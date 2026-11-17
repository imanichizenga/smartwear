'use client';

import { useId } from 'react';
import { A_GEOMETRY as G, LOADER_NEEDLE_RADIUS, LOADER_SIZES, LOADER_STITCH_STROKE, LOADER_STROKE, type LoaderSize } from '@smartwear/brand';
import { cn } from './cn';

/**
 * The Atelier A — strokes draw base → apex with a champagne sheen, the crossbar is sewn as a dashed stitch led by
 * a needle dot, a sparkle twinkles at the apex, then the mark breathes and fades. Same geometry and 1600 ms loop
 * as the app's ALoader (packages/brand). Colour follows `currentColor`.
 */
export function ALoader({ size = 'md', backdrop = false, label, className, color }: { size?: LoaderSize; backdrop?: boolean; label?: string; className?: string; color?: string }) {
  const id = useId().replace(/[:«»]/g, '');
  const px = LOADER_SIZES[size];
  const sw = LOADER_STROKE[size];
  return (
    <span
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('sw-loader', backdrop && 'rounded-full bg-scrim p-2 backdrop-blur-md', className)}
      style={{ width: backdrop ? undefined : px, height: backdrop ? undefined : px, color: color ?? 'var(--sw-ink)' }}
    >
      <svg width={px} height={px} viewBox="0 0 100 100" focusable="false">
        <defs>
          <mask id={`st-${id}`} maskUnits="userSpaceOnUse">
            <rect className="stitch-reveal" x={G.crossbar.x1 - 4} y={G.crossbar.y - 8} width={G.crossbarLength + 8} height={16} fill="#fff" />
          </mask>
        </defs>
        <g className="breathe">
          <g className="fade">
            <path className="leg" d={G.leftLegPath} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" fill="none" />
            <path className="leg" d={G.rightLegPath} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" fill="none" />
            {size !== 'xs' && size !== 'sm' && (
              <>
                <path className="sheen" d={G.leftLegPath} stroke="var(--sw-accent)" strokeWidth={sw * 0.55} strokeLinecap="round" fill="none" />
                <path className="sheen" d={G.rightLegPath} stroke="var(--sw-accent)" strokeWidth={sw * 0.55} strokeLinecap="round" fill="none" />
              </>
            )}
            <path d={G.crossbarPath} mask={`url(#st-${id})`} stroke="currentColor" strokeWidth={LOADER_STITCH_STROKE[size]} strokeLinecap="round" strokeDasharray={G.stitchDash.join(' ')} fill="none" />
            <circle className="needle" cx={G.crossbar.x1} cy={G.crossbar.y} r={LOADER_NEEDLE_RADIUS[size]} fill="var(--sw-accent)" />
          </g>
          <path className="sparkle" d={G.sparklePath} fill="var(--sw-accent)" />
        </g>
      </svg>
    </span>
  );
}

export function ALoaderBlock({ message, size = 'lg', className }: { message?: string; size?: LoaderSize; className?: string }) {
  return (
    <div className={cn('flex flex-col items-center justify-center gap-4 py-16 text-center', className)} role="status" aria-live="polite">
      <ALoader size={size} />
      {message && <p className="t-caption text-muted">{message}</p>}
    </div>
  );
}
