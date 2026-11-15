import type { PrismaClient } from '@prisma/client';
import type { Config } from '../core/config.js';
import { remindWaiting } from '../modules/admin/service.js';
import { sendPushes } from '../modules/notifications/push.js';
import type { Audience } from '../realtime.js';

const DAY = 86_400_000;
/** What a job changed that someone can see: these members, and/or staff screens. */
export type Changes = { users?: string[]; staff?: boolean };

/** Delete rows nothing reads any more, so these tables don't grow forever (F15), and expire old requests and codes. */
export async function cleanup(db: PrismaClient, now: Date): Promise<Changes> {
  const dayAgo = new Date(+now - DAY);
  await db.session.deleteMany({ where: { OR: [{ expiresAt: { lte: now } }, { revokedAt: { not: null } }] } });
  await db.rateWindow.deleteMany({ where: { expiresAt: { lte: now } } });
  await db.emailCode.deleteMany({ where: { expiresAt: { lte: dayAgo } } });
  const requests = await db.parcelRequest.findMany({
    where: { status: 'OPEN', expiresAt: { lte: now } },
    select: { id: true, userId: true },
  });
  if (requests.length)
    await db.parcelRequest.updateMany({
      where: { id: { in: requests.map(r => r.id) }, status: 'OPEN' },
      data: { status: 'EXPIRED', deliveryOtp: null },
    });
  const codes = await db.collection.findMany({
    where: { status: { in: ['PENDING', 'VERIFIED'] }, expiresAt: { lte: now } },
    select: { id: true, userId: true },
  });
  if (codes.length)
    await db.collection.updateMany({
      where: { id: { in: codes.map(c => c.id) }, status: { in: ['PENDING', 'VERIFIED'] } },
      data: { status: 'EXPIRED' },
    });
  // A self-registration that was never verified frees its phone and ID number after a day.
  await db.user.deleteMany({ where: { role: 'MEMBER', emailVerifiedAt: null, createdAt: { lte: dayAgo } } });
  const users = [...requests, ...codes].map(row => row.userId);
  return { users, staff: users.length > 0 };
}

const label = { labelName: null, labelPhone: null, labelEmail: null, labelHostel: null, labelRoom: null, note: null };

/** Plan 8.5 (F36): `days` after a parcel left the mailroom (collected; returned ones count from receipt, as no
 * return time is kept), erase everything copied from its label. The parcel, its tracking number and the
 * append-only audit trail stay, so the record that it was handed over survives without the label's contents. */
export async function pseudonymise(db: PrismaClient, now: Date, days: number): Promise<Changes> {
  const before = new Date(+now - days * DAY);
  const { count } = await db.parcel.updateMany({
    where: {
      OR: [
        { status: 'COLLECTED', collectedAt: { lte: before } },
        { status: 'RETURNED', receivedAt: { lte: before } },
      ],
      AND: { OR: Object.keys(label).map(field => ({ [field]: { not: null } })) },
    },
    data: label,
  });
  return { staff: count > 0 };
}

/** One worker run: every job, then who must hear about it. Undefined when nothing visible changed, so an idle
 * run sends no live-update frame (WS-03). */
export async function runJobs(db: PrismaClient, settings: Config, now: Date): Promise<Audience | undefined> {
  const users = new Set<string>();
  let staff = false;
  const jobs: (() => Promise<Changes | void>)[] = [
    () => cleanup(db, now),
    () => remindWaiting(db, now, settings.reminderAfterDays),
    () => pseudonymise(db, now, settings.retentionDays),
    () => sendPushes(db, now),
  ];
  for (const job of jobs)
    try {
      const changes = await job();
      changes?.users?.forEach(user => users.add(user));
      staff ||= !!changes?.staff;
    } catch (error) {
      console.error('Worker job failed:', error);
    }
  return users.size || staff ? { users, staff } : undefined;
}

/** One background loop per API process. ponytail: fine for one instance; run it in a separate service
 * (or take an advisory lock per run) before scaling the API out. */
export function startWorker(
  db: PrismaClient,
  settings: Config,
  everyMs = 60_000,
  changed?: (audience: Audience) => void,
) {
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    const audience = await runJobs(db, settings, new Date());
    if (audience) changed?.(audience);
    running = false;
  }, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
