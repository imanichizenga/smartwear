'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from './cn';

/**
 * One-time-code field: responsive boxes, blinking caret, paste of a whole message ("Code: 123 456" keeps the
 * digits), browser SMS autofill (`autocomplete=one-time-code`), error shake and success state. `onComplete` fires
 * once per distinct complete code, never while disabled.
 */
export function OtpInput({ value, onChange, onComplete, length = 6, error = false, success = false, enabled = true }: { value: string; onChange: (v: string) => void; onComplete: (v: string) => void; length?: number; error?: boolean; success?: boolean; enabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const fired = useRef<string | null>(null);
  const [shake, setShake] = useState(0);
  const prevErr = useRef(error);

  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);
  useEffect(() => {
    if (error && !prevErr.current) setShake((n) => n + 1);
    if (error) fired.current = null; // the same digits may be submitted again after a failure
    prevErr.current = error;
  }, [error]);
  useEffect(() => {
    if (value.length < length) {
      fired.current = null;
      return;
    }
    if (!enabled || fired.current === value) return;
    fired.current = value;
    onComplete(value);
  }, [value, length, enabled, onComplete]);

  const set = (raw: string) => onChange(raw.replace(/\D/g, '').slice(0, length));

  return (
    <div className="relative w-full" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => set(e.target.value)}
        onPaste={(e) => {
          e.preventDefault();
          set(e.clipboardData.getData('text'));
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        readOnly={!enabled}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        aria-label={`Verification code, ${value.length} of ${length} digits entered`}
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0"
        style={{ caretColor: 'transparent' }}
      />
      <div key={shake} className={cn('flex justify-center gap-2', shake > 0 && 'sw-shake')} aria-hidden>
        {Array.from({ length }, (_, i) => {
          const d = value[i] ?? '';
          const active = i === Math.min(value.length, length - 1) && value.length < length && focused && enabled;
          const color = success ? 'var(--sw-success)' : error ? 'var(--sw-danger)' : active ? 'var(--sw-accent)' : d ? 'var(--sw-ink)' : 'var(--sw-hairline)';
          return (
            <div
              key={i}
              className="flex aspect-[1/1.22] max-h-16 min-h-[52px] w-full min-w-0 max-w-14 items-center justify-center rounded-sm transition-[border-color,background-color] duration-150"
              style={{ border: `${active || success || error ? 1.5 : 1}px solid ${color}`, background: success ? 'var(--sw-success-soft)' : 'var(--sw-surface)' }}
            >
              {d ? <span className={cn('t-display-m', error ? 'text-danger' : 'text-ink')}>{d}</span> : active ? <span className="sw-caret block h-[42%] w-[1.5px] bg-accent" /> : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
