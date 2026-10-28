import { automaticNamespace, checkedIdentifier, sameIdentifier } from './identifiers';
import { DEMO_PASSCODE, ServiceError, type Input, type MailroomService, type Schema } from './service';

type Order = Schema<'ExpectedOrder'>;
type Parcel = Schema<'StaffParcel'>;
type Profile = Schema<'Profile'>;
type Credential = Schema<'Credential'>;
type Verification = Schema<'Verification'>;
type Receipt = Schema<'StaffReceipt'>;
type Identifier = Schema<'Identifier'>;
type ConfirmationRecord = { actor: string; key: string; fingerprint: string; receipt: Receipt };
type IssueRecord = { actor: string; key: string; fingerprint: string; credentialId: string; expiresAt: number };
type WriteRecord = { actor: string; operation: string; key: string; fingerprint: string; expiresAt: number; result: unknown };
type State = {
  version: 1; sequence: number; orders: Order[]; parcels: Parcel[];
  notifications: Schema<'Notification'>[]; receipts: Receipt[];
  confirmations: ConfirmationRecord[]; issues: IssueRecord[]; resolvedClaims: Record<string, string>; observedClaims: Record<string, string>; writes: WriteRecord[];
};
export interface Persistence { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }
export const STORAGE_KEY = 'smart-mailroom-demo-v1';
const profiles: Profile[] = [
  { id: 'usr_asha', name: 'Asha Rao', email: 'asha@students.example.invalid', studentNumber: 'DEMO1001', role: 'STUDENT' },
  { id: 'usr_neel', name: 'Neel Shah', email: 'neel@students.example.invalid', studentNumber: 'DEMO1002', role: 'STUDENT' },
  { id: 'usr_staff', name: 'Mira Sen', email: 'mira@staff.example.invalid', role: 'STAFF' },
];
const fresh = (): State => ({ version: 1, sequence: 0, orders: [], parcels: [], notifications: [], receipts: [], confirmations: [], issues: [], resolvedClaims: {}, observedClaims: {}, writes: [] });
const normalize = (s: string) => s.trim().toUpperCase();
const same = sameIdentifier;
const references = (o: Order): Identifier[] => [{ kind: 'ORDER_ID', namespace: o.platform, value: o.merchantOrderId }, ...o.tracking];
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function fail(code: Schema<'ErrorCode'>, message: string): never { throw new ServiceError(code, message); }
const requiredText = (text: string, name: string, max = 100) => {
  if (typeof text !== 'string' || !text.trim() || text.trim().length > max) fail('VALIDATION', `${name} is required (maximum ${max} characters).`);
  return text.trim();
};
const reasonText = (text: string) => {
  const value = requiredText(text, 'Review reason', 500);
  if (value.length < 12) fail('VALIDATION', 'Explain the evidence and decision in at least 12 characters.');
  return value;
};

/** Deterministic demonstration state machine. Serialized operations model outcomes only;
 * this is not server authorization, cryptography, or a database transaction implementation.
 * Credential secrets and verification references are deliberately volatile.
 */
