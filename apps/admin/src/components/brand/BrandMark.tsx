import { A_GEOMETRY as G } from '@smartwear/brand';

/** Static Atelier A (logo use). Ink follows currentColor; the sparkle is always champagne. */
export function BrandMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" className={className} aria-hidden>
      <path d={G.leftLegPath} stroke="currentColor" strokeWidth={7} strokeLinecap="round" fill="none" />
      <path d={G.rightLegPath} stroke="currentColor" strokeWidth={7} strokeLinecap="round" fill="none" />
      <path d={G.crossbarPath} stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeDasharray="4.2 3.6" fill="none" />
      <path d={G.sparklePath} style={{ fill: 'var(--sw-accent)' }} />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={`text-[13px] font-semibold tracking-[0.28em] ${className ?? ''}`}>SMARTWEAR</span>;
}
