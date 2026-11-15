import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Input } from '../src/contract.js';
import { cleanup } from '../src/jobs/worker.js';
import { namesMatch } from '../src/modules/collection/service.js';
import { call, clock, db, fails, ok, reset, settings, signIn } from './helpers.js';

beforeEach(reset);

let operator: Awaited<ReturnType<typeof signIn>>;
let asha: Awaited<ReturnType<typeof signIn>>;
beforeEach(async () => {
  operator = await signIn('OPERATOR');
  asha = await signIn('MEMBER', { phone: '+919876543210' });
  await db.user.update({ where: { id: asha.user.id }, data: { name: 'Asha Rao', idNumber: '23CS1' } });
});
/** A parcel linked to Asha by her phone on the label, a second after the last one. */
const parcelFor = (labelName: string | undefined, fields: Partial<Input<'intakeParcel'>> = {}) => {
  clock.now += 1_000;
  return ok(
    'intakeParcel',
    {
      id: randomUUID(),
      awb: `C${randomUUID().slice(0, 8)}`,
      shelf: 'A1',
      labelName,
      labelPhone: '9876543210',
      ...fields,
    },
    operator.token,
  );
};
const queueIds = async () => (await ok('listCollections', {}, operator.token)).items.map(c => c.id);
const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

test('label names match the member on a shared word of two letters or more, ignoring case', () => {
  assert.equal(namesMatch('A. Rao', 'Asha Rao'), true);
  assert.equal(namesMatch('ASHA', 'Asha Rao'), true);
  assert.equal(namesMatch('Rahul Verma', 'Asha Rao'), false);
  assert.equal(namesMatch('S Kumar', 'S Sharma'), false);
  assert.equal(namesMatch(null, 'Asha Rao'), false);
  assert.equal(namesMatch('', 'Asha Rao'), false);
});

test('one code covers all waiting parcels; the operator verifies it and hands over the ticked ones', async () => {
  const first = await parcelFor('Asha R');
  const second = await parcelFor('A. Rao');
  const code = await ok('collectNow', {}, asha.token);
  assert.match(code.otp, /^\d{6}$/);
  assert.deepEqual(
    code.parcels.map(p => p.id),
    [first.id, second.id],
  );
  assert.equal(Date.parse(code.expiresAt) - clock.now, settings.collectionCodeMinutes * 60_000);

  const [queued] = (await ok('listCollections', {}, operator.token)).items;
  assert.deepEqual(
    [queued.status, queued.member.id, queued.attemptsLeft, queued.parcels.map(p => [p.id, p.nameMatches])],
    [
      'PENDING',
      asha.user.id,
      5,
      [
        [first.id, true],
        [second.id, true],
      ],
    ],
  );
  await fails(
    'completeCollection',
    { collectionId: queued.id, parcelIds: [first.id], idChecked: false },
    'VALIDATION',
    operator.token,
  );
  const reply = await call('verifyCollection', { collectionId: queued.id, otp: wrong(code.otp) }, operator.token);
  assert.match(JSON.stringify(reply.body), /CODE_INVALID.*4 tries left/);
  const verified = await ok('verifyCollection', { collectionId: queued.id, otp: code.otp }, operator.token);
  assert.deepEqual([verified.status, verified.attemptsLeft], ['VERIFIED', 4]);

  await ok('completeCollection', { collectionId: queued.id, parcelIds: [first.id], idChecked: false }, operator.token);
  const ready = await ok('listMyParcels', { view: 'ready' }, asha.token);
  const history = await ok('listMyParcels', { view: 'history' }, asha.token);
  assert.deepEqual(
    [ready.items.map(p => p.id), history.items.map(p => [p.id, p.status])],
    [[second.id], [[first.id, 'COLLECTED']]],
  );
  const audit = await db.auditEvent.findFirst({ where: { parcelId: first.id, action: 'COLLECTED' } });
  assert.match(audit!.detail, /Handed to Asha Rao .*label name matches; ID card not checked$/);
  assert.equal(await db.notification.count({ where: { userId: asha.user.id, type: 'COLLECTED' } }), 1);

  // The code is used up: a second complete and the queue both know it. A new code covers what's left.
  await fails(
    'completeCollection',
    { collectionId: queued.id, parcelIds: [second.id], idChecked: false },
    'ALREADY_COLLECTED',
    operator.token,
  );
  assert.deepEqual(await queueIds(), []);
  assert.deepEqual(
    (await ok('collectNow', {}, asha.token)).parcels.map(p => p.id),
    [second.id],
  );
});

test('five wrong codes cancel it; an expired code fails; the worker expires open codes', async () => {
  await parcelFor('Asha');
  const code = await ok('collectNow', {}, asha.token);
  const [collectionId] = await queueIds();
  for (let n = 0; n < 4; n++)
    await fails('verifyCollection', { collectionId, otp: wrong(code.otp) }, 'CODE_INVALID', operator.token);
  const last = await call('verifyCollection', { collectionId, otp: wrong(code.otp) }, operator.token);
  assert.match(JSON.stringify(last.body), /CODE_INVALID.*cancelled/);
  await fails('verifyCollection', { collectionId, otp: code.otp }, 'CODE_EXPIRED', operator.token);
  assert.deepEqual(await queueIds(), []);

  // Verified, then left too long: the handover is refused.
  const next = await ok('collectNow', {}, asha.token);
  const [nextId] = await queueIds();
  const verified = await ok('verifyCollection', { collectionId: nextId, otp: next.otp }, operator.token);
  clock.now += settings.collectionCodeMinutes * 60_000 + 1;
  await fails(
    'completeCollection',
    { collectionId: nextId, parcelIds: [verified.parcels[0].id], idChecked: false },
    'CODE_EXPIRED',
    operator.token,
  );
  await cleanup(db, new Date(clock.now));
  assert.equal((await db.collection.findUnique({ where: { id: nextId } }))!.status, 'EXPIRED');
});

