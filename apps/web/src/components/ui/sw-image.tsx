'use client';

import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import type { Json } from '@/lib/json';
import { mediaPending, sourcesOf, srcSet, thumbhashUrl } from '@/lib/media';
import { cn } from './cn';

const noop = () => () => undefined;
/** True after hydration: blur placeholders are decoded in the browser, not shipped inside the HTML. */
const useHydrated = () => useSyncExternalStore(noop, () => true, () => false);

/** Neutral, branded stand-in for media that is genuinely missing — never a "broken image" icon. */
export function MediaFallback({ dark = false, className }: { dark?: boolean; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn('flex h-full w-full items-center justify-center', className)}
      style={{ background: dark ? 'linear-gradient(135deg,#232120,#1C1A18)' : 'linear-gradient(135deg, color-mix(in srgb, var(--sw-hairline) 45%, var(--sw-surface)), var(--sw-hairline))' }}
    >
      <span className="t-title-s" style={{ letterSpacing: '0.3em', color: dark ? 'rgba(255,255,255,.14)' : 'color-mix(in srgb, var(--sw-ink) 14%, transparent)', fontWeight: 700 }}>
        SW
      </span>
    </div>
  );
}

export interface SwImageProps {
  media: Json | null | undefined;
  /** width / height; null fills the parent. Product imagery is 4:5. */
  aspect?: number | null;
  /** Tailwind rounding class; product images use rounded-xs. */
  rounded?: string;
  fit?: 'cover' | 'contain';
  alt?: string;
  dark?: boolean;
  /** `sizes` attribute for the srcset (CSS px the image is drawn at). */
  sizes?: string;
  priority?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * A pipeline image: ThumbHash blur-up immediately (on the dominant colour), then the right-sized AVIF/WebP rendition
 * fades in. Videos show their poster. Processing media shows the shimmer; missing or failed media a branded surface.
 */
export function SwImage({ media: m, aspect = 4 / 5, rounded = 'rounded-xs', fit = 'cover', alt, dark = false, sizes = '50vw', priority = false, className, style }: SwImageProps) {
  const hydrated = useHydrated();
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const box: CSSProperties = aspect ? { aspectRatio: String(aspect), ...style } : { width: '100%', height: '100%', ...style };
  const wrap = cn('relative block overflow-hidden', rounded, !aspect && 'h-full w-full', className);
  if (!m) return <span className={wrap} style={box}><MediaFallback dark={dark} /></span>;

  const isVideo = m.type === 'VIDEO';
  const webp = isVideo ? [] : sourcesOf(m, 'webp');
  const jpeg = isVideo ? [] : sourcesOf(m, 'jpeg');
  const fallback = isVideo ? (typeof m.posterUrl === 'string' ? m.posterUrl : null) : (jpeg.find((s) => s.width >= 768) ?? jpeg[jpeg.length - 1])?.url ?? (typeof m.url === 'string' ? m.url : null);
  const blur = hydrated ? thumbhashUrl(typeof m.thumbhash === 'string' ? m.thumbhash : null) : null;
  const bg = typeof m.dominantColor === 'string' && m.dominantColor.length === 7 ? m.dominantColor : dark ? '#1C1A18' : 'var(--sw-hairline)';
  const fx = typeof m.focalX === 'number' ? m.focalX : 0.5;
  const fy = typeof m.focalY === 'number' ? m.focalY : 0.5;

  if (!fallback || failed) {
    if (!failed && mediaPending(m)) return <span className={cn(wrap, 'sw-skeleton')} data-dark={dark} style={box} />;
    return (
      <span className={wrap} style={box}>
        {blur ? <img src={blur} alt="" aria-hidden className="h-full w-full object-cover" /> : <MediaFallback dark={dark} />}
      </span>
    );
  }
  return (
    <span className={wrap} style={{ ...box, background: bg }}>
      {blur && <img src={blur} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover" />}
      {!blur && !loaded && hydrated && <span className="sw-skeleton absolute inset-0" data-dark={dark} />}
      <picture>
        {webp.length > 0 && <source type="image/webp" srcSet={srcSet(webp)} sizes={sizes} />}
        <img
          src={fallback}
          alt={alt ?? (typeof m.alt === 'string' ? m.alt : '')}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : undefined}
          draggable={false}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full transition-opacity duration-[240ms] ease-[var(--sw-ease-atelier)]"
          style={{ objectFit: fit, objectPosition: `${fx * 100}% ${fy * 100}%`, opacity: loaded ? 1 : 0 }}
          ref={(el) => {
            if (el?.complete && el.naturalWidth > 0 && !loaded) setLoaded(true);
          }}
        />
      </picture>
    </span>
  );
}
