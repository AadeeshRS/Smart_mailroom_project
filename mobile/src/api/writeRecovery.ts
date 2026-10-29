import type { Persistence } from './mock';
import { ServiceError, type MailroomService, type Schema } from './service';
type WriteOperation = 'createOrder' | 'intakeParcel' | 'reconcileParcel';
export type PendingWrite = { operation: WriteOperation; request: Parameters<MailroomService[WriteOperation]>[0]; createdAt: string; resetEpoch?: string; reviewedAt?: string };
export type RecoveryProtection = 'RECOVERABLE' | 'EXPIRED' | 'RESET' | 'REVIEWED';
export const ORDINARY_REPLAY_MS = 86_400_000;
const operations: WriteOperation[] = ['createOrder', 'intakeParcel', 'reconcileParcel'];
const uncertain = (error: unknown) => !(error instanceof ServiceError) || ['NETWORK', 'PERSISTENCE', 'UNAUTHENTICATED', 'SESSION_EXPIRED'].includes(error.code);
/** Original ordinary writes are scoped to URL + authenticated identity. No secrets. */
export function durableWrites(raw: MailroomService, storage: Persistence, environment: string, now: () => number = Date.now) {
  let accountId: string | undefined; let queue: Promise<unknown> = Promise.resolve();
  const epochKey = `smart-mailroom-http-reset-v1:${encodeURIComponent(environment)}`;
  const epoch = async () => await storage.getItem(epochKey) ?? 'initial';
  const key = (account: string) => `smart-mailroom-http-writes-v1:${encodeURIComponent(environment)}:${account}`;
  const list = async (account: string): Promise<PendingWrite[]> => JSON.parse(await storage.getItem(key(account)) ?? '[]');
  const save = (account: string, records: PendingWrite[]) => storage.setItem(key(account), JSON.stringify(records));
  function serialized<T>(work: () => Promise<T>) { const job = queue.then(work); queue = job.catch(() => undefined); return job; }
  const protection = async (record: PendingWrite): Promise<RecoveryProtection> => {
    if (record.reviewedAt) return 'REVIEWED';
    if ((record.resetEpoch ?? 'initial') !== await epoch()) return 'RESET';
    const created = Date.parse(record.createdAt), age = now() - created;
    // Invalid/future timestamps fail closed too; never renew createdAt on retry.
    return !Number.isFinite(created) || age < 0 || age >= ORDINARY_REPLAY_MS ? 'EXPIRED' : 'RECOVERABLE';
  };
  const actor = (account: string) => { if (account !== accountId) throw new ServiceError('FORBIDDEN', 'Recovery belongs to another authenticated account.'); };
  async function perform(operation: WriteOperation, request: PendingWrite['request']) {
    const account = accountId; if (!account) throw new ServiceError('UNAUTHENTICATED', 'Sign in before writing.');
    const records = await list(account), existing = records.find(r => r.operation === operation && !r.reviewedAt);
    if (existing && await protection(existing) !== 'RECOVERABLE') throw new ServiceError('IDEMPOTENCY_CONFLICT', 'Ordinary recovery protection has expired or a reset intervened. Inspect existing records and explicitly review a new operation; the original will not be posted.');
    if (records.some(r => r.reviewedAt && r.request.idempotencyKey === request.idempotencyKey)) throw new ServiceError('IDEMPOTENCY_CONFLICT', 'This original request is archived for investigation and cannot be submitted as fresh work.');
    if (existing && JSON.stringify(existing.request) !== JSON.stringify(request)) throw new ServiceError('IDEMPOTENCY_CONFLICT', 'An uncertain original write is saved. Recover it from the overview before starting another request of this kind.');
    const record: PendingWrite = existing ?? { operation, request: JSON.parse(JSON.stringify(request)), createdAt: new Date(now()).toISOString(), resetEpoch: await epoch() };
    const isOriginal = (r: PendingWrite) => r.operation === operation && r.request.idempotencyKey === record.request.idempotencyKey;
    await save(account, [...records.filter(r => !isOriginal(r)), record]);
    // Storage latency or another client instance may cross the deadline/reset.
    if (await protection(record) !== 'RECOVERABLE') throw new ServiceError('IDEMPOTENCY_CONFLICT', 'Recovery protection expired before submission. Inspect the saved original outcome.');
    try {
      const result = await (raw[operation] as (value: unknown) => Promise<Schema<'ExpectedOrder'> | Schema<'StaffParcel'>>)(record.request);
      await save(account, (await list(account)).filter(r => !isOriginal(r))); return result;
    } catch (error) { if (!uncertain(error)) await save(account, (await list(account)).filter(r => !isOriginal(r))); throw error; }
  }
  const api = { ...raw,
    login: async (input: Parameters<MailroomService['login']>[0]) => { const result = await raw.login(input); accountId = result.profile.id; return result; },
    logout: async (input: Parameters<MailroomService['logout']>[0]) => { const result = await raw.logout(input); accountId = undefined; return result; },
    resetDemo: (input: Parameters<MailroomService['resetDemo']>[0]) => serialized(async () => {
      // Fence every account's local originals BEFORE reset, including lost responses.
      // An uncertain reset conservatively requires inspection even if it rolled back.
      // This local generation marker is not a secret or an authorization token.
      await storage.setItem(epochKey, `${now()}:${Math.random().toString(36).slice(2)}`);
      const result = await raw.resetDemo(input); accountId = undefined; return result;
    }),
  };
  for (const operation of operations) Object.assign(api, { [operation]: (request: PendingWrite['request']) => {
    return serialized(() => perform(operation, request));
  } });
  return { api, list, protection, reviewForNewOperation: (account: string, record: PendingWrite) => serialized(async () => {
    actor(account);
    const records = await list(account), original = records.find(r => r.operation === record.operation && r.request.idempotencyKey === record.request.idempotencyKey);
    if (!original || !['EXPIRED', 'RESET'].includes(await protection(original))) throw new ServiceError('IDEMPOTENCY_CONFLICT', 'Only an expired or reset original may be archived after explicit inspection.');
    original.reviewedAt = new Date(now()).toISOString(); await save(account, records);
  }), retry: async (account: string, record: PendingWrite) => {
    actor(account);
    const original = (await list(account)).find(r => r.operation === record.operation && r.request.idempotencyKey === record.request.idempotencyKey);
    if (!original || await protection(original) !== 'RECOVERABLE') throw new ServiceError('IDEMPOTENCY_CONFLICT', 'Ordinary recovery protection expired, was reset, or was reviewed. Inspect existing records; this original will not be posted.');
    return (api[original.operation] as (value: unknown) => Promise<Schema<'ExpectedOrder'> | Schema<'StaffParcel'>>)(original.request);
  } };
}
