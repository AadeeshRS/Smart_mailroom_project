import type { Prisma } from '@prisma/client';
import { signedIn, type Ctx, type Input, type S } from '../../contract.js';
import { uniqueViolation } from '../../core/db.js';
import { fail } from '../../core/errors.js';
import { id } from '../../core/security.js';
import { classify, normalCode } from '../parcels/carrier.js';
import { claim } from '../parcels/matching.js';
import { toMyParcel } from '../parcels/service.js';

const DAY = 86_400_000;
/** Each open request reserves its AWB for everyone, so one member can't hold on to too many. */
const MAX_OPEN = 20;

const include = { parcel: true } satisfies Prisma.ParcelRequestInclude;
type Full = Prisma.ParcelRequestGetPayload<{ include: typeof include }>;

const toRequest = (r: Full): S<'MyRequest'> => ({
  id: r.id,
  awb: r.awb,
  orderId: r.orderId,
  carrier: r.carrier,
  deliveryOtp: r.deliveryOtp,
  status: r.status,
  createdAt: r.createdAt.toISOString(),
  expiresAt: r.expiresAt.toISOString(),
  // Only once it's theirs: a CONFLICT parcel is still the operator's to decide.
  ...(r.parcel?.recipientId === r.userId && { parcel: toMyParcel(r.parcel) }),
});

const load = async (ctx: Ctx, requestId: string) =>
  (await ctx.db.parcelRequest.findFirst({ where: { id: requestId, userId: signedIn(ctx).user.id }, include })) ??
  fail('NOT_FOUND', 'Request not found.');

export async function list(_input: Input<'listMyRequests'>, ctx: Ctx) {
  const rows = await ctx.db.parcelRequest.findMany({
    where: { userId: signedIn(ctx).user.id },
    include,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 100,
  });
  return { items: rows.map(toRequest) };
}

/** Save the request, then the reverse trigger (plan §4.7): a parcel already linked to this member answers it,
 * else an unlinked one with this AWB or order ID goes through matching step 1 now. */
export async function create(input: Input<'createRequest'>, ctx: Ctx) {
  const { user } = signedIn(ctx);
  const awb = normalCode(input.awb) || fail('VALIDATION', 'Enter the AWB.');
  if (classify(awb).kind === 'ORDER_ID')
    fail(
      'VALIDATION',
      'That looks like an order ID. Enter the tracking (AWB) number, and put the order ID in the second field.',
    );
  const orderId = input.orderId ? normalCode(input.orderId) || null : null;
  // ponytail: count-then-insert can overshoot by a request or two under a race; harmless for a soft cap.
  if ((await ctx.db.parcelRequest.count({ where: { userId: user.id, status: 'OPEN' } })) >= MAX_OPEN)
    fail('VALIDATION', `You have ${MAX_OPEN} open requests. Cancel one you no longer need first.`);
  const requestId = id('req');
  try {
    await ctx.db.$transaction(async tx => {
      const request = await tx.parcelRequest.create({
        data: {
          id: requestId,
          userId: user.id,
          awb,
          orderId,
          carrier: classify(awb).carrier,
          deliveryOtp: input.deliveryOtp ?? null,
          createdAt: ctx.now,
          expiresAt: new Date(+ctx.now + ctx.config.requestExpiryDays * DAY),
        },
      });
      const parcels = await tx.parcel.findMany({
        where: { status: 'IN_MAILROOM', OR: [{ awb }, ...(orderId ? [{ orderId }] : [])] },
        orderBy: { receivedAt: 'desc' },
        take: 5,
      });
      const mine = parcels.find(p => p.recipientId === user.id);
      const free = parcels.find(p => !p.recipientId && p.matchFlag !== 'CONFLICT');
      if (mine)
        await tx.parcelRequest.update({
          where: { id: request.id },
          data: { status: 'MATCHED', parcelId: mine.id, deliveryOtp: null },
        });
      else if (free) await claim(tx, free, { ...request, user }, user.id);
    });
  } catch (error) {
    if (uniqueViolation(error) !== 'one_open_request_per_awb') throw error;
    fail('REQUEST_EXISTS', 'There’s already an open request for this AWB. If it isn’t in your list, ask the mailroom.');
  }
  return toRequest(await load(ctx, requestId));
}

/** Change an open request; NOT_FOUND if it isn't the member's, REQUEST_CLOSED once it's matched or closed. */
async function change(ctx: Ctx, requestId: string, data: Prisma.ParcelRequestUpdateManyMutationInput) {
  const { count } = await ctx.db.parcelRequest.updateMany({
    where: { id: requestId, userId: signedIn(ctx).user.id, status: 'OPEN' },
    data,
  });
  if (!count) {
    await load(ctx, requestId);
    fail('REQUEST_CLOSED', 'This request is no longer open.');
  }
}

export async function update(input: Input<'updateRequest'>, ctx: Ctx) {
  await change(ctx, input.requestId, { deliveryOtp: input.deliveryOtp });
  return toRequest(await load(ctx, input.requestId));
}

export async function cancel(input: Input<'cancelRequest'>, ctx: Ctx) {
  await change(ctx, input.requestId, { status: 'CANCELLED', deliveryOtp: null });
  return { ok: true as const };
}
