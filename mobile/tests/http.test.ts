import { expect, it, vi } from 'vitest';
import { createHttpService, normalizeBaseUrl } from '../src/api/http';
import { ServiceError, errorText } from '../src/api/service';
import { watchResource } from '../src/refresh';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

it('invalidates visible data after successful writes, without invalidating after reads or failed writes', async () => {
  const load = vi.fn(async () => 'current');
  const live = watchResource(load, vi.fn(), vi.fn(), vi.fn(), () => true);
  const fetcher = vi.fn<typeof fetch>(async () => json({ ok: true }));
  const { api } = createHttpService('http://localhost/v1', fetcher);
  try {
    await Promise.resolve();
    await api.listHostels({});
    expect(load).toHaveBeenCalledTimes(1);
    await api.markNotificationsRead({});
    expect(load).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValueOnce(json({ error: { code: 'FORBIDDEN', message: 'Denied' } }, 403));
    await expect(api.markNotificationsRead({})).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(load).toHaveBeenCalledTimes(2);
  } finally {
    live.stop();
  }
});

it('maps generated paths, query, JSON bodies and the bearer token', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => json({ ok: true }));
  const { api, setToken } = createHttpService('http://localhost:3000/v1/', fetcher);
  await api.login({ email: 'a@college.example', password: 'secret-password' });
  expect(fetcher.mock.calls[0][0]).toBe('http://localhost:3000/v1/auth/login');
  expect(fetcher.mock.calls[0][1]).toMatchObject({
    method: 'POST',
    body: '{"email":"a@college.example","password":"secret-password"}',
  });
  expect(fetcher.mock.calls[0][1]?.headers).not.toHaveProperty('Authorization');

  setToken('token-1');
  await api.listUsers({ q: 'asha rao', role: 'MEMBER', limit: 20 });
  const url = new URL(String(fetcher.mock.calls[1][0]));
  expect(url.pathname).toBe('/v1/admin/users');
  expect(Object.fromEntries(url.searchParams)).toEqual({ q: 'asha rao', role: 'MEMBER', limit: '20' });
  expect(fetcher.mock.calls[1][1]?.headers).toHaveProperty('Authorization', 'Bearer token-1');

  await api.updateUser({ userId: 'usr/1', active: false });
  expect(fetcher.mock.calls[2][0]).toBe('http://localhost:3000/v1/admin/users/usr%2F1');
  expect(fetcher.mock.calls[2][1]).toMatchObject({ method: 'PATCH', body: '{"active":false}' });

  setToken(undefined);
  await api.listHostels({});
  expect(fetcher.mock.calls[3][1]?.headers).not.toHaveProperty('Authorization');
});

it('keeps the server error code, message and request ID', async () => {
  const error = { code: 'EMAIL_NOT_VERIFIED', message: 'Verify first.', requestId: 'req_1', retryable: false };
  const { api } = createHttpService(
    'http://localhost/v1',
    vi.fn<typeof fetch>().mockResolvedValue(json({ error }, 403)),
  );
  await expect(api.login({ email: 'a@college.example', password: 'x' })).rejects.toMatchObject({
    code: 'EMAIL_NOT_VERIFIED',
    message: 'Verify first.',
    envelope: { error: { requestId: 'req_1' } },
  });
});

it('turns failures, timeouts and unreadable answers into a retryable NETWORK error', async () => {
  const offline = createHttpService(
    'http://localhost/v1',
    vi.fn<typeof fetch>().mockRejectedValue(new Error('offline')),
  );
  await expect(offline.api.getMe({})).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
  const garbage = createHttpService('http://localhost/v1', vi.fn<typeof fetch>().mockResolvedValue(json('nope', 502)));
  await expect(garbage.api.getMe({})).rejects.toMatchObject({ code: 'NETWORK' });
  const slow = createHttpService(
    'http://localhost/v1',
    vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    ),
    5,
  );
  await expect(slow.api.getMe({})).rejects.toMatchObject({ code: 'NETWORK' });
});

it('only accepts a plain HTTP(S) base URL', () => {
  expect(normalizeBaseUrl('https://api.example.org/v1/')).toBe('https://api.example.org/v1');
  for (const bad of ['ftp://x/v1', 'https://user:pw@x/v1', 'https://x/v1?debug=1', 'not a url'])
    expect(() => normalizeBaseUrl(bad)).toThrow();
});

it('error text: the server message with its request ID as a reference; errors made in the app have none', () => {
  expect(errorText(new ServiceError('VALIDATION', 'Name is required.', false, 'req_1'))).toBe(
    'Name is required.\nReference: req_1',
  );
  expect(errorText(new ServiceError('NETWORK', 'Couldn’t reach the server.', true))).toBe('Couldn’t reach the server.');
  expect(errorText(new Error('boom'))).toBe('Something went wrong. Please try again.');
});
