'use client';

import { refreshIfExpiring, refreshSession } from './api';
import type { Json } from './json';
import { tokens } from './tokens';

export type RtEvent = Json;
type Fn<T> = (v: T) => void;

/**
 * One WebSocket per tab to Django Channels (`/realtime/?token=<access>`), same protocol as the app: rooms
 * `user.<id>` / `rider.<id>` are joined by the server, screens subscribe to `order.<id>`, `thread.<id>`…
 * Reconnects with backoff, re-subscribes, pings every 25 s, and handles 4401 (expired token → refresh) and
 * 4403 (revoked → a refresh asks the server, which signs the tab out if it's final).
 */
class Realtime {
  private ws: WebSocket | null = null;
  private rooms = new Map<string, number>();
  private events = new Set<Fn<RtEvent>>();
  private conn = new Set<Fn<boolean>>();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private ping: ReturnType<typeof setInterval> | null = null;
  private attempt = 0;
  private connecting = false;
  up = false;

  onEvent(f: Fn<RtEvent>) {
    this.events.add(f);
    return () => void this.events.delete(f);
  }
  onConnected(f: Fn<boolean>) {
    this.conn.add(f);
    return () => void this.conn.delete(f);
  }

  ensure() {
    if (typeof window === 'undefined' || this.ws || this.connecting || !tokens.signedIn) return;
    this.connecting = true;
    refreshIfExpiring()
      .then((r) => {
        this.connecting = false;
        if (this.ws) return;
        if (r === 'signedOut' || !tokens.access) return;
        if (r === 'offline') return this.scheduleRetry();
        this.open();
      })
      .catch(() => {
        this.connecting = false;
        this.scheduleRetry();
      });
  }

  private open() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    let ws: WebSocket;
    try {
      ws = new WebSocket(`${proto}://${window.location.host}/realtime/?token=${encodeURIComponent(tokens.access ?? '')}`);
    } catch {
      return this.scheduleRetry();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setUp(true);
      for (const r of this.rooms.keys()) this.send({ type: 'subscribe', channel: r });
      if (this.ping) clearInterval(this.ping);
      this.ping = setInterval(() => this.send({ type: 'ping' }), 25_000);
    };
    ws.onmessage = (m) => {
      try {
        const e = JSON.parse(String(m.data)) as RtEvent;
        if (e.type !== 'pong' && e.type !== 'subscribed' && e.type !== 'hello') this.events.forEach((f) => f(e));
      } catch {
        /* ignore */
      }
    };
    ws.onclose = (ev) => this.closed(ws, ev.code);
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private closed(ws: WebSocket, code: number) {
    if (this.ws !== ws) return;
    this.ws = null;
    if (this.ping) clearInterval(this.ping);
    this.setUp(false);
    if (!tokens.signedIn) return;
    if (code === 4401 || code === 4403) {
      refreshSession().then((r) => {
        if (r === 'ok') {
          this.attempt = 0;
          this.ensure();
        } else if (r === 'offline') this.scheduleRetry();
      });
      return;
    }
    this.scheduleRetry();
  }

  private scheduleRetry() {
    if (this.retry) clearTimeout(this.retry);
    this.attempt = Math.min(this.attempt + 1, 6);
    this.retry = setTimeout(() => this.ensure(), 600 * 2 ** this.attempt);
  }

  /** Subscribe to a room; returns an unsubscribe (ref-counted across screens). */
  subscribe(room: string) {
    this.rooms.set(room, (this.rooms.get(room) ?? 0) + 1);
    this.ensure();
    if (this.up) this.send({ type: 'subscribe', channel: room });
    return () => {
      const n = (this.rooms.get(room) ?? 1) - 1;
      if (n <= 0) {
        this.rooms.delete(room);
        if (this.up) this.send({ type: 'unsubscribe', channel: room });
      } else this.rooms.set(room, n);
    };
  }

  /** Fire-and-forget client event (`chat.typing`, `rider.location`); false when the socket is down. */
  emit(m: Json) {
    if (!this.up) return false;
    this.send(m);
    return true;
  }

  private send(m: Json) {
    try {
      if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
    } catch {
      /* ignore */
    }
  }

  private setUp(v: boolean) {
    if (this.up === v) return;
    this.up = v;
    this.conn.forEach((f) => f(v));
  }

  /** After sign-out: drop the socket and forget rooms tied to the old account. */
  reset() {
    if (this.retry) clearTimeout(this.retry);
    if (this.ping) clearInterval(this.ping);
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    this.rooms.clear();
    this.attempt = 0;
    this.setUp(false);
  }
}

export const realtime = new Realtime();
