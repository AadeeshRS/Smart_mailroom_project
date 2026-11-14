import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Input } from '../src/contract.js';
import { cleanup } from '../src/jobs/worker.js';
import { call, clock, db, fails, ok, reset, settings, signIn } from './helpers.js';

beforeEach(reset);

let operator: Awaited<ReturnType<typeof signIn>>;
let asha: Awaited<ReturnType<typeof signIn>>;
beforeEach(async () => {
  operator = await signIn('OPERATOR');
  asha = await signIn('MEMBER', { phone: '+919876543210' });
});
const intake = (fields: Partial<Input<'intakeParcel'>>) =>
  ok('intakeParcel', { id: randomUUID(), shelf: 'A1', ...fields }, operator.token);
const request = (fields: Input<'createRequest'>, token = asha.token) => ok('createRequest', fields, token);

test('requests: normalised, one open request per AWB, OTP edits and cancel only while open', async () => {
  const made = await request({ awb: ' ee 123 456 789 in ', orderId: ' od1 ', deliveryOtp: '4821' });
  assert.deepEqual(
    [made.awb, made.orderId, made.carrier, made.deliveryOtp, made.status, made.parcel],
    ['EE123456789IN', 'OD1', 'INDIA_POST', '4821', 'OPEN', undefined],
  );
  assert.equal(Date.parse(made.expiresAt) - Date.parse(made.createdAt), settings.requestExpiryDays * 86_400_000);
  const bala = await signIn('MEMBER');
  await fails('createRequest', { awb: 'EE123456789IN' }, 'REQUEST_EXISTS', asha.token);
  await fails('createRequest', { awb: 'ee123456789in' }, 'REQUEST_EXISTS', bala.token);

  assert.equal(
    (await ok('updateRequest', { requestId: made.id, deliveryOtp: '9999' }, asha.token)).deliveryOtp,
    '9999',
  );
  assert.equal((await ok('updateRequest', { requestId: made.id, deliveryOtp: null }, asha.token)).deliveryOtp, null);
  await fails('updateRequest', { requestId: made.id, deliveryOtp: '1111' }, 'NOT_FOUND', bala.token);
  await fails('cancelRequest', { requestId: made.id }, 'NOT_FOUND', bala.token);
  await ok('cancelRequest', { requestId: made.id }, asha.token);
  await fails('cancelRequest', { requestId: made.id }, 'REQUEST_CLOSED', asha.token);
  await fails('updateRequest', { requestId: made.id, deliveryOtp: '1111' }, 'REQUEST_CLOSED', asha.token);

  // Cancelling frees the AWB for someone else; the list is the member's own, newest first.
  const theirs = await request({ awb: 'EE123456789IN' }, bala.token);
  assert.deepEqual(
    (await ok('listMyRequests', {}, bala.token)).items.map(r => r.id),
    [theirs.id],
  );
  assert.deepEqual(
    (await ok('listMyRequests', {}, asha.token)).items.map(r => [r.id, r.status]),
    [[made.id, 'CANCELLED']],
  );
});

test('a member can hold at most 20 open requests', async () => {
  for (let n = 0; n < 20; n++) await request({ awb: `CAP${n}` });
  await fails('createRequest', { awb: 'CAP20' }, 'VALIDATION', asha.token);
});

test('a request for a parcel already in the mailroom links it at once', async () => {
  const waiting = await intake({ awb: 'W1', labelName: 'Asha' });
  const made = await request({ awb: 'w1', deliveryOtp: '1234' });
  assert.deepEqual([made.status, made.deliveryOtp, made.parcel?.id], ['MATCHED', null, waiting.id]);
  const linked = (await ok('getParcel', { parcelId: waiting.id }, operator.token)).parcel;
  assert.deepEqual([linked.recipient?.id, linked.matchSource], [asha.user.id, 'REQUEST']);
  assert.equal(await db.notification.count({ where: { userId: asha.user.id, type: 'ARRIVAL' } }), 1);

  // Already hers by contact: the request just reports it. By order ID when the parcel has no AWB.
  const byContact = await intake({ awb: 'W2', labelPhone: '9876543210' });
  assert.equal((await request({ awb: 'W2' })).parcel?.id, byContact.id);
  const byOrder = await intake({ orderId: 'OD555' });
  assert.equal((await request({ awb: 'W3', orderId: 'od555' })).parcel?.id, byOrder.id);
});

