'use client';

import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { translate } from '@/lib/i18n';
import { getPrefs, usePrefs } from '@/lib/session';
import { SwButton } from './button';
import { cn } from './cn';
import { Ic, Icon } from './icons';

/* ================================================================ sheets */

interface SheetEntry {
  id: number;
  title?: string;
  expand?: boolean;
  wide?: boolean;
  render: (close: (v?: unknown) => void) => ReactNode;
  resolve: (v: unknown) => void;
  closing?: boolean;
}
let sheets: SheetEntry[] = [];
let seq = 0;
const sheetSubs = new Set<() => void>();
const emitSheets = () => sheetSubs.forEach((f) => f());

/**
 * Opens a sheet and resolves with the value passed to `close` (undefined when dismissed). On phones it's the app's
 * bottom sheet (drag handle, 86/92 % max height); from tablet width up, a centred dialog.
 */
export function openSheet<T = unknown>(render: (close: (v?: T) => void) => ReactNode, opts: { title?: string; expand?: boolean; wide?: boolean } = {}): Promise<T | undefined> {
  return new Promise((resolve) => {
    const id = ++seq;
    sheets = [...sheets, { id, ...opts, render: render as SheetEntry['render'], resolve: resolve as (v: unknown) => void }];
    emitSheets();
  });
}

function closeSheet(id: number, value?: unknown) {
  const s = sheets.find((x) => x.id === id);
  if (!s || s.closing) return;
  sheets = sheets.map((x) => (x.id === id ? { ...x, closing: true } : x));
  emitSheets();
  setTimeout(() => {
    sheets = sheets.filter((x) => x.id !== id);
    emitSheets();
    s.resolve(value);
  }, 210);
}

export function closeAllSheets() {
  sheets.forEach((s) => closeSheet(s.id));
}

