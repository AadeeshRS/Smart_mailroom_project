import { expect, it, vi } from 'vitest';
import { createHttpService, normalizeBaseUrl } from '../src/api/http';
import { durableWrites } from '../src/api/writeRecovery';
import { ConfirmationRecoveryStore } from '../src/confirmationRecovery';
import { ServiceError, type MailroomService } from '../src/api/service';
const session = { token: 'synthetic-bearer', expiresAt: '2099-01-01T00:00:00.000Z', profile: { id: 'usr_server', name: 'Synthetic', role: 'STUDENT', email: 'test@example.invalid' } };
it('HTTP maps generated paths, bodies, query and bearer headers without fallback', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(session))).mockResolvedValueOnce(new Response(JSON.stringify({ items: [] }))).mockResolvedValueOnce(new Response('{}'));
  const api = createHttpService('http://localhost:3000/v1/', fetcher);
  await api.login({ accountId: 'usr_server', passcode: 'synthetic-passphrase' }); await api.listParcels({ limit: 20, status: 'CLOSED', q: 'box one' });
  const url = new URL(String(fetcher.mock.calls[1][0])); expect(url.pathname).toBe('/v1/parcels'); expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '20', status: 'CLOSED', q: 'box one' });
  expect(fetcher.mock.calls[1][1]?.headers).toHaveProperty('Authorization', 'Bearer synthetic-bearer');
  await api.confirmHandover({ parcelId: 'par_one', verificationId: 'ver_one', physicalHandoverConfirmed: true, idempotencyKey: 'same-original-key' });
  expect(fetcher.mock.calls[2][0]).toBe('http://localhost:3000/v1/parcels/par_one/handover'); expect(fetcher.mock.calls[2][1]?.body).toBe('{"verificationId":"ver_one","physicalHandoverConfirmed":true,"idempotencyKey":"same-original-key"}');
});
it('HTTP preserves typed server errors/request IDs and clears bearer on expiry', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(session))).mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'SESSION_EXPIRED', message: 'Expired', requestId: 'req_server', retryable: false } }), { status: 401 })).mockResolvedValueOnce(new Response('{}'));
  const api = createHttpService('http://localhost/v1', fetcher); await api.login({ accountId: 'usr_server', passcode: 'synthetic-passphrase' });
  await expect(api.getSession({})).rejects.toMatchObject({ code: 'SESSION_EXPIRED', envelope: { error: { requestId: 'req_server' } } });
  await api.getSession({}); expect(fetcher.mock.calls[2][1]?.headers).not.toHaveProperty('Authorization');
});
it('HTTP rejects failures/timeouts as uncertain NETWORK without returning mock data', async () => {
  const api = createHttpService('http://localhost/v1', vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')));
  await expect(api.listOrders({})).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
  const timeout = createHttpService('http://localhost/v1', (_url, init) => new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('timeout')))), 1);
  await expect(timeout.listOrders({})).rejects.toMatchObject({ code: 'NETWORK' });
  expect(() => normalizeBaseUrl('https://user:password@example.invalid/v1')).toThrow();
});
it('ordinary uncertain writes retain exact requests across reload and block automatic new keys', async () => {
  const values = new Map<string, string>(), storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); } };
  const raw = { login: vi.fn().mockResolvedValue(session), createOrder: vi.fn().mockRejectedValueOnce(new ServiceError('NETWORK', 'response lost')).mockResolvedValue({ id: 'ord_original' }) } as unknown as MailroomService;
  const original = { platform: 'AMAZON' as const, merchantOrderId: 'AMZ-ONE', tracking: [], idempotencyKey: 'original-write-key' };
  const first = durableWrites(raw, storage, 'http://first/v1'); await first.api.login({ accountId: 'usr_server', passcode: 'synthetic-passphrase' }); await expect(first.api.createOrder(original)).rejects.toMatchObject({ code: 'NETWORK' });
  const next = durableWrites(raw, storage, 'http://first/v1'); await next.api.login({ accountId: 'usr_server', passcode: 'synthetic-passphrase' });
  await expect(next.api.createOrder({ ...original, idempotencyKey: 'silently-new-key' })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(await durableWrites(raw, storage, 'http://second/v1').list('usr_server')).toEqual([]);
  const saved = (await next.list('usr_server'))[0]; await expect(next.retry('usr_other', saved)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  expect(await next.retry('usr_server', saved)).toEqual({ id: 'ord_original' }); expect(raw.createOrder).toHaveBeenLastCalledWith(original); expect(await next.list('usr_server')).toEqual([]);
  expect(JSON.stringify([...values.values()])).not.toContain(session.token);
});
it('handover recovery storage is separated by API environment and staff identity', async () => {
  const values = new Map<string, string>(), storage = { getItem: async (key: string) => values.get(key) ?? null, setItem: async (key: string, value: string) => { values.set(key, value); } };
  const first = new ConfirmationRecoveryStore(storage, 'http:first'), other = new ConfirmationRecoveryStore(storage, 'http:second');
  await first.save({ staffId: 'usr_staff', createdAt: '2026-10-28T00:00:00Z', phase: 'UNCERTAIN', request: { parcelId: 'par_one', verificationId: 'ver_one', physicalHandoverConfirmed: true, idempotencyKey: 'original-key' } });
  expect(await other.list('usr_staff')).toEqual([]); expect(await first.list('usr_other')).toEqual([]); expect(await first.list('usr_staff')).toHaveLength(1);
});
