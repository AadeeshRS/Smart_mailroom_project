import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Input } from '../src/contract.js';
import { id } from '../src/core/security.js';
import { remindWaiting } from '../src/modules/admin/service.js';
import { sendPushes } from '../src/modules/notifications/push.js';
import { clock, db, fails, ok, reset, signIn } from './helpers.js';

beforeEach(reset);

const DAY = 86_400_000;
const MINUTE = 60_000;
const tokenA = 'ExponentPushToken[aaaaaaaaaaaaaaaaaaaaaa]';
const tokenB = 'ExponentPushToken[bbbbbbbbbbbbbbbbbbbbbb]';
const mine = { labelPhone: '9876543210' };

const intake = (token: string, fields: Partial<Input<'intakeParcel'>> = {}) =>
  ok('intakeParcel', { id: randomUUID(), shelf: 'A1', awb: `S${randomUUID().slice(0, 8)}`, ...fields }, token);
const notify = (userId: string) =>
  db.notification.create({
    data: { id: id('ntf'), userId, type: 'ARRIVAL', title: 'Arrived', body: 'B', pushAfter: new Date(clock.now) },
  });
const state = async (notificationId: string) => db.notification.findUniqueOrThrow({ where: { id: notificationId } });

/** A mocked Expo push API: each call takes the next reply (tickets, an HTTP status, or a thrown error). */
function expo(...replies: (object[] | number | Error)[]) {
  const calls: { to: string; title: string; data: { type: string } }[][] = [];
  const fetcher = (async (url: string, init?: RequestInit) => {
    assert.equal(url, 'https://exp.host/--/api/v2/push/send');
    calls.push(JSON.parse(String(init?.body)));
    const reply = replies.shift() ?? [];
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'number') return new Response('', { status: reply });
    return Response.json({ data: reply });
  }) as typeof fetch;
  return { fetcher, calls };
}
const run = (fetcher: typeof fetch, at = clock.now) => sendPushes(db, new Date(at), fetcher);

test('a member registers a push token for the session, lists their notifications and marks them read', async () => {
  const operator = await signIn('OPERATOR');
  const asha = await signIn('MEMBER', { phone: '+919876543210' });
  const ravi = await signIn('MEMBER');
  await ok('registerDevice', { token: tokenA, platform: 'ios' }, asha.token);
  await fails('registerDevice', { token: 'not-a-push-token', platform: 'ios' }, 'VALIDATION', asha.token);
  await intake(operator.token, mine);
  const inbox = await ok('listNotifications', {}, asha.token);
  assert.deepEqual(
    inbox.items.map(n => [n.type, n.title, n.read]),
    [['ARRIVAL', 'Your parcel is at the mailroom', false]],
  );
  assert.deepEqual((await ok('listNotifications', {}, ravi.token)).items, []);
  await ok('markNotificationsRead', {}, asha.token);
  assert.equal((await ok('listNotifications', {}, asha.token)).items[0].read, true);
  // The same phone signed in to another account: the token moves to that session.
  await ok('registerDevice', { token: tokenA, platform: 'ios' }, ravi.token);
  const device = await db.device.findUniqueOrThrow({ where: { token: tokenA }, include: { session: true } });
  assert.equal(device.session.userId, ravi.user.id);
  assert.equal(await db.device.count(), 1);
});

test('pushes go to live sessions only; no device is SKIPPED; signing out stops pushes', async () => {
  const asha = await signIn('MEMBER');
  const ravi = await signIn('MEMBER');
  const carol = await signIn('MEMBER');
  await ok('registerDevice', { token: tokenA, platform: 'ios' }, asha.token);
  await ok('registerDevice', { token: tokenB, platform: 'android' }, ravi.token);
  await ok('logout', {}, ravi.token);
  const [toAsha, toRavi, toCarol] = await Promise.all([
    notify(asha.user.id),
    notify(ravi.user.id),
    notify(carol.user.id),
  ]);
  const { fetcher, calls } = expo([{ status: 'ok', id: 'ticket-1' }]);
  await run(fetcher);
  assert.equal(calls.length, 1);
  assert.deepEqual(
    calls[0].map(m => [m.to, m.title, m.data.type]),
    [[tokenA, 'Arrived', 'ARRIVAL']],
  );
  assert.deepEqual(
    [(await state(toAsha.id)).pushState, (await state(toRavi.id)).pushState, (await state(toCarol.id)).pushState],
    ['SENT', 'SKIPPED', 'SKIPPED'],
  );
  await run(fetcher);
  assert.equal(calls.length, 1, 'nothing left to send');
});

test('failed pushes back off 1, 2, 4, 8 minutes and are FAILED after 5 tries', async () => {
  const asha = await signIn('MEMBER');
  await ok('registerDevice', { token: tokenA, platform: 'ios' }, asha.token);
  const notice = await notify(asha.user.id);
  const { fetcher, calls } = expo(503, new Error('offline'), [{ status: 'error', details: {} }], 500, 429);
  let at = clock.now;
  for (const wait of [1, 2, 4, 8]) {
    await run(fetcher, at);
    const row = await state(notice.id);
    assert.equal(row.pushState, 'PENDING');
    assert.equal(+row.pushAfter, at + wait * MINUTE);
    await run(fetcher, at + wait * MINUTE - 1);
    at += wait * MINUTE;
  }
  assert.equal(calls.length, 4, 'nothing is sent before it is due');
  await run(fetcher, at);
  assert.deepEqual([(await state(notice.id)).pushState, (await state(notice.id)).pushAttempts], ['FAILED', 5]);
});

test('a token Expo reports as DeviceNotRegistered is deleted', async () => {
  const asha = await signIn('MEMBER');
  await ok('registerDevice', { token: tokenA, platform: 'ios' }, asha.token);
  const notice = await notify(asha.user.id);
  const { fetcher } = expo([{ status: 'error', details: { error: 'DeviceNotRegistered' } }]);
  await run(fetcher);
  assert.equal(await db.device.count(), 0);
  await run(fetcher, clock.now + MINUTE);
  assert.equal((await state(notice.id)).pushState, 'SKIPPED');
});

test('the reminder job reminds a linked waiting parcel every N days, once per due date', async () => {
  const operator = await signIn('OPERATOR');
  const asha = await signIn('MEMBER', { phone: '+919876543210' });
  const parcel = await intake(operator.token, mine);
  await intake(operator.token); // unmatched: nobody to remind
  const reminders = () => db.notification.findMany({ where: { type: 'REMINDER' } });
  const at = (days: number) => remindWaiting(db, new Date(clock.now + days * DAY), 3);
  await at(2);
  assert.equal((await reminders()).length, 0);
  await at(3);
  await at(3);
  const [first] = await reminders();
  assert.deepEqual(
    [(await reminders()).length, first.userId, first.parcelId, first.title],
    [1, asha.user.id, parcel.id, 'Your parcel is still waiting'],
  );
  await at(5);
  assert.equal((await reminders()).length, 1);
  await at(6);
  assert.equal((await reminders()).length, 2);
  await db.parcel.update({ where: { id: parcel.id }, data: { status: 'COLLECTED' } });
  await at(12);
  assert.equal((await reminders()).length, 2);
});