function SheetView({ s, top }: { s: SheetEntry; top: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  const close = (v?: unknown) => closeSheet(s.id, v);

  useEffect(() => {
    if (!top) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    const prevFocus = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => {
      const el = panel.current?.querySelector<HTMLElement>('[autofocus],input,textarea,button:not([data-handle])');
      if (el && el.tagName !== 'BUTTON') el.focus();
      else panel.current?.focus();
    }, 60);
    return () => {
      window.removeEventListener('keydown', onKey);
      clearTimeout(t);
      prevFocus?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [top]);

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center md:items-center md:p-6" role="presentation">
      <div className="sw-sheet-backdrop absolute inset-0 bg-overlay" data-closing={s.closing} onClick={() => close()} aria-hidden />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={s.title}
        tabIndex={-1}
        data-closing={s.closing}
        className={cn(
          'sw-sheet relative flex w-full flex-col overflow-hidden bg-surface outline-none',
          'rounded-t-lg md:rounded-lg md:shadow-[0_30px_80px_rgba(0,0,0,.22)]',
          s.wide ? 'md:max-w-[720px]' : s.expand ? 'md:max-w-[560px]' : 'md:max-w-[480px]',
        )}
        style={{ maxHeight: s.expand ? '92dvh' : '86dvh', transform: drag ? `translateY(${drag}px)` : undefined, transition: start.current == null ? 'transform 200ms var(--sw-ease-atelier)' : undefined }}
      >
        <div
          data-handle
          className="flex shrink-0 cursor-grab touch-none justify-center pt-3 md:hidden"
          onPointerDown={(e) => {
            start.current = e.clientY;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => start.current != null && setDrag(Math.max(0, e.clientY - start.current))}
          onPointerUp={() => {
            const d = drag;
            start.current = null;
            setDrag(0);
            if (d > 90) close();
          }}
        >
          <span className="h-1 w-9 rounded-sm bg-hairline" />
        </div>
        {s.title ? (
          <div className="flex shrink-0 items-start gap-2 px-5 pb-2 pt-5 md:pt-6">
            <h2 className="t-display-s flex-1 text-ink">{s.title}</h2>
            <button type="button" aria-label="Close" onClick={() => close()} className="-mr-2 -mt-1 hidden size-10 items-center justify-center rounded-full hover:bg-[color-mix(in_srgb,var(--sw-ink)_6%,transparent)] md:flex">
              <Icon icon={Ic.x} size={20} />
            </button>
          </div>
        ) : (
          <div className="h-2 md:h-4" />
        )}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]">{s.render(close)}</div>
      </div>
    </div>
  );
}

export function SheetHost() {
  const list = useSyncExternalStore(
    (f) => {
      sheetSubs.add(f);
      return () => void sheetSubs.delete(f);
    },
    () => sheets,
    () => sheets,
  );
  useEffect(() => {
    if (!list.length) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [list.length]);
  if (typeof document === 'undefined' || !list.length) return null;
  return createPortal(
    <>
      {list.map((s, i) => (
        <SheetView key={s.id} s={s} top={i === list.length - 1} />
      ))}
    </>,
    document.body,
  );
}

/** Confirm in the app's style (sheet with primary / ghost); resolves true when confirmed. */
export async function confirmSw(o: { title: string; body?: string; confirm: string; cancel?: string; danger?: boolean }): Promise<boolean> {
  const t = (k: string) => translate(getPrefs().locale, k);
  const r = await openSheet<boolean>(
    (close) => (
      <div className="flex flex-col gap-2 px-5 pb-5">
        {o.body && <p className="t-body-m mb-3 text-muted">{o.body}</p>}
        <SwButton label={o.confirm} large expand variant={o.danger ? 'danger' : 'primary'} onPress={() => close(true)} />
        <SwButton label={o.cancel ?? t('common.cancel')} large expand variant="ghost" onPress={() => close(false)} />
      </div>
    ),
    { title: o.title },
  );
  return r === true;
}

/** A list of choices (language, theme, sort) with a check on the selected one. */
export function ChoiceList({ options, selected, onSelect }: { options: [string, string][]; selected: string; onSelect: (k: string) => void }) {
  return (
    <div className="px-5 pb-6">
      {options.map(([k, label]) => (
        <button key={k} type="button" onClick={() => onSelect(k)} className="flex h-[52px] w-full items-center text-left">
          <span className="t-body-m flex-1 text-ink">{label}</span>
          {k === selected && <Icon icon={Ic.check} size={18} />}
        </button>
      ))}
    </div>
  );
}

/* ================================================================ toasts */

interface ToastEntry {
  id: number;
  message: string;
  icon: LucideIcon;
  error: boolean;
  action?: { label: string; onPress: () => void };
  closing?: boolean;
}
let toasts: ToastEntry[] = [];
const toastSubs = new Set<() => void>();
const emitToasts = () => toastSubs.forEach((f) => f());

/** Floating ink toast; with an action (Undo) it stays a little longer. One at a time, like the app's SnackBar. */
export function toast(message: string, o: { icon?: LucideIcon; error?: boolean; action?: { label: string; onPress: () => void } } = {}) {
  const id = ++seq;
  toasts.forEach((x) => dismissToast(x.id));
  toasts = [...toasts, { id, message, icon: o.icon ?? Ic.check, error: !!o.error, action: o.action }];
  emitToasts();
  setTimeout(() => dismissToast(id), o.action ? 4000 : 2400);
}
function dismissToast(id: number) {
  if (!toasts.some((x) => x.id === id && !x.closing)) return;
  toasts = toasts.map((x) => (x.id === id ? { ...x, closing: true } : x));
  emitToasts();
  setTimeout(() => {
    toasts = toasts.filter((x) => x.id !== id);
    emitToasts();
  }, 200);
}

export function ToastHost() {
  const list = useSyncExternalStore(
    (f) => {
      toastSubs.add(f);
      return () => void toastSubs.delete(f);
    },
    () => toasts,
    () => toasts,
  );
  usePrefs();
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 z-[90] flex flex-col items-center gap-2 px-5 bottom-[calc(96px+env(safe-area-inset-bottom))] md:bottom-8">
      {list.map((x) => (
        <div key={x.id} data-closing={x.closing} className="sw-toast pointer-events-auto flex w-full max-w-[440px] items-center gap-3 rounded-md bg-ink px-4 py-3.5 shadow-[0_12px_32px_rgba(0,0,0,.18)]">
          <Icon icon={x.error ? Ic.circleAlert : x.icon} size={18} style={{ color: x.error ? 'var(--sw-danger-soft)' : 'var(--sw-accent)' }} />
          <p className="t-body-s flex-1 text-on-ink">{x.message}</p>
          {x.action && (
            <button
              type="button"
              className="t-title-s -my-2 px-2 py-2 text-accent"
              onClick={() => {
                x.action!.onPress();
                dismissToast(x.id);
              }}
            >
              {x.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
