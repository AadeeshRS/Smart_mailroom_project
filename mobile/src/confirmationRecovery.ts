import type { Persistence } from './api/mock';
import { ServiceError, type Input, type MailroomService } from './api/service';

export type ConfirmationRecovery = {
  staffId: string;
  request: Input<'confirmHandover'>;
  createdAt: string;
  phase: 'UNCERTAIN' | 'COMMITTED' | 'REJECTED';
  receiptId?: string;
};
/** Stores only the original non-secret request and result reference. Account-scoped;
 * no OTP, QR token, bearer/session token or student profile is persisted here.
 */
export class ConfirmationRecoveryStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private storage: Persistence, private environment = 'mock') {}
  private key(staffId: string) { return this.environment === 'mock' ? `smart-mailroom-confirmation-recovery-v1:${staffId}` : `smart-mailroom-confirmation-recovery-v1:${encodeURIComponent(this.environment)}:${staffId}`; }
  async list(staffId: string): Promise<ConfirmationRecovery[]> {
    const raw = await this.storage.getItem(this.key(staffId));
    if (!raw) return [];
    const records = JSON.parse(raw) as ConfirmationRecovery[];
    return records.filter(record => record.staffId === staffId);
  }
  async get(staffId: string, parcelId: string) { return (await this.list(staffId)).find(record => record.request.parcelId === parcelId); }
  private change(staffId: string, fn: (records: ConfirmationRecovery[]) => ConfirmationRecovery[]) {
    const job = this.queue.then(async () => { const records = await this.list(staffId); await this.storage.setItem(this.key(staffId), JSON.stringify(fn(records))); });
    this.queue = job.catch(() => undefined); return job;
  }
  async save(record: ConfirmationRecovery) {
    // Explicit allowlist prevents accidental persistence of response/credential/session objects.
    const clean: ConfirmationRecovery = {
      staffId: record.staffId, createdAt: record.createdAt, phase: record.phase,
      request: { parcelId: record.request.parcelId, verificationId: record.request.verificationId, physicalHandoverConfirmed: record.request.physicalHandoverConfirmed, idempotencyKey: record.request.idempotencyKey },
      ...(record.receiptId ? { receiptId: record.receiptId } : {}),
    };
    await this.change(record.staffId, records => [...records.filter(r => r.request.parcelId !== record.request.parcelId), clean]);
  }
  async clearRejected(staffId: string, parcelId: string) {
    await this.change(staffId, records => {
      if (records.some(r => r.request.parcelId === parcelId && r.phase === 'UNCERTAIN')) throw new ServiceError('IDEMPOTENCY_CONFLICT', 'Recover the uncertain original request before starting another authorization.');
      return records.filter(r => r.request.parcelId !== parcelId);
    });
  }
  async reset(staffId: string) { await this.change(staffId, () => []); }
}
export async function confirmWithRecovery(store: ConfirmationRecoveryStore, api: MailroomService, staffId: string, request: Input<'confirmHandover'>) {
  const existing = await store.get(staffId, request.parcelId);
  if (existing && (['parcelId', 'verificationId', 'physicalHandoverConfirmed', 'idempotencyKey'] as const).some(field => existing.request[field] !== request[field])) throw new ServiceError('IDEMPOTENCY_CONFLICT', 'An original confirmation exists for this parcel. Recover it before creating a different request.');
  const record: ConfirmationRecovery = existing ?? { staffId, request, createdAt: new Date().toISOString(), phase: 'UNCERTAIN' };
  await store.save({ ...record, phase: 'UNCERTAIN' }); // Must succeed BEFORE any physical confirmation is submitted.
  try {
    const result = await api.confirmHandover(record.request);
    await store.save({ ...record, phase: 'COMMITTED', receiptId: result.receipt.id });
    return result;
  } catch (error) {
    if (error instanceof ServiceError && !['NETWORK', 'PERSISTENCE', 'UNAUTHENTICATED', 'SESSION_EXPIRED'].includes(error.code)) await store.save({ ...record, phase: 'REJECTED' });
    throw error;
  }
}
