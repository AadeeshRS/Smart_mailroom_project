import type { Notification, PrismaClient } from '@prisma/client';

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';
const ATTEMPTS = 5;
type Ticket = { status?: string; details?: { error?: string } };

/** Send pending pushes through Expo's push API with plain fetch (plan §4.10), to every device of a live session.
 * A failed try waits 1, 2, 4 then 8 minutes; the 5th failure is FAILED. A notification for a member with no
 * device is SKIPPED, and tokens Expo reports as DeviceNotRegistered are deleted.
 * ponytail: push tickets only; also reading Expo's receipts would catch tokens APNs/FCM reject later. */
export async function sendPushes(db: PrismaClient, now: Date, fetcher: typeof fetch = fetch) {
  const pending = await db.notification.findMany({
    where: { pushState: 'PENDING', pushAfter: { lte: now } },
    orderBy: { createdAt: 'asc' },
    take: 50,
  });
  if (!pending.length) return;
  const devices = await db.device.findMany({
    where: { session: { userId: { in: pending.map(n => n.userId) }, revokedAt: null, expiresAt: { gt: now } } },
    select: { token: true, session: { select: { userId: true } } },
  });
  const messages = pending.flatMap(n =>
    devices.filter(d => d.session.userId === n.userId).map(d => ({ notification: n, token: d.token })),
  );
  const delivered = new Set<Notification>();
  const gone: string[] = [];
  for (let start = 0; start < messages.length; start += 100) {
    const batch = messages.slice(start, start + 100);
    let tickets: Ticket[] = [];
    try {
      const response = await fetcher(EXPO_PUSH, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(
          batch.map(({ notification: n, token }) => ({
            to: token,
            title: n.title,
            body: n.body,
            sound: 'default',
            data: { type: n.type, parcelId: n.parcelId },
          })),
        ),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.ok) tickets = ((await response.json()) as { data?: Ticket[] }).data ?? [];
    } catch {
      // Offline or timed out: every message in the batch counts as a failed try.
    }
    batch.forEach(({ notification, token }, k) => {
      if (tickets[k]?.status === 'ok') delivered.add(notification);
      else if (tickets[k]?.details?.error === 'DeviceNotRegistered') gone.push(token);
    });
  }
  if (gone.length) await db.device.deleteMany({ where: { token: { in: gone } } });
  for (const n of pending) {
    const tries = n.pushAttempts + 1;
    await db.notification.update({
      where: { id: n.id },
      data: !messages.some(m => m.notification === n)
        ? { pushState: 'SKIPPED' }
        : delivered.has(n)
          ? { pushState: 'SENT', pushAttempts: tries }
          : tries >= ATTEMPTS
            ? { pushState: 'FAILED', pushAttempts: tries }
            : { pushAttempts: tries, pushAfter: new Date(+now + 60_000 * 2 ** (tries - 1)) },
    });
  }
}
