/** WebSocket events and local writes invalidate focused resources; polling is only a recovery fallback. */
const listeners = new Set<() => void>();
export const FALLBACK_INTERVAL_MS = 15_000;
let connected = false;
export function setRealtimeConnected(value: boolean) {
  connected = value;
  if (value) notifyChanged(); // includes a reconnect: recover anything missed while disconnected
}
export function notifyChanged() {
  listeners.forEach(refresh => refresh());
}

/** Serialize reads and discard a response invalidated by a write while it was in flight. */
export function watchResource<T>(
  loader: () => Promise<T>,
  receive: (value: T) => void,
  failed: (reason: unknown) => void,
  settled: () => void,
  isActive: () => boolean,
) {
  let stopped = false;
  let running = false;
  let revision = 0;
  let retryNeeded = false;
  async function read() {
    if (stopped || running || !isActive()) return;
    running = true;
    const started = revision;
    try {
      const value = await loader();
      retryNeeded = false;
      if (!stopped && started === revision) receive(value);
    } catch (reason) {
      retryNeeded = true;
      if (!stopped && started === revision) failed(reason);
    } finally {
      running = false;
      if (!stopped) {
        settled();
        if (started !== revision) void read();
      }
    }
  }
  const refresh = () => {
    revision++;
    void read();
  };
  listeners.add(refresh);
  const timer = setInterval(() => {
    if (!connected || retryNeeded) void read();
  }, FALLBACK_INTERVAL_MS);
  void read();
  return {
    refresh,
    stop: () => {
      stopped = true;
      listeners.delete(refresh);
      clearInterval(timer);
    },
  };
}