test('a new code replaces the open one; cancel; at most 6 a minute; nothing waiting means no code', async () => {
  await fails('collectNow', {}, 'NOT_FOUND', asha.token);
  await parcelFor('Asha');
  const old = await ok('collectNow', {}, asha.token);
  const [oldId] = await queueIds();
  const [fresh] = await Promise.all([ok('collectNow', {}, asha.token), ok('collectNow', {}, asha.token)]);
  assert.equal((await queueIds()).length, 1);
  await fails('verifyCollection', { collectionId: oldId, otp: old.otp }, 'CODE_EXPIRED', operator.token);
  assert.match(fresh.otp, /^\d{6}$/);
  await ok('cancelCollection', {}, asha.token);
  assert.deepEqual(await queueIds(), []);
  // Every tap counts, the refused first one too: four so far, two more, then the seventh is refused.
  for (let n = 0; n < 2; n++) await ok('collectNow', {}, asha.token);
  await fails('collectNow', {}, 'RATE_LIMITED', asha.token);
});

test('handovers are all or nothing and can’t happen twice', async () => {
  const mine = await parcelFor('Asha');
  const bala = await signIn('MEMBER', { phone: '+919000000001' });
  const theirs = await parcelFor('Bala', { labelPhone: '9000000001' });
  const code = await ok('collectNow', {}, asha.token);
  const [collectionId] = await queueIds();
  await ok('verifyCollection', { collectionId, otp: code.otp }, operator.token);
  // Someone else's parcel in the list rolls everything back.
  await fails(
    'completeCollection',
    { collectionId, parcelIds: [mine.id, theirs.id], idChecked: true },
    'ALREADY_COLLECTED',
    operator.token,
  );
  assert.deepEqual(
    (await db.parcel.findMany({ where: { id: { in: [mine.id, theirs.id] } } })).map(p => p.status),
    ['IN_MAILROOM', 'IN_MAILROOM'],
  );
  assert.equal((await ok('listCollections', {}, operator.token)).items[0].status, 'VERIFIED');
  // Two operators completing at once: exactly one wins.
  const results = await Promise.all(
    [1, 2].map(() =>
      call('completeCollection', { collectionId, parcelIds: [mine.id], idChecked: false }, operator.token),
    ),
  );
  assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  assert.equal(await db.auditEvent.count({ where: { action: 'COLLECTED' } }), 1);
  assert.equal(bala.user.role, 'MEMBER');
});

test('a label name that differs from the member, or is missing, needs the ID card checked', async () => {
  const other = await parcelFor('Rahul Verma');
  const blank = await parcelFor(undefined);
  const code = await ok('collectNow', {}, asha.token);
  const [collectionId] = await queueIds();
  const verified = await ok('verifyCollection', { collectionId, otp: code.otp }, operator.token);
  assert.deepEqual(
    verified.parcels.map(p => p.nameMatches),
    [false, false],
  );
  for (const parcelIds of [[other.id], [blank.id]])
    await fails(
      'completeCollection',
      { collectionId, parcelIds, idChecked: false },
      'ID_CHECK_REQUIRED',
      operator.token,
    );
  await ok('completeCollection', { collectionId, parcelIds: [other.id, blank.id], idChecked: true }, operator.token);
  const audit = await db.auditEvent.findFirst({ where: { parcelId: other.id, action: 'COLLECTED' } });
  assert.match(audit!.detail, /label name differs; ID card checked$/);
});

test('members can check code replacement, verification, cancellation and expiry without replaying the OTP', async () => {
  assert.deepEqual(await ok('getMyCollection', {}, asha.token), { collection: null });
  await parcelFor('Asha');
  const first = await ok('collectNow', {}, asha.token);
  const state = await ok('getMyCollection', {}, asha.token);
  assert.equal(state.collection?.id, first.id);
  assert.equal(state.collection?.status, 'PENDING');
  assert.equal('otp' in state.collection!, false);
  const other = await signIn('MEMBER');
  assert.deepEqual(await ok('getMyCollection', {}, other.token), { collection: null });
  const second = await ok('collectNow', {}, asha.token);
  assert.notEqual(second.id, first.id);
  await ok('verifyCollection', { collectionId: second.id, otp: second.otp }, operator.token);
  assert.equal((await ok('getMyCollection', {}, asha.token)).collection?.status, 'VERIFIED');
  await ok('cancelCollection', {}, asha.token);
  assert.deepEqual(await ok('getMyCollection', {}, asha.token), { collection: null });
  await ok('collectNow', {}, asha.token);
  clock.now += settings.collectionCodeMinutes * 60_000 + 1;
  assert.deepEqual(await ok('getMyCollection', {}, asha.token), { collection: null });
});
