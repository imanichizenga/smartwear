'use client';

import type { Json } from './json';

/**
 * Token + device storage for the browser. localStorage is the single source of truth (every read goes to it), so
 * all tabs always use the newest rotated refresh token — the API treats a rotated-away token presented outside
 * its 2-minute grace window as theft and revokes the session, which a stale in-memory copy in a second tab
 * would otherwise trigger.
 */
const K = { access: 'sw.access', refresh: 'sw.refresh', device: 'sw.device', sid: 'sw.sid', user: 'sw.user' } as const;

function get(k: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(k);
  } catch {
    return null;
  }
}
function set(k: string, v: string) {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* storage full / blocked: the session lives for this tab only */
  }
}
function del(k: string) {
  try {
    window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export const tokens = {
  keys: K,
  get access() {
    return get(K.refresh) ? get(K.access) : null;
  },
  get refresh() {
    return get(K.refresh);
  },
  get sessionId() {
    return get(K.refresh) ? get(K.sid) : null;
  },
  get deviceId() {
    return get(K.device);
  },
  get signedIn() {
    return !!get(K.refresh);
  },
  get cachedUser(): Json | null {
    if (!get(K.refresh)) return null;
    try {
      const u = get(K.user);
      return u ? (JSON.parse(u) as Json) : null;
    } catch {
      return null;
    }
  },
  /** Generated only when signing in (no refresh token exists); never changes under a live session. */
  ensureDeviceId(): string {
    const have = get(K.device);
    if (have) return have;
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    const id = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    set(K.device, id);
    return id;
  },
  /** When the access token expires (JWT `exp`), for proactive refresh. */
  accessExpiresAt(): number | null {
    const t = this.access;
    if (!t) return null;
    try {
      const part = t.split('.')[1];
      if (!part) return null;
      const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
      return typeof json.exp === 'number' ? json.exp * 1000 : null;
    } catch {
      return null;
    }
  },
  /** Refresh first, then access: never an access token without its refresh token. */
  save(access: string, refresh: string, sessionId?: string | null) {
    set(K.refresh, refresh);
    set(K.access, access);
    if (sessionId) set(K.sid, sessionId);
  },
  saveUser(user: Json) {
    if (get(K.refresh)) set(K.user, JSON.stringify(user));
  },
  /** Access first so storage is never "access without refresh". The device id stays. */
  clear() {
    del(K.access);
    del(K.refresh);
    del(K.sid);
    del(K.user);
  },
};
