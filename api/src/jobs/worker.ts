import type { PrismaClient } from '@prisma/client';
import type { Config } from '../core/config.js';
import { remindWaiting } from '../modules/admin/service.js';
import { sendPushes } from '../modules/notifications/push.js';

const DAY = 86_400_000;

/** Delete rows nothing reads any more, so these tables don't grow forever (F15), and expire old requests and codes. */
export async function cleanup(db: PrismaClient, now: Date) {
  const dayAgo = new Date(+now - DAY);
  await db.session.deleteMany({ where: { OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }] } });
  await db.rateWindow.deleteMany({ where: { expiresAt: { lte: now } } });
  await db.emailCode.deleteMany({ where: { expiresAt: { lte: dayAgo } } });
  await db.parcelRequest.updateMany({
    where: { status: 'OPEN', expiresAt: { lte: now } },
    data: { status: 'EXPIRED', deliveryOtp: null },
  });
  await db.collection.updateMany({
    where: { status: { in: ['PENDING', 'VERIFIED'] }, expiresAt: { lte: now } },
    data: { status: 'EXPIRED' },
  });
  // A self-registration that was never verified frees its phone and ID number after a day.
  await db.user.deleteMany({ where: { role: 'MEMBER', emailVerifiedAt: null, createdAt: { lte: dayAgo } } });
}

/** One background loop per API process. ponytail: fine for one instance; run it in a separate service
 * (or take an advisory lock per run) before scaling the API out. */
export function startWorker(db: PrismaClient, settings: Config, everyMs = 60_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    const now = new Date();
    const jobs = [
      () => cleanup(db, now),
      () => remindWaiting(db, now, settings.reminderAfterDays),
      () => sendPushes(db, now),
    ];
    for (const job of jobs)
      try {
        await job();
      } catch (error) {
        console.error('Worker job failed:', error);
      }
    running = false;
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
