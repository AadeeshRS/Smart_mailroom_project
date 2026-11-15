import { afterEach, expect, it, vi } from 'vitest';
import { FALLBACK_INTERVAL_MS, notifyChanged, setRealtimeConnected, watchResource } from '../src/refresh';

const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach(stop => stop());
  setRealtimeConnected(false);
  vi.useRealTimers();
});

it('polls visible resources, pauses in the background, refreshes on resume and cleans up', async () => {
  vi.useFakeTimers();
  let active = true;
  const load = vi.fn(async () => 'latest');
  const receive = vi.fn();
  const live = watchResource(load, receive, vi.fn(), vi.fn(), () => active);
  stops.push(live.stop);
  await vi.advanceTimersByTimeAsync(FALLBACK_INTERVAL_MS);
  expect(load).toHaveBeenCalledTimes(2);
  active = false;
  await vi.advanceTimersByTimeAsync(FALLBACK_INTERVAL_MS * 2);
  expect(load).toHaveBeenCalledTimes(2);
  active = true;
  live.refresh();
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(3);
  live.stop();
  notifyChanged();
  await vi.advanceTimersByTimeAsync(3000);
  expect(load).toHaveBeenCalledTimes(3);
});

it('serializes slow reads and drops a stale response when a local write invalidates it', async () => {
  vi.useFakeTimers();
  let resolve!: (value: string) => void;
  const load = vi.fn(
    () =>
      new Promise<string>(done => {
        resolve = done;
      }),
  );
  const receive = vi.fn();
  const live = watchResource(load, receive, vi.fn(), vi.fn(), () => true);
  stops.push(live.stop);
  await vi.advanceTimersByTimeAsync(5000);
  expect(load).toHaveBeenCalledTimes(1);
  notifyChanged();
  resolve('stale');
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).not.toHaveBeenCalled();
  expect(load).toHaveBeenCalledTimes(2);
  resolve('fresh');
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).toHaveBeenCalledWith('fresh');
});

it('recovers from offline errors and never applies results after leaving the screen', async () => {
  vi.useFakeTimers();
  const failure = new Error('offline');
  const load = vi.fn<() => Promise<string>>().mockRejectedValueOnce(failure).mockResolvedValue('reconnected');
  const receive = vi.fn();
  const failed = vi.fn();
  const live = watchResource(load, receive, failed, vi.fn(), () => true);
  stops.push(live.stop);
  await vi.advanceTimersByTimeAsync(0);
  expect(failed).toHaveBeenCalledWith(failure);
  await vi.advanceTimersByTimeAsync(FALLBACK_INTERVAL_MS);
  expect(receive).toHaveBeenCalledWith('reconnected');
  let resolve!: (value: string) => void;
  load.mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done;
      }),
  );
  live.refresh();
  live.stop();
  resolve('old account');
  await vi.advanceTimersByTimeAsync(0);
  expect(receive).not.toHaveBeenCalledWith('old account');
});

it('does not poll a healthy WebSocket; changed events and reconnection refresh immediately', async () => {
  vi.useFakeTimers();
  setRealtimeConnected(true);
  const load = vi.fn(async () => 'latest');
  const live = watchResource(load, vi.fn(), vi.fn(), vi.fn(), () => true);
  stops.push(live.stop);
  await vi.advanceTimersByTimeAsync(FALLBACK_INTERVAL_MS * 4);
  expect(load).toHaveBeenCalledTimes(1);
  notifyChanged();
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(2);
  setRealtimeConnected(false);
  await vi.advanceTimersByTimeAsync(FALLBACK_INTERVAL_MS);
  expect(load).toHaveBeenCalledTimes(3);
  setRealtimeConnected(true);
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(4);
});
