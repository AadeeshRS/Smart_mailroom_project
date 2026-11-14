import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Input } from '../src/contract.js';
import { id } from '../src/core/security.js';
import { PASSWORD, call, codeFor, db, fails, ok, reset, signIn } from './helpers.js';

beforeEach(reset);

let operator: Awaited<ReturnType<typeof signIn>>;
beforeEach(async () => {
  operator = await signIn('OPERATOR');
});
const intake = (fields: Partial<Input<'intakeParcel'>>) =>
  ok('intakeParcel', { id: randomUUID(), shelf: 'A1', ...fields }, operator.token);

test('intake normalises the label; a retried intake returns the parcel already saved', async () => {
  const parcelId = randomUUID();
  const body = {
    id: parcelId,
    awb: ' ee 123 456 789 in ',
    labelPhone: '98XXXXXX10',
    labelEmail: ' A@B.C ',
    shelf: ' B2 ',
  };
  const [first, again] = await Promise.all([
    ok('intakeParcel', body, operator.token),
    ok('intakeParcel', body, operator.token),
  ]);
  assert.deepEqual(again, first);
  assert.deepEqual(
    [first.id, first.awb, first.carrier, first.labelPhone, first.labelEmail, first.shelf, first.receivedBy],
    [parcelId, 'EE123456789IN', 'INDIA_POST', null, 'a@b.c', 'B2', operator.user.name],
  );
  assert.equal(await db.parcel.count(), 1);
  const overridden = await intake({ awb: '12345678901', carrier: 'BLUEDART' });
  assert.equal(overridden.carrier, 'BLUEDART');
  await fails('intakeParcel', { id: randomUUID(), shelf: 'A1' }, 'VALIDATION', operator.token);
  await fails('intakeParcel', { id: randomUUID(), awb: '   ', shelf: 'A1' }, 'VALIDATION', operator.token);
});

test('lookup classifies the code and warns about parcels already logged with it', async () => {
  const fresh = await ok('lookupParcel', { code: '403-1234567-1234567' }, operator.token);
  assert.deepEqual([fresh.kind, fresh.carrier, fresh.existing], ['ORDER_ID', null, []]);
  const saved = await intake({ awb: 'TBA123456789012' });
  const dup = await ok('lookupParcel', { code: 'tba123456789012' }, operator.token);
  assert.deepEqual([dup.code, dup.kind, dup.carrier], ['TBA123456789012', 'AWB', 'AMAZON']);
  assert.deepEqual(
    dup.existing.map(p => p.id),
    [saved.id],
  );
});

test('contact match: phone, alternate phone, college email or personal email links one verified member', async () => {
  const asha = await signIn('MEMBER', { phone: '+919876543210' });
  await db.user.update({
    where: { id: asha.user.id },
    data: { altPhone: '+919123456789', personalEmail: 'asha@gmail.com' },
  });
  for (const label of [
    { labelPhone: '98765 43210' },
    { labelPhone: '09123456789' },
    { labelEmail: asha.user.email.toUpperCase() },
    { labelEmail: 'Asha@Gmail.com' },
  ]) {
    const parcel = await intake({ awb: `D${String(Math.random()).slice(2, 10)}`, ...label });
    assert.equal(parcel.recipient?.id, asha.user.id, JSON.stringify(label));
    assert.equal(parcel.matchSource, 'CONTACT');
  }
  assert.equal(await db.notification.count({ where: { userId: asha.user.id, type: 'ARRIVAL' } }), 4);
  assert.equal(await db.auditEvent.count({ where: { action: 'LINKED' } }), 4);
  const ready = await ok('listMyParcels', { view: 'ready' }, asha.token);
  assert.equal(ready.items.length, 4);
});

test('ambiguous labels are flagged, unknown contacts stay unlinked, and only verified active members match', async () => {
  const a = await signIn('MEMBER', { phone: '+919000000001' });
  await signIn('MEMBER', { email: 'b@college.example' });
  const ambiguous = await intake({ awb: 'X1', labelPhone: '9000000001', labelEmail: 'b@college.example' });
  assert.deepEqual([ambiguous.recipient, ambiguous.matchFlag], [null, 'AMBIGUOUS']);
  const nobody = await intake({ awb: 'X2', labelPhone: '9000000099' });
  assert.deepEqual([nobody.recipient, nobody.matchFlag], [null, null]);
  await db.user.create({
    data: { id: id('usr'), email: 'pending@college.example', name: 'Pending', phone: '+919000000002' },
  });
  assert.equal((await intake({ awb: 'X3', labelPhone: '9000000002' })).recipient, null);
  await db.user.update({ where: { id: a.user.id }, data: { active: false } });
  assert.equal((await intake({ awb: 'X4', labelPhone: '9000000001' })).recipient, null);
});