test('intake: an open request beats the contact match, its OTP shows in lookup and is cleared after', async () => {
  const bala = await signIn('MEMBER', { phone: '+919000000001' });
  const made = await request({ awb: 'EE222222222IN', deliveryOtp: '4821' }, bala.token);
  const seen = await ok('lookupParcel', { code: 'ee222222222in' }, operator.token);
  assert.deepEqual(
    [seen.request?.id, seen.request?.member.id, seen.request?.deliveryOtp],
    [made.id, bala.user.id, '4821'],
  );
  // The label carries nobody's contact, so the requester gets it.
  const parcel = await intake({ awb: 'EE222222222IN', labelPhone: '98XXXXXX01' });
  assert.deepEqual([parcel.recipient?.id, parcel.matchSource, parcel.matchFlag], [bala.user.id, 'REQUEST', null]);
  const done = (await ok('listMyRequests', {}, bala.token)).items[0];
  assert.deepEqual([done.status, done.deliveryOtp, done.parcel?.id], ['MATCHED', null, parcel.id]);
  assert.equal((await ok('lookupParcel', { code: 'EE222222222IN' }, operator.token)).request, undefined);

  // Her own contact on the label agrees with her request; the order ID finds it when there's no AWB.
  await request({ awb: 'AGREE1' });
  assert.equal((await intake({ awb: 'AGREE1', labelPhone: '9876543210' })).recipient?.id, asha.user.id);
  await request({ awb: 'NOAWB1', orderId: 'OD777' });
  const orderOnly = await intake({ orderId: 'OD777' });
  assert.deepEqual([orderOnly.recipient?.id, orderOnly.matchSource], [asha.user.id, 'REQUEST']);
});

test('a label contact owned by someone other than the requester flags CONFLICT for the operator', async () => {
  const bala = await signIn('MEMBER', { phone: '+919000000001' });
  const made = await request({ awb: 'C1', deliveryOtp: '4821' }, bala.token);
  const parcel = await intake({ awb: 'C1', labelPhone: '9876543210' });
  assert.deepEqual([parcel.recipient, parcel.matchFlag], [null, 'CONFLICT']);
  const theirs = (await ok('listMyRequests', {}, bala.token)).items[0];
  assert.deepEqual(
    [theirs.id, theirs.status, theirs.deliveryOtp, theirs.parcel],
    [made.id, 'MATCHED', null, undefined],
  );
  const { history } = await ok('getParcel', { parcelId: parcel.id }, operator.token);
  assert.match(history.at(-1)!.detail, new RegExp(`Requested by ${bala.user.name}, but the label contact is`));
  assert.deepEqual((await ok('listMyParcels', { view: 'ready' }, asha.token)).items, []);

  // A profile edit by the label's owner doesn't settle it behind the operator's back; a manual assign does.
  await ok('updateMe', { altPhone: '9000000555' }, asha.token);
  assert.equal((await ok('getParcel', { parcelId: parcel.id }, operator.token)).parcel.matchFlag, 'CONFLICT');
  const assigned = await ok('assignParcel', { parcelId: parcel.id, userId: bala.user.id }, operator.token);
  assert.deepEqual([assigned.recipient?.id, assigned.matchFlag], [bala.user.id, null]);
});

test('the worker expires open requests and clears their OTP; matched ones are untouched', async () => {
  const stale = await request({ awb: 'E1', deliveryOtp: '1234' });
  const used = await request({ awb: 'E2', deliveryOtp: '5678' });
  await intake({ awb: 'E2' });
  // A day past expiry. That also ends today's sessions, so read the rows directly.
  await cleanup(db, new Date(clock.now + (settings.requestExpiryDays + 1) * 86_400_000));
  const rows = await db.parcelRequest.findMany({ orderBy: { awb: 'asc' } });
  assert.deepEqual(
    rows.map(r => [r.id, r.status, r.deliveryOtp]),
    [
      [stale.id, 'EXPIRED', null],
      [used.id, 'MATCHED', null],
    ],
  );
  // The AWB is free again.
  const { token } = await signIn('MEMBER');
  assert.equal((await call('createRequest', { awb: 'E1' }, token)).status, 200);
});
