'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Production: same origin (the reverse proxy routes /realtime/ to the API). `next dev` can't proxy
 * WebSocket upgrades, so in development the socket goes straight to the API port — cookies on a
 * host are shared across ports, so the admin session still authenticates.
 */
function realtimeUrl(proto: string) {
  if (process.env.NEXT_PUBLIC_REALTIME_URL) return process.env.NEXT_PUBLIC_REALTIME_URL;
  if (process.env.NODE_ENV === 'development') return `${proto}://${window.location.hostname}:4000/realtime/`;
  return `${proto}://${window.location.host}/realtime/`;
}

export type RealtimeEvent = { type: string; [k: string]: unknown };
type Status = 'connecting' | 'live' | 'polling';

/**
 * Subscribes to Django Channels rooms (`dispatch`, `order.<id>`) over /realtime/ (same origin → the
 * httpOnly admin cookie authenticates). If the socket can't stay up, `onPoll` runs every `pollMs`
 * so the screen keeps moving — the status tells the UI which mode it is in.
 */
export function useRealtime(channels: string[], onEvent: (e: RealtimeEvent) => void, { onPoll, pollMs = 5000 }: { onPoll?: () => void; pollMs?: number } = {}) {
  const [status, setStatus] = useState<Status>('connecting');
  const handler = useRef(onEvent);
  const poll = useRef(onPoll);
  useEffect(() => {
    handler.current = onEvent;
    poll.current = onPoll;
  });
  const key = channels.join('|');

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let pingTimer: ReturnType<typeof setInterval> | undefined;
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    const rooms = key ? key.split('|') : [];

    const startPolling = () => {
      setStatus('polling');
      if (!pollTimer && poll.current) pollTimer = setInterval(() => poll.current?.(), pollMs);
    };
    const stopPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = undefined;
    };
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (closed) return;
      // Keep the screen fresh while the socket is (re)connecting.
      if (!pollTimer && poll.current) pollTimer = setInterval(() => poll.current?.(), pollMs);
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      try {
        ws = new WebSocket(realtimeUrl(proto));
      } catch {
        startPolling();
        return;
      }
      // A proxy that swallows the upgrade never opens or closes the socket — give up after 6s and poll.
      openTimer = setTimeout(() => ws && ws.readyState !== WebSocket.OPEN && ws.close(), 6000);
      ws.onopen = () => {
        if (openTimer) clearTimeout(openTimer);
        retry = 0;
        stopPolling();
        setStatus('live');
        rooms.forEach((channel) => ws?.send(JSON.stringify({ type: 'subscribe', channel })));
        pingTimer = setInterval(() => ws?.readyState === WebSocket.OPEN && ws.send('{"type":"ping"}'), 25_000);
      };
      ws.onmessage = (m) => {
        try {
          const e = JSON.parse(m.data as string) as RealtimeEvent;
          if (e.type !== 'pong' && e.type !== 'hello' && e.type !== 'subscribed') handler.current(e);
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        if (openTimer) clearTimeout(openTimer);
        if (pingTimer) clearInterval(pingTimer);
        if (closed) return;
        startPolling();
        retry = Math.min(retry + 1, 6);
        retryTimer = setTimeout(connect, 1000 * 2 ** retry);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      closed = true;
      if (openTimer) clearTimeout(openTimer);
      if (retryTimer) clearTimeout(retryTimer);
      if (pingTimer) clearInterval(pingTimer);
      stopPolling();
      ws?.close();
    };
  }, [key, pollMs]);

  return status;
}
