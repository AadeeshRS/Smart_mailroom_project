import type { Collection, Parcel, Prisma, PrismaClient } from '@prisma/client';
import { signedIn, type Ctx, type Input, type S } from '../../contract.js';
import { fail } from '../../core/errors.js';
import { limit } from '../../core/rate.js';
import { equal, id, otp, secretDigest } from '../../core/security.js';
import { queue } from '../notifications/service.js';
import { toMyParcel } from '../parcels/service.js';
import { memberSummary } from '../users/service.js';

const MINUTE = 60_000;
const ATTEMPTS = 5;
const OPEN = { in: ['PENDING', 'VERIFIED'] } satisfies Prisma.EnumCollectionStatusFilter;
const include = { user: { include: { hostel: true } } } satisfies Prisma.CollectionInclude;
type Full = Prisma.CollectionGetPayload<{ include: typeof include }>;

/** Words of two letters or more, lowercased: a shared initial alone isn't a match. */
const words = (name: string) =>
  new Set(
    name
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(word => word.length > 1),
  );

/** Plan 5.5: the label name shares a word with the member's name. An empty label never matches. */
export function namesMatch(label: string | null, member: string) {
  const theirs = words(member);
  return [...words(label ?? '')].some(word => theirs.has(word));
}

const codeDigest = (ctx: Ctx, collectionId: string, code: string) =>
  secretDigest(ctx.config.pepper, collectionId, 'COLLECT', code);
const minutes = (ctx: Ctx) => new Date(+ctx.now + ctx.config.collectionCodeMinutes * MINUTE);

/** The members' parcels waiting in the mailroom, oldest first. */
const waitingFor = (db: PrismaClient, userIds: string[]) =>
  db.parcel.findMany({
    where: { recipientId: { in: userIds }, status: 'IN_MAILROOM' },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
  });

const toCollection = (c: Full, parcels: Parcel[]): S<'OperatorCollection'> => ({
  id: c.id,
  status: c.status === 'VERIFIED' ? 'VERIFIED' : 'PENDING',
  member: memberSummary(c.user),
  requestedAt: c.requestedAt.toISOString(),
  expiresAt: c.expiresAt.toISOString(),
  attemptsLeft: ATTEMPTS - c.attempts,
  parcels: parcels.map(p => ({
    id: p.id,
    awb: p.awb,
    orderId: p.orderId,
    carrier: p.carrier,
    shelf: p.shelf,
    labelName: p.labelName,
    nameMatches: namesMatch(p.labelName, c.user.name),
    receivedAt: p.receivedAt.toISOString(),
  })),
});

const load = async (ctx: Ctx, collectionId: string) =>
  (await ctx.db.collection.findUnique({ where: { id: collectionId }, include })) ??
  fail('NOT_FOUND', 'Code not found.');

/** The code must be open, unexpired and at this step, or the operator is told why not. */
function ready(c: Collection, ctx: Ctx, step: 'PENDING' | 'VERIFIED') {
  if (c.status === 'COMPLETED') fail('ALREADY_COLLECTED', 'These parcels were already handed over with this code.');
  const open = (c.status === 'PENDING' || c.status === 'VERIFIED') && c.expiresAt > ctx.now;
  if (!open) fail('CODE_EXPIRED', 'This code has expired or was replaced. Ask the member to tap Collect now again.');
  if (c.status !== step)
    fail('VALIDATION', step === 'VERIFIED' ? 'Check the member’s code first.' : 'This code is already verified.');
}

