import type { PrismaClient } from '@prisma/client';
import { transaction } from './db.js';
/** Internal adapter boundary, deliberately not exposed as a student/staff route.
 * Authenticated provider adapters would call this only after verifying callbacks.
 */
export async function deliveryResult(db: PrismaClient, input: { attemptId: string; eventId: string; state: 'ACCEPTED' | 'DELIVERED' | 'FAILED'; occurredAt: Date }) {
  return transaction(db, async tx => {
    if (await tx.deliveryResult.findUnique({ where: { eventId: input.eventId } })) return false;
    const attempt = await tx.deliveryAttempt.findUnique({ where: { id: input.attemptId } });
    if (!attempt || attempt.processedAt && attempt.processedAt > input.occurredAt || ['DELIVERED', 'FAILED'].includes(attempt.state) || attempt.state === 'ACCEPTED' && input.state === 'ACCEPTED') return false;
    if (attempt.state === 'PENDING' && input.state === 'DELIVERED') return false;
    await tx.deliveryResult.create({ data: { eventId: input.eventId, attemptId: input.attemptId, state: input.state, occurredAt: input.occurredAt } });
    await tx.deliveryAttempt.update({ where: { id: attempt.id }, data: { state: input.state, providerEventId: input.eventId, processedAt: input.occurredAt } });
    return true;
  });
}
export async function processOutbox(db: PrismaClient) {
  const pending = await db.deliveryAttempt.findMany({ where: { state: 'PENDING', simulated: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: 50 });
  for (const attempt of pending) await deliveryResult(db, { attemptId: attempt.id, eventId: `simulation:${attempt.id}`, state: 'ACCEPTED', occurredAt: new Date(Math.max(Date.now(), +attempt.createdAt)) });
  return pending.length;
}
