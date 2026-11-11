'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';

/** Count of links currently navigating — every AppLink reports into it, the top bar reads it. */
let count = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
export const navProgress = {
  start: () => {
    count += 1;
    emit();
  },
  done: () => {
    count = Math.max(0, count - 1);
    emit();
  },
};

export function useReportPending(pending: boolean) {
  useEffect(() => {
    if (!pending) return;
    navProgress.start();
    return navProgress.done;
  }, [pending]);
}

export function RouteProgress() {
  const active = useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => count > 0,
    () => false,
  );
  const reduce = useReducedMotion();
  return (
    <AnimatePresence>
      {active && (
        <motion.div
          key="bar"
          className="sw-progress"
          initial={{ scaleX: 0, opacity: 1 }}
          animate={{ scaleX: reduce ? 1 : [0, 0.4, 0.7, 0.88], transition: { duration: reduce ? 0 : 4, times: [0, 0.1, 0.4, 1], ease: 'easeOut' } }}
          exit={{ scaleX: 1, opacity: 0, transition: { duration: 0.25 } }}
        />
      )}
    </AnimatePresence>
  );
}
