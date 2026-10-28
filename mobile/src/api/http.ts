import { routes } from './routes.generated';
import { ServiceError, type Input, type MailroomService, type Output } from './service';
type Operation = keyof typeof routes;
export function normalizeBaseUrl(raw: string) {
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Configure an HTTP(S) API URL without credentials, query or fragment.');
  return url.href.replace(/\/+$/, '');
}
export function createHttpService(base: string, fetcher: typeof fetch = fetch, timeoutMs = 15_000): MailroomService {
  const baseUrl = normalizeBaseUrl(base); let bearer: string | undefined;
  async function request<K extends Operation>(operation: K, input: Input<K>): Promise<Output<K>> {
    const route = routes[operation], fields = { ...input } as Record<string, unknown>;
    const path = route.path.replace(/\{(\w+)\}/g, (_match, name: string) => { const value = fields[name]; delete fields[name]; return encodeURIComponent(String(value)); });
    const query = new URLSearchParams();
    for (const key of route.query) { if (fields[key] !== undefined) query.set(key, String(fields[key])); delete fields[key]; }
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetcher(baseUrl + path + (query.size ? '?' + query.toString() : ''), { method: route.method, headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(route.body ? { 'Content-Type': 'application/json' } : {}) }, ...(route.body ? { body: JSON.stringify(fields) } : {}), signal: controller.signal, cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) {
        const error = result?.error;
        if (error && typeof error.code === 'string' && typeof error.message === 'string' && typeof error.retryable === 'boolean') {
          if (['SESSION_EXPIRED', 'UNAUTHENTICATED'].includes(error.code)) bearer = undefined;
          throw new ServiceError(error.code, error.message, error.retryable, error.requestId);
        }
        throw new ServiceError('NETWORK', 'Server response could not be understood. Preserve the original request and retry key.', true);
      }
      if (operation === 'login') bearer = result.token;
      if (operation === 'logout' || operation === 'resetDemo') bearer = undefined;
      return result as Output<K>;
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      throw new ServiceError('NETWORK', 'The API request failed or timed out. Its outcome may be uncertain; retry the original request and key.', true);
    } finally { clearTimeout(timer); }
  }
  return Object.fromEntries((Object.keys(routes) as Operation[]).map(operation => [operation, (input: Input<typeof operation>) => request(operation, input)])) as unknown as MailroomService;
}
