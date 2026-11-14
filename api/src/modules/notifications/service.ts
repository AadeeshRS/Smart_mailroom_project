import type { Prisma } from '@prisma/client';
import { signedIn, type Ctx, type Input } from '../../contract.js';
import { id } from '../../core/security.js';

/** Queue an in-app notification (and its push, sent later by the worker) in the same transaction as the
 * change that caused it, so a rolled-back change never notifies anyone. */
export const queue = (
  tx: Prisma.TransactionClient,
  notice: { userId: string; type: string; title: string; body: string; parcelId?: string },
) => tx.notification.create({ data: { id: id('ntf'), ...notice } });

/** The token belongs to the current session: revoking the session stops its pushes, deleting it deletes the token. */
export async function registerDevice(input: Input<'registerDevice'>, ctx: Ctx) {
  const { session } = signedIn(ctx);
  const data = { sessionId: session.id, platform: input.platform };
  await ctx.db.device.upsert({ where: { token: input.token }, create: { token: input.token, ...data }, update: data });
  return { ok: true as const };
}

export async function list(_input: Input<'listNotifications'>, ctx: Ctx) {
  const { user } = signedIn(ctx);
  const rows = await ctx.db.notification.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return {
    items: rows.map(n => ({
      id: n.id,
      type: n.type,
      title: n.title,
      body: n.body,
      createdAt: n.createdAt.toISOString(),
      read: !!n.readAt,
    })),
  };
}

export async function markRead(_input: Input<'markNotificationsRead'>, ctx: Ctx) {
  const { user } = signedIn(ctx);
  await ctx.db.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: ctx.now } });
  return { ok: true as const };
}
