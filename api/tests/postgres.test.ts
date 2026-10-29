import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { Ajv } from 'ajv';
import { createRequire } from 'node:module';
import { config, dedicatedDataset } from '../src/config.js';
import { database, transaction } from '../src/db.js';
import { createApp } from '../src/app.js';
import { contract, schemaRef, type Input, type Output } from '../src/contract.js';
import type { operations } from '../../contracts/generated/api.js';
import { id } from '../src/security.js';
import { reset, seed } from '../src/seed.js';
import { deliveryResult, processOutbox } from '../src/outbox.js';
import { fingerprint } from '../src/matching.js';
import { orderInclude, parcelInclude } from '../src/projections.js';
const settings = config(); dedicatedDataset(settings.databaseUrl);
assert.equal(new URL(settings.databaseUrl).pathname, '/smart_mailroom_test', 'Tests must use the isolated project TEST database.');
const db = database(settings.databaseUrl); let time = Date.now(); let rollback = false;
let runtime = await createApp(db, settings, { now: () => new Date(time), afterHandover: async () => { if (rollback) throw new Error('Injected transaction failure'); } });
const ajv = new Ajv({ strict: false }); (createRequire(import.meta.url)('ajv-formats') as (a: Ajv) => void)(ajv); ajv.addSchema({ $id: 'mailroom', components: contract.components });
const routes = Object.entries(contract.paths).flatMap(([path, methods]) => Object.entries(methods as Record<string, { operationId: keyof operations; responses: Record<string, { content: { 'application/json': { schema: unknown } } }> }>).map(([method, operation]) => ({ path, method, ...operation })));
type Client = { token: string; accountId: string };
let a: Client, b: Client, staff: Client;
async function call<K extends keyof operations>(operation: K, input: Input<K>, client?: Client, expected = 200): Promise<Output<K>> {
  const route = routes.find(r => r.operationId === operation)!; const fields = { ...input } as Record<string, unknown>;
  const path = route.path.replaceAll(/\{(\w+)\}/g, (_match, name: string) => { const value = fields[name]; delete fields[name]; return encodeURIComponent(String(value)); });
  const query = route.method === 'get' ? '?' + new URLSearchParams(Object.entries(fields).filter(([, value]) => value !== undefined).map(([k, v]) => [k, String(v)])).toString() : '';
  const response = await runtime.app.inject({ method: route.method.toUpperCase() as 'GET' | 'POST' | 'DELETE', url: '/v1' + path + query, headers: client ? { authorization: 'Bearer ' + client.token } : {}, ...(route.method === 'get' || !Object.keys(fields).length ? {} : { payload: fields }) });
  assert.equal(response.statusCode, expected, `${operation}: ${response.body}`); assert.equal(response.headers['cache-control'], 'no-store');
  const value = response.json();
  if (expected === 200) { const validate = ajv.compile(schemaRef(route.responses['200'].content['application/json'].schema)); assert.equal(validate(value), true, JSON.stringify(validate.errors)); }
  else { const validate = ajv.compile({ $ref: 'mailroom#/components/schemas/ErrorEnvelope' }); assert.equal(validate(value), true); }
  return value;
}
async function login(accountId: string): Promise<Client> { const result = await call('login', { accountId, passcode: process.env.DEMO_PASSCODE! }); return { token: result.token, accountId }; }
const order = (merchantOrderId = 'AMZ-TEST'): Input<'createOrder'> => ({ platform: 'AMAZON', merchantOrderId, tracking: [], idempotencyKey: id('key') });
const intake = (merchantOrderId = 'AMZ-TEST'): Input<'intakeParcel'> => ({ identifiers: [{ kind: 'ORDER_ID', namespace: 'AMAZON', value: merchantOrderId }], recipientEmail: 'asha@students.example.invalid', recipientStudentNumber: 'DEMO1001', recipientName: 'Asha', description: 'Synthetic parcel', storageLocation: 'Rack B2', physicalReference: id('box'), source: 'MANUAL', labelReviewed: true, idempotencyKey: id('key') });
const tracking = (value = 'TRACK-ONE') => ({ kind: 'TRACKING' as const, namespace: 'EKART' as const, value });
const issue = (parcelId: string, replace = false): Input<'issueCredential'> => ({ parcelId, replace, idempotencyKey: id('key') });
const confirm = (parcelId: string, verificationId: string): Input<'confirmHandover'> => ({ parcelId, verificationId, physicalHandoverConfirmed: true, idempotencyKey: id('key') });
async function ready() {
  const o = await call('createOrder', order(), a), p = await call('intakeParcel', intake(), staff), request = issue(p.id), c = await call('issueCredential', request, a);
  const v = await call('verifyCredential', { parcelId: p.id, method: 'OTP', otp: c.otp }, staff); return { o, p, c, v, request };
}
before(async () => { await seed(db, settings.databaseUrl, process.env.DEMO_PASSCODE!); });
beforeEach(async () => {
  rollback = false; time = Date.now(); await transaction(db, tx => reset(tx, settings.databaseUrl)); runtime.backend.credentials.clear();
  const users = await db.user.findMany(); a = await login(users.find(u => u.studentNumber === 'DEMO1001')!.id); b = await login(users.find(u => u.studentNumber === 'DEMO1002')!.id); staff = await login(users.find(u => u.role === 'STAFF')!.id);
});
after(async () => { await runtime.app.close(); await db.$disconnect(); });

