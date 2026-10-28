import { describe, expect, it } from 'vitest';
import { createMockKernel, STORAGE_KEY, type Persistence } from '../src/api/mock';
import { DEMO_PASSCODE, type Input, type MailroomService, type Schema } from '../src/api/service';

class MemoryStorage implements Persistence {
  data = new Map<string, string>();
  fail = false;
  async getItem(key: string) { return this.data.get(key) ?? null; }
  async setItem(key: string, value: string) { if (this.fail) throw new Error('storage unavailable'); this.data.set(key, value); }
}
async function fixture() {
  const storage = new MemoryStorage(); let time = Date.parse('2026-10-28T08:00:00.000Z');
  const now = () => time; const kernel = createMockKernel(storage, now);
  const a = kernel.client(); const b = kernel.client(); const staff = kernel.client();
  await a.login({ accountId: 'usr_asha', passcode: DEMO_PASSCODE }); await b.login({ accountId: 'usr_neel', passcode: DEMO_PASSCODE }); await staff.login({ accountId: 'usr_staff', passcode: DEMO_PASSCODE });
  return { storage, now, kernel, a, b, staff, advance: (ms: number) => { time += ms; } };
}
let keyCounter = 0;
const writeKey = () => 'test-write-' + ++keyCounter;
const orderInput = (merchantOrderId = 'AMZ-1001'): Input<'createOrder'> => ({ idempotencyKey: writeKey(), platform: 'AMAZON', merchantOrderId, tracking: [] });
const label = (merchantOrderId = 'AMZ-1001', physicalReference = 'BOX-001'): Input<'intakeParcel'> => ({ idempotencyKey: writeKey(), identifiers: [{ kind: 'ORDER_ID', namespace: 'AMAZON', value: merchantOrderId }], recipientEmail: 'asha@students.example.invalid', recipientStudentNumber: 'DEMO1001', recipientName: 'Asha Rao', description: 'Brown box', physicalReference, storageLocation: 'Rack A2', source: 'MANUAL', labelReviewed: true });
const issuance = (parcelId: string, key = 'issue-key-001', replace = false): Input<'issueCredential'> => ({ parcelId, idempotencyKey: key, replace });
const confirm = (parcelId: string, verificationId: string, key = 'handover-key-001'): Input<'confirmHandover'> => ({ parcelId, verificationId, physicalHandoverConfirmed: true, idempotencyKey: key });
async function ready(a: MailroomService, staff: MailroomService) { const order = await a.createOrder(orderInput()); const parcel = await staff.intakeParcel(label()); return { order, parcel }; }
async function verified(a: MailroomService, staff: MailroomService, parcel: Pick<Schema<'Parcel'>, 'id'>) { const credential = await a.issueCredential(issuance(parcel.id)); const verification = await staff.verifyCredential({ parcelId: parcel.id, method: 'OTP', otp: credential.otp }); return { credential, verification }; }