/** Collect now: one code for all the member's waiting parcels, replacing their open code. */
export async function collectNow(_input: Input<'collectNow'>, ctx: Ctx) {
  const { user } = signedIn(ctx);
  await limit(ctx.db, `collect:${user.id}`, 6, ctx.now, MINUTE);
  const parcels = await waitingFor(ctx.db, [user.id]);
  if (!parcels.length) fail('NOT_FOUND', 'No parcels are waiting for you at the mailroom.');
  const code = otp();
  const collectionId = id('col');
  const expiresAt = minutes(ctx);
  await ctx.db.$transaction(async tx => {
    // Two taps by the same member queue here, so replacing the open code can't trip the one-open-code index.
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id} FOR UPDATE`;
    await tx.collection.updateMany({ where: { userId: user.id, status: OPEN }, data: { status: 'CANCELLED' } });
    await tx.collection.create({
      data: {
        id: collectionId,
        userId: user.id,
        otpDigest: codeDigest(ctx, collectionId, code),
        requestedAt: ctx.now,
        expiresAt,
      },
    });
  });
  return { otp: code, expiresAt: expiresAt.toISOString(), parcels: parcels.map(toMyParcel) };
}

export async function cancel(_input: Input<'cancelCollection'>, ctx: Ctx) {
  const { user } = signedIn(ctx);
  await ctx.db.collection.updateMany({ where: { userId: user.id, status: OPEN }, data: { status: 'CANCELLED' } });
  return { ok: true as const };
}

/** The giveaway queue: each open code once, with the member's waiting parcels. */
export async function list(_input: Input<'listCollections'>, ctx: Ctx) {
  const rows = await ctx.db.collection.findMany({
    where: { status: OPEN, expiresAt: { gt: ctx.now } },
    include,
    orderBy: { requestedAt: 'asc' },
    take: 50,
  });
  const parcels = await waitingFor(
    ctx.db,
    rows.map(r => r.userId),
  );
  return {
    items: rows.map(r =>
      toCollection(
        r,
        parcels.filter(p => p.recipientId === r.userId),
      ),
    ),
  };
}

/** Check the code. Wrong guesses count atomically; the fifth cancels it. */
export async function verify(input: Input<'verifyCollection'>, ctx: Ctx) {
  const c = await load(ctx, input.collectionId);
  ready(c, ctx, 'PENDING');
  if (!equal(codeDigest(ctx, c.id, input.otp), c.otpDigest)) {
    const [row] = await ctx.db.$queryRaw<{ attempts: number }[]>`
      UPDATE "Collection" SET "attempts" = "attempts" + 1,
        "status" = CASE WHEN "attempts" + 1 >= ${ATTEMPTS} THEN 'CANCELLED'::"CollectionStatus" ELSE "status" END
      WHERE "id" = ${c.id} AND "status" = 'PENDING' RETURNING "attempts"`;
    const left = ATTEMPTS - (row?.attempts ?? ATTEMPTS);
    fail(
      'CODE_INVALID',
      left
        ? `Wrong code. ${left} ${left === 1 ? 'try' : 'tries'} left.`
        : `Wrong code ${ATTEMPTS} times, so it’s cancelled. Ask the member to tap Collect now again.`,
    );
  }
  // A verified code gets a fresh window for ticking the parcels.
  const { count } = await ctx.db.collection.updateMany({
    where: { id: c.id, status: 'PENDING', expiresAt: { gt: ctx.now } },
    data: { status: 'VERIFIED', expiresAt: minutes(ctx) },
  });
  if (!count) fail('CODE_EXPIRED', 'This code has expired or was replaced. Ask the member to tap Collect now again.');
  return toCollection(await load(ctx, c.id), await waitingFor(ctx.db, [c.userId]));
}

/** Hand over the ticked parcels, all or nothing: the code and every parcel change state conditionally in one
 * transaction, so a double tap or a parcel collected elsewhere rolls the whole handover back. */
export async function complete(input: Input<'completeCollection'>, ctx: Ctx) {
  const { user: operator } = signedIn(ctx);
  const c = await load(ctx, input.collectionId);
  ready(c, ctx, 'VERIFIED');
  const parcels = await ctx.db.parcel.findMany({
    where: { id: { in: input.parcelIds }, recipientId: c.userId, status: 'IN_MAILROOM' },
  });
  const gone = () =>
    fail('ALREADY_COLLECTED', 'Some of these parcels are no longer waiting for this member. Refresh and try again.');
  if (parcels.length !== input.parcelIds.length) gone();
  if (!input.idChecked && parcels.some(p => !namesMatch(p.labelName, c.user.name)))
    fail('ID_CHECK_REQUIRED', 'A label name doesn’t match the member. Check their college ID card first.');
  await ctx.db.$transaction(async tx => {
    const used = await tx.collection.updateMany({
      where: { id: c.id, status: 'VERIFIED', expiresAt: { gt: ctx.now } },
      data: { status: 'COMPLETED', completedAt: ctx.now, operatorId: operator.id },
    });
    if (!used.count) fail('ALREADY_COLLECTED', 'This code was used or expired a moment ago.');
    const handed = await tx.parcel.updateMany({
      where: { id: { in: input.parcelIds }, recipientId: c.userId, status: 'IN_MAILROOM' },
      data: { status: 'COLLECTED', collectedAt: ctx.now, collectedById: operator.id },
    });
    if (handed.count !== input.parcelIds.length) gone();
    await tx.auditEvent.createMany({
      data: parcels.map(p => ({
        id: id('aud'),
        actorId: operator.id,
        parcelId: p.id,
        action: 'COLLECTED',
        detail:
          `Handed to ${c.user.name} with their Collect now code; label name ` +
          `${namesMatch(p.labelName, c.user.name) ? 'matches' : 'differs'}; ID card ` +
          `${input.idChecked ? 'checked' : 'not checked'}`,
      })),
    });
    await queue(tx, {
      userId: c.userId,
      type: 'COLLECTED',
      title: 'Collected',
      body: `${parcels.length === 1 ? 'Your parcel was' : `${parcels.length} parcels were`} handed over at the mailroom.`,
    });
  });
  return { ok: true as const };
}