test('PostgreSQL: complete order-first journey, public projections, retained receipt and credential reuse rejection', async () => {
  const { o, p, c, v } = await ready(); assert.equal(p.orderId, o.id); assert.equal(p.collectionEligible, true);
  assert.match((await call('getGuide', { platform: 'AMAZON' })).steps[0], /Amazon/);
  const inbox = await call('listNotifications', {}, a); assert.equal(inbox.items.length, 1); assert.equal(inbox.items[0].simulatedExternal, true);
  await call('readNotification', { notificationId: inbox.items[0].id }, a);
  const result = await call('confirmHandover', confirm(p.id, v.id), staff);
  assert.equal(await db.handover.count({ where: { parcelId: p.id } }), 1); const saved = await db.parcel.findUniqueOrThrow({ where: { id: p.id } }); assert.equal(saved.status, 'CLOSED'); assert.equal(saved.credentialState, 'CONSUMED');
  assert.ok((await db.verification.findUniqueOrThrow({ where: { id: v.id } })).consumedAt);
  await call('verifyCredential', { parcelId: p.id, method: 'QR', qr: c.qr }, staff, 409);
  assert.equal((await call('listParcels', { status: 'CLOSED', q: p.id }, staff)).items.length, 1);
  const publicP = await call('getParcel', { parcelId: p.id }, a), publicH = await call('getReceipt', { receiptId: result.receipt.id }, a);
  for (const field of ['audit', 'identifiers', 'recipientEmail', 'recipientName']) assert.equal(field in publicP, false);
  for (const field of ['staffId', 'verificationId']) assert.equal(field in publicH, false);
  assert.ok((await call('getStaffParcel', { parcelId: p.id }, staff)).audit.length >= 3);
  const credentials = await db.credential.findUniqueOrThrow({ where: { id: c.id } }); assert.notEqual(credentials.otpDigest, c.otp); assert.notEqual(credentials.qrDigest, c.qr.token);
  const serialized = JSON.stringify([await db.credential.findMany(), await db.idempotency.findMany(), await db.session.findMany(), await db.auditEvent.findMany()]);
  assert.equal(serialized.includes(c.qr.token), false); assert.equal(serialized.includes(a.token), false); assert.equal(serialized.includes('"otp":'), false);
});
test('PostgreSQL: authorization and ownership are enforced by the server', async () => {
  const { o, p } = await ready();
  await call('getOrder', { orderId: o.id }, b, 404); await call('getParcel', { parcelId: p.id }, b, 404);
  await call('intakeParcel', intake(), a, 403); await call('getStaffParcel', { parcelId: p.id }, a, 403); await call('getReview', { parcelId: p.id }, a, 403);
  await call('issueCredential', issue(p.id), b, 404); assert.equal((await call('listParcels', {}, b)).items.length, 0);
  await call('getSession', {}, undefined, 401); await call('logout', {}, a); await call('getSession', {}, a, 401);
});
test('PostgreSQL: late registration, no-match and typed identifier namespaces', async () => {
  const p = await call('intakeParcel', intake(), staff); assert.equal(p.studentId, undefined); assert.equal(p.matchOutcome, 'NO_MATCH');
  await call('createOrder', order(), a); assert.equal((await call('getParcel', { parcelId: p.id }, a)).collectionEligible, true);
  const awb = await call('intakeParcel', { ...intake(), identifiers: [tracking('AMZ-TEST')] }, staff); assert.equal(awb.studentId, undefined);
  await call('intakeParcel', { ...intake(), identifiers: [{ ...tracking(), namespace: 'UNKNOWN' }] } as never, staff, 400);
  await call('intakeParcel', { ...intake(), identifiers: [{ kind: 'TRACKING', namespace: 'BLUEDART', value: 'ABC' }] }, staff, 400);
  assert.equal(await db.parcel.count(), 2);
});
test('PostgreSQL: cross-student ambiguity holds current assignment and concurrent claims never allocate arbitrarily', async () => {
  await Promise.all([call('createOrder', order(), a), call('createOrder', order(), b)]);
  const p = await call('intakeParcel', intake(), staff); assert.equal(p.matchOutcome, 'AMBIGUOUS'); assert.equal(p.studentId, undefined);
  assert.equal((await db.parcel.findUniqueOrThrow({ where: { id: p.id } })).studentId, null);
});
test('PostgreSQL: split shipments stay separate; tracking collisions hold uncollected assignments and preserve new intake', async () => {
  const o = await call('createOrder', { ...order(), tracking: [tracking()] }, a);
  const one = await call('intakeParcel', { ...intake(), identifiers: [tracking()] }, staff); const c = await call('issueCredential', issue(one.id), a);
  const two = await call('intakeParcel', { ...intake(), identifiers: [tracking('track-one')] }, staff);
  assert.equal(two.studentId, undefined); assert.equal(two.matchOutcome, 'TRACKING_COLLISION'); assert.equal((await call('getParcel', { parcelId: one.id }, a)).hold, 'DISPUTE');
  assert.equal((await db.credential.findUniqueOrThrow({ where: { id: c.id } })).state, 'INVALIDATED');
  const first = await call('getStaffParcel', { parcelId: one.id }, staff);
  const decision: Input<'reconcileParcel'> = { parcelId: one.id, orderId: o.id, expectedRevision: first.revision, identifierReviewed: true, recipientVerified: true, conflictsResolved: true, reason: 'PRIVATE EVIDENCE: inspected both physical items and resolved reuse.', idempotencyKey: id('key') };
  const resolved = await call('reconcileParcel', decision, staff); assert.equal(resolved.hold, 'NONE'); assert.equal(await db.decision.count(), 1);
  assert.deepEqual(await call('reconcileParcel', decision, staff), resolved);
  await call('createOrder', order('UNRELATED'), b); assert.equal((await call('getParcel', { parcelId: one.id }, a)).hold, 'NONE');
  await call('intakeParcel', { ...intake(), identifiers: [tracking()] }, staff); assert.equal((await call('getParcel', { parcelId: one.id }, a)).hold, 'DISPUTE');
  assert.equal(JSON.stringify(await call('listNotifications', {}, a)).includes('PRIVATE EVIDENCE'), false);
  const split1 = await call('intakeParcel', intake(), staff), split2 = await call('intakeParcel', intake(), staff); assert.equal(split1.collectionEligible, true); assert.equal(split2.collectionEligible, true); assert.notEqual(split1.id, split2.id);
  assert.equal(await db.parcel.count(), 5);
});
test('PostgreSQL: simultaneous physical intake of same reference is unique, ordinary writes replay and reject changed bodies', async () => {
  const o = order(); const created = await call('createOrder', o, a); assert.deepEqual(await call('createOrder', o, a), created);
  await call('createOrder', { ...o, merchantOrderId: 'CHANGED' }, a, 409); const request = intake();
  const [one, two] = await Promise.all([call('intakeParcel', request, staff), call('intakeParcel', request, staff)]); assert.equal(one.id, two.id);
  await call('intakeParcel', { ...request, idempotencyKey: id('key') }, staff, 409); assert.equal(await db.parcel.count(), 1); assert.equal(await db.notification.count(), 1);
});
test('PostgreSQL: replacement, expiry, five failed OTP attempts and strict OTP/QR validation', async () => {
  const { p, c } = await ready();
  for (const fields of [{ method: 'OTP' }, { method: 'QR' }, { method: 'OTP', otp: c.otp, qr: c.qr }, { method: 'QR', qr: c.qr, otp: c.otp }]) await call('verifyCredential', { parcelId: p.id, ...fields } as never, staff, 400);
  const next = await call('issueCredential', issue(p.id, true), a); await call('verifyCredential', { parcelId: p.id, method: 'QR', qr: c.qr }, staff, 409);
  const wrong = next.otp === '000000' ? '111111' : '000000';
  for (let i = 1; i <= 5; i++) await call('verifyCredential', { parcelId: p.id, method: 'OTP', otp: wrong }, staff, i === 5 ? 429 : 409);
  assert.equal((await db.credential.findUniqueOrThrow({ where: { id: next.id } })).attempts, 5);
  assert.equal((await db.credential.findUniqueOrThrow({ where: { id: next.id } })).state, 'INVALIDATED');
  const replacement = await call('issueCredential', issue(p.id, true), a); time += 600_001;
  await call('verifyCredential', { parcelId: p.id, method: 'QR', qr: replacement.qr }, staff, 410); assert.equal(await db.handover.count(), 0);
});
test('PostgreSQL: verification binds parcel, revision, current credential and staff session; holds block issuance/confirmation', async () => {
  const { p, c, v } = await ready(); const otherStaff = await login(staff.accountId);
  await call('confirmHandover', confirm(p.id, v.id), otherStaff, 409);
  const second = await call('intakeParcel', intake(), staff); await call('confirmHandover', confirm(second.id, v.id), staff, 409);
  await call('issueCredential', issue(p.id, true), a); await call('confirmHandover', confirm(p.id, v.id), staff, 409);
  await call('verifyCredential', { parcelId: p.id, method: 'QR', qr: c.qr }, staff, 409);
  const fresh = await call('issueCredential', issue(p.id, true), a), verification = await call('verifyCredential', { parcelId: p.id, method: 'OTP', otp: fresh.otp }, staff);
  const held = await call('setHold', { parcelId: p.id, expectedRevision: p.revision, hold: 'REVIEW', reason: 'PRIVATE REVIEW REASON evidence requires inspection' }, staff);
  await call('issueCredential', issue(p.id, true), a, 423); await call('confirmHandover', confirm(p.id, verification.id), staff, 423); assert.equal(await db.handover.count(), 0);
  await call('setHold', { parcelId: p.id, expectedRevision: held.revision, hold: 'NONE', reason: 'Physical inspection completed; review hold cleared.' }, staff);
  const stale = await call('confirmHandover', confirm(p.id, verification.id), staff, 409);
  assert.equal((stale as unknown as { error: { code: string } }).error.code, 'REVISION_CHANGED');
});
test('PostgreSQL: transaction failure rolls back handover, closure, credential consumption, audit, outbox and idempotency together', async () => {
  const { p, c, v } = await ready(), beforeAudit = await db.auditEvent.count(), beforeInbox = await db.notification.count(); const request = confirm(p.id, v.id);
  rollback = true; await call('confirmHandover', request, staff, 503); rollback = false;
  assert.equal(await db.handover.count(), 0); assert.equal((await db.parcel.findUniqueOrThrow({ where: { id: p.id } })).status, 'AWAITING_COLLECTION');
  assert.equal((await db.credential.findUniqueOrThrow({ where: { id: c.id } })).state, 'ACTIVE'); assert.equal((await db.verification.findUniqueOrThrow({ where: { id: v.id } })).consumedAt, null);
  assert.equal(await db.auditEvent.count(), beforeAudit); assert.equal(await db.notification.count(), beforeInbox); assert.equal(await db.idempotency.count({ where: { operation: 'confirmHandover' } }), 0);
  await call('confirmHandover', request, staff); assert.equal(await db.handover.count(), 1);
});
test('PostgreSQL: two simultaneous fresh confirmations with DISTINCT keys create exactly one handover', async () => {
  const { p, v } = await ready();
  const results = await Promise.allSettled([runtime.backend.execute('confirmHandover', confirm(p.id, v.id), staff.token), runtime.backend.execute('confirmHandover', confirm(p.id, v.id), staff.token)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(await db.handover.count(), 1); assert.equal(await db.notification.count({ where: { eventKey: `collection:${p.id}` } }), 1);
});
test('PostgreSQL: simultaneous SAME-key retries replay one permanent result', async () => {
  const { p, v } = await ready(), request = confirm(p.id, v.id);
  const results = await Promise.all([call('confirmHandover', request, staff), call('confirmHandover', request, staff)]);
  assert.equal(results[0].receipt.id, results[1].receipt.id); assert.deepEqual(results.map(r => r.replayed).sort(), [false, true]);
  assert.equal(await db.handover.count(), 1); assert.equal(await db.idempotency.count({ where: { operation: 'confirmHandover' } }), 1);
  await call('confirmHandover', { ...request, physicalHandoverConfirmed: false }, staff, 409);
});
test('PostgreSQL: permanent lost-outcome replay survives 24 hours, server state restart and staff logout/login; uncommitted expiry rejects', async () => {
  const { p, v } = await ready(), request = confirm(p.id, v.id); await call('confirmHandover', request, staff); // response intentionally discarded
  await call('logout', {}, staff); time += 86_400_001; await runtime.app.close();
  runtime = await createApp(db, settings, { now: () => new Date(time) }); staff = await login(staff.accountId);
  a = await login(a.accountId);
  const recovered = await call('confirmHandover', request, staff); assert.equal(recovered.replayed, true); assert.equal(await db.handover.count(), 1);
  const newP = await call('intakeParcel', intake(), staff), code = await call('issueCredential', issue(newP.id), a), verification = await call('verifyCredential', { parcelId: newP.id, method: 'QR', qr: code.qr }, staff);
  time += 121_000; await call('confirmHandover', confirm(newP.id, verification.id), staff, 410); assert.equal(await db.handover.count(), 1);
});
test('PostgreSQL: issuance replay secrets are volatile and require explicit new-key replacement after restart', async () => {
  const { p, c, request } = await ready(); assert.deepEqual(await call('issueCredential', request, a), c);
  await runtime.app.close(); runtime = await createApp(db, settings, { now: () => new Date(time) });
  await call('issueCredential', request, a, 409); await call('issueCredential', issue(p.id), a, 409);
  const replacement = await call('issueCredential', issue(p.id, true), a); assert.notEqual(replacement.id, c.id);
});
test('PostgreSQL: durable outbox, provider-result deduplication and read state are independent', async () => {
  await ready(); const inbox = await call('listNotifications', {}, a); const n = inbox.items[0]; assert.equal(n.externalDelivery, 'PENDING');
  await call('readNotification', { notificationId: n.id }, a); await processOutbox(db); await processOutbox(db);
  const attempt = await db.deliveryAttempt.findFirstOrThrow({ where: { notificationId: n.id } }); assert.equal(attempt.state, 'ACCEPTED'); assert.equal(await db.deliveryResult.count(), 1);
  assert.equal(await deliveryResult(db, { attemptId: attempt.id, eventId: `simulation:${attempt.id}`, state: 'ACCEPTED', occurredAt: new Date(time) }), false);
  assert.equal(await deliveryResult(db, { attemptId: attempt.id, eventId: id('evt'), state: 'DELIVERED', occurredAt: new Date(time - 1000) }), false);
  const nextInbox = await call('listNotifications', {}, a); assert.ok(nextInbox.items[0].readAt); assert.equal(nextInbox.items[0].simulatedExternal, true); assert.equal(nextInbox.items[0].externalDelivery, 'ACCEPTED');
});
test('PostgreSQL: pagination snapshots survive server state restart and exclude concurrent inserts', async () => {
  for (let i = 0; i < 4; i++) await call('createOrder', order('ORDER-' + i), a);
  const first = await call('listOrders', { limit: 2 }, a); await call('createOrder', order('INSERTED'), a);
  await runtime.app.close(); runtime = await createApp(db, settings, { now: () => new Date(time) });
  const second = await call('listOrders', { limit: 2, cursor: first.nextCursor }, a); assert.equal(second.items.length, 2); assert.equal(second.items.some(o => o.merchantOrderId === 'INSERTED'), false);
  assert.equal(new Set([...first.items, ...second.items].map(o => o.id)).size, 4); await call('listOrders', { limit: 2, cursor: first.nextCursor }, b, 400);
  time += 900_001; await call('listOrders', { limit: 2, cursor: first.nextCursor }, a, 400);
});
test('PostgreSQL: production disables demo endpoints; retained audit and closed ownership cannot be changed', async () => {
  const { p, v } = await ready(); await call('confirmHandover', confirm(p.id, v.id), staff);
  await assert.rejects(db.auditEvent.updateMany({ data: { reason: 'tampered' } }));
  await assert.rejects(db.parcel.update({ where: { id: p.id }, data: { studentId: b.accountId } }));
  await assert.rejects(db.handover.deleteMany());
  const disabled = await createApp(db, { ...settings, demo: false });
  try { for (const url of ['/v1/demo/sessions', '/v1/demo/reset']) { const response = await disabled.app.inject({ method: 'POST', url, ...(url.endsWith('sessions') ? { payload: { accountId: staff.accountId, passcode: process.env.DEMO_PASSCODE! } } : {}) }); assert.equal(response.statusCode, 404); } } finally { await disabled.app.close(); }
});
test('PostgreSQL: new conflicting claim holds an assignment; clearing a review cannot reuse stale verification', async () => {
  const { p, v } = await ready(); await call('createOrder', order(), b);
  const held = await call('getStaffParcel', { parcelId: p.id }, staff); assert.equal(held.hold, 'DISPUTE');
  await call('confirmHandover', confirm(p.id, v.id), staff, 423); assert.equal(await db.handover.count(), 0);
  await call('setHold', { parcelId: p.id, expectedRevision: held.revision, hold: 'NONE', reason: 'Cannot bypass evidence reconciliation' }, staff, 423);
});
test('PostgreSQL: concurrent intake tracking collisions, reconciliation and replacement preserve database invariants', async () => {
  const o = await call('createOrder', { ...order(), tracking: [tracking()] }, a);
  await Promise.all([call('intakeParcel', { ...intake(), identifiers: [tracking()] }, staff), call('intakeParcel', { ...intake(), identifiers: [tracking()] }, staff)]);
  assert.equal(await db.parcel.count(), 2); assert.equal(await db.parcel.count({ where: { studentId: null } }), 1); assert.equal(await db.parcel.count({ where: { hold: 'NONE' } }), 0);
  const p = await call('intakeParcel', { ...intake('UNMATCHED'), identifiers: [] }, staff);
  const decision = { parcelId: p.id, orderId: o.id, expectedRevision: p.revision, identifierReviewed: true, recipientVerified: true, conflictsResolved: true, reason: 'Physical evidence reviewed with independent profile corroboration.', idempotencyKey: id('key') };
  const decisions = await Promise.allSettled([runtime.backend.execute('reconcileParcel', decision, staff.token), runtime.backend.execute('reconcileParcel', { ...decision, idempotencyKey: id('key') }, staff.token)]);
  assert.equal(decisions.filter(r => r.status === 'fulfilled').length, 1); assert.equal(await db.decision.count({ where: { parcelId: p.id } }), 1);
  const [one, two] = await Promise.all([call('issueCredential', issue(p.id, true), a), call('issueCredential', issue(p.id, true), a)]);
  assert.notEqual(one.id, two.id); assert.equal(await db.credential.count({ where: { parcelId: p.id, state: 'ACTIVE' } }), 1); assert.equal(await db.credential.count({ where: { parcelId: p.id, state: 'INVALIDATED' } }), 1);
});
test('PostgreSQL: historical handover survives later reused tracking and closed ownership stays unchanged', async () => {
  await call('createOrder', { ...order(), tracking: [tracking()] }, a); const p = await call('intakeParcel', { ...intake(), identifiers: [tracking()] }, staff);
  const c = await call('issueCredential', issue(p.id), a), v = await call('verifyCredential', { parcelId: p.id, method: 'QR', qr: c.qr }, staff), result = await call('confirmHandover', confirm(p.id, v.id), staff);
  const later = await call('intakeParcel', { ...intake(), identifiers: [tracking()] }, staff); assert.equal(later.matchOutcome, 'TRACKING_COLLISION'); assert.equal(later.studentId, undefined);
  assert.equal((await db.parcel.findUniqueOrThrow({ where: { id: p.id } })).studentId, a.accountId); assert.equal((await db.parcel.findUniqueOrThrow({ where: { id: p.id } })).status, 'CLOSED');
  assert.equal((await call('getReceipt', { receiptId: result.receipt.id }, a)).id, result.receipt.id); assert.equal(await db.handover.count(), 1);
});
test('PostgreSQL: server rate limits persist and clear at the time boundary; session expiry rejects authentication', async () => {
  const { p, c } = await ready();
  for (let i = 1; i <= 5; i++) await call('issueCredential', issue(p.id, true), a);
  await call('issueCredential', issue(p.id, true), a, 400); assert.equal(await db.credential.count({ where: { parcelId: p.id } }), 6);
  time += 60_001; const next = await call('issueCredential', issue(p.id, true), a);
  for (let i = 0; i < 20; i++) await call('verifyCredential', { parcelId: p.id, method: 'QR', qr: next.qr }, staff);
  await call('verifyCredential', { parcelId: p.id, method: 'QR', qr: next.qr }, staff, 400); assert.equal(await db.verification.count(), 21); // original ready verification + twenty fresh checks
  assert.notEqual(c.id, next.id); time += 1_800_001; await call('getSession', {}, a, 401);
});
test('PostgreSQL: 24-hour ordinary write expiry applies current uniqueness and schema bounds reject before mutation', async () => {
  const input = order(); await call('createOrder', input, a); time += 86_400_001; a = await login(a.accountId); staff = await login(staff.accountId);
  await call('createOrder', input, a, 409); assert.equal(await db.expectedOrder.count(), 1);
  await call('intakeParcel', { ...intake(), recipientStudentNumber: 'x'.repeat(41) }, staff, 400);
  await call('intakeParcel', { ...intake(), identifiers: Array.from({ length: 21 }, () => tracking()) }, staff, 400);
  assert.equal(await db.parcel.count(), 0);
});
test('PostgreSQL closeout: relevant conflicting evidence invalidates an unassigned review; unrelated orders do not', async () => {
  const target = await call('createOrder', order('MANUAL-TARGET'), a);
  const p = await call('intakeParcel', intake('LATE-CONFLICT'), staff);
  const review = await call('getReview', { parcelId: p.id }, staff);
  await call('createOrder', order('UNRELATED'), a);
  assert.equal((await call('getReview', { parcelId: p.id }, staff)).parcel.revision, review.parcel.revision);
  await call('createOrder', order('LATE-CONFLICT'), b);
  const changed = await call('getReview', { parcelId: p.id }, staff);
  assert.equal(changed.parcel.matchOutcome, 'CONFLICT'); assert.equal(changed.parcel.studentId, undefined); assert.ok(changed.parcel.revision > review.parcel.revision);
  const decision: Input<'reconcileParcel'> = { parcelId: p.id, orderId: target.id, expectedRevision: review.parcel.revision, identifierReviewed: true, recipientVerified: true, conflictsResolved: true, reason: 'Physical label and independent recipient evidence reviewed.', idempotencyKey: id('key') };
  const rejected = await call('reconcileParcel', decision, staff, 409);
  assert.equal((rejected as unknown as { error: { code: string } }).error.code, 'REVISION_CHANGED');
  assert.equal(await db.decision.count(), 0); assert.equal((await db.parcel.findUniqueOrThrow({ where: { id: p.id } })).studentId, null);
  assert.equal(await db.auditEvent.count({ where: { parcelId: p.id, action: 'EVIDENCE_REVIEWED' } }), 0);
  assert.equal(await db.idempotency.count({ where: { operation: 'reconcileParcel' } }), 0);
  const resolved = await call('reconcileParcel', { ...decision, expectedRevision: changed.parcel.revision, idempotencyKey: id('key'), reason: 'Fresh review resolved the new conflicting claim using physical and recipient evidence.' }, staff);
  assert.equal(resolved.orderId, target.id); assert.equal(resolved.collectionEligible, true); assert.equal(await db.decision.count(), 1);
  // A retained legacy decision must not be invalidated merely by upgrading its hash format.
  const stored = await db.parcel.findUniqueOrThrow({ where: { id: p.id }, include: parcelInclude });
  const legacy = fingerprint(stored, await db.expectedOrder.findMany({ include: orderInclude }), await db.parcel.findMany({ include: parcelInclude })).legacyValue;
  await db.parcel.update({ where: { id: p.id }, data: { reviewedFingerprint: legacy, observedFingerprint: legacy } });
  await call('createOrder', order('ANOTHER-UNRELATED'), a);
  const preserved = await call('getStaffParcel', { parcelId: p.id }, staff); assert.equal(preserved.hold, 'NONE'); assert.equal(preserved.revision, resolved.revision);
  assert.match((await db.parcel.findUniqueOrThrow({ where: { id: p.id } })).reviewedFingerprint!, /^e2:/);
});
test('PostgreSQL closeout: unassigned ambiguity and tracking-collision membership changes advance revision once per relevant change', async () => {
  await call('createOrder', order(), a); await call('createOrder', order(), b);
  const label = intake(); const p = await call('intakeParcel', { ...label, identifiers: [...label.identifiers, tracking('SHARED')] }, staff), original = await call('getReview', { parcelId: p.id }, staff);
  assert.equal(p.matchOutcome, 'AMBIGUOUS');
  await call('createOrder', { ...order('THIRD-CLAIM'), tracking: [tracking('SHARED')] }, a);
  const thirdReview = await call('getReview', { parcelId: p.id }, staff);
  assert.equal(thirdReview.parcel.matchOutcome, 'AMBIGUOUS'); assert.equal(thirdReview.parcel.revision, original.parcel.revision + 1);
  await call('createOrder', order('UNRELATED-CLAIM'), a);
  assert.equal((await call('getReview', { parcelId: p.id }, staff)).parcel.revision, thirdReview.parcel.revision);
  const collision = await call('intakeParcel', { ...intake(), identifiers: [tracking('REUSED')] }, staff);
  const before = await call('getReview', { parcelId: collision.id }, staff);
  await call('intakeParcel', { ...intake(), identifiers: [tracking('REUSED')] }, staff);
  const second = await call('getReview', { parcelId: collision.id }, staff); assert.equal(second.parcel.matchOutcome, 'TRACKING_COLLISION'); assert.equal(second.parcel.revision, before.parcel.revision + 1);
  await call('intakeParcel', { ...intake(), identifiers: [tracking('REUSED')] }, staff);
  const next = await call('getReview', { parcelId: collision.id }, staff); assert.equal(next.parcel.revision, second.parcel.revision + 1);
  await call('createOrder', order('NOT-RELEVANT'), a); assert.equal((await call('getReview', { parcelId: collision.id }, staff)).parcel.revision, next.parcel.revision);
  assert.equal(await db.decision.count(), 0); assert.equal((await db.parcel.findUniqueOrThrow({ where: { id: collision.id } })).studentId, null);
});
test('PostgreSQL closeout: forced old OTP proposals are rejected against protected history; exhaustion preserves the current credential', async () => {
  let proposals: string[] = []; let generated = 0;
  await runtime.app.close(); runtime = await createApp(db, settings, { now: () => new Date(time), otpGenerator: () => { generated++; const value = proposals.shift(); assert.ok(value, 'test must explicitly supply each proposal'); return value; } });
  await call('createOrder', order(), a); const p = await call('intakeParcel', intake(), staff);
  proposals = ['012345']; const first = await call('issueCredential', issue(p.id), a);
  proposals = [first.otp, '678901']; const second = await call('issueCredential', issue(p.id, true), a); assert.equal(second.otp, '678901');
  proposals = [first.otp, second.otp, '234567']; const current = await call('issueCredential', issue(p.id, true), a); assert.equal(current.otp, '234567');
  for (const code of [first.otp, second.otp]) await call('verifyCredential', { parcelId: p.id, method: 'OTP', otp: code }, staff, 409);
  await call('verifyCredential', { parcelId: p.id, method: 'OTP', otp: current.otp }, staff);
  assert.equal((await db.credential.findUniqueOrThrow({ where: { id: first.id } })).state, 'INVALIDATED');
  proposals = Array(32).fill(current.otp); const before = generated;
  await call('issueCredential', issue(p.id, true), a, 503); assert.equal(generated - before, 32);
  assert.equal(await db.credential.count(), 3); assert.equal(await db.credential.count({ where: { parcelId: p.id, state: 'ACTIVE' } }), 1);
  assert.equal((await db.credential.findUniqueOrThrow({ where: { id: current.id } })).state, 'ACTIVE');
  await call('verifyCredential', { parcelId: p.id, method: 'OTP', otp: current.otp }, staff);
  time += 600_001; proposals = [current.otp, '345678']; const afterExpiry = await call('issueCredential', issue(p.id, true), a); assert.equal(afterExpiry.otp, '345678');
  await call('verifyCredential', { parcelId: p.id, method: 'OTP', otp: current.otp }, staff, 409);
  await call('verifyCredential', { parcelId: p.id, method: 'OTP', otp: afterExpiry.otp }, staff);
  await call('issueCredential', { ...issue(p.id, true), otp: '999999' } as never, a, 400);
  assert.equal(await db.credential.count(), 4); assert.equal(generated, 40);
  const serialized = JSON.stringify(await db.credential.findMany()); assert.equal(serialized.includes('"otp":'), false); assert.equal(serialized.includes('"qr":'), false);
});
