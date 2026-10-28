import type { Tx } from './db.js';
import { canonical, digest, id } from './security.js';
import { refs, order, profile, orderInclude, parcelInclude, type O, type P } from './projections.js';
import { same, upper } from './identifiers.js';
import type { S } from './contract.js';
export async function audit(tx: Tx, parcelId: string, actorId: string, action: string, reason: string, at: Date) {
  await tx.auditEvent.create({ data: { id: id('aud'), parcelId, actorId, action, reason, at } });
}
export async function notify(tx: Tx, p: { id: string; studentId: string | null }, title: string, message: string, eventKey: string, now: Date) {
  if (!p.studentId) return;
  const existing = await tx.notification.findUnique({ where: { eventKey } }); if (existing) return;
  await tx.notification.create({ data: { id: id('ntf'), eventKey, parcelId: p.id, studentId: p.studentId, title, message, createdAt: now, attempts: { create: { id: id('dlv'), simulated: true, createdAt: now } } } });
}
export async function revoke(tx: Tx, p: P) {
  await tx.credential.updateMany({ where: { parcelId: p.id, state: { in: ['ACTIVE', 'EXPIRED'] } }, data: { state: 'INVALIDATED' } });
  if (['ACTIVE', 'EXPIRED'].includes(p.credentialState)) await tx.parcel.update({ where: { id: p.id }, data: { credentialState: 'INVALIDATED' } });
}
export const duplicate = (o: O, orders: O[]) => orders.some(other => other.id !== o.id && other.status !== 'CANCELLED' && o.status !== 'CANCELLED' && refs(o).some(a => refs(other).some(b => same(a, b))));
export function candidate(p: P, o: O, orders: O[]): S<'Candidate'> {
  const r = refs(o), student = o.student, conflicts: string[] = [];
  if (p.recipientEmail && upper(p.recipientEmail) !== upper(student.email)) conflicts.push('Label email differs from provisioned student profile.');
  if (p.recipientStudentNumber && upper(p.recipientStudentNumber) !== upper(student.studentNumber ?? '')) conflicts.push('Label student number differs from provisioned profile.');
  for (const i of p.identifiers) {
    if (i.kind === 'ORDER_ID' && !r.some(b => same(i, b))) conflicts.push('Supplied merchant identifier contradicts this order.');
    const namespace = r.filter(b => b.kind === i.kind && b.namespace === i.namespace);
    if (i.kind === 'TRACKING' && namespace.length && !namespace.some(b => same(i, b))) conflicts.push('Supplied tracking identifier contradicts registered references.');
  }
  return { order: order(o, duplicate(o, orders)), student: profile(student), comparable: p.identifiers.some(a => r.some(b => same(a, b))), corroborated: !!(p.recipientEmail && upper(p.recipientEmail) === upper(student.email) || p.recipientStudentNumber && upper(p.recipientStudentNumber) === upper(student.studentNumber ?? '')), conflicts };
}
export function fingerprint(p: P, orders: O[], parcels: P[]) {
  const linked = orders.find(o => o.id === p.orderId), related = [...p.identifiers, ...(linked ? refs(linked) : [])];
  const peers = parcels.filter(other => other.id !== p.id && p.identifiers.some(a => a.kind === 'TRACKING' && other.identifiers.some(b => b.kind === 'TRACKING' && same(a, b))));
  return { peers, value: digest(canonical([peers.map(other => ({ id: other.id, identifiers: other.identifiers.map(i => [i.kind, i.namespace, i.value]) })).sort((a, b) => a.id.localeCompare(b.id)), orders.filter(o => o.status !== 'CANCELLED' && (o.id === p.orderId || refs(o).some(a => related.some(b => same(a, b))))).map(o => ({ id: o.id, references: refs(o), duplicate: duplicate(o, orders) })).sort((a, b) => a.id.localeCompare(b.id))])) };
}
export async function assign(tx: Tx, p: P, o: O, actor: string, reason: string, now: Date) {
  await revoke(tx, p);
  const updated = await tx.parcel.update({ where: { id: p.id }, data: { orderId: o.id, studentId: o.studentId, status: 'AWAITING_COLLECTION', matchOutcome: 'MATCHED', matchExplanation: reason, hold: 'NONE', holdReason: '', revision: { increment: 1 } } });
  await audit(tx, p.id, actor, 'MATCHED', reason, now);
  if (p.studentId && p.studentId !== o.studentId) await notify(tx, p, 'Parcel assignment reviewed', 'Mailroom review updated this parcel. Contact staff for assistance.', `review:${p.id}:${updated.revision}:${p.studentId}`, now);
  if (p.studentId !== o.studentId) await notify(tx, updated, 'Your parcel has arrived', `${p.description} is stored at ${p.storageLocation}. Request a collection code when ready.`, `arrival:${p.id}:${updated.revision}:${o.studentId}`, now);
}
export async function recheck(tx: Tx, actor: string, now: Date) {
  const orders = await tx.expectedOrder.findMany({ include: orderInclude });
  const parcels = await tx.parcel.findMany({ include: parcelInclude });
  for (const p of parcels) {
    if (p.status === 'CLOSED') continue;
    const f = fingerprint(p, orders, parcels);
    if (p.orderId && (p.reviewedFingerprint === f.value || p.hold === 'DISPUTE' && p.observedFingerprint === f.value)) continue;
    const candidates = orders.filter(o => o.status !== 'CANCELLED').map(o => ({ o, c: candidate(p, o, orders) })).filter(x => x.c.comparable);
    const first = candidates[0]; let outcome: string, explanation: string;
    if (f.peers.length) { outcome = 'TRACKING_COLLISION'; explanation = 'A carrier/tracking reference appears on multiple physical parcels. Document a resolution for each parcel.'; }
    else if (candidates.length > 1 || candidates.some(x => x.c.order.duplicateClaim)) { outcome = 'AMBIGUOUS'; explanation = 'Overlapping claims require staff review; no first-claim allocation.'; }
    else if (!first) { outcome = 'NO_MATCH'; explanation = 'No comparable identifier in the same namespace.'; }
    else if (first.c.conflicts.length || p.orderId && p.orderId !== first.o.id) { outcome = 'CONFLICT'; explanation = first.c.conflicts.join(' ') || 'A new claim contradicts the reviewed assignment.'; }
    else if (!first.c.corroborated || first.o.platform === 'OTHER' || !p.identifiers.some(a => a.namespace !== 'OTHER' && refs(first.o).some(b => same(a, b)))) { outcome = 'INSUFFICIENT_EVIDENCE'; explanation = 'Independent profile corroboration and approved comparable reference required. OTHER requires review.'; }
    else { if (!p.orderId) await assign(tx, p, first.o, actor, 'Unique comparable identifier with independent profile corroboration and no contradictions.', now); continue; }
    await tx.parcel.update({ where: { id: p.id }, data: { matchOutcome: outcome, matchExplanation: explanation, ...(p.orderId ? { hold: 'DISPUTE', holdReason: explanation, observedFingerprint: f.value, revision: { increment: 1 } } : { status: 'AWAITING_MATCH', ...(f.peers.length ? { hold: 'REVIEW', holdReason: explanation } : {}) }) } });
    if (p.orderId) {
      await revoke(tx, p); await audit(tx, p.id, actor, 'DISPUTE_HOLD', explanation, now);
      await notify(tx, p, 'Collection paused for review', 'Collection is paused pending mailroom review.', `hold:${p.id}:${p.revision + 1}`, now);
    }
  }
  for (const o of orders.filter(o => o.status !== 'CANCELLED')) {
    const count = await tx.parcel.count({ where: { orderId: o.id } });
    await tx.expectedOrder.update({ where: { id: o.id }, data: { status: count ? 'MATCHED' : 'PENDING' } });
  }
}
