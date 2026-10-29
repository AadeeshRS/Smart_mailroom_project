import { expect, it, vi } from 'vitest';
import { durableWrites, ORDINARY_REPLAY_MS, type PendingWrite } from '../src/api/writeRecovery';
import { ServiceError, type MailroomService } from '../src/api/service';
const requests: PendingWrite[] = [
  { operation: 'createOrder', createdAt: '', request: { platform: 'AMAZON', merchantOrderId: 'CLOSEOUT-ORDER', tracking: [], idempotencyKey: 'original-registration-key' } },
  { operation: 'intakeParcel', createdAt: '', request: { identifiers: [], recipientEmail: '', recipientStudentNumber: '', recipientName: '', description: 'Synthetic box', storageLocation: 'A1', physicalReference: 'CLOSEOUT-BOX', source: 'MANUAL', labelReviewed: true, idempotencyKey: 'original-intake-key' } },
  { operation: 'reconcileParcel', createdAt: '', request: { parcelId: 'par_closeout', orderId: 'ord_closeout', expectedRevision: 1, identifierReviewed: true, recipientVerified: true, conflictsResolved: true, reason: 'Synthetic evidence reviewed explicitly.', idempotencyKey: 'original-reconciliation-key' } },
];
function fixture() {
  let time = Date.parse('2026-10-28T00:00:00Z'); const values = new Map<string, string>();
  const storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); } };
  const login = vi.fn(async ({ accountId }: { accountId: string }) => ({ token: 'not-persisted', expiresAt: '2099-01-01T00:00:00Z', profile: { id: accountId, name: 'Synthetic', email: 'synthetic@example.invalid', role: 'STAFF' } }));
  const methods = Object.fromEntries(requests.map(r => [r.operation, vi.fn().mockRejectedValueOnce(new ServiceError('NETWORK', 'lost outcome')).mockResolvedValue({ id: 'record_existing' })]));
  const raw = { ...methods, login, resetDemo: vi.fn().mockResolvedValue({ ok: true }) } as unknown as MailroomService;
  const make = () => durableWrites(raw, storage, 'http://closeout/v1', () => time);
  const signIn = async (client: ReturnType<typeof make>, accountId = 'usr_original') => { await client.api.login({ accountId, passcode: 'synthetic-passphrase' }); };
  const invoke = (client: ReturnType<typeof make>, record: PendingWrite) => (client.api[record.operation] as (input: unknown) => Promise<unknown>)(record.request);
  return { values, storage, raw, methods, make, signIn, invoke, advance: (ms: number) => { time += ms; }, now: () => time };
}
it.each(requests)('$operation retries inside 24 hours retain the exact original key across reload', async original => {
  const f = fixture(), client = f.make(); await f.signIn(client);
  await expect(f.invoke(client, original)).rejects.toMatchObject({ code: 'NETWORK' }); const saved = (await client.list('usr_original'))[0];
  f.advance(ORDINARY_REPLAY_MS - 1); const reload = f.make(); await f.signIn(reload);
  expect(await reload.protection(saved)).toBe('RECOVERABLE'); await reload.retry('usr_original', saved);
  expect(f.methods[original.operation]).toHaveBeenCalledTimes(2); expect(f.methods[original.operation]).toHaveBeenLastCalledWith(original.request);
});
it.each(requests)('$operation stops at the 24-hour boundary, retains the original, and requires explicit new-operation review', async original => {
  const f = fixture(), client = f.make(); await f.signIn(client); await expect(f.invoke(client, original)).rejects.toMatchObject({ code: 'NETWORK' });
  f.advance(ORDINARY_REPLAY_MS); const reload = f.make(); await f.signIn(reload); const saved = (await reload.list('usr_original'))[0];
  expect(await reload.protection(saved)).toBe('EXPIRED');
  await expect(reload.retry('usr_original', saved)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  await expect(f.invoke(reload, original)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  const fresh = { ...original, request: { ...original.request, idempotencyKey: 'explicit-new-operation-key' } };
  await expect(f.invoke(reload, fresh)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(f.methods[original.operation]).toHaveBeenCalledTimes(1); expect((await reload.list('usr_original'))[0]).toEqual(saved);
  await expect(reload.reviewForNewOperation('usr_other', saved)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await reload.reviewForNewOperation('usr_original', saved); await f.invoke(reload, fresh);
  const archived = (await reload.list('usr_original'))[0]; expect(archived.request).toEqual(original.request); expect(archived.createdAt).toBe(saved.createdAt); expect(archived.reviewedAt).toBeDefined();
  await expect(reload.retry('usr_original', archived)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' }); await expect(f.invoke(reload, original)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(f.methods[original.operation]).toHaveBeenCalledTimes(2);
});
it('does not cross the deadline while saving a retry and fails closed on invalid/future timestamps', async () => {
  const f = fixture(), client = f.make(); await f.signIn(client); await expect(f.invoke(client, requests[0])).rejects.toMatchObject({ code: 'NETWORK' });
  const saved = (await client.list('usr_original'))[0];
  expect(await client.protection({ ...saved, createdAt: 'invalid' })).toBe('EXPIRED'); expect(await client.protection({ ...saved, createdAt: new Date(f.now() + 1).toISOString() })).toBe('EXPIRED');
  f.advance(ORDINARY_REPLAY_MS - 1);
  const delayedStorage = { ...f.storage, setItem: async (key: string, value: string) => { await f.storage.setItem(key, value); f.advance(1); } };
  const delayed = durableWrites(f.raw, delayedStorage, 'http://closeout/v1', f.now); await f.signIn(delayed);
  await expect(delayed.retry('usr_original', saved)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' }); expect(f.methods.createOrder).toHaveBeenCalledTimes(1);
});
it.each([false, true])('development reset fences every locally saved account, including lost reset response: %s', async lostResponse => {
  const f = fixture(), first = f.make(); await f.signIn(first); await expect(f.invoke(first, requests[0])).rejects.toMatchObject({ code: 'NETWORK' });
  const second = f.make(); await f.signIn(second, 'usr_second'); await expect(f.invoke(second, requests[1])).rejects.toMatchObject({ code: 'NETWORK' });
  const resetter = f.make(); await f.signIn(resetter, 'usr_staff');
  if (lostResponse) vi.mocked(f.raw.resetDemo).mockRejectedValueOnce(new ServiceError('NETWORK', 'reset response lost'));
  if (lostResponse) await expect(resetter.api.resetDemo({})).rejects.toMatchObject({ code: 'NETWORK' }); else await resetter.api.resetDemo({});
  for (const [account, operation] of [['usr_original', 'createOrder'], ['usr_second', 'intakeParcel']] as const) {
    const reload = f.make(); await f.signIn(reload, account); const original = (await reload.list(account))[0]; expect(await reload.protection(original)).toBe('RESET');
    await expect(reload.retry(account, original)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' }); expect(f.methods[operation]).toHaveBeenCalledTimes(1); expect(original.reviewedAt).toBeUndefined();
  }
});
