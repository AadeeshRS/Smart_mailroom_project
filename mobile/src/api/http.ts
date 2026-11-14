import { routes } from './routes.generated';
import { ServiceError, type Input, type MailroomService, type Output } from './service';

type Operation = keyof typeof routes;

export function normalizeBaseUrl(raw: string) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
    throw new Error('Configure an HTTP(S) API URL without credentials, query or fragment.');
  return url.href.replace(/\/+$/, '');
}

/** A typed client for every contract operation. The caller owns the session token (setToken). */
export function createHttpService(base: string, fetcher: typeof fetch = fetch, timeoutMs = 15_000) {
  const baseUrl = normalizeBaseUrl(base);
  let bearer: string | undefined;
  async function request<K extends Operation>(operation: K, input: Input<K>): Promise<Output<K>> {
    const route = routes[operation],
      fields = { ...input } as Record<string, unknown>;
    const path = route.path.replace(/\{(\w+)\}/g, (_match, name: string) => {
      const value = fields[name];
      delete fields[name];
      return encodeURIComponent(String(value));
    });
    const query = new URLSearchParams();
    for (const key of route.query) {
      if (fields[key] !== undefined) query.set(key, String(fields[key]));
      delete fields[key];
    }
    const controller = new AbortController(),
      timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(baseUrl + path + (query.size ? '?' + query.toString() : ''), {
        method: route.method,
        headers: {
          ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
          ...(route.body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(route.body ? { body: JSON.stringify(fields) } : {}),
        signal: controller.signal,
        cache: 'no-store',
      });
      const result = await response.json();
      if (response.ok) return result as Output<K>;
      const error = result?.error;
      if (error && typeof error.code === 'string' && typeof error.message === 'string')
        throw new ServiceError(error.code, error.message, !!error.retryable, error.requestId);
      throw new ServiceError('NETWORK', "The server's answer couldn't be read. Try again.", true);
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('NETWORK', "Couldn't reach the server. Check your connection and try again.", true);
    } finally {
      clearTimeout(timer);
    }
  }
  const api = Object.fromEntries(
    (Object.keys(routes) as Operation[]).map(operation => [
      operation,
      (input: Input<typeof operation>) => request(operation, input),
    ]),
  ) as unknown as MailroomService;
  return {
    api,
    setToken: (token: string | undefined) => {
      bearer = token;
    },
  };
}