test('reverse triggers: verifying an email or editing a phone links parcels already waiting', async () => {
  const waiting = await intake({ awb: 'R1', labelPhone: '9876500001' });
  assert.equal(waiting.recipient, null);
  await ok('register', {
    email: 'late@college.example',
    password: PASSWORD,
    name: 'Late',
    memberType: 'STUDENT',
    acceptPrivacyNotice: true,
    idNumber: 'L1',
    phone: '9876500001',
  });
  const session = await ok('verifyEmail', { email: 'late@college.example', code: codeFor('late@college.example') });
  assert.deepEqual(
    (await ok('listMyParcels', { view: 'ready' }, session.token)).items.map(p => p.id),
    [waiting.id],
  );
  const later = await intake({ awb: 'R2', labelPhone: '9876500002' });
  await ok('updateMe', { altPhone: '9876500002' }, session.token);
  assert.equal((await ok('getParcel', { parcelId: later.id }, operator.token)).parcel.recipient?.id, session.user.id);
});

test('operator search: code, label name, phone digits, recipient, shelf; unmatched filter; keyset pages', async () => {
  const asha = await signIn('MEMBER', { phone: '+919876543210' });
  await db.user.update({ where: { id: asha.user.id }, data: { name: 'Asha Rao' } });
  const linked = await intake({ awb: 'EE111111111IN', labelPhone: '9876543210', shelf: 'C9' });
  const named = await intake({ orderId: 'OD123456789012345', labelName: 'Bala Kumar' });
  const ids = async (input: Input<'listParcels'>) =>
    (await ok('listParcels', input, operator.token)).items.map(p => p.id);
  assert.deepEqual(await ids({ q: 'ee111' }), [linked.id]);
  assert.deepEqual(await ids({ q: 'bala' }), [named.id]);
  assert.deepEqual(await ids({ q: '43210' }), [linked.id]);
  assert.deepEqual(await ids({ q: 'asha rao' }), [linked.id]);
  assert.deepEqual(await ids({ q: 'c9' }), [linked.id]);
  assert.deepEqual(await ids({ unmatched: true }), [named.id]);
  assert.deepEqual(await ids({ status: 'COLLECTED' }), []);
  for (let n = 0; n < 3; n++) await intake({ awb: `P${n}` });
  const first = await ok('listParcels', { limit: 2 }, operator.token);
  const rest = await ok('listParcels', { limit: 3, cursor: first.nextCursor }, operator.token);
  assert.equal(new Set([...first.items, ...rest.items].map(p => p.id)).size, 5);
  assert.equal(rest.nextCursor, undefined);
});

test('manual assign links an unmatched parcel once; detail shows the history', async () => {
  const asha = await signIn('MEMBER', { phone: '+919876543210' });
  const bala = await signIn('MEMBER');
  const parcel = await intake({ awb: 'M1', labelName: 'A. Rao' });
  const found = await ok('searchMembers', { q: '43210' }, operator.token);
  assert.deepEqual(
    found.items.map(m => m.id),
    [asha.user.id],
  );
  const results = await Promise.all([
    call('assignParcel', { parcelId: parcel.id, userId: asha.user.id }, operator.token),
    call('assignParcel', { parcelId: parcel.id, userId: bala.user.id }, operator.token),
  ]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const { parcel: after, history } = await ok('getParcel', { parcelId: parcel.id }, operator.token);
  assert.equal(after.matchSource, 'MANUAL');
  assert.deepEqual(
    history.map(h => [h.action, h.actor]),
    [
      ['RECEIVED', operator.user.name],
      ['LINKED', operator.user.name],
    ],
  );
  await fails('assignParcel', { parcelId: parcel.id, userId: bala.user.id }, 'ALREADY_ASSIGNED', operator.token);
  const unverified = await db.user.create({ data: { id: id('usr'), email: 'u@college.example', name: 'U' } });
  const other = await intake({ awb: 'M2' });
  await fails('assignParcel', { parcelId: other.id, userId: unverified.id }, 'NOT_FOUND', operator.token);
  await fails('getParcel', { parcelId: 'missing' }, 'NOT_FOUND', operator.token);
});

test('members see only their own parcels, split into ready and history; no label contact details', async () => {
  const asha = await signIn('MEMBER', { phone: '+919876543210' });
  const bala = await signIn('MEMBER');
  const waiting = await intake({ awb: 'H1', labelPhone: '9876543210' });
  const done = await intake({ awb: 'H2', labelPhone: '9876543210' });
  await db.parcel.update({ where: { id: done.id }, data: { status: 'COLLECTED', collectedAt: new Date() } });
  const ready = await ok('listMyParcels', { view: 'ready' }, asha.token);
  const history = await ok('listMyParcels', { view: 'history' }, asha.token);
  assert.deepEqual([ready.items.map(p => p.id), history.items.map(p => p.id)], [[waiting.id], [done.id]]);
  assert.equal('labelPhone' in ready.items[0], false);
  assert.deepEqual((await ok('listMyParcels', { view: 'ready' }, bala.token)).items, []);
});
