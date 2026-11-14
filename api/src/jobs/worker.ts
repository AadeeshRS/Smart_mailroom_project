import type { PrismaClient } from '@prisma/client';

const DAY = 86_400_000;

/** Delete rows nothing reads any more, so these tables don't grow forever (F15). */
export async function cleanup(db: PrismaClient, now: Date) {
  const dayAgo = new Date(+now - DAY);
  await db.session.deleteMany({ where: { OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }] } });
  await db.rateWindow.deleteMany({ where: { expiresAt: { lte: now } } });
  await db.emailCode.deleteMany({ where: { expiresAt: { lte: dayAgo } } });
  // A self-registration that was never verified frees its phone and ID number after a day.
  await db.user.deleteMany({ where: { role: 'MEMBER', emailVerifiedAt: null, createdAt: { lte: dayAgo } } });
}

/** One background loop per API process. ponytail: fine for one instance; run it in a separate service
 * (or take an advisory lock per run) before scaling the API out. */
export function startWorker(db: PrismaClient, everyMs = 60_000) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await cleanup(db, new Date());
    } catch (error) {
      console.error('Worker run failed:', error);
    } finally {
      running = false;
    }
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
