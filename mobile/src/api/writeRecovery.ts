import type { Persistence } from './mock';
import { ServiceError, type MailroomService, type Schema } from './service';
type WriteOperation = 'createOrder' | 'intakeParcel' | 'reconcileParcel';
export type PendingWrite = { operation: WriteOperation; request: Parameters<MailroomService[WriteOperation]>[0]; createdAt: string };
const operations: WriteOperation[] = ['createOrder', 'intakeParcel', 'reconcileParcel'];
const uncertain = (error: unknown) => !(error instanceof ServiceError) || ['NETWORK', 'PERSISTENCE', 'UNAUTHENTICATED', 'SESSION_EXPIRED'].includes(error.code);
/** Original ordinary writes are scoped to URL + authenticated identity. No secrets. */
export function durableWrites(raw: MailroomService, storage: Persistence, environment: string) {
  let accountId: string | undefined; let queue: Promise<unknown> = Promise.resolve();
  const key = (account: string) => `smart-mailroom-http-writes-v1:${encodeURIComponent(environment)}:${account}`;
  const list = async (account: string): Promise<PendingWrite[]> => JSON.parse(await storage.getItem(key(account)) ?? '[]');
  const save = (account: string, records: PendingWrite[]) => storage.setItem(key(account), JSON.stringify(records));
  async function perform(operation: WriteOperation, request: PendingWrite['request']) {
    const actor = accountId; if (!actor) throw new ServiceError('UNAUTHENTICATED', 'Sign in before writing.');
    const records = await list(actor), existing = records.find(r => r.operation === operation);
    if (existing && JSON.stringify(existing.request) !== JSON.stringify(request)) throw new ServiceError('IDEMPOTENCY_CONFLICT', 'An uncertain original write is saved. Recover it from the overview before starting another request of this kind.');
    const record: PendingWrite = existing ?? { operation, request, createdAt: new Date().toISOString() };
    await save(actor, [...records.filter(r => r.operation !== operation), record]);
    try {
      const result = await (raw[operation] as (value: unknown) => Promise<Schema<'ExpectedOrder'> | Schema<'StaffParcel'>>)(record.request);
      await save(actor, (await list(actor)).filter(r => r.operation !== operation)); return result;
    } catch (error) { if (!uncertain(error)) await save(actor, (await list(actor)).filter(r => r.operation !== operation)); throw error; }
  }
  const api = { ...raw,
    login: async (input: Parameters<MailroomService['login']>[0]) => { const result = await raw.login(input); accountId = result.profile.id; return result; },
    logout: async (input: Parameters<MailroomService['logout']>[0]) => { const result = await raw.logout(input); accountId = undefined; return result; },
  };
  for (const operation of operations) Object.assign(api, { [operation]: (request: PendingWrite['request']) => {
    const job = queue.then(() => perform(operation, request)); queue = job.catch(() => undefined); return job;
  } });
  return { api, list, retry: (account: string, record: PendingWrite) => {
    if (account !== accountId) return Promise.reject(new ServiceError('FORBIDDEN', 'Recovery belongs to another authenticated account.'));
    return (api[record.operation] as (value: unknown) => Promise<Schema<'ExpectedOrder'> | Schema<'StaffParcel'>>)(record.request);
  } };
}
