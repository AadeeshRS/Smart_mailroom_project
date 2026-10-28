import { describe, expect, it } from 'vitest';
import { createMockKernel, STORAGE_KEY, type Persistence } from '../src/api/mock';
import { automaticNamespace, checkedIdentifier, sameIdentifier } from '../src/api/identifiers';
import { DEMO_PASSCODE, type Input, type Schema } from '../src/api/service';
import { ConfirmationRecoveryStore, confirmWithRecovery } from '../src/confirmationRecovery';

class Storage implements Persistence {
  values = new Map<string, string>();
  fail = false;
  async getItem(key: string) { return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { if (this.fail) throw new Error('Storage unavailable'); this.values.set(key, value); }
}
let counter = 0;
const key = () => `review-key-${++counter}`;
const order = (id = 'AMZ-REVIEW'): Input<'createOrder'> => ({ idempotencyKey: key(), platform: 'AMAZON', merchantOrderId: id, tracking: [] });
const intake = (id = 'AMZ-REVIEW', physicalReference = key()): Input<'intakeParcel'> => ({ idempotencyKey: key(), identifiers: [{ kind: 'ORDER_ID', namespace: 'AMAZON', value: id }], recipientEmail: 'asha@students.example.invalid', recipientStudentNumber: 'DEMO1001', recipientName: 'Asha', description: 'Review parcel', storageLocation: 'A2', physicalReference, source: 'MANUAL', labelReviewed: true });
const tracking = (value = 'TRACK-001'): Schema<'TrackingReference'> => ({ kind: 'TRACKING', namespace: 'EKART', value });
async function fixture() {
  const storage = new Storage(); let time = Date.parse('2026-10-28T08:00:00.000Z'); const now = () => time;
  const kernel = createMockKernel(storage, now); const a = kernel.client(); const b = kernel.client(); const staff = kernel.client();
  await a.login({ accountId: 'usr_asha', passcode: DEMO_PASSCODE }); await b.login({ accountId: 'usr_neel', passcode: DEMO_PASSCODE }); await staff.login({ accountId: 'usr_staff', passcode: DEMO_PASSCODE });
  return { storage, kernel, a, b, staff, now, advance: (ms: number) => { time += ms; } };
}
async function ready(f: Awaited<ReturnType<typeof fixture>>) {
  const o = await f.a.createOrder(order()); const p = await f.staff.intakeParcel(intake());
  const c = await f.a.issueCredential({ parcelId: p.id, idempotencyKey: key(), replace: false });
  const v = await f.staff.verifyCredential({ parcelId: p.id, method: 'OTP', otp: c.otp });
  return { o, p, c, v };
}
const reconciliation = (p: Schema<'StaffParcel'>, orderId: string): Input<'reconcileParcel'> => ({ parcelId: p.id, orderId, expectedRevision: p.revision, identifierReviewed: true, recipientVerified: true, conflictsResolved: true, reason: 'PRIVATE REVIEW MARKER: physical label and competing reference checked.', idempotencyKey: key() });

describe('review: confirmation recovery', () => {
  it('persists the exact request before sending, recovers a lost committed response after expiry/restart and retains one receipt', async () => {
    const f = await fixture(); const { p, c, v } = await ready(f); const store = new ConfirmationRecoveryStore(f.storage);
    const request = { parcelId: p.id, verificationId: v.id, physicalHandoverConfirmed: true, idempotencyKey: key() };
    f.kernel.loseNextConfirmationResponse();
    await expect(confirmWithRecovery(store, f.staff, 'usr_staff', request)).rejects.toMatchObject({ code: 'NETWORK' });
    expect((await store.get('usr_staff', p.id))?.request).toEqual(request);
    expect((await f.staff.listReceipts({})).items).toHaveLength(1);
    expect(await store.list('usr_other_staff')).toEqual([]);
    const persisted = f.storage.values.get('smart-mailroom-confirmation-recovery-v1:usr_staff')!;
    expect(persisted).not.toContain(c.otp); expect(persisted).not.toContain(c.qr.token); expect(persisted).not.toContain('demo-session');
    f.advance(180_000);
    const restarted = createMockKernel(f.storage, f.now).client(); await restarted.login({ accountId: 'usr_staff', passcode: DEMO_PASSCODE });
    const freshStore = new ConfirmationRecoveryStore(f.storage); const original = (await freshStore.get('usr_staff', p.id))!;
    const result = await confirmWithRecovery(freshStore, restarted, 'usr_staff', original.request);
    expect(result.replayed).toBe(true); expect((await restarted.listReceipts({})).items).toHaveLength(1);
    expect((await freshStore.get('usr_staff', p.id))?.receiptId).toBe(result.receipt.id);
    await expect(restarted.confirmHandover({ ...request, idempotencyKey: key() })).rejects.toMatchObject({ code: 'ALREADY_COLLECTED' });
  });
  it('rejects fresh expired confirmations and preserves uncertain requests without silently changing their keys', async () => {
    const f = await fixture(); const { p, v } = await ready(f); const store = new ConfirmationRecoveryStore(f.storage);
    const request = { parcelId: p.id, verificationId: v.id, physicalHandoverConfirmed: true, idempotencyKey: key() };
    f.kernel.setOnline(false); await expect(confirmWithRecovery(store, f.staff, 'usr_staff', request)).rejects.toMatchObject({ code: 'NETWORK' }); f.kernel.setOnline(true);
    await expect(store.clearRejected('usr_staff', p.id)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(confirmWithRecovery(store, f.staff, 'usr_staff', { ...request, idempotencyKey: key() })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    f.advance(121_000); await expect(confirmWithRecovery(store, f.staff, 'usr_staff', request)).rejects.toMatchObject({ code: 'VERIFICATION_EXPIRED' });
    expect((await f.staff.listReceipts({})).items).toHaveLength(0); expect((await store.get('usr_staff', p.id))?.phase).toBe('REJECTED');
    await store.clearRejected('usr_staff', p.id); expect(await store.get('usr_staff', p.id)).toBeUndefined();
  });
  it('does not send a confirmation when the original recovery request cannot be saved', async () => {
    const f = await fixture(); const { p, v } = await ready(f); f.storage.fail = true;
    await expect(confirmWithRecovery(new ConfirmationRecoveryStore(f.storage), f.staff, 'usr_staff', { parcelId: p.id, verificationId: v.id, physicalHandoverConfirmed: true, idempotencyKey: key() })).rejects.toThrow('Storage unavailable');
    f.storage.fail = false; expect((await f.staff.listReceipts({})).items).toHaveLength(0);
  });
  it('requires an explicit new-key replacement when issuance secrets cannot be replayed', async () => {
    const f = await fixture(); const { p } = await ready(f);
    const restarted = createMockKernel(f.storage, f.now).client(); await restarted.login({ accountId: 'usr_asha', passcode: DEMO_PASSCODE });
    await expect(restarted.issueCredential({ parcelId: p.id, idempotencyKey: key(), replace: false })).rejects.toMatchObject({ code: 'CREDENTIAL_INVALIDATED' });
    const issueKey = key(); const credential = await restarted.issueCredential({ parcelId: p.id, idempotencyKey: issueKey, replace: true });
    expect(await restarted.issueCredential({ parcelId: p.id, idempotencyKey: issueKey, replace: true })).toEqual(credential);
    f.advance(600_001); await expect(restarted.issueCredential({ parcelId: p.id, idempotencyKey: issueKey, replace: true })).rejects.toMatchObject({ code: 'ISSUANCE_RETRY_UNAVAILABLE' });
  });
});
describe('review: physical tracking collisions and approved namespaces', () => {
  it('keeps colliding physical intake unassigned and holds/invalidate the first assignment until each is reviewed', async () => {
    const f = await fixture(); const o = await f.a.createOrder({ ...order(), tracking: [tracking()] });
    const one = await f.staff.intakeParcel({ ...intake(), identifiers: [tracking()] });
    await f.a.issueCredential({ parcelId: one.id, idempotencyKey: key(), replace: false });
    const two = await f.staff.intakeParcel({ ...intake(), identifiers: [tracking('track-001')] });
    expect(two).toMatchObject({ status: 'AWAITING_MATCH', matchOutcome: 'TRACKING_COLLISION', hold: 'REVIEW' }); expect(two.studentId).toBeUndefined();
    const first = await f.staff.getStaffParcel({ parcelId: one.id }); expect(first).toMatchObject({ hold: 'DISPUTE', collectionEligible: false, credentialState: 'INVALIDATED' });
    expect((await f.staff.listParcels({})).items).toHaveLength(2);
    const resolved = await f.staff.reconcileParcel(reconciliation(first, o.id)); expect(resolved.collectionEligible).toBe(true);
    expect((await f.staff.getStaffParcel({ parcelId: two.id })).studentId).toBeUndefined();
    await f.a.createOrder(order('UNRELATED')); expect((await f.a.getParcel({ parcelId: one.id })).hold).toBe('NONE');
    const third = await f.staff.intakeParcel({ ...intake(), identifiers: [tracking()] }); expect(third.matchOutcome).toBe('TRACKING_COLLISION'); expect((await f.a.getParcel({ parcelId: one.id })).hold).toBe('DISPUTE');
  });
  it('preserves historic handovers on later tracking collision and allows merchant-order split shipments', async () => {
    const f = await fixture(); await f.a.createOrder({ ...order(), tracking: [tracking()] }); const p = await f.staff.intakeParcel({ ...intake(), identifiers: [tracking()] });
    const c = await f.a.issueCredential({ parcelId: p.id, idempotencyKey: key(), replace: false }); const v = await f.staff.verifyCredential({ parcelId: p.id, method: 'QR', qr: c.qr });
    const result = await f.staff.confirmHandover({ parcelId: p.id, verificationId: v.id, physicalHandoverConfirmed: true, idempotencyKey: key() });
    const later = await f.staff.intakeParcel({ ...intake(), identifiers: [tracking()] }); expect(later.studentId).toBeUndefined();
    expect((await f.staff.getStaffParcel({ parcelId: p.id })).status).toBe('CLOSED'); expect((await f.staff.getStaffReceipt({ receiptId: result.receipt.id })).id).toBe(result.receipt.id);
    const split1 = await f.staff.intakeParcel(intake()); const split2 = await f.staff.intakeParcel(intake()); expect(split1.collectionEligible).toBe(true); expect(split2.collectionEligible).toBe(true); expect(split1.id).not.toBe(split2.id);
  });
  it('rejects unknown catalog keys and applies explicit platform/carrier-specific normalization', async () => {
    const f = await fixture(); const invalid = { kind: 'TRACKING', namespace: 'FAKE_CARRIER', value: 'TRACK-001' } as unknown as Schema<'Identifier'>;
    await expect(f.staff.intakeParcel({ ...intake(), identifiers: [invalid] })).rejects.toMatchObject({ code: 'UNKNOWN_NAMESPACE' });
    expect(automaticNamespace(invalid)).toBe(false);
    expect(checkedIdentifier({ kind: 'TRACKING', namespace: 'BLUEDART', value: ' 00 123 ' }).value).toBe('00123');
    expect(sameIdentifier({ kind: 'ORDER_ID', namespace: 'AMAZON', value: 'AbC' }, { kind: 'ORDER_ID', namespace: 'AMAZON', value: 'ABC' })).toBe(false);
    expect(sameIdentifier({ kind: 'ORDER_ID', namespace: 'FLIPKART', value: ' od-AbC ' }, { kind: 'ORDER_ID', namespace: 'FLIPKART', value: 'OD-ABC' })).toBe(true);
    expect(() => checkedIdentifier({ kind: 'TRACKING', namespace: 'BLUEDART', value: 'ABC' })).toThrow();
    expect((await f.staff.listParcels({})).items).toHaveLength(0);
  });
});
describe('review: privacy, strict input and contract decisions', () => {
  it('projects legacy persisted review notifications safely on list, search and read', async () => {
    const f = await fixture(); await f.a.createOrder(order()); const p = await f.staff.intakeParcel(intake());
    await f.staff.setHold({ parcelId: p.id, hold: 'REVIEW', reason: 'Private historical review evidence', expectedRevision: p.revision });
    const raw = JSON.parse(f.storage.values.get(STORAGE_KEY)!);
    const notification = raw.notifications.find((n: Schema<'Notification'>) => /review/i.test(n.title));
    notification.message = 'LEGACY_PRIVATE_EVIDENCE'; f.storage.values.set(STORAGE_KEY, JSON.stringify(raw));
    const restored = createMockKernel(f.storage, f.now).client(); await restored.login({ accountId: 'usr_asha', passcode: DEMO_PASSCODE });
    expect(JSON.stringify(await restored.listNotifications({}))).not.toContain('LEGACY_PRIVATE_EVIDENCE');
    expect((await restored.listNotifications({ q: 'LEGACY_PRIVATE_EVIDENCE' })).items).toHaveLength(0);
    expect(JSON.stringify(await restored.readNotification({ notificationId: notification.id }))).not.toContain('LEGACY_PRIVATE_EVIDENCE');
  });
  it('student payloads exclude staff audit actors, label evidence and reconciliation/hold free text', async () => {
    const f = await fixture(); const o = await f.a.createOrder(order()); const label = intake();
    const p = await f.staff.intakeParcel({ ...label, identifiers: [...label.identifiers, tracking('PRIVATE_LABEL_VALUE')] });
    expect((await f.a.listParcels({ q: 'PRIVATE_LABEL_VALUE' })).items).toHaveLength(0);
    expect((await f.staff.listParcels({ q: 'PRIVATE_LABEL_VALUE' })).items).toHaveLength(1);
    const resolved = await f.staff.reconcileParcel(reconciliation(p, o.id)); const held = await f.staff.setHold({ parcelId: p.id, hold: 'REVIEW', reason: 'PRIVATE REVIEW MARKER: do not expose this reason', expectedRevision: resolved.revision });
    const payloads = [await f.a.getParcel({ parcelId: p.id }), await f.a.listParcels({}), await f.a.listNotifications({})];
    expect(JSON.stringify(payloads)).not.toContain('PRIVATE REVIEW MARKER'); expect(JSON.stringify(payloads)).not.toContain('usr_staff');
    for (const forbidden of ['audit', 'identifiers', 'recipientEmail', 'recipientStudentNumber', 'recipientName', 'source']) expect(payloads[0]).not.toHaveProperty(forbidden);
    await expect(f.a.getStaffParcel({ parcelId: p.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    try { await f.a.issueCredential({ parcelId: p.id, idempotencyKey: key(), replace: true }); } catch (error) { expect(JSON.stringify(error)).not.toContain('PRIVATE REVIEW MARKER'); }
    const cleared = await f.staff.setHold({ parcelId: p.id, hold: 'NONE', reason: 'PRIVATE REVIEW MARKER: inspection complete', expectedRevision: held.revision });
    expect(cleared.audit.some(e => e.actorId === 'usr_staff' && e.reason.includes('PRIVATE REVIEW MARKER'))).toBe(true);
    const c = await f.a.issueCredential({ parcelId: p.id, replace: true, idempotencyKey: key() }); const v = await f.staff.verifyCredential({ parcelId: p.id, method: 'OTP', otp: c.otp });
    const confirmed = await f.staff.confirmHandover({ parcelId: p.id, verificationId: v.id, physicalHandoverConfirmed: true, idempotencyKey: key() });
    const receipts = [await f.a.getReceipt({ receiptId: confirmed.receipt.id }), await f.a.listReceipts({})]; expect(JSON.stringify(receipts)).not.toContain('usr_staff'); expect(receipts[0]).not.toHaveProperty('verificationId'); expect(receipts[0]).not.toHaveProperty('staffId');
    await expect(f.a.getStaffReceipt({ receiptId: confirmed.receipt.id })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('rejects missing/mixed credential presentations and oversize inputs at the service boundary', async () => {
    const f = await fixture(); const { p, c } = await ready(f);
    for (const input of [{ method: 'OTP' }, { method: 'QR' }, { method: 'OTP', otp: c.otp, qr: c.qr }, { method: 'QR', otp: c.otp, qr: c.qr }]) await expect(f.staff.verifyCredential({ parcelId: p.id, ...input } as Input<'verifyCredential'>)).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(f.a.createOrder({ ...order('TOO-LONG'), tracking: Array.from({ length: 21 }, () => tracking()) })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(f.staff.intakeParcel({ ...intake(), recipientEmail: 'a'.repeat(255) })).rejects.toMatchObject({ code: 'VALIDATION' });
    await expect(f.staff.intakeParcel({ ...intake(), identifiers: Array.from({ length: 21 }, () => tracking()) })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect((await f.staff.listReceipts({})).items).toHaveLength(0);
  });
  it('replays ordinary writes for 24 hours before current-revision checks without duplicate side effects', async () => {
    const f = await fixture(); const input = order(); const o = await f.a.createOrder(input); expect(await f.a.createOrder(input)).toEqual(o);
    await expect(f.a.createOrder({ ...input, merchantOrderId: 'CHANGED' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    const received = intake(); const p = await f.staff.intakeParcel(received); expect(await f.staff.intakeParcel({ ...received })).toEqual(p); expect((await f.staff.listParcels({})).items).toHaveLength(1);
    const decision = reconciliation(p, o.id); const resolved = await f.staff.reconcileParcel(decision); expect(await f.staff.reconcileParcel({ ...decision })).toEqual(resolved);
    expect((await f.a.listNotifications({})).items).toHaveLength(1);
    f.advance(86_400_001); await f.a.login({ accountId: 'usr_asha', passcode: DEMO_PASSCODE }); await f.staff.login({ accountId: 'usr_staff', passcode: DEMO_PASSCODE });
    await expect(f.a.createOrder(input)).rejects.toMatchObject({ code: 'DUPLICATE_ORDER' }); await expect(f.staff.reconcileParcel(decision)).rejects.toMatchObject({ code: 'REVISION_CHANGED' });
  });
  it('snapshot pagination excludes inserts, rejects changed filter/account/expired cursors and bounds searchable candidates', async () => {
    const f = await fixture(); for (let n = 0; n < 4; n++) await f.a.createOrder(order('ORDER-' + n));
    const first = await f.a.listOrders({ limit: 2 }); expect(first.nextCursor).toBeDefined(); await f.a.createOrder(order('NEW-INSERT'));
    const second = await f.a.listOrders({ limit: 2, cursor: first.nextCursor }); expect(second.items).toHaveLength(2); expect(second.items.some(o => o.merchantOrderId === 'NEW-INSERT')).toBe(false);
    expect(new Set([...first.items, ...second.items].map(o => o.id)).size).toBe(4);
    await expect(f.b.listOrders({ limit: 2, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    await expect(f.a.listOrders({ limit: 2, cursor: first.nextCursor, q: 'ORDER' })).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    const p = await f.staff.intakeParcel(intake('UNMATCHED')); const candidates = await f.staff.getReview({ parcelId: p.id, limit: 2 }); expect(candidates.candidates).toHaveLength(2); expect(candidates.nextCursor).toBeDefined();
    expect((await f.staff.getReview({ parcelId: p.id, q: 'NEW-INSERT' })).candidates).toHaveLength(1); await expect(f.staff.getReview({ parcelId: p.id, limit: 51 })).rejects.toMatchObject({ code: 'VALIDATION' });
    f.advance(900_001); await expect(f.a.listOrders({ limit: 2, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
  });
  it('demo endpoints can be disabled and historical records survive restart with the new state fields', async () => {
    const f = await fixture(); await f.a.createOrder(order()); const disabled = createMockKernel(f.storage, f.now, { demoEnabled: false }).client(); await expect(disabled.login({ accountId: 'usr_staff', passcode: DEMO_PASSCODE })).rejects.toMatchObject({ code: 'DEMO_DISABLED' });
    const raw = JSON.parse(f.storage.values.get(STORAGE_KEY)!); delete raw.writes; delete raw.resolvedClaims; f.storage.values.set(STORAGE_KEY, JSON.stringify(raw));
    const restored = createMockKernel(f.storage, f.now).client(); await restored.login({ accountId: 'usr_asha', passcode: DEMO_PASSCODE }); expect((await restored.listOrders({})).items).toHaveLength(1);
    const options = { demoEnabled: true }; const toggled = createMockKernel(f.storage, f.now, options).client(); await toggled.login({ accountId: 'usr_staff', passcode: DEMO_PASSCODE }); options.demoEnabled = false;
    await expect(toggled.resetDemo({})).rejects.toMatchObject({ code: 'DEMO_DISABLED' });
  });
});
