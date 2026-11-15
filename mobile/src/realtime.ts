import type { Schema } from './api/service';
import { notifyChanged, setRealtimeConnected } from './refresh';

export type LiveSocket = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: ((event: { code: number }) => void) | null;
  onerror: (() => void) | null;
  send: (data: string) => void;
  close: () => void;
};

export function realtimeUrl(base: string) {
  const url = new URL(base.replace(/\/+$/, '') + '/realtime');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.href;
}

/** One socket per signed-in foreground session. No credentials in URLs, persistent queues or logs. */
export function startRealtime(
  base: string,
  token: string,
  unauthorized: () => void,
  factory: (url: string) => LiveSocket = url => new WebSocket(url) as unknown as LiveSocket,
) {
  let stopped = false;
  let active = false;
  let socket: LiveSocket | undefined;
  let attempts = 0;
  let lastMessage = 0;
  let retry: ReturnType<typeof setTimeout> | undefined;
  function disconnect() {
    if (retry) clearTimeout(retry);
    retry = undefined;
    const old = socket;
    socket = undefined;
    if (old) {
      old.onopen = old.onmessage = old.onclose = old.onerror = null;
      try {
        old.close();
      } catch {
        /* A native socket may already be gone after a network change. */
      }
    }
    setRealtimeConnected(false);
  }
  function schedule() {
    disconnect();
    if (stopped || !active) return;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5)) * (0.8 + Math.random() * 0.4);
    retry = setTimeout(connect, delay);
  }
  function connect() {
    if (stopped || !active || socket) return;
    retry = undefined;
    try {
      const current = factory(realtimeUrl(base));
      socket = current;
      lastMessage = Date.now();
      current.onopen = () => {
        if (socket !== current) return;
        try {
          current.send(JSON.stringify({ type: 'authenticate', token }));
        } catch {
          schedule();
        }
      };
      let ready = false;
      current.onmessage = event => {
        if (socket !== current || stopped) return;
        try {
          const frame = JSON.parse(String(event.data)) as Schema<'RealtimeServerFrame'>;
          lastMessage = Date.now();
          if (frame.type === 'ready') {
            ready = true;
            attempts = 0;
            setRealtimeConnected(true);
          } else if (ready && frame.type === 'changed') notifyChanged();
          else if (ready && frame.type === 'ping') current.send(JSON.stringify({ type: 'pong' }));
          else schedule();
        } catch {
          schedule();
        }
      };
      current.onclose = event => {
        if (socket !== current) return;
        if (event.code === 4001) {
          stopped = true;
          disconnect();
          unauthorized();
        } else schedule();
      };
      current.onerror = () => {
        if (socket === current) schedule();
      };
    } catch {
      schedule();
    }
  }
  const watchdog = setInterval(() => {
    if (socket && Date.now() - lastMessage > 45_000) schedule();
  }, 5000);
  return {
    setActive: (value: boolean) => {
      active = value;
      if (!active) disconnect();
      else connect();
    },
    reconnect: () => {
      if (active && !socket) {
        if (retry) clearTimeout(retry);
        retry = undefined;
        connect();
      }
    },
    stop: () => {
      stopped = true;
      clearInterval(watchdog);
      disconnect();
    },
  };
}
