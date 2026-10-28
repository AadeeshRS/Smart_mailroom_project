import type { PrismaClient } from '@prisma/client';
import type { operations } from '../../contracts/generated/api.js';
import { type Config } from './config.js';
import { transaction } from './db.js';
import { CommittedFailure, DomainError, fail } from './errors.js';
import { type Input, type Output, type S } from './contract.js';
import { digest, id, passwordHash, passwordValid, token } from './security.js';
import { type Context, nonblank, ownedParcel, page, rate, remember, replay, revision, search, sorted, staff, student } from './context.js';
import { candidate, duplicate, fingerprint, assign, audit, notify, recheck, revoke } from './matching.js';
import { identifier, same, upper } from './identifiers.js';
import { order, orderInclude, parcel, parcelInclude, profile, receipt, staffParcel, staffReceipt } from './projections.js';
import { Credentials } from './credentials.js';
import { reset } from './seed.js';
import { guide } from './guides.js';
type Handlers = { [K in keyof operations]: (input: Input<K>) => Promise<Output<K> | CommittedFailure> };
export type BackendOptions = { now?: () => Date; afterHandover?: () => Promise<void> };
export class Backend {
  readonly credentials: Credentials;
  constructor(readonly db: PrismaClient, readonly config: Config, readonly options: BackendOptions = {}) { this.credentials = new Credentials(config.pepper, options.afterHandover); }
  async execute(operation: keyof operations, input: unknown, bearer = '', ip = 'local') {
    if (operation === 'getGuide') return guide(input as Input<'getGuide'>);
    const result = await transaction(this.db, async tx => {
      const now = this.options.now?.() ?? new Date();
      await tx.snapshot.deleteMany({ where: { expiresAt: { lte: now } } });
      await tx.idempotency.deleteMany({ where: { expiresAt: { lte: now }, receiptId: null } });
      if (operation === 'login') {
        if (!this.config.demo) fail('DEMO_DISABLED', 'Demo login is unavailable.');
        const request = input as Input<'login'>;
        if (!await rate(tx, 'login:' + digest(ip), 20, now)) return new CommittedFailure(new DomainError('UNAUTHENTICATED', 'Login rate limit reached. Retry after one minute.', true));
        const user = await tx.user.findUnique({ where: { id: request.accountId } });
        // Always do scrypt, including unknown accounts, to avoid a cheap enumeration path.
        const hash = user?.passwordHash ?? 'scrypt$131072$8$1$00000000000000000000000000000000$' + '0'.repeat(128);
        if (!await passwordValid(request.passcode, hash) || !user) return new CommittedFailure(new DomainError('UNAUTHENTICATED', 'Invalid demonstration account or passcode.'));
        if (Number(hash.split('$')[1]) < 131072) await tx.user.update({ where: { id: user.id }, data: { passwordHash: await passwordHash(request.passcode) } });
        const secret = token(), expiresAt = new Date(+now + 1_800_000);
        await tx.session.create({ data: { id: id('ses'), userId: user.id, tokenDigest: digest(secret), createdAt: now, expiresAt } });
        return { token: secret, expiresAt: expiresAt.toISOString(), profile: profile(user) } satisfies S<'Session'>;
      }
      if (operation === 'resetDemo' && !this.config.demo) fail('DEMO_DISABLED', 'Demo reset is unavailable.');
      const session = bearer && await tx.session.findUnique({ where: { tokenDigest: digest(bearer) }, include: { user: true } });
      if (!session || session.revokedAt) fail('UNAUTHENTICATED', 'Sign in to a provisioned account.');
      if (session.expiresAt <= now) fail('SESSION_EXPIRED', 'Your demonstration session expired. Sign in again.');
      const c: Context = { tx, session, user: session.user, now };
      const allOrders = () => tx.expectedOrder.findMany({ include: orderInclude });
      const ownedOrder = async (orderId: string) => { student(c); const o = await tx.expectedOrder.findUnique({ where: { id: orderId }, include: orderInclude }); if (!o || o.studentId !== c.user.id) fail('NOT_FOUND', 'Order not found.'); return o; };
      const orderResponse = async (orderId: string) => { const orders = await allOrders(); const o = orders.find(o => o.id === orderId)!; return order(o, duplicate(o, orders)); };
      async function write<T>(op: string, request: { idempotencyKey: string }, action: () => Promise<T>) {
        const previous = await replay(c, op, request); if (previous.old) return previous.old.result as T;
        const value = await action(); await remember(c, op, request.idempotencyKey, previous.fingerprint, value); return value;
      }
      const handlers = {
        login: async () => fail('VALIDATION', 'Invalid dispatch.'),
        getSession: async () => ({ token: bearer, expiresAt: session.expiresAt.toISOString(), profile: profile(c.user) }),
        logout: async () => { await tx.session.update({ where: { id: session.id }, data: { revokedAt: now } }); this.credentials.forgetSession(session.id); return { ok: true }; },
        getGuide: async input => guide(input),
        listOrders: async query => {
          student(c); const orders = await allOrders();
          const authorized = orders.filter(o => o.studentId === c.user.id);
          const items = sorted(authorized, o => o.createdAt).filter(o => query.cursor || ((!query.status || o.status === query.status) && search(query.q, [o.merchantOrderId, ...o.tracking.map(r => r.value)])));
          const result = await page(c, 'orders', items, query); return { ...result, items: result.items.map(o => order(o, duplicate(o, orders))) };
        },
        createOrder: async input => {
          student(c); return write('createOrder', input, async () => {
            const merchant = identifier({ kind: 'ORDER_ID', namespace: input.platform, value: input.merchantOrderId });
            const tracking = input.tracking.map(identifier);
            if (await tx.expectedOrder.findFirst({ where: { studentId: c.user.id, platform: input.platform, merchantOrderId: merchant.value, status: { not: 'CANCELLED' } } })) fail('DUPLICATE_ORDER', 'Active order already registered. Add tracking to it.');
            const unique = tracking.filter((r, index) => tracking.findIndex(other => same(r, other)) === index);
            const o = await tx.expectedOrder.create({ data: { id: id('ord'), studentId: c.user.id, platform: input.platform, merchantOrderId: merchant.value, originalOrderId: input.merchantOrderId, createdAt: now, tracking: { create: unique.map(r => ({ id: id('ref'), namespace: r.namespace, value: r.value, originalValue: input.tracking[tracking.indexOf(r)].value })) } } });
            await recheck(tx, c.user.id, now); return orderResponse(o.id);
          });
        },
        getOrder: async input => { await ownedOrder(input.orderId); return orderResponse(input.orderId); },
        addTracking: async input => {
          const o = await ownedOrder(input.orderId); if (o.status === 'CANCELLED') fail('CANCELLATION_INELIGIBLE', 'Cancelled orders cannot be edited.');
          const reference = identifier(input.reference); const exists = o.tracking.some(r => r.namespace === reference.namespace && r.value === reference.value);
          if (!exists && o.tracking.length >= 20) fail('VALIDATION', 'At most 20 tracking references are allowed.');
          if (!exists) await tx.orderReference.create({ data: { id: id('ref'), orderId: o.id, namespace: reference.namespace, value: reference.value, originalValue: input.reference.value } });
          await recheck(tx, c.user.id, now); return orderResponse(o.id);
        },
        cancelOrder: async input => {
          const o = await ownedOrder(input.orderId); if (o.status === 'CANCELLED') return orderResponse(o.id);
          if (o.status !== 'PENDING' || o.parcels.length) fail('CANCELLATION_INELIGIBLE', 'Only pending unlinked requests can be cancelled.');
          await tx.expectedOrder.update({ where: { id: o.id }, data: { status: 'CANCELLED' } }); await recheck(tx, c.user.id, now); return orderResponse(o.id);
        },
        listParcels: async query => {
          const records = await tx.parcel.findMany({ where: c.user.role === 'STAFF' ? {} : { studentId: c.user.id }, include: parcelInclude });
          const items = sorted(records, p => p.receivedAt).filter(p => query.cursor || ((!query.status || p.status === query.status) && (!query.hold || p.hold === query.hold) && search(query.q, [p.id, p.description, p.storageLocation, p.physicalReference, ...(c.user.role === 'STAFF' ? p.identifiers.map(i => i.value) : [])])));
          const result = await page(c, 'parcels', items, query); return { ...result, items: result.items.map(p => parcel(p, now)) };
        },
        intakeParcel: async input => {
          staff(c); return write('intakeParcel', input, async () => {
            if (!input.labelReviewed) fail('VALIDATION', 'Review and classify extracted fields before saving.');
            const identifiers = input.identifiers.map(identifier), physicalReference = nonblank(input.physicalReference);
            if (await tx.parcel.findUnique({ where: { physicalKey: upper(physicalReference) } })) fail('DUPLICATE_INTAKE', 'This physical parcel reference already exists.');
            const p = await tx.parcel.create({ data: { id: id('par'), physicalReference, physicalKey: upper(physicalReference), description: nonblank(input.description), storageLocation: nonblank(input.storageLocation), recipientEmail: input.recipientEmail.trim(), recipientStudentNumber: input.recipientStudentNumber.trim(), recipientName: input.recipientName.trim(), source: input.source, receivedAt: now, identifiers: { create: identifiers.map((r, i) => ({ ...r, id: id('ref'), originalValue: input.identifiers[i].value })) } } });
            await audit(tx, p.id, c.user.id, 'RECEIVED', 'Physical intake and classified label fields reviewed.', now); await recheck(tx, c.user.id, now); return staffParcel(await ownedParcel(c, p.id), now);
          });
        },
        getParcel: async input => parcel(await ownedParcel(c, input.parcelId), now),
        getStaffParcel: async input => { staff(c); return staffParcel(await ownedParcel(c, input.parcelId), now); },
        getReview: async input => {
          staff(c); const p = await ownedParcel(c, input.parcelId), orders = await allOrders();
          const all = orders.filter(o => o.status !== 'CANCELLED');
          const items = sorted(all, o => o.createdAt).sort((a, b) => Number(candidate(p, b, orders).comparable) - Number(candidate(p, a, orders).comparable)).filter(o => input.cursor || search(input.q, [o.merchantOrderId, ...o.tracking.map(r => r.value), o.student.name, o.student.email, o.student.studentNumber ?? '']));
          const result = await page(c, 'review:' + p.id, items, input); return { parcel: staffParcel(p, now), candidates: result.items.map(o => candidate(p, o, orders)), ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
        },
        reconcileParcel: async input => {
          staff(c); return write('reconcileParcel', input, async () => {
            const p = await ownedParcel(c, input.parcelId); revision(p, input.expectedRevision);
            if (p.status === 'CLOSED') fail('ALREADY_COLLECTED', 'Closed parcel ownership is retained.');
            if (!input.identifierReviewed || !input.recipientVerified || !input.conflictsResolved || input.reason.trim().length < 12) fail('VALIDATION', 'Complete every evidence check and reason.');
            const orders = await allOrders(), o = orders.find(o => o.id === input.orderId && o.status !== 'CANCELLED'); if (!o) fail('NOT_FOUND', 'Active order not found.');
            await assign(tx, p, o, c.user.id, input.reason.trim(), now);
            const updated = await ownedParcel(c, p.id), parcels = await tx.parcel.findMany({ include: parcelInclude });
            const f = fingerprint(updated, orders, parcels).value;
            await tx.decision.create({ data: { id: id('dec'), parcelId: p.id, orderId: o.id, actorId: c.user.id, fingerprint: f, reason: input.reason.trim(), identifierReviewed: true, recipientVerified: true, conflictsResolved: true, createdAt: now } });
            await tx.parcel.update({ where: { id: p.id }, data: { reviewedFingerprint: f } });
            await audit(tx, p.id, c.user.id, 'EVIDENCE_REVIEWED', input.reason.trim(), now);
            await recheck(tx, c.user.id, now); return staffParcel(await ownedParcel(c, p.id), now);
          });
        },
        setHold: async input => {
          staff(c); const p = await ownedParcel(c, input.parcelId); revision(p, input.expectedRevision);
          if (p.status === 'CLOSED') fail('ALREADY_COLLECTED', 'Collected parcels remain closed.');
          if (p.hold === 'DISPUTE' && input.hold !== 'DISPUTE') fail('COLLECTION_HOLD', 'Resolve the dispute with evidence-led reconciliation.');
          if (input.reason.trim().length < 12) fail('VALIDATION', 'Explain the review decision.');
          await revoke(tx, p); const updated = await tx.parcel.update({ where: { id: p.id }, data: { hold: input.hold, holdReason: input.hold === 'NONE' ? '' : input.reason.trim(), revision: { increment: 1 } } });
          await audit(tx, p.id, c.user.id, 'HOLD_UPDATED', input.reason.trim(), now); await notify(tx, p, input.hold === 'NONE' ? 'Collection review completed' : 'Collection paused for review', 'Mailroom review updated this parcel. Contact staff for assistance.', `hold:${p.id}:${updated.revision}`, now); return staffParcel(await ownedParcel(c, p.id), now);
        },
        issueCredential: input => this.credentials.issue(c, input),
        verifyCredential: input => this.credentials.verify(c, input),
        confirmHandover: input => this.credentials.confirm(c, input),
        listNotifications: async query => {
          student(c); const notifications = await tx.notification.findMany({ where: { studentId: c.user.id }, include: { attempts: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 } } });
          const items = sorted(notifications, n => n.createdAt).filter(n => query.cursor || search(query.q, [n.title, n.message])); const result = await page(c, 'notifications', items, query);
          return { ...result, items: result.items.map(n => ({ id: n.id, studentId: n.studentId, parcelId: n.parcelId, title: n.title, message: n.message, createdAt: n.createdAt.toISOString(), ...(n.readAt ? { readAt: n.readAt.toISOString() } : {}), inAppAvailable: true, simulatedExternal: true, externalDelivery: (n.attempts[0]?.state ?? 'PENDING') as S<'Notification'>['externalDelivery'] })) };
        },
        readNotification: async input => {
          student(c); const n = await tx.notification.findFirst({ where: { id: input.notificationId, studentId: c.user.id }, include: { attempts: { orderBy: { createdAt: 'desc' }, take: 1 } } }); if (!n) fail('NOT_FOUND', 'Notification not found.');
          const updated = await tx.notification.update({ where: { id: n.id }, data: { readAt: n.readAt ?? now } });
          return { id: n.id, studentId: n.studentId, parcelId: n.parcelId, title: n.title, message: n.message, createdAt: n.createdAt.toISOString(), readAt: updated.readAt!.toISOString(), inAppAvailable: true, simulatedExternal: true, externalDelivery: (n.attempts[0]?.state ?? 'PENDING') as S<'Notification'>['externalDelivery'] };
        },
        listReceipts: async query => {
          const records = await tx.handover.findMany({ where: c.user.role === 'STAFF' ? {} : { studentId: c.user.id } });
          const items = sorted(records, h => h.confirmedAt).filter(h => query.cursor || search(query.q, [h.id, h.parcelId, h.orderId])); const result = await page(c, 'receipts', items, query); return { ...result, items: result.items.map(receipt) };
        },
        getReceipt: async input => { const h = await tx.handover.findFirst({ where: { id: input.receiptId, ...(c.user.role === 'STUDENT' ? { studentId: c.user.id } : {}) } }); if (!h) fail('NOT_FOUND', 'Receipt not found.'); return receipt(h); },
        getStaffReceipt: async input => { staff(c); const h = await tx.handover.findUnique({ where: { id: input.receiptId } }); if (!h) fail('NOT_FOUND', 'Receipt not found.'); return staffReceipt(h); },
        resetDemo: async () => { staff(c); await reset(tx, this.config.databaseUrl); this.credentials.clear(); return { ok: true }; },
      } satisfies Handlers;
      return (handlers[operation] as (input: unknown) => Promise<unknown>)(input);
    });
    if (result instanceof CommittedFailure) throw result.error;
    return result;
  }
}