describe('complete mock journey', () => {
  it('registers, guides, matches, notifies, issues OTP/QR, verifies separately, confirms, retains and rejects reuse', async () => {
    const f = await fixture();
    const guide = await f.a.getGuide({ platform: 'AMAZON' }); expect(guide.steps.length).toBeGreaterThan(1);
    const { order, parcel } = await ready(f.a, f.staff);
    expect(parcel).toMatchObject({ status: 'AWAITING_COLLECTION', studentId: 'usr_asha', matchOutcome: 'MATCHED', collectionEligible: true });
    expect((await f.a.getOrder({ orderId: order.id })).status).toBe('MATCHED');
    const inbox = await f.a.listNotifications({}); expect(inbox.items).toHaveLength(1); expect(inbox.items[0]).toMatchObject({ inAppAvailable: true, externalDelivery: 'ACCEPTED', simulatedExternal: true });
    await f.a.readNotification({ notificationId: inbox.items[0].id }); expect((await f.a.listNotifications({})).items[0].readAt).toBeDefined();
    const { credential, verification } = await verified(f.a, f.staff, parcel);
    expect(credential.otp).toMatch(/^\d{6}$/); expect(Object.keys(credential.qr).sort()).toEqual(['credentialRef', 'token', 'v']);
    expect(Date.parse(credential.expiresAt) - Date.parse(credential.issuedAt)).toBe(600_000);
    expect((await f.staff.getParcel({ parcelId: parcel.id })).status).toBe('AWAITING_COLLECTION');
    expect((await f.staff.listReceipts({})).items).toHaveLength(0);
    expect(Date.parse(verification.expiresAt) - f.now()).toBe(120_000);
    const result = await f.staff.confirmHandover(confirm(parcel.id, verification.id));
    expect(result.replayed).toBe(false); expect((await f.a.getReceipt({ receiptId: result.receipt.id })).id).toBe(result.receipt.id);
    await expect(f.staff.verifyCredential({ parcelId: parcel.id, method: 'QR', qr: credential.qr })).rejects.toMatchObject({ code: 'ALREADY_COLLECTED' });
    expect((await f.staff.listParcels({ status: 'CLOSED', q: 'Brown' })).items).toHaveLength(1);
    expect((await f.a.getParcel({ parcelId: parcel.id })).credentialState).toBe('CONSUMED');
  });
});
describe('matching and lifecycle safeguards', () => {
  it('keeps no-match and name-only evidence unassigned', async () => {
    const { a, staff } = await fixture(); await a.createOrder(orderInput());
    const noMatch = await staff.intakeParcel(label('UNKNOWN'));
    expect(noMatch.status).toBe('AWAITING_MATCH'); expect(noMatch.studentId).toBeUndefined();
    const nameOnly = await staff.intakeParcel({ ...label('AMZ-1001', 'BOX-002'), recipientEmail: '', recipientStudentNumber: '' });
    expect(nameOnly.matchOutcome).toBe('INSUFFICIENT_EVIDENCE'); expect(nameOnly.studentId).toBeUndefined();
    expect((await a.listNotifications({})).items).toHaveLength(0);
  });
  it('never compares an order ID with AWB or a different namespace', async () => {
    const { a, staff } = await fixture(); await a.createOrder(orderInput('SAME-TEXT'));
    for (const [kind, namespace, physicalReference] of [['TRACKING', 'EKART', 'BOX-1'], ['ORDER_ID', 'FLIPKART', 'BOX-2']] as const) {
      const p = await staff.intakeParcel({ ...label(), physicalReference, identifiers: [({ kind, namespace, value: 'SAME-TEXT' } as Schema<'Identifier'>)] }); expect(p.studentId).toBeUndefined(); expect(p.matchOutcome).toBe('NO_MATCH');
    }
  });
  it('requires staff review when only a generic OTHER carrier namespace is comparable', async () => {
    const { a, staff } = await fixture(); await a.createOrder({ ...orderInput(), tracking: [{ kind: 'TRACKING', namespace: 'OTHER', value: 'UNKNOWN-CARRIER-1' }] });
    const p = await staff.intakeParcel({ ...label(), identifiers: [{ kind: 'TRACKING', namespace: 'OTHER', value: 'UNKNOWN-CARRIER-1' }] });
    expect(p.matchOutcome).toBe('INSUFFICIENT_EVIDENCE'); expect(p.studentId).toBeUndefined();
  });
  it('rejects contradictory identifiers and recipient evidence', async () => {
    const { a, staff } = await fixture(); await a.createOrder({ ...orderInput(), tracking: [{ kind: 'TRACKING', namespace: 'DELHIVERY', value: 'AWB-CORRECT' }] });
    const badId = await staff.intakeParcel({ ...label(), identifiers: [...label().identifiers, { kind: 'TRACKING', namespace: 'DELHIVERY', value: 'AWB-WRONG' }] });
    expect(badId.matchOutcome).toBe('CONFLICT'); expect(badId.studentId).toBeUndefined();
    const badRecipient = await staff.intakeParcel({ ...label('AMZ-1001', 'BOX-2'), recipientEmail: 'neel@students.example.invalid' }); expect(badRecipient.matchOutcome).toBe('CONFLICT');
  });
  it('does not allocate ambiguous duplicate claims to first claimant', async () => {
    const { a, b, staff } = await fixture(); await a.createOrder(orderInput()); await b.createOrder(orderInput());
    const p = await staff.intakeParcel(label()); expect(p.matchOutcome).toBe('AMBIGUOUS'); expect(p.studentId).toBeUndefined();
    await expect(a.createOrder(orderInput())).rejects.toMatchObject({ code: 'DUPLICATE_ORDER' });
  });
  it('requires a unique physical reference while preserving separate split shipments', async () => {
    const { a, staff } = await fixture(); const { order, parcel } = await ready(a, staff);
    await expect(staff.intakeParcel(label())).rejects.toMatchObject({ code: 'DUPLICATE_INTAKE' });
    const second = await staff.intakeParcel(label('AMZ-1001', 'BOX-002')); expect(second.id).not.toBe(parcel.id);
    expect((await a.getOrder({ orderId: order.id })).parcelIds).toEqual(expect.arrayContaining([parcel.id, second.id]));
    const c = await a.issueCredential(issuance(parcel.id)); await expect(staff.verifyCredential({ parcelId: second.id, method: 'OTP', otp: c.otp })).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' });
  });
  it('handles late registration and subsequently available tracking', async () => {
    const { a, staff } = await fixture(); const late = await staff.intakeParcel(label()); expect(late.status).toBe('AWAITING_MATCH');
    await a.createOrder(orderInput()); expect((await a.getParcel({ parcelId: late.id })).collectionEligible).toBe(true);
    const order = await a.createOrder(orderInput('SECOND')); const trackingParcel = await staff.intakeParcel({ ...label('SECOND', 'BOX-2'), identifiers: [{ kind: 'TRACKING', namespace: 'DELHIVERY', value: 'AWB-SECOND' }] }); expect(trackingParcel.studentId).toBeUndefined();
    await a.addTracking({ orderId: order.id, reference: { kind: 'TRACKING', namespace: 'DELHIVERY', value: 'AWB-SECOND' } }); expect((await a.getParcel({ parcelId: trackingParcel.id })).orderId).toBe(order.id);
  });
  it('allows only eligible cancellation', async () => {
    const { a, staff } = await fixture(); const pending = await a.createOrder(orderInput('CANCEL')); expect((await a.cancelOrder({ orderId: pending.id })).status).toBe('CANCELLED');
    const { order } = await ready(a, staff); await expect(a.cancelOrder({ orderId: order.id })).rejects.toMatchObject({ code: 'CANCELLATION_INELIGIBLE' });
  });
  it('new disputes hold assigned parcels, revoke credentials and require reviewed evidence', async () => {
    const { a, b, staff } = await fixture(); const { order, parcel } = await ready(a, staff); const { verification } = await verified(a, staff, parcel);
    await b.createOrder(orderInput()); const held = await staff.getParcel({ parcelId: parcel.id }); expect(held.hold).toBe('DISPUTE'); expect(held.credentialState).toBe('INVALIDATED');
    await expect(a.issueCredential(issuance(parcel.id, 'new-issue-key'))).rejects.toMatchObject({ code: 'COLLECTION_HOLD' });
    await expect(staff.confirmHandover(confirm(parcel.id, verification.id))).rejects.toMatchObject({ code: 'COLLECTION_HOLD' });
    await expect(staff.setHold({ parcelId: parcel.id, hold: 'NONE', expectedRevision: held.revision, reason: 'Trying to bypass evidence review' })).rejects.toMatchObject({ code: 'COLLECTION_HOLD' });
    const request: Input<'reconcileParcel'> = { idempotencyKey: writeKey(), parcelId: parcel.id, orderId: order.id, expectedRevision: held.revision, identifierReviewed: true, recipientVerified: true, conflictsResolved: false, reason: 'Label and provisioned profile reviewed; competing claim resolved.' };
    await expect(staff.reconcileParcel(request)).rejects.toMatchObject({ code: 'VALIDATION' });
    const resolved = await staff.reconcileParcel({ ...request, conflictsResolved: true }); expect(resolved.hold).toBe('NONE');
    await b.createOrder(orderInput('UNRELATED')); expect((await a.getParcel({ parcelId: parcel.id })).hold).toBe('NONE');
    expect(resolved.audit.some(e => e.action === 'EVIDENCE_REVIEWED')).toBe(true);
  });
  it('supports documented manual reconciliation without uploading evidence', async () => {
    const { a, staff } = await fixture(); const order = await a.createOrder(orderInput()); const p = await staff.intakeParcel({ ...label(), identifiers: [] });
    const result = await staff.reconcileParcel({ idempotencyKey: writeKey(), parcelId: p.id, orderId: order.id, expectedRevision: p.revision, identifierReviewed: true, recipientVerified: true, conflictsResolved: true, reason: 'Physical label and independent provisioned student evidence checked.' }); expect(result.collectionEligible).toBe(true);
  });
  it('a later trustworthy competing request holds a manually assigned parcel instead of leaving it collectable', async () => {
    const { a, b, staff } = await fixture(); const order = await a.createOrder(orderInput());
    const p = await staff.intakeParcel({ ...label('LATE-NEEL-ORDER'), recipientEmail: 'neel@students.example.invalid', recipientStudentNumber: 'DEMO1002' });
    await staff.reconcileParcel({ idempotencyKey: writeKey(), parcelId: p.id, orderId: order.id, expectedRevision: p.revision, identifierReviewed: true, recipientVerified: true, conflictsResolved: true, reason: 'Demonstration manual decision before competing reference was registered.' });
    await a.issueCredential(issuance(p.id)); await b.createOrder(orderInput('LATE-NEEL-ORDER'));
    const result = await staff.getParcel({ parcelId: p.id }); expect(result.studentId).toBe('usr_asha'); expect(result.hold).toBe('DISPUTE'); expect(result.collectionEligible).toBe(false); expect(result.credentialState).toBe('INVALIDATED');
  });
});
describe('authorization, credentials, verification and retry semantics', () => {
  it('scopes Student A and B records and restricts all staff operations', async () => {
    const { a, b, staff } = await fixture(); const { order, parcel } = await ready(a, staff);
    expect((await b.listOrders({})).items).toHaveLength(0); expect((await b.listParcels({})).items).toHaveLength(0); expect((await b.listNotifications({})).items).toHaveLength(0);
    await expect(b.getOrder({ orderId: order.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(b.getParcel({ parcelId: parcel.id })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(b.issueCredential(issuance(parcel.id))).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(b.addTracking({ orderId: order.id, reference: { kind: 'TRACKING', namespace: 'EKART', value: 'BAD' } })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(a.intakeParcel(label('X', 'BOX-2'))).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(a.getReview({ parcelId: parcel.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(a.resetDemo({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('issues one current code, replays issuance and invalidates OTP/QR on replacement', async () => {
    const { a, staff } = await fixture(); const { parcel } = await ready(a, staff);
    const first = await a.issueCredential(issuance(parcel.id)); expect(await a.issueCredential(issuance(parcel.id))).toEqual(first);
    await expect(a.issueCredential(issuance(parcel.id, 'other-issuance-key'))).rejects.toMatchObject({ code: 'CREDENTIAL_ACTIVE' });
    await expect(a.issueCredential(issuance(parcel.id, 'issue-key-001', true))).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const verification = await staff.verifyCredential({ parcelId: parcel.id, method: 'QR', qr: first.qr });
    const second = await a.issueCredential(issuance(parcel.id, 'replacement-key', true)); expect(second.id).not.toBe(first.id);
    await expect(staff.verifyCredential({ parcelId: parcel.id, method: 'OTP', otp: first.otp })).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' });
    await expect(staff.verifyCredential({ parcelId: parcel.id, method: 'QR', qr: first.qr })).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' });
    await expect(staff.confirmHandover(confirm(parcel.id, verification.id))).rejects.toMatchObject({ code: 'CONCURRENT_CONFLICT' });
  });
  it('invalid OTP attempts never close a parcel and five attempts invalidate the credential', async () => {
    const { a, staff } = await fixture(); const { parcel } = await ready(a, staff); await a.issueCredential(issuance(parcel.id));
    for (let n = 1; n <= 5; n++) await expect(staff.verifyCredential({ parcelId: parcel.id, method: 'OTP', otp: '000000' })).rejects.toMatchObject({ code: n === 5 ? 'ATTEMPTS_EXCEEDED' : 'INVALID_CREDENTIAL' });
    expect((await staff.getParcel({ parcelId: parcel.id })).status).toBe('AWAITING_COLLECTION'); expect((await staff.listReceipts({})).items).toHaveLength(0);
  });
  it('rejects expired credentials and expired verification without closing', async () => {
    const f = await fixture(); const { parcel } = await ready(f.a, f.staff); const { credential, verification } = await verified(f.a, f.staff, parcel);
    f.advance(120_001); await expect(f.staff.confirmHandover(confirm(parcel.id, verification.id))).rejects.toMatchObject({ code: 'VERIFICATION_EXPIRED' });
    f.advance(480_000); await expect(f.staff.verifyCredential({ parcelId: parcel.id, method: 'OTP', otp: credential.otp })).rejects.toMatchObject({ code: 'CREDENTIAL_EXPIRED' });
    expect((await f.staff.listReceipts({})).items).toHaveLength(0);
  });
  it('bounds verification expiry by credential expiry and binds staff session', async () => {
    const f = await fixture(); const { parcel } = await ready(f.a, f.staff); const c = await f.a.issueCredential(issuance(parcel.id)); f.advance(550_000);
    const v = await f.staff.verifyCredential({ parcelId: parcel.id, method: 'QR', qr: c.qr }); expect(v.expiresAt).toBe(c.expiresAt);
    const otherStaff = f.kernel.client(); await otherStaff.login({ accountId: 'usr_staff', passcode: DEMO_PASSCODE });
    await expect(otherStaff.confirmHandover(confirm(parcel.id, v.id))).rejects.toMatchObject({ code: 'INVALID_CREDENTIAL' });
  });
  it('rechecks hold, revision and explicit physical confirmation', async () => {
    const f = await fixture(); const { parcel } = await ready(f.a, f.staff); const { verification } = await verified(f.a, f.staff, parcel);
    await expect(f.staff.confirmHandover({ ...confirm(parcel.id, verification.id), physicalHandoverConfirmed: false })).rejects.toMatchObject({ code: 'VALIDATION' });
    const held = await f.staff.setHold({ parcelId: parcel.id, hold: 'REVIEW', expectedRevision: parcel.revision, reason: 'Inspect damaged packaging before collection.' });
    await expect(f.staff.confirmHandover(confirm(parcel.id, verification.id))).rejects.toMatchObject({ code: 'COLLECTION_HOLD' });
    await f.staff.setHold({ parcelId: parcel.id, hold: 'NONE', expectedRevision: held.revision, reason: 'Physical packaging inspection completed safely.' });
    await expect(f.staff.confirmHandover(confirm(parcel.id, verification.id))).rejects.toMatchObject({ code: 'REVISION_CHANGED' });
  });
  it('idempotent concurrent retries retain one receipt; changed key/body conflicts', async () => {
    const f = await fixture(); const { order, parcel } = await ready(f.a, f.staff); const { verification } = await verified(f.a, f.staff, parcel);
    const request = confirm(parcel.id, verification.id);
    const [first, replay] = await Promise.all([f.staff.confirmHandover(request), f.staff.confirmHandover(request)]);
    expect(first.receipt.id).toBe(replay.receipt.id); expect(replay.replayed).toBe(true); expect((await f.staff.listReceipts({})).items).toHaveLength(1);
    await expect(f.staff.confirmHandover({ ...request, physicalHandoverConfirmed: false })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(f.staff.confirmHandover({ ...request, idempotencyKey: 'different-key' })).rejects.toMatchObject({ code: 'ALREADY_COLLECTED' });
    const closed = await f.staff.getParcel({ parcelId: parcel.id }); await expect(f.staff.reconcileParcel({ idempotencyKey: writeKey(), parcelId: parcel.id, orderId: order.id, expectedRevision: closed.revision, identifierReviewed: true, recipientVerified: true, conflictsResolved: true, reason: 'Attempt to reassign a collected parcel' })).rejects.toMatchObject({ code: 'ALREADY_COLLECTED' });
  });
  it('persists history and read state across fresh kernels, without credential secrets', async () => {
    const f = await fixture(); const { parcel } = await ready(f.a, f.staff); const { credential, verification } = await verified(f.a, f.staff, parcel);
    const n = (await f.a.listNotifications({})).items[0]; await f.a.readNotification({ notificationId: n.id });
    const result = await f.staff.confirmHandover(confirm(parcel.id, verification.id));
    const saved = f.storage.data.get(STORAGE_KEY)!; expect(saved).not.toContain(credential.otp); expect(saved).not.toContain(credential.qr.token); expect(saved).not.toContain('demo-session');
    const reboot = createMockKernel(f.storage, f.now); const a = reboot.client(); const staff = reboot.client();
    await a.login({ accountId: 'usr_asha', passcode: DEMO_PASSCODE }); await staff.login({ accountId: 'usr_staff', passcode: DEMO_PASSCODE });
    expect((await a.getParcel({ parcelId: parcel.id })).status).toBe('CLOSED'); expect((await a.listNotifications({})).items.find(item => item.id === n.id)?.readAt).toBeDefined();
    expect((await staff.confirmHandover(confirm(parcel.id, verification.id))).receipt.id).toBe(result.receipt.id);
    expect((await staff.listReceipts({ q: parcel.id })).items).toHaveLength(1);
    await staff.resetDemo({}); await expect(a.listParcels({})).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    const resetClient = createMockKernel(f.storage, f.now).client(); await resetClient.login({ accountId: 'usr_staff', passcode: DEMO_PASSCODE }); expect((await resetClient.listParcels({})).items).toHaveLength(0);
  });
  it('does not restore credential secrets or old issuance retries after restart', async () => {
    const f = await fixture(); const { parcel } = await ready(f.a, f.staff); const c = await f.a.issueCredential(issuance(parcel.id));
    const reboot = createMockKernel(f.storage, f.now); const a = reboot.client(); const staff = reboot.client(); await a.login({ accountId: 'usr_asha', passcode: DEMO_PASSCODE }); await staff.login({ accountId: 'usr_staff', passcode: DEMO_PASSCODE });
    await expect(a.issueCredential(issuance(parcel.id))).rejects.toMatchObject({ code: 'ISSUANCE_RETRY_UNAVAILABLE' });
    await expect(staff.verifyCredential({ parcelId: parcel.id, method: 'QR', qr: c.qr })).rejects.toMatchObject({ code: 'CREDENTIAL_INVALIDATED' });
    expect((await a.issueCredential(issuance(parcel.id, 'restart-new-key', true))).id).not.toBe(c.id);
  });
  it('handles session expiry, logout, network retry, storage errors and pagination', async () => {
    const f = await fixture(); for (let n = 0; n < 3; n++) await f.a.createOrder(orderInput(`ORDER-${n}`));
    const first = await f.a.listOrders({ limit: 2 }); expect(first.items).toHaveLength(2); expect((await f.a.listOrders({ limit: 2, cursor: first.nextCursor })).items).toHaveLength(1);
    await expect(f.a.listOrders({ cursor: 'bad' })).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    f.kernel.setOnline(false); await expect(f.a.listOrders({})).rejects.toMatchObject({ code: 'NETWORK', retryable: true }); f.kernel.setOnline(true); expect((await f.a.listOrders({})).items).toHaveLength(3);
    f.storage.fail = true; await expect(f.a.createOrder(orderInput('UNSAVED'))).rejects.toMatchObject({ code: 'PERSISTENCE' }); f.storage.fail = false; expect((await f.a.listOrders({})).items).toHaveLength(3);
    await f.b.logout({}); await expect(f.b.listOrders({})).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    f.advance(30 * 60_000); await expect(f.a.listOrders({})).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});
