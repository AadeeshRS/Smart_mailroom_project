import type { Parcel, Prisma } from '@prisma/client';
import { signedIn, type Ctx, type Input, type S } from '../../contract.js';
import { uniqueViolation } from '../../core/db.js';
import { fail } from '../../core/errors.js';
import { phone } from '../../core/phone.js';
import { id } from '../../core/security.js';
import { memberSummary } from '../users/service.js';
import { classify, normalCode } from './carrier.js';
import { findRecipient, link, matchable, openRequest } from './matching.js';

const include = {
  recipient: { include: { hostel: true } },
  receivedBy: { select: { name: true } },
} satisfies Prisma.ParcelInclude;
type Full = Prisma.ParcelGetPayload<{ include: typeof include }>;
export { include as parcelInclude };

export const toParcel = (p: Full): S<'OperatorParcel'> => ({
  id: p.id,
  awb: p.awb,
  orderId: p.orderId,
  carrier: p.carrier as S<'OperatorParcel'>['carrier'],
  labelName: p.labelName,
  labelPhone: p.labelPhone,
  labelEmail: p.labelEmail,
  labelHostel: p.labelHostel,
  labelRoom: p.labelRoom,
  shelf: p.shelf,
  note: p.note,
  status: p.status,
  recipient: p.recipient && memberSummary(p.recipient),
  matchSource: p.matchSource,
  matchFlag: p.matchFlag,
  receivedAt: p.receivedAt.toISOString(),
  receivedBy: p.receivedBy.name,
  collectedAt: p.collectedAt?.toISOString() ?? null,
});

const load = async (ctx: Ctx, parcelId: string) =>
  (await ctx.db.parcel.findUnique({ where: { id: parcelId }, include })) ?? fail('NOT_FOUND', 'Parcel not found.');

export async function lookup(input: Input<'lookupParcel'>, ctx: Ctx) {
  const result = classify(input.code);
  const existing = await ctx.db.parcel.findMany({
    where: { OR: [{ awb: result.code }, { orderId: result.code }] },
    include,
    orderBy: { receivedAt: 'desc' },
    take: 5,
  });
  const request = await openRequest(ctx.db, result.code, result.code);
  return {
    ...result,
    existing: existing.map(toParcel),
    ...(request && {
      request: {
        id: request.id,
        member: memberSummary(request.user),
        orderId: request.orderId,
        deliveryOtp: request.deliveryOtp,
        createdAt: request.createdAt.toISOString(),
      },
    }),
  };
}

const text = (value?: string) => value?.trim() || null;

/** Save a parcel and match it, in one transaction. The id comes from the phone, so a retry after a lost
 * response hits the primary key and gets the parcel that was already saved. */
export async function intake(input: Input<'intakeParcel'>, ctx: Ctx) {
  const { user } = signedIn(ctx);
  const awb = input.awb ? normalCode(input.awb) || null : null;
  const orderId = input.orderId ? normalCode(input.orderId) || null : null;
  if (!awb && !orderId) fail('VALIDATION', 'Enter the AWB or the order ID.');
  const shelf = text(input.shelf) ?? fail('VALIDATION', 'Enter the shelf.');
  const data = {
    id: input.id.toLowerCase(),
    awb,
    orderId,
    carrier: input.carrier ?? (awb ? classify(awb).carrier : null),
    labelName: text(input.labelName),
    labelPhone: input.labelPhone ? phone(input.labelPhone) : null,
    labelEmail: text(input.labelEmail)?.toLowerCase() ?? null,
    labelHostel: text(input.labelHostel),
    labelRoom: text(input.labelRoom),
    shelf,
    note: text(input.note),
    receivedById: user.id,
    receivedAt: ctx.now,
  };
  try {
    await ctx.db.$transaction(async tx => {
      const parcel = await tx.parcel.create({ data });
      await tx.auditEvent.create({
        data: { id: id('aud'), actorId: user.id, parcelId: parcel.id, action: 'RECEIVED', detail: `Shelf ${shelf}` },
      });
      await findRecipient(tx, parcel, user.id, ctx.now);
    });
  } catch (error) {
    if (uniqueViolation(error) !== 'id') throw error;
  }
  return toParcel(await load(ctx, data.id));
}

// ponytail: substring search scans the parcel table; fine for a semester (~10k rows), add pg_trgm beyond that.
export async function list(input: Input<'listParcels'>, ctx: Ctx) {
  const q = input.q?.trim();
  const digits = q?.replace(/\D/g, '') ?? '';
  const take = input.limit ?? 20;
  const rows = await ctx.db.parcel.findMany({
    where: {
      ...(input.status ? { status: input.status } : {}),
      ...(input.unmatched ? { recipientId: null } : {}),
      ...(q
        ? {
            OR: [
              { awb: { contains: normalCode(q) } },
              { orderId: { contains: normalCode(q) } },
              { labelName: { contains: q, mode: 'insensitive' } },
              ...(digits.length >= 4 ? [{ labelPhone: { contains: digits } }] : []),
              { recipient: { name: { contains: q, mode: 'insensitive' } } },
              { shelf: { equals: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    },
    include,
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const items = rows.slice(0, take).map(toParcel);
  return rows.length > take ? { items, nextCursor: items.at(-1)!.id } : { items };
}

export async function detail(input: Input<'getParcel'>, ctx: Ctx) {
  const parcel = await load(ctx, input.parcelId);
  const audits = await ctx.db.auditEvent.findMany({
    where: { parcelId: parcel.id },
    include: { actor: { select: { name: true } } },
    orderBy: { at: 'asc' },
  });
  return {
    parcel: toParcel(parcel),
    history: audits.map(a => ({ at: a.at.toISOString(), actor: a.actor.name, action: a.action, detail: a.detail })),
  };
}

export async function assign(input: Input<'assignParcel'>, ctx: Ctx) {
  const { user } = signedIn(ctx);
  const parcel = await load(ctx, input.parcelId);
  const member = await ctx.db.user.findFirst({ where: { id: input.userId, ...matchable } });
  if (!member) fail('NOT_FOUND', 'Member not found, or their email is not verified yet.');
  if (!(await ctx.db.$transaction(tx => link(tx, parcel, member.id, 'MANUAL', user.id, ctx.now)))) {
    const now = await load(ctx, parcel.id);
    if (now.status !== 'IN_MAILROOM') fail('NOT_IN_MAILROOM', 'This parcel has already left the mailroom.');
    fail('ALREADY_ASSIGNED', `This parcel is already linked to ${now.recipient?.name ?? 'a member'}.`);
  }
  return toParcel(await load(ctx, parcel.id));
}

/** A parcel as its member sees it: no label contact details. */
export const toMyParcel = (p: Parcel): S<'MyParcel'> => ({
  id: p.id,
  awb: p.awb,
  orderId: p.orderId,
  carrier: p.carrier,
  status: p.status,
  receivedAt: p.receivedAt.toISOString(),
  collectedAt: p.collectedAt?.toISOString() ?? null,
});

/** The signed-in member's parcels: waiting in the mailroom, or the latest 100 collected or returned. */
export async function mine(input: Input<'listMyParcels'>, ctx: Ctx) {
  const { user } = signedIn(ctx);
  const rows = await ctx.db.parcel.findMany({
    where: { recipientId: user.id, status: input.view === 'ready' ? 'IN_MAILROOM' : { in: ['COLLECTED', 'RETURNED'] } },
    orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });
  return { items: rows.map(toMyParcel) };
}
