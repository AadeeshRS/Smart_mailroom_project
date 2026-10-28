import type { Prisma, Session, User } from '@prisma/client';
import type { Tx } from './db.js';
import { canonical, digest, id } from './security.js';
import { fail } from './errors.js';
import { eligible, parcelInclude, type P } from './projections.js';
export type Context = { tx: Tx; user: User; session: Session; now: Date };
export const staff = (c: Context) => { if (c.user.role !== 'STAFF') fail('FORBIDDEN', 'Staff permission required.'); };
export const student = (c: Context) => { if (c.user.role !== 'STUDENT') fail('FORBIDDEN', 'Student permission required.'); };
export async function ownedParcel(c: Context, parcelId: string) {
  const p = await c.tx.parcel.findUnique({ where: { id: parcelId }, include: parcelInclude });
  if (!p || c.user.role === 'STUDENT' && p.studentId !== c.user.id) fail('NOT_FOUND', 'Parcel not found.'); return p;
}
export const collection = (p: P) => {
  if (p.status === 'CLOSED') fail('ALREADY_COLLECTED', 'Parcel already collected; retained receipt available.');
  if (p.hold !== 'NONE') fail('COLLECTION_HOLD', 'Collection is paused pending mailroom review.');
  if (!eligible(p)) fail('NOT_ELIGIBLE', 'Parcel is not eligible for collection.');
};
export const revision = (p: P, value: number) => { if (p.revision !== value) fail('REVISION_CHANGED', 'Parcel changed; reload and review again.'); };
export const nonblank = (value: string) => { if (!value.trim()) fail('VALIDATION', 'Required text must not be blank.'); return value.trim(); };
export async function rate(tx: Tx, key: string, maximum: number, now: Date, period = 60_000) {
  const previous = await tx.rateWindow.findUnique({ where: { key } });
  if (!previous || previous.expiresAt <= now) await tx.rateWindow.upsert({ where: { key }, create: { key, count: 1, expiresAt: new Date(+now + period) }, update: { count: 1, expiresAt: new Date(+now + period) } });
  else { if (previous.count >= maximum) return false; await tx.rateWindow.update({ where: { key }, data: { count: { increment: 1 } } }); }
  return true;
}
export async function replay(c: Context, operation: string, request: { idempotencyKey: string }) {
  const { idempotencyKey: key, ...body } = request, fingerprint = digest(canonical(body));
  const where = { actorId_operation_key: { actorId: c.user.id, operation, key } };
  const old = await c.tx.idempotency.findUnique({ where });
  if (old && (!old.expiresAt || old.expiresAt > c.now)) {
    if (old.fingerprint !== fingerprint) fail('IDEMPOTENCY_CONFLICT', 'Retry key was used with different request details.');
    return { old, fingerprint };
  }
  if (old) await c.tx.idempotency.delete({ where });
  return { old: null, fingerprint };
}
export async function remember(c: Context, operation: string, key: string, fingerprint: string, result: unknown, permanentReceiptId?: string) {
  await c.tx.idempotency.create({ data: { id: id('idem'), actorId: c.user.id, operation, key, fingerprint, result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue, expiresAt: permanentReceiptId ? null : new Date(+c.now + 86_400_000), receiptId: permanentReceiptId, createdAt: c.now } });
}
type Query = { q?: string; status?: string; hold?: string; cursor?: string; limit?: number };
export async function page<T extends { id: string }>(c: Context, operation: string, items: T[], query: Query) {
  const binding = digest(canonical({ operation, limit: query.limit ?? 20, q: query.q ?? '', status: query.status ?? '', hold: query.hold ?? '' }));
  let ids: string[], offset = 0, expiresAt = new Date(+c.now + 900_000);
  if (query.cursor !== undefined) {
    const snapshot = await c.tx.snapshot.findUnique({ where: { id: query.cursor } });
    if (!snapshot || snapshot.actorId !== c.user.id || snapshot.binding !== binding || snapshot.expiresAt <= c.now) fail('CURSOR_INVALID', 'Cursor expired or belongs to another account/query. Load the first page.');
    ids = snapshot.ids as string[]; offset = snapshot.offset; expiresAt = snapshot.expiresAt;
  } else ids = items.map(item => item.id);
  const current = new Map(items.map(item => [item.id, item])); const selected: T[] = [];
  while (offset < ids.length && selected.length < (query.limit ?? 20)) { const item = current.get(ids[offset++]); if (item) selected.push(item); }
  if (offset < ids.length) {
    const snapshot = await c.tx.snapshot.create({ data: { id: id('cursor'), actorId: c.user.id, binding, ids, offset, expiresAt } });
    return { items: selected, nextCursor: snapshot.id };
  }
  return { items: selected };
}
export const search = (q: string | undefined, fields: string[]) => !q || fields.join(' ').toUpperCase().includes(q.toUpperCase());
export const sorted = <T extends { id: string }>(items: T[], time: (item: T) => Date) => items.sort((a, b) => +time(b) - +time(a) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
