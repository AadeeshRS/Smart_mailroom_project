import type { Parcel, PrismaClient } from '@prisma/client';
import { signedIn, type Ctx, type Input } from '../../contract.js';
import { fail } from '../../core/errors.js';
import { id } from '../../core/security.js';
import { queue } from '../notifications/service.js';
import { describe } from '../parcels/matching.js';
import { parcelInclude, toParcel } from '../parcels/service.js';

const DAY = 86_400_000;
const waiting = { status: 'IN_MAILROOM' } as const;
const leftAlready = () => fail('NOT_IN_MAILROOM', 'This parcel has already left the mailroom.');
const reminder = (parcel: Parcel, userId: string) => ({
  userId,
  parcelId: parcel.id,
  type: 'REMINDER',
  title: 'Your parcel is still waiting',
  body: `${describe(parcel)} is still at the mailroom. Open the app and tap Collect now, then bring your college ID.`,
});

/** Dashboard counts: every one is an indexed count, run in parallel. */
export async function stats(input: Input<'getStats'>, ctx: Ctx) {
  const day = { gte: new Date(input.dayStart), lt: new Date(Date.parse(input.dayStart) + DAY) };
  const limit = ctx.config.waitingTooLongDays;
  const ago = (days: number) => new Date(+ctx.now - days * DAY);
  const [received, collected, total, recent, old, unmatched, openRequests] = await Promise.all([
    ctx.db.parcel.count({ where: { receivedAt: day } }),
    ctx.db.parcel.count({ where: { collectedAt: day } }),
    ctx.db.parcel.count({ where: waiting }),
    ctx.db.parcel.count({ where: { ...waiting, receivedAt: { gt: ago(Math.min(3, limit)) } } }),
    ctx.db.parcel.count({ where: { ...waiting, receivedAt: { lt: ago(limit) } } }),
    ctx.db.parcel.count({ where: { ...waiting, recipientId: null } }),
    ctx.db.parcelRequest.count({ where: { status: 'OPEN' } }),
  ]);
  return {
    received,
    collected,
    waiting: total,
    waitingByAge: { underThreeDays: recent, upToLimit: total - recent - old, overLimit: old },
    tooLongDays: limit,
    unmatched,
    openRequests,
  };
}

// ponytail: the 200 oldest only; add keyset pages if a backlog ever gets that long.
export async function aging(input: Input<'listAging'>, ctx: Ctx) {
  const days = input.olderThanDays ?? ctx.config.waitingTooLongDays;
  const rows = await ctx.db.parcel.findMany({
    where: { ...waiting, receivedAt: { lt: new Date(+ctx.now - days * DAY) } },
    include: parcelInclude,
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
    take: 200,
  });
  return {
    olderThanDays: days,
    items: rows.map(p => ({
      parcel: toParcel(p),
      daysWaiting: Math.floor((+ctx.now - +p.receivedAt) / DAY),
      lastRemindedAt: p.lastRemindedAt?.toISOString() ?? null,
    })),
  };
}

const load = async (ctx: Ctx, parcelId: string) =>
  (await ctx.db.parcel.findUnique({ where: { id: parcelId } })) ?? fail('NOT_FOUND', 'Parcel not found.');

export async function remind(input: Input<'remindParcel'>, ctx: Ctx) {
  const { user } = signedIn(ctx);
  const parcel = await load(ctx, input.parcelId);
  if (parcel.status !== 'IN_MAILROOM') leftAlready();
  const memberId =
    parcel.recipientId ?? fail('VALIDATION', 'This parcel isn’t linked to a member yet. Assign it first.');
  await ctx.db.$transaction(async tx => {
    await tx.parcel.update({ where: { id: parcel.id }, data: { lastRemindedAt: ctx.now } });
    await tx.auditEvent.create({
      data: { id: id('aud'), actorId: user.id, parcelId: parcel.id, action: 'REMINDED', detail: 'Reminder sent' },
    });
    await queue(tx, reminder(parcel, memberId));
  });
  return { ok: true as const };
}

/** The worker's automatic reminders: a linked parcel waiting `everyDays` days gets one, then another every
 * `everyDays` days. The update is conditional on lastRemindedAt, so a run racing the admin's button reminds once. */
export async function remindWaiting(db: PrismaClient, now: Date, everyDays: number) {
  const reminded: string[] = [];
  const due = new Date(+now - everyDays * DAY);
  const parcels = await db.parcel.findMany({
    where: {
      ...waiting,
      recipientId: { not: null },
      receivedAt: { lte: due },
      OR: [{ lastRemindedAt: null }, { lastRemindedAt: { lte: due } }],
    },
    orderBy: { receivedAt: 'asc' },
    take: 200,
  });
  for (const parcel of parcels)
    await db.$transaction(async tx => {
      const { count } = await tx.parcel.updateMany({
        where: { id: parcel.id, ...waiting, recipientId: parcel.recipientId, lastRemindedAt: parcel.lastRemindedAt },
        data: { lastRemindedAt: now },
      });
      if (count) {
        await queue(tx, reminder(parcel, parcel.recipientId!));
        reminded.push(parcel.recipientId!);
      }
    });
  return { users: reminded, staff: reminded.length > 0 };
}

/** Returned to the sender: a conditional update, so a parcel collected a moment ago can't be returned too. */
export async function returnToSender(input: Input<'returnParcel'>, ctx: Ctx) {
  const { user } = signedIn(ctx);
  const parcel = await load(ctx, input.parcelId);
  await ctx.db.$transaction(async tx => {
    const { count } = await tx.parcel.updateMany({
      where: { id: parcel.id, ...waiting },
      data: { status: 'RETURNED' },
    });
    if (!count) leftAlready();
    await tx.auditEvent.create({
      data: {
        id: id('aud'),
        actorId: user.id,
        parcelId: parcel.id,
        action: 'RETURNED',
        detail: 'Returned to the sender',
      },
    });
    if (parcel.recipientId)
      await queue(tx, {
        userId: parcel.recipientId,
        parcelId: parcel.id,
        type: 'RETURNED',
        title: 'Parcel returned to the sender',
        body: `${describe(parcel)} was returned to the sender. Ask the mailroom if that's unexpected.`,
      });
  });
  return { ok: true as const };
}
