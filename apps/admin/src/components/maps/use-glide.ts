'use client';

import { useEffect, useRef, useState } from 'react';
import { lerpAngle, type LatLng } from '@/lib/geo';

/**
 * Riders report every 3–5s; drawing the raw points makes them jump. This eases the displayed
 * position (and heading, the short way round) to each new fix over `ms`, so the dot glides.
 * Reduce Motion → snaps.
 */
export function useGlide(target: LatLng, heading: number | null | undefined, ms = 1200): { pos: LatLng; heading: number | null } {
  const [state, setState] = useState({ pos: target, heading: heading ?? null });
  const from = useRef(state);
  const cur = useRef(state);

  useEffect(() => {
    const reduce = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const to = { pos: target, heading: heading ?? cur.current.heading };
    if (reduce || (cur.current.pos.lat === target.lat && cur.current.pos.lng === target.lng && cur.current.heading === to.heading)) {
      const t = setTimeout(() => {
        cur.current = to;
        setState(to);
      }, 0);
      return () => clearTimeout(t);
    }
    from.current = cur.current;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const e = 1 - (1 - k) ** 3; // ease-out cubic: arrives softly
      const f = from.current;
      const next = {
        pos: { lat: f.pos.lat + (to.pos.lat - f.pos.lat) * e, lng: f.pos.lng + (to.pos.lng - f.pos.lng) * e },
        heading: f.heading != null && to.heading != null ? lerpAngle(f.heading, to.heading, e) : to.heading,
      };
      cur.current = next;
      setState(next);
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target.lat, target.lng, heading, ms]); // eslint-disable-line react-hooks/exhaustive-deps

  return state;
}
