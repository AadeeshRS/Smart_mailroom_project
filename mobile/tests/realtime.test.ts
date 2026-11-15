import { afterEach, expect, it, vi } from 'vitest';
import { realtimeUrl, startRealtime, type LiveSocket } from '../src/realtime';
import { setRealtimeConnected, watchResource } from '../src/refresh';

class FakeSocket implements LiveSocket {
  onopen: LiveSocket['onopen'] = null;
  onmessage: LiveSocket['onmessage'] = null;
  onclose: LiveSocket['onclose'] = null;
  onerror: LiveSocket['onerror'] = null;
  send = vi.fn();
  close = vi.fn();
  receive(type: string) {
    this.onmessage?.({ data: JSON.stringify({ type }) });
  }
}
const stops: (() => void)[] = [];
afterEach(() => {
  stops.splice(0).forEach(stop => stop());
  setRealtimeConnected(false);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it('uses ws/wss with no credentials in the connection URL', () => {
  expect(realtimeUrl('http://localhost:3000/v1/')).toBe('ws://localhost:3000/v1/realtime');
  expect(realtimeUrl('https://mailroom.example/v1')).toBe('wss://mailroom.example/v1/realtime');
});

it('survives a native connection disappearing during authentication and cleanup', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const first = new FakeSocket();
  first.send.mockImplementation(() => {
    throw new Error('native socket disconnected');
  });
  first.close.mockImplementation(() => {
    throw new Error('already gone');
  });
  const factory = vi.fn().mockReturnValueOnce(first).mockReturnValue(new FakeSocket());
  const live = startRealtime('http://localhost/v1', 'token', vi.fn(), factory);
  stops.push(live.stop);
  live.setActive(true);
  expect(() => first.onopen?.()).not.toThrow();
  await vi.advanceTimersByTimeAsync(1000);
  expect(factory).toHaveBeenCalledTimes(2);
});

it('authenticates once, refreshes on pushes, and recovers missed events after reconnect', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const sockets: FakeSocket[] = [];
  const live = startRealtime('http://localhost/v1', 'secret', vi.fn(), () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  stops.push(live.stop);
  const load = vi.fn(async () => 'current');
  const resource = watchResource(load, vi.fn(), vi.fn(), vi.fn(), () => true);
  stops.push(resource.stop);
  live.setActive(true);
  sockets[0].onopen?.();
  expect(sockets[0].send).toHaveBeenCalledWith(JSON.stringify({ type: 'authenticate', token: 'secret' }));
  sockets[0].receive('ready');
  await vi.advanceTimersByTimeAsync(0);
  const reads = load.mock.calls.length;
  await vi.advanceTimersByTimeAsync(3000);
  expect(load).toHaveBeenCalledTimes(reads);
  sockets[0].receive('changed');
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(reads + 1);
  sockets[0].receive('ping');
  expect(sockets[0].send).toHaveBeenLastCalledWith('{"type":"pong"}');
  sockets[0].onclose?.({ code: 1006 });
  await vi.advanceTimersByTimeAsync(1000);
  expect(sockets).toHaveLength(2);
  sockets[1].onopen?.();
  sockets[1].receive('ready');
  await vi.advanceTimersByTimeAsync(0);
  expect(load).toHaveBeenCalledTimes(reads + 2);
  live.setActive(false);
  expect(sockets[1].close).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(sockets).toHaveLength(2);
  live.setActive(true);
  expect(sockets).toHaveLength(3);
});

it('backs off failures, detects a silent connection, and stops after invalid authentication/logout', async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const unauthorized = vi.fn();
  const sockets: FakeSocket[] = [];
  const live = startRealtime('http://localhost/v1', 'token', unauthorized, () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  });
  stops.push(live.stop);
  live.setActive(true);
  sockets[0].onerror?.();
  await vi.advanceTimersByTimeAsync(1000);
  sockets[1].onerror?.();
  await vi.advanceTimersByTimeAsync(1000);
  expect(sockets).toHaveLength(2);
  await vi.advanceTimersByTimeAsync(1000);
  sockets[2].receive('ready');
  await vi.advanceTimersByTimeAsync(50_000);
  expect(sockets[2].close).toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  sockets.at(-1)!.onclose?.({ code: 4001 });
  expect(unauthorized).toHaveBeenCalledTimes(1);
  const count = sockets.length;
  await vi.advanceTimersByTimeAsync(60_000);
  expect(sockets).toHaveLength(count);
  live.stop();
  live.setActive(true);
  expect(sockets).toHaveLength(count);
});
