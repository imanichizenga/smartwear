'use client';

import { Store } from 'lucide-react';
import { cn } from '@/lib/cn';

export type MarkerKind = 'client' | 'rider' | 'store';
export type RiderState = 'idle' | 'assigned' | 'en_route' | 'offline';

const RIDER_RING: Record<RiderState, string> = {
  idle: 'var(--sw-success)',
  assigned: 'var(--sw-accent)',
  en_route: 'var(--sw-map-rider)',
  offline: 'var(--sw-subtle)',
};

/**
 * The three map pins of the brand: client = black dot (pulsing halo), rider = blue dot with a heading
 * arrow and a status ring, store/office = blue dot with a store glyph. Same visuals on every map.
 */
export function MarkerDot({ kind, heading, state = 'idle', selected, label, dimmed, dropTarget }: { kind: MarkerKind; heading?: number | null; state?: RiderState; selected?: boolean; label?: string; dimmed?: boolean; dropTarget?: boolean }) {
  return (
    <span className={cn('sw-pin relative flex flex-col items-center transition-opacity duration-300', dimmed && 'opacity-40')} data-kind={kind}>
      <span className="relative flex items-center justify-center">
        {kind === 'client' && <span className="sw-halo absolute size-9 rounded-full bg-map-client/25" aria-hidden />}
        {kind === 'rider' && (
          <>
            {heading != null && (
              <span className="absolute inset-0 flex items-start justify-center transition-transform duration-700 ease-atelier" style={{ transform: `rotate(${heading}deg)` }} aria-hidden>
                <svg width="12" height="9" viewBox="0 0 12 9" className="-translate-y-[11px]">
                  <path d="M6 0 L12 9 L6 6.5 L0 9 Z" fill="var(--sw-map-rider)" />
                </svg>
              </span>
            )}
            <span className="absolute size-[26px] rounded-full" style={{ boxShadow: `0 0 0 2px ${RIDER_RING[state]}` }} aria-hidden />
          </>
        )}
        {(selected || dropTarget) && <span className={cn('absolute rounded-full border-2 border-ink', kind === 'store' ? 'size-10' : 'size-9', dropTarget && 'sw-halo border-accent')} aria-hidden />}
        <span
          className={cn(
            'relative flex items-center justify-center rounded-full border-[3px] border-map-ring shadow-[0_2px_8px_rgba(0,0,0,0.28)]',
            kind === 'client' && 'size-[18px] bg-map-client',
            kind === 'rider' && 'size-5 bg-map-rider',
            kind === 'store' && 'size-7 bg-map-office text-white',
          )}
        >
          {kind === 'store' && <Store className="size-3.5" strokeWidth={2} />}
        </span>
      </span>
      {label && (
        <span className={cn('pointer-events-none absolute whitespace-nowrap rounded-xs bg-surface/95 px-1.5 py-0.5 text-[11px] font-semibold text-ink shadow-[0_1px_4px_rgba(0,0,0,0.15)] backdrop-blur', kind === 'store' ? 'bottom-full mb-1.5' : 'top-full mt-1.5')}>
          {label}
        </span>
      )}
    </span>
  );
}

export function MapLegend({ className }: { className?: string }) {
  return (
    <div className={cn('flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-sm bg-surface/92 px-3 py-2 text-[11px] font-semibold text-muted shadow-floating backdrop-blur-md', className)}>
      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-map-ring bg-map-client shadow" /> Client</span>
      <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-full border-2 border-map-ring bg-map-rider shadow" /> Rider</span>
      <span className="flex items-center gap-1.5"><span className="flex size-3.5 items-center justify-center rounded-full bg-map-office"><Store className="size-2 text-white" strokeWidth={2.5} /></span> Store</span>
      <span className="hidden items-center gap-2 sm:flex">
        <span className="size-2 rounded-full" style={{ boxShadow: `0 0 0 2px ${RIDER_RING.idle}` }} /> Idle
        <span className="size-2 rounded-full" style={{ boxShadow: `0 0 0 2px ${RIDER_RING.assigned}` }} /> Assigned
        <span className="size-2 rounded-full" style={{ boxShadow: `0 0 0 2px ${RIDER_RING.en_route}` }} /> En route
      </span>
    </div>
  );
}
