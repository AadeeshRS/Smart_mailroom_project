import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Input } from '../src/contract.js';
import { clock, db, fails, ok, reset, signIn } from './helpers.js';

beforeEach(reset);

const DAY = 86_400_000;
let admin: Awaited<ReturnType<typeof signIn>>;
let asha: Awaited<ReturnType<typeof signIn>>;
beforeEach(async () => {
  admin = await signIn('ADMIN');
  asha = await signIn('MEMBER', { phone: '+919876543210' });
});
/** A parcel received `daysAgo` days before now (linked to Asha when her phone is on the label). */
async function receivedAgo(daysAgo: number, fields: Partial<Input<'intakeParcel'>> = {}) {
  const now = clock.now;
  clock.now = now - daysAgo * DAY;
  try {
    return await ok(
      'intakeParcel',
      { id: randomUUID(), shelf: 'A1', awb: `S${randomUUID().slice(0, 8)}`, ...fields },
      admin.token,
    );
  } finally {
    clock.now = now;
  }
}
const mine = { labelPhone: '9876543210' };
const at = (ms: number) => new Date(ms).toISOString();

async function seedWeek() {
  const fresh = await receivedAgo(0, mine);
  const unmatched = await receivedAgo(1);
  const mid = await receivedAgo(4, mine);
  const old = await receivedAgo(10, mine);
  const done = await receivedAgo(5, mine);
  await db.parcel.update({ where: { id: done.id }, data: { status: 'COLLECTED', collectedAt: new Date(clock.now) } });
  return { fresh, unmatched, mid, old, done };
}

test('stats count one day by the phone’s midnight, and bucket what’s waiting by age', async () => {
  await seedWeek();
  await ok('createRequest', { awb: 'OPEN1' }, asha.token);
  const today = await ok('getStats', { dayStart: at(clock.now - DAY / 2) }, admin.token);
  assert.deepEqual(today, {
    received: 1,
    collected: 1,
    waiting: 4,
    waitingByAge: { underThreeDays: 2, upToLimit: 1, overLimit: 1 },
    tooLongDays: 7,
    unmatched: 1,
    openRequests: 1,
  });
  const tenDaysAgo = await ok('getStats', { dayStart: at(clock.now - 10 * DAY - DAY / 2) }, admin.token);
  assert.deepEqual([tenDaysAgo.received, tenDaysAgo.collected], [1, 0]);
});

test('the waiting-too-long list is oldest first, with the member’s contact details', async () => {
  const { mid, old } = await seedWeek();
  const tooLong = await ok('listAging', {}, admin.token);
  assert.equal(tooLong.olderThanDays, 7);
  assert.deepEqual(
    tooLong.items.map(i => [i.parcel.id, i.daysWaiting, i.parcel.recipient?.phone, i.lastRemindedAt]),
    [[old.id, 10, '+919876543210', null]],
  );
  assert.deepEqual(
    (await ok('listAging', { olderThanDays: 3 }, admin.token)).items.map(i => i.parcel.id),
    [old.id, mid.id],
  );
});

test('remind tells the member and is recorded; only for linked parcels still in the mailroom', async () => {
  const { unmatched, old, done } = await seedWeek();
  await ok('remindParcel', { parcelId: old.id }, admin.token);
  const [item] = (await ok('listAging', {}, admin.token)).items;
  assert.equal(item.lastRemindedAt, at(clock.now));
  const notice = await db.notification.findFirst({ where: { userId: asha.user.id, type: 'REMINDER' } });
  assert.match(notice!.body, /is still at the mailroom\. Open the app and tap Collect now/);
  assert.equal(await db.auditEvent.count({ where: { parcelId: old.id, action: 'REMINDED' } }), 1);
  await fails('remindParcel', { parcelId: unmatched.id }, 'VALIDATION', admin.token);
  await fails('remindParcel', { parcelId: done.id }, 'NOT_IN_MAILROOM', admin.token);
  await fails('remindParcel', { parcelId: 'missing' }, 'NOT_FOUND', admin.token);
});

test('a parcel returned to the sender leaves the mailroom once, and the member sees why', async () => {
  const { unmatched, old } = await seedWeek();
  await ok('returnParcel', { parcelId: old.id }, admin.token);
  await fails('returnParcel', { parcelId: old.id }, 'NOT_IN_MAILROOM', admin.token);
  const history = await ok('listMyParcels', { view: 'history' }, asha.token);
  assert.deepEqual(history.items.find(p => p.id === old.id)?.status, 'RETURNED');
  assert.equal(await db.notification.count({ where: { userId: asha.user.id, type: 'RETURNED' } }), 1);
  assert.equal(await db.auditEvent.count({ where: { parcelId: old.id, action: 'RETURNED' } }), 1);
  await ok('returnParcel', { parcelId: unmatched.id }, admin.token); // nobody to tell
  const stats = await ok('getStats', { dayStart: at(clock.now - DAY / 2) }, admin.token);
  assert.deepEqual([stats.waiting, stats.unmatched, stats.waitingByAge.overLimit], [2, 0, 0]);
});
