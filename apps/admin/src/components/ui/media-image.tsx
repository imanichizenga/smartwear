'use client';

import { useMemo, useState } from 'react';
import { thumbHashToDataURL } from 'thumbhash';
import { ImageOff } from 'lucide-react';
import type { MediaOut } from '@/lib/types';
import { cn } from '@/lib/cn';

function thumbUrl(hash: string | null): string | undefined {
  if (!hash) return undefined;
  try {
    const bin = atob(hash);
    return thumbHashToDataURL(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  } catch {
    return undefined;
  }
}

const srcset = (list?: { width: number; url: string }[]) => list?.map((s) => `${s.url} ${s.width}w`).join(', ');

/**
 * Renders a pipeline image: AVIF → WebP → JPEG `srcset`s with the ThumbHash blur-up underneath.
 * (next/image's loader can't address per-variant signed S3/CDN URLs, so we emit <picture> directly — see DECISIONS.md.)
 * Product imagery is 4:5 with a 0–4px radius; the image itself is never overlaid with text.
 */
export function MediaImage({ media, sizes = '160px', ratio = '4 / 5', className, priority, rounded = 'sm' }: {
  media: MediaOut | null | undefined;
  sizes?: string;
  ratio?: string;
  className?: string;
  priority?: boolean;
  rounded?: 'none' | 'xs' | 'sm';
}) {
  const [loaded, setLoaded] = useState(false);
  const blur = useMemo(() => thumbUrl(media?.thumbhash ?? null), [media?.thumbhash]);
  const radius = rounded === 'none' ? '' : rounded === 'xs' ? 'rounded-xs' : 'rounded-sm';
  if (!media || media.type !== 'IMAGE' || (!media.url && !media.sources)) {
    return (
      <div className={cn('flex items-center justify-center bg-hairline text-subtle', radius, className)} style={{ aspectRatio: ratio }}>
        {media?.status === 'PROCESSING' || media?.status === 'UPLOADED' ? <span className="sw-skeleton size-full" /> : <ImageOff className="size-5" strokeWidth={1.5} />}
      </div>
    );
  }
  const s = media.sources ?? {};
  return (
    <div
      className={cn('relative overflow-hidden bg-hairline', radius, className)}
      style={{ aspectRatio: ratio, backgroundColor: media.dominantColor ?? undefined, backgroundImage: blur ? `url(${blur})` : undefined, backgroundSize: 'cover' }}
    >
      <picture>
        {s.avif && <source type="image/avif" srcSet={srcset(s.avif)} sizes={sizes} />}
        {s.webp && <source type="image/webp" srcSet={srcset(s.webp)} sizes={sizes} />}
        <img
          src={media.url}
          srcSet={srcset(s.jpeg)}
          sizes={sizes}
          alt={media.alt ?? ''}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          fetchPriority={priority ? 'high' : undefined}
          onLoad={() => setLoaded(true)}
          className={cn('absolute inset-0 size-full object-cover transition-opacity duration-300', loaded ? 'opacity-100' : 'opacity-0')}
          style={{ objectPosition: `${media.focalX * 100}% ${media.focalY * 100}%` }}
        />
      </picture>
    </div>
  );
}