export function createMockKernel(storage: Persistence, now: () => number = Date.now, options: { demoEnabled?: boolean } = {}) {
  let state = fresh();
  let loaded = false;
  let online = true;
  let loseConfirmationResponse = false;
  const snapshots = new Map<string, { ids: string[]; offset: number; scope: string; expiresAt: number }>();
  let queue: Promise<unknown> = Promise.resolve();
  const sessions = new Map<string, Schema<'Session'>>();
  const credentials = new Map<string, Credential & { attempts: number }>();
  const verifications = new Map<string, Verification & { staffSession: string }>();
  const issueSessions = new Map<string, string>();
  const iso = (time = now()) => new Date(time).toISOString();
  const next = (prefix: string) => `${prefix}_${++state.sequence}`;
  const profile = (id: string) => profiles.find(p => p.id === id) ?? fail('NOT_FOUND', 'Demo profile not found.');
  const eligible = (p: Parcel) => p.status === 'AWAITING_COLLECTION' && p.hold === 'NONE' && !!p.studentId && !!p.orderId;
  const audit = (p: Parcel, actor: string, action: string, reason: string) => p.audit.push({ at: iso(), actorId: actor, action, reason });
  const revoke = (p: Parcel) => {
    credentials.delete(p.id);
    if (p.credentialState === 'ACTIVE' || p.credentialState === 'EXPIRED') p.credentialState = 'INVALIDATED';
    // Retain volatile verification references to return meaningful revision/credential errors.
  };
  const hydrate = async () => {
    if (loaded) return;
    const value = await storage.getItem(STORAGE_KEY);
    if (value) {
      try {
        const parsed = JSON.parse(value) as State;
        if (parsed.version !== 1 || !Array.isArray(parsed.orders) || !Array.isArray(parsed.parcels) || !Array.isArray(parsed.receipts) || !Array.isArray(parsed.notifications) || !Array.isArray(parsed.confirmations) || !Array.isArray(parsed.issues)) throw new Error('Unsupported demo data');
        state = { ...parsed, resolvedClaims: parsed.resolvedClaims ?? {}, observedClaims: parsed.observedClaims ?? {}, writes: parsed.writes ?? [] };
        for (const p of state.parcels) if (p.credentialState === 'ACTIVE') p.credentialState = 'INVALIDATED';
      } catch { throw new ServiceError('PERSISTENCE', 'Saved demo data cannot be read. Clear this app’s local storage to reset.', false); }
    }
    loaded = true;
  };
  function run<T>(fn: () => T): Promise<T> {
    const work = queue.then(async () => {
      if (!online) throw new ServiceError('NETWORK', 'Simulated connection unavailable. Turn off simulated offline mode and retry.', true);
      try { await hydrate(); } catch (error) {
        if (error instanceof ServiceError) throw error;
        throw new ServiceError('PERSISTENCE', 'Local demo storage is unavailable. Retry when storage is available.', true);
      }
      const before = clone(state);
      // Failed OTP attempts intentionally mutate state even when the operation rejects.
      let result: T | undefined; let operationError: unknown;
      try { result = fn(); } catch (error) { operationError = error; }
      try { await storage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch {
        state = before;
        // Fail closed when a write is uncertain; no outstanding secret can authorize a handover.
        credentials.clear(); verifications.clear();
        for (const p of state.parcels) if (p.credentialState === 'ACTIVE') p.credentialState = 'INVALIDATED';
        throw new ServiceError('PERSISTENCE', 'Could not save the demo change. Retry; collection secrets have been cleared.', true);
      }
      if (operationError) throw operationError;
      return clone(result as T);
    });
    queue = work.catch(() => undefined);
    return work;
  }
  const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
  function write<T>(actor: string, operation: string, request: { idempotencyKey: string }, action: () => T): T {
    const key = requiredText(request.idempotencyKey, 'Idempotency key');
    if (key.length < 8) fail('VALIDATION', 'Idempotency key must have at least 8 characters.');
    const { idempotencyKey: _key, ...body } = request;
    const fingerprint = canonical(body);
    state.writes = state.writes.filter(record => record.expiresAt > now());
    const previous = state.writes.find(record => record.actor === actor && record.operation === operation && record.key === key);
    if (previous) {
      if (previous.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'This retry key belongs to different request details.');
      return clone(previous.result) as T;
    }
    const result = action();
    state.writes.push({ actor, operation, key, fingerprint, expiresAt: now() + 86_400_000, result: clone(result) });
    return result;
  }
  const candidate = (p: Parcel, order: Order): Schema<'Candidate'> => {
    const student = profile(order.studentId);
    const refs = references(order);
    const comparable = p.identifiers.some(i => refs.some(r => same(i, r)));
    const conflicts: string[] = [];
    if (p.recipientEmail.trim() && normalize(p.recipientEmail) !== normalize(student.email)) conflicts.push('Label email differs from provisioned student profile.');
    if (p.recipientStudentNumber.trim() && normalize(p.recipientStudentNumber) !== normalize(student.studentNumber ?? '')) conflicts.push('Label student number differs from provisioned profile.');
    for (const id of p.identifiers) {
      if (id.kind === 'ORDER_ID' && !refs.some(r => same(id, r))) conflicts.push('Supplied merchant identifier contradicts this order.');
      const inNamespace = refs.filter(r => r.kind === id.kind && normalize(r.namespace) === normalize(id.namespace));
      if (id.kind === 'TRACKING' && inNamespace.length && !inNamespace.some(r => same(id, r))) conflicts.push('Supplied tracking identifier contradicts registered references.');
    }
    const corroborated = !!(p.recipientEmail.trim() && normalize(p.recipientEmail) === normalize(student.email)) || !!(p.recipientStudentNumber.trim() && normalize(p.recipientStudentNumber) === normalize(student.studentNumber ?? ''));
    return { order, student, comparable, corroborated, conflicts };
  };
  const notify = (p: Parcel, title: string, message: string, studentId = p.studentId) => {
    if (studentId) state.notifications.unshift({ id: next('ntf'), studentId, parcelId: p.id, title, message: /review|paused/i.test(title) ? 'Mailroom review updated this parcel. Contact staff for assistance; internal evidence remains private.' : message, createdAt: iso(), inAppAvailable: true, simulatedExternal: true, externalDelivery: 'ACCEPTED' });
  };
  // Apply the privacy boundary on reads too: older persisted demo notifications
  // may predate the restriction on exposing internal review reasons.
  const publicNotification = (n: Schema<'Notification'>): Schema<'Notification'> => ({ ...n, message: /review|paused/i.test(n.title) ? 'Mailroom review updated this parcel. Contact staff for assistance; internal evidence remains private.' : n.message });
  const updateOrders = () => {
    const active = state.orders.filter(o => o.status !== 'CANCELLED');
    for (const o of state.orders) {
      o.parcelIds = state.parcels.filter(p => p.orderId === o.id).map(p => p.id);
      if (o.status !== 'CANCELLED') o.status = o.parcelIds.length ? 'MATCHED' : 'PENDING';
      o.duplicateClaim = active.some(other => other.id !== o.id && references(o).some(a => references(other).some(b => same(a, b))));
    }
  };
  const link = (p: Parcel, o: Order, actor: string, reason: string) => {
    const previousStudent = p.studentId;
    revoke(p);
    p.orderId = o.id; p.studentId = o.studentId; p.status = 'AWAITING_COLLECTION';
    p.matchOutcome = 'MATCHED'; p.matchExplanation = reason; p.hold = 'NONE'; p.holdReason = ''; p.revision++;
    audit(p, actor, 'MATCHED', reason);
    if (previousStudent && previousStudent !== o.studentId) notify(p, 'Parcel assignment reviewed', 'Staff resolved a dispute and updated this parcel’s assignment. Contact the mailroom with questions.', previousStudent);
    if (previousStudent !== o.studentId) notify(p, 'Your parcel has arrived', `${p.description} is stored at ${p.storageLocation}. Request a collection code when ready.`);
    updateOrders();
  };
  const collisionPeers = (p: Parcel) => state.parcels.filter(other => other.id !== p.id && p.identifiers.some(a => a.kind === 'TRACKING' && other.identifiers.some(b => b.kind === 'TRACKING' && same(a, b))));
  const claimsFingerprint = (p: Parcel) => {
    const linked = state.orders.find(o => o.id === p.orderId);
    const related = [...p.identifiers, ...(linked ? references(linked) : [])];
    return JSON.stringify([collisionPeers(p).map(other => ({ id: other.id, identifiers: other.identifiers })).sort((a, b) => a.id.localeCompare(b.id)), state.orders.filter(o => o.status !== 'CANCELLED' && (o.id === p.orderId || references(o).some(a => related.some(b => same(a, b))))).map(o => ({ id: o.id, tracking: o.tracking, merchantOrderId: o.merchantOrderId, duplicateClaim: o.duplicateClaim }))]);
  };
  const evaluate = (p: Parcel, actor: string) => {
    if (p.status === 'CLOSED') return;
    const evidenceFingerprint = claimsFingerprint(p);
    if (p.orderId && state.resolvedClaims[p.id] === evidenceFingerprint) return;
    if (p.orderId && p.hold === 'DISPUTE' && state.observedClaims[p.id] === evidenceFingerprint) return;
    const candidates = state.orders.filter(o => o.status !== 'CANCELLED').map(o => candidate(p, o)).filter(c => c.comparable);
    let outcome: Schema<'MatchOutcome'>; let explanation: string;
    const c = candidates[0];
    if (collisionPeers(p).length) { outcome = 'TRACKING_COLLISION'; explanation = 'A normalized carrier/tracking reference appears on multiple physical parcels. Document a resolution for each affected parcel.'; }
    else if (candidates.length > 1 || candidates.some(c => c.order.duplicateClaim)) { outcome = 'AMBIGUOUS'; explanation = 'Overlapping claims require staff evidence review. No first-claim allocation.'; }
    else if (!c) { outcome = 'NO_MATCH'; explanation = 'No registered reference matches the same identifier type and namespace.'; }
    else if (c.conflicts.length) { outcome = 'CONFLICT'; explanation = c.conflicts.join(' '); }
    else if (p.orderId && p.orderId !== c.order.id) { outcome = 'CONFLICT'; explanation = 'A new matching request contradicts the reviewed assignment. Staff must resolve ownership before collection.'; }
    else if (!c.corroborated || c.order.platform === 'OTHER' || !p.identifiers.some(id => automaticNamespace(id) && references(c.order).some(r => same(id, r)))) { outcome = 'INSUFFICIENT_EVIDENCE'; explanation = 'Independent profile corroboration or a comparable identifier in a known platform/carrier namespace is missing. OTHER requires staff review.'; }
    else {
      // A staff-imposed hold cannot be silently removed by a later order registration.
      if (!p.orderId) link(p, c.order, actor, 'Unique comparable identifier with independent profile corroboration and no contradictory evidence.');
      return;
    }
    p.matchOutcome = outcome; p.matchExplanation = explanation;
    if (p.orderId) {
      state.observedClaims[p.id] = evidenceFingerprint;
      revoke(p); p.hold = 'DISPUTE'; p.holdReason = explanation; p.revision++;
      audit(p, actor, 'DISPUTE_HOLD', explanation);
      notify(p, 'Collection paused for review', explanation);
    } else { p.status = 'AWAITING_MATCH'; if (outcome === 'TRACKING_COLLISION') { p.hold = 'REVIEW'; p.holdReason = explanation; } }
  };
  const recheck = (actor: string) => { updateOrders(); for (const p of state.parcels) evaluate(p, actor); updateOrders(); };
  const presented = (p: Parcel): Parcel => {
    const c = credentials.get(p.id);
    if (c && now() >= Date.parse(c.expiresAt) && p.credentialState === 'ACTIVE') p.credentialState = 'EXPIRED';
    return { ...p, collectionEligible: eligible(p) };
  };
  const publicParcel = (record: Parcel): Schema<'Parcel'> => {
    const p = presented(record);
    return { id: p.id, description: p.description, storageLocation: p.storageLocation, physicalReference: p.physicalReference,
      status: p.status, receivedAt: p.receivedAt, ...(p.orderId ? { orderId: p.orderId } : {}), ...(p.studentId ? { studentId: p.studentId } : {}),
      revision: p.revision, matchOutcome: p.matchOutcome, matchExplanation: p.status === 'CLOSED' ? 'Collected; retained receipt available.' : p.hold !== 'NONE' ? 'Mailroom review is required before collection.' : p.collectionEligible ? 'Matched parcel is ready for collection.' : 'Awaiting mailroom matching review.',
      hold: p.hold, holdReason: p.hold === 'NONE' ? '' : 'Collection is paused pending mailroom review.', collectionEligible: p.collectionEligible,
      credentialState: p.credentialState, ...(p.receiptId ? { receiptId: p.receiptId } : {}) };
  };
  const publicReceipt = (r: Receipt): Schema<'Receipt'> => ({ id: r.id, parcelId: r.parcelId, orderId: r.orderId, studentId: r.studentId, confirmedAt: r.confirmedAt, storageLocation: r.storageLocation });
  const timestamp = (item: { createdAt?: string; receivedAt?: string; confirmedAt?: string }) => item.createdAt ?? item.receivedAt ?? item.confirmedAt ?? '';
  const page = <T extends { id: string; createdAt?: string; receivedAt?: string; confirmedAt?: string },>(items: T[], query: { cursor?: string; limit?: number; q?: string; status?: string; hold?: string }, scope: string, search: (x: T) => boolean = () => true, preserveOrder = false) => {
    for (const [key, snapshot] of snapshots) if (snapshot.expiresAt <= now()) snapshots.delete(key);
    const limit = query.limit ?? 20;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || (query.q?.length ?? 0) > 100) fail('VALIDATION', 'Invalid page size or search length.');
    const binding = scope + canonical({ limit, q: query.q ?? '', status: query.status ?? '', hold: query.hold ?? '' });
    let snapshot;
    if (query.cursor !== undefined) {
      snapshot = snapshots.get(query.cursor);
      if (!snapshot || snapshot.scope !== binding || snapshot.expiresAt <= now()) fail('CURSOR_INVALID', 'Cursor expired or belongs to another account/query. Load the first page.');
    } else {
      const values = items.filter(search);
      if (!preserveOrder) values.sort((a, b) => timestamp(b).localeCompare(timestamp(a)) || b.id.localeCompare(a.id));
      snapshot = { ids: values.map(item => item.id), offset: 0, scope: binding, expiresAt: now() + 900_000 };
    }
    const current = new Map(items.map(item => [item.id, item]));
    const result: T[] = []; let offset = snapshot.offset;
    while (offset < snapshot.ids.length && result.length < limit) { const item = current.get(snapshot.ids[offset++]); if (item) result.push(item); }
    if (offset < snapshot.ids.length) { const cursor = next('cursor'); snapshots.set(cursor, { ...snapshot, offset }); return { items: result, nextCursor: cursor }; }
    return { items: result };
  };
  const validIdentifier = checkedIdentifier;
  const arrayBound = (input: unknown, label: string) => { if (!Array.isArray(input) || input.length > 20) fail('VALIDATION', label + ' must be an array of at most 20 references.'); };
  const recipient = (value: string, label: string, maximum: number) => { if (typeof value !== 'string' || value.length > maximum) fail('VALIDATION', label + ' exceeds its field limit.'); return value.trim(); };

  function client(): MailroomService {
    let token = '';
    const session = (role?: Profile['role']) => {
      const s = sessions.get(token) ?? fail('UNAUTHENTICATED', 'Sign in to a demonstration account.');
      if (now() >= Date.parse(s.expiresAt)) { sessions.delete(token); fail('SESSION_EXPIRED', 'Your demonstration session expired. Sign in again.'); }
      if (role && s.profile.role !== role) fail('FORBIDDEN', 'This action is restricted to the other demonstration role.');
      return s;
    };
    const ownedParcel = (id: string) => {
      const s = session(); const p = state.parcels.find(p => p.id === id);
      if (!p || (s.profile.role === 'STUDENT' && p.studentId !== s.profile.id)) return fail('NOT_FOUND', 'Parcel not found.');
      return p;
    };
    const ownedOrder = (id: string) => {
      const s = session('STUDENT');
      return state.orders.find(o => o.id === id && o.studentId === s.profile.id) ?? fail('NOT_FOUND', 'Expected order not found.');
    };
    const collection = (p: Parcel) => {
      if (p.status === 'CLOSED') fail('ALREADY_COLLECTED', 'This parcel has already been collected. View its retained receipt.');
      if (p.hold !== 'NONE') fail('COLLECTION_HOLD', 'Collection is paused pending mailroom review.');
      if (!eligible(p)) fail('NOT_ELIGIBLE', 'Parcel must be assigned and awaiting collection.');
    };
    const current = (p: Parcel) => {
      const c = credentials.get(p.id);
      if (p.credentialState === 'INVALIDATED') fail('CREDENTIAL_INVALIDATED', 'This credential is no longer valid. Request a replacement.');
      if (p.credentialState === 'EXPIRED') fail('CREDENTIAL_EXPIRED', 'Collection credential expired. Request a new one.');
      if (!c || p.credentialState !== 'ACTIVE') fail('INVALID_CREDENTIAL', 'No current collection credential. Ask the student to request a new one.');
      if (now() >= Date.parse(c.expiresAt)) { p.credentialState = 'EXPIRED'; fail('CREDENTIAL_EXPIRED', 'Collection credential expired. Request a new one.'); }
      return c;
    };
    const checkRevision = (p: Parcel, revision: number) => { if (p.revision !== revision) fail('REVISION_CHANGED', 'Parcel changed. Reload the latest details and review again.'); };
    const api: MailroomService = {
      login: input => run(() => {
        if (options.demoEnabled === false) fail('DEMO_DISABLED', 'Demo authentication is unavailable in this environment.');
        const p = profiles.find(p => p.id === input.accountId);
        if (!p || input.passcode !== DEMO_PASSCODE) fail('UNAUTHENTICATED', 'Invalid demonstration account or passcode.');
        if (token) sessions.delete(token);
        const s = { token: next('demo-session'), profile: p, expiresAt: iso(now() + 30 * 60_000) };
        token = s.token; sessions.set(token, s); return s;
      }),
      getSession: () => run(() => session()),
      logout: () => run(() => { session(); sessions.delete(token); token = ''; return { ok: true }; }),
      getGuide: input => run(() => {
        const steps: Record<Schema<'Platform'>, string[]> = {
          AMAZON: ['Open Amazon and go to Your Orders.', 'Choose the order, then view Order details or the invoice.', 'Copy the merchant Order #. Keep carrier tracking separate.'],
          FLIPKART: ['Open Flipkart and go to My Orders.', 'Select the purchase and open Order details.', 'Copy the Order ID (often starts with OD), not the shipment tracking ID.'],
          MYNTRA: ['Open Myntra and go to Profile, then Orders.', 'Choose the purchase and open its details or invoice.', 'Copy the Order ID. One order may arrive in several parcels.'],
          OTHER: ['Open the merchant’s purchase history or confirmation email.', 'Find the merchant order reference on the order details or invoice.', 'Enter carrier tracking separately. Other-platform matches require staff review.'],
        };
        if (!steps[input.platform]) fail('VALIDATION', 'Choose a supported shopping platform.');
        return { platform: input.platform, title: `Find your ${input.platform.toLowerCase()} order ID`, steps: steps[input.platform], caution: 'Guidance is illustrative; merchant menus may change. No shopping account is connected. An order ID does not verify ownership.' };
      }),
      listOrders: query => run(() => { const s = session('STUDENT'); return page(state.orders.filter(o => o.studentId === s.profile.id), query, 'orders:' + s.profile.id, o => (!query.status || o.status === query.status) && (!query.q || normalize(`${o.merchantOrderId} ${o.tracking.map(r => r.value).join(' ')}`).includes(normalize(query.q)))); }),
      createOrder: input => run(() => {
        const s = session('STUDENT');
        return write(s.profile.id, 'createOrder', input, () => {
        arrayBound(input.tracking, 'Tracking');
        if (!['AMAZON', 'FLIPKART', 'MYNTRA', 'OTHER'].includes(input.platform)) fail('VALIDATION', 'Choose a shopping platform.');
        const merchantOrderId = checkedIdentifier({ kind: 'ORDER_ID', namespace: input.platform, value: requiredText(input.merchantOrderId, 'Merchant order ID') }).value;
        if (state.orders.some(o => o.studentId === s.profile.id && o.status !== 'CANCELLED' && o.platform === input.platform && o.merchantOrderId === merchantOrderId)) fail('DUPLICATE_ORDER', 'You already registered this active order. Add tracking to the existing request.');
        const tracking = input.tracking.map(r => validIdentifier(r, true) as Schema<'TrackingReference'>);
        const order: Order = { id: next('ord'), studentId: s.profile.id, platform: input.platform, merchantOrderId, tracking, status: 'PENDING', createdAt: iso(), parcelIds: [], duplicateClaim: false };
        state.orders.unshift(order); recheck(s.profile.id); return order;
        });
      }),
      getOrder: input => run(() => ownedOrder(input.orderId)),
      addTracking: input => run(() => {
        const o = ownedOrder(input.orderId);
        if (o.tracking.length >= 20 && !o.tracking.some(r => same(r, input.reference))) fail('VALIDATION', 'At most 20 tracking references are allowed.');
        if (o.status === 'CANCELLED') fail('CANCELLATION_INELIGIBLE', 'Cancelled orders cannot be edited.');
        const reference = validIdentifier(input.reference, true) as Schema<'TrackingReference'>;
        if (!o.tracking.some(r => same(r, reference))) o.tracking.push(reference);
        recheck(session().profile.id); return o;
      }),
      cancelOrder: input => run(() => {
        const o = ownedOrder(input.orderId);
        if (o.status === 'CANCELLED') return o;
        if (o.status !== 'PENDING' || o.parcelIds.length) fail('CANCELLATION_INELIGIBLE', 'Only pending orders without linked parcels can be cancelled.');
        o.status = 'CANCELLED'; updateOrders(); return o;
      }),
      listParcels: query => run(() => {
        const s = session();
        return page(state.parcels.filter(p => s.profile.role === 'STAFF' || p.studentId === s.profile.id).map(publicParcel), query, 'parcels:' + s.profile.id,
          p => (!query.status || p.status === query.status) && (!query.hold || p.hold === query.hold) && (!query.q || normalize(`${p.id} ${p.description} ${p.storageLocation} ${p.physicalReference} ${s.profile.role === 'STAFF' ? state.parcels.find(record => record.id === p.id)?.identifiers.map(i => i.value).join(' ') ?? '' : ''}`).includes(normalize(query.q))));
      }),
      intakeParcel: input => run(() => {
        const s = session('STAFF');
        return write(s.profile.id, 'intakeParcel', input, () => {
        arrayBound(input.identifiers, 'Label identifiers');
        if (!input.labelReviewed) fail('VALIDATION', 'Review and classify label values before saving intake.');
        const physicalReference = requiredText(input.physicalReference, 'Physical parcel reference', 80);
        if (state.parcels.some(p => normalize(p.physicalReference) === normalize(physicalReference))) fail('DUPLICATE_INTAKE', 'That physical parcel reference already exists. Review the retained intake record; split shipments need distinct physical references.');
        if (!['MANUAL', 'CAMERA'].includes(input.source)) fail('VALIDATION', 'Invalid intake source.');
        const p: Parcel = { id: next('par'), identifiers: input.identifiers.map(i => validIdentifier(i)), description: requiredText(input.description, 'Parcel description', 160), storageLocation: requiredText(input.storageLocation, 'Storage location', 80), physicalReference, recipientEmail: recipient(input.recipientEmail, 'Recipient email', 254), recipientStudentNumber: recipient(input.recipientStudentNumber, 'Student number', 40), recipientName: recipient(input.recipientName, 'Recipient name', 120), source: input.source, status: 'RECEIVED', receivedAt: iso(), revision: 1, matchOutcome: 'NO_MATCH', matchExplanation: '', hold: 'NONE', holdReason: '', collectionEligible: false, credentialState: 'NONE', audit: [] };
        audit(p, s.profile.id, 'RECEIVED', `Physical intake saved at ${p.storageLocation}; label fields reviewed.`);
        state.parcels.unshift(p); recheck(s.profile.id); return presented(p);
        });
      }),
      getParcel: input => run(() => publicParcel(ownedParcel(input.parcelId))),
      getStaffParcel: input => run(() => { session('STAFF'); return presented(ownedParcel(input.parcelId)); }),
      getReview: input => run(() => {
        const s = session('STAFF'); const p = ownedParcel(input.parcelId);
        if ((input.limit ?? 20) > 50) fail('VALIDATION', 'Candidate pages contain at most 50 requests.');
        const candidates = state.orders.filter(o => o.status !== 'CANCELLED').sort((a, b) => Number(candidate(p, b).comparable) - Number(candidate(p, a).comparable) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
        const result = page(candidates, input, 'review:' + s.profile.id + ':' + p.id, o => { const student = profile(o.studentId); return !input.q || normalize(`${o.merchantOrderId} ${o.tracking.map(r => r.value).join(' ')} ${student.name} ${student.email} ${student.studentNumber ?? ''}`).includes(normalize(input.q)); }, true);
        return { parcel: presented(p), candidates: result.items.map(o => candidate(p, o)), ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
      }),
      reconcileParcel: input => run(() => {
        const s = session('STAFF');
        return write(s.profile.id, 'reconcileParcel', input, () => {
        const p = ownedParcel(input.parcelId); checkRevision(p, input.expectedRevision);
        if (p.status === 'CLOSED') fail('ALREADY_COLLECTED', 'Collected parcels cannot be reassigned. Retain the receipt and investigate separately.');
        if (!input.identifierReviewed || !input.recipientVerified || !input.conflictsResolved) fail('VALIDATION', 'Complete every evidence check before resolving this parcel.');
        const reason = reasonText(input.reason);
        const o = state.orders.find(o => o.id === input.orderId && o.status !== 'CANCELLED') ?? fail('NOT_FOUND', 'Active expected order not found.');
        link(p, o, s.profile.id, `Staff reconciliation: ${reason}`);
        state.resolvedClaims[p.id] = claimsFingerprint(p);
        audit(p, s.profile.id, 'EVIDENCE_REVIEWED', `Identifier reviewed; recipient verified; competing claims resolved. ${reason}`);
        return presented(p);
        });
      }),
      setHold: input => run(() => {
        const s = session('STAFF'); const p = ownedParcel(input.parcelId); checkRevision(p, input.expectedRevision);
        if (!['NONE', 'REVIEW', 'DISPUTE'].includes(input.hold)) fail('VALIDATION', 'Invalid hold.');
        if (p.status === 'CLOSED') fail('ALREADY_COLLECTED', 'Closed records are retained; collection state cannot be changed.');
        if (p.hold === 'DISPUTE' && input.hold !== 'DISPUTE') fail('COLLECTION_HOLD', 'Resolve disputed ownership through evidence-led reconciliation.');
        const reason = reasonText(input.reason); revoke(p); p.hold = input.hold; p.holdReason = input.hold === 'NONE' ? '' : reason; p.revision++;
        audit(p, s.profile.id, 'HOLD_UPDATED', reason); notify(p, input.hold === 'NONE' ? 'Collection review completed' : 'Collection paused for review', reason); return presented(p);
      }),
      issueCredential: input => run(() => {
        const s = session('STUDENT'); const p = ownedParcel(input.parcelId); collection(p);
        const key = requiredText(input.idempotencyKey, 'Issuance retry key'); if (key.length < 8) fail('VALIDATION', 'Retry key must be at least 8 characters.');
        const fingerprint = JSON.stringify({ parcelId: p.id, replace: input.replace });
        state.issues = state.issues.filter(i => i.expiresAt > now());
        const prior = state.issues.find(i => i.actor === s.profile.id && i.key === key);
        if (prior) {
          if (prior.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'Issuance retry key was used with a different request.');
          const previous = credentials.get(p.id);
          if (issueSessions.get(`${s.profile.id}:${key}`) === token && previous?.id === prior.credentialId && p.credentialState === 'ACTIVE' && now() < Date.parse(previous.expiresAt)) {
            const { attempts: _attempts, ...credential } = previous; return credential;
          }
          fail('ISSUANCE_RETRY_UNAVAILABLE', 'Original issuance cannot be replayed. Use a new retry key and request a replacement.');
        }
        const active = credentials.get(p.id);
        if (active && p.credentialState === 'ACTIVE' && now() < Date.parse(active.expiresAt) && !input.replace) fail('CREDENTIAL_ACTIVE', 'A current code exists. Choose Replace code to invalidate it.');
        if (p.credentialState !== 'NONE' && !input.replace) fail('CREDENTIAL_INVALIDATED', 'Explicitly request a replacement with replace=true and a new issuance key.');
        revoke(p); const id = next('crd');
        // Synthetic, predictable demo values only. Backend must use cryptographic generation.
        const otp = String(100000 + (state.sequence * 7919) % 900000);
        const credential: Credential = { id, parcelId: p.id, otp, qr: { v: 1, credentialRef: id, token: `demo-opaque-token-${state.sequence}-v1` }, issuedAt: iso(), expiresAt: iso(now() + 10 * 60_000) };
        credentials.set(p.id, { ...credential, attempts: 0 }); p.credentialState = 'ACTIVE';
        state.issues.push({ actor: s.profile.id, key, fingerprint, credentialId: id, expiresAt: now() + 86_400_000 }); issueSessions.set(`${s.profile.id}:${key}`, token); return credential;
      }),
      verifyCredential: input => run(() => {
        const s = session('STAFF');
        const fields = Object.keys(input);
        const allowed = input.method === 'OTP' ? ['parcelId', 'method', 'otp'] : ['parcelId', 'method', 'qr'];
        if (!['OTP', 'QR'].includes(input.method) || fields.some(field => !allowed.includes(field)) || input.method === 'OTP' && (!('otp' in input) || typeof input.otp !== 'string' || !/^\d{6}$/.test(input.otp)) || input.method === 'QR' && (!('qr' in input) || !input.qr || Object.keys(input.qr).sort().join(',') !== 'credentialRef,token,v' || input.qr.v !== 1 || typeof input.qr.credentialRef !== 'string' || !/^crd_[A-Za-z0-9_-]+$/.test(input.qr.credentialRef) || typeof input.qr.token !== 'string' || input.qr.token.length < 16 || input.qr.token.length > 256)) fail('VALIDATION', 'Supply exactly one credential presentation: OTP with otp, or QR with qr.');
        const p = ownedParcel(input.parcelId); collection(p); const c = current(p);
        if (input.method === 'OTP') {
          if (!input.otp || !/^\d{6}$/.test(input.otp)) fail('VALIDATION', 'Enter a six-digit OTP for this parcel.');
          if (input.otp !== c.otp) {
            c.attempts++;
            if (c.attempts >= 5) { revoke(p); fail('ATTEMPTS_EXCEEDED', 'Five failed OTP attempts. Credential invalidated; student must request a replacement.'); }
            fail('INVALID_CREDENTIAL', `Incorrect OTP. ${5 - c.attempts} attempts remain.`);
          }
        } else if (input.method === 'QR') {
          if (!input.qr || input.qr.v !== 1 || input.qr.credentialRef !== c.id || input.qr.token !== c.qr.token) fail('INVALID_CREDENTIAL', 'QR credential does not match this parcel’s current credential.');
        } else fail('VALIDATION', 'Choose OTP or QR verification.');
        const v: Verification = { id: next('ver'), parcelId: p.id, credentialId: c.id, parcelRevision: p.revision, expiresAt: iso(Math.min(now() + 2 * 60_000, Date.parse(c.expiresAt))), student: profile(p.studentId!), parcel: presented(p) };
        verifications.set(v.id, { ...v, staffSession: s.token }); return v;
      }),
      confirmHandover: input => run(() => {
        const s = session('STAFF');
        const key = requiredText(input.idempotencyKey, 'Confirmation retry key'); if (key.length < 8) fail('VALIDATION', 'Retry key must be at least 8 characters.');
        const fingerprint = JSON.stringify({ parcelId: input.parcelId, verificationId: input.verificationId, confirmed: input.physicalHandoverConfirmed });
        const prior = state.confirmations.find(c => c.actor === s.profile.id && c.key === key);
        if (prior) {
          if (prior.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'Confirmation retry key was used with different details.');
          return { receipt: prior.receipt, replayed: true };
        }
        const p = ownedParcel(input.parcelId); collection(p);
        if (!input.physicalHandoverConfirmed) fail('VALIDATION', 'Explicit physical handover confirmation is required.');
        const v = verifications.get(input.verificationId) ?? fail('VERIFICATION_EXPIRED', 'Verification unavailable or expired. Verify the current credential again.');
        if (v.parcelId !== p.id || v.staffSession !== token) fail('INVALID_CREDENTIAL', 'Verification belongs to a different parcel or staff session.');
        if (now() >= Date.parse(v.expiresAt)) fail('VERIFICATION_EXPIRED', 'Verification expired. Verify the credential again before handover.');
        checkRevision(p, v.parcelRevision);
        const c = current(p);
        if (c.id !== v.credentialId) fail('CONCURRENT_CONFLICT', 'Credential changed after verification. Verify the replacement.');
        const receipt: Receipt = { id: next('rcp'), parcelId: p.id, orderId: p.orderId!, studentId: p.studentId!, staffId: s.profile.id, confirmedAt: iso(), storageLocation: p.storageLocation, verificationId: v.id };
        p.status = 'CLOSED'; p.credentialState = 'CONSUMED'; p.receiptId = receipt.id; p.revision++; credentials.delete(p.id);
        state.receipts.unshift(receipt); state.confirmations.push({ actor: s.profile.id, key, fingerprint, receipt });
        audit(p, s.profile.id, 'HANDOVER_CONFIRMED', `Physical handover explicitly confirmed; receipt ${receipt.id}.`);
        notify(p, 'Parcel collected', `Your parcel ${p.id} was collected. Receipt ${receipt.id} is retained in history.`);
        return { receipt, replayed: false };
      }).then(result => {
        if (loseConfirmationResponse) { loseConfirmationResponse = false; throw new ServiceError('NETWORK', 'Simulated response lost after the confirmation was saved. Outcome is uncertain to this screen; retry the original request.', true); }
        return result;
      }),
      listNotifications: query => run(() => { const s = session('STUDENT'); return page(state.notifications.filter(n => n.studentId === s.profile.id).map(publicNotification), query, 'notifications:' + s.profile.id, n => !query.q || normalize(`${n.title} ${n.message}`).includes(normalize(query.q))); }),
      readNotification: input => run(() => {
        const s = session('STUDENT'); const n = state.notifications.find(n => n.id === input.notificationId && n.studentId === s.profile.id) ?? fail('NOT_FOUND', 'Notification not found.');
        n.readAt ??= iso(); return publicNotification(n);
      }),
      listReceipts: query => run(() => { const s = session(); return page(state.receipts.filter(r => s.profile.role === 'STAFF' || r.studentId === s.profile.id).map(publicReceipt), query, 'receipts:' + s.profile.id, r => !query.q || normalize(`${r.id} ${r.parcelId} ${r.orderId}`).includes(normalize(query.q))); }),
      getReceipt: input => run(() => {
        const s = session(); const r = state.receipts.find(r => r.id === input.receiptId && (s.profile.role === 'STAFF' || r.studentId === s.profile.id)) ?? fail('NOT_FOUND', 'Receipt not found.'); return publicReceipt(r);
      }),
      getStaffReceipt: input => run(() => { session('STAFF'); return state.receipts.find(r => r.id === input.receiptId) ?? fail('NOT_FOUND', 'Receipt not found.'); }),
      resetDemo: () => run(() => { if (options.demoEnabled === false) fail('DEMO_DISABLED', 'Demo reset is unavailable in this environment.'); session('STAFF'); state = fresh(); credentials.clear(); verifications.clear(); issueSessions.clear(); snapshots.clear(); loseConfirmationResponse = false; sessions.clear(); token = ''; return { ok: true }; }),
    };
    return api;
  }
  return { client, setOnline: (value: boolean) => { online = value; }, isOnline: () => online, loseNextConfirmationResponse: () => { loseConfirmationResponse = true; } };
}

// Input is generated from OpenAPI; this compile-time export helps later adapters/tests reuse it.
export type IntakeRequest = Input<'intakeParcel'>;
