'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const MIN_PENDING_MS = 300;

/**
 * Runs an async action with a pending flag that stays on for at least 300ms (no flicker) and
 * ignores re-entry while pending (no double submits).
 */
export function usePendingAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>) {
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const run = useCallback(
    async (...args: A): Promise<R | undefined> => {
      if (busy.current) return undefined;
      busy.current = true;
      setPending(true);
      const started = performance.now();
      try {
        return await fn(...args);
      } finally {
        const left = MIN_PENDING_MS - (performance.now() - started);
        if (left > 0) await new Promise((r) => setTimeout(r, left));
        busy.current = false;
        setPending(false);
      }
    },
    [fn],
  );
  return [run, pending] as const;
}

/**
 * True while `active`, and for at least `min` ms after it first turned on — so a fast navigation
 * never flickers the loader. State only changes in timer callbacks (no synchronous setState in effects).
 */
export function useMinimumPending(active: boolean, min = MIN_PENDING_MS): boolean {
  const [lingering, setLingering] = useState(false);
  const since = useRef(0);
  useEffect(() => {
    if (active) {
      since.current = performance.now();
      const t = setTimeout(() => setLingering(true), 0);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setLingering(false), Math.max(0, min - (performance.now() - since.current)));
    return () => clearTimeout(t);
  }, [active, min]);
  return active || lingering;
}
