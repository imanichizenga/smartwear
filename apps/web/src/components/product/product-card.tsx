'use client';

import { useState } from 'react';
import { useT, useWishlist } from '@/lib/hooks';
import { int, list, obj, str, type Json } from '@/lib/json';
import { useAppNav } from '@/lib/nav';
import { usePrefs } from '@/lib/session';
import { cn } from '../ui/cn';
import { categoryIcon, Icon } from '../ui/icons';
import { HeartIcon, ParticleBurst, PriceTag, Skeleton, SwatchDots, SwChip, toneOf } from '../ui/kit';
import { PLink } from '../ui/plink';
import { SwImage } from '../ui/sw-image';

function WishButton({ active, onPress, label }: { active: boolean; onPress: () => void; label: string }) {
  const [burst, setBurst] = useState(0);
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!active) setBurst((n) => n + 1);
        onPress();
      }}
      className="absolute right-0 top-0 z-20 flex size-11 items-center justify-center"
    >
      <span className="relative flex size-8 items-center justify-center rounded-full bg-scrim backdrop-blur-md">
        <ParticleBurst play={burst} />
        <span key={String(active)} className={burst ? 'sw-pop' : undefined}>
          <HeartIcon filled={active} size={17} color="var(--sw-ink)" />
        </span>
      </span>
    </button>
  );
}

/** The product card: 4:5 photo, quiet chrome, serif price, swatch dots, wishlist heart. */
export function ProductCard({ product: p, width, sizes = '(min-width:1280px) 20vw, (min-width:1024px) 25vw, (min-width:640px) 33vw, 50vw', priority }: { product: Json; width?: number; sizes?: string; priority?: boolean }) {
  const t = useT();
  const { locale } = usePrefs();
  const wish = useWishlist().data;
  const nav = useAppNav();
  const id = str(p, 'id');
  const badges = list(p, 'badges');
  const badge = badges[0];
  const soldOut = p.inStock === false;
  const slug = str(p, 'slug');
  return (
    <div className="relative min-w-0" style={width ? { width } : undefined}>
      <PLink href={`/p/${encodeURIComponent(slug)}`} onNavigate={() => nav.openProduct(p)} label={str(p, 'title')} className="group">
        <span className="relative block">
          <SwImage media={obj(p, 'cover')} sizes={width ? `${width}px` : sizes} alt={str(p, 'title')} priority={priority} className="transition-transform duration-500 ease-[var(--sw-ease-atelier)] md:group-hover:scale-[1.015]" />
          {obj(p, 'hover') && (
            <span className="pointer-events-none absolute inset-0 hidden opacity-0 transition-opacity duration-300 md:block md:group-hover:opacity-100">
              <SwImage media={obj(p, 'hover')} sizes={width ? `${width}px` : sizes} alt="" />
            </span>
          )}
          {soldOut && <SwChip label={t('product.outOfStock')} className="absolute bottom-2 left-2" />}
        </span>
        <span className="flex h-[136px] flex-col pt-3">
          <span className="t-label-s truncate text-muted">{str(obj(p, 'brand'), 'name')}</span>
          <span className="t-body-s mt-1 line-clamp-2 text-ink">{str(p, 'title')}</span>
          <span className="mt-2">
            <PriceTag price={obj(p, 'price')} range={obj(p, 'priceRange')} size="s" />
          </span>
          <span className="mt-2 flex items-center gap-2">
            <span className="min-w-0 flex-1">
              <SwatchDots swatches={list(p, 'swatches')} more={int(p, 'moreSwatches')} />
            </span>
            {badge && <SwChip label={(locale === 'sw' && str(badge, 'labelSw')) || str(badge, 'label')} tone={toneOf(str(badge, 'tone'))} />}
          </span>
        </span>
      </PLink>
      <WishButton active={wish?.has(id) ?? false} onPress={() => void nav.toggleWishlist(id)} label={t('wishlist.add')} />
    </div>
  );
}

/** Horizontal rail of cards (156 px on phones, wider on large screens). */
export function ProductRail({ items, cardWidth = 156, className }: { items: Json[]; cardWidth?: number; className?: string }) {
  return (
    <div className={cn('sw-rail gap-4 px-5 md:px-0', className)}>
      {items.map((p) => (
        <div key={str(p, 'id')} className="w-[var(--cw)] md:w-[calc(var(--cw)*1.25)] xl:w-[calc(var(--cw)*1.4)]" style={{ ['--cw' as string]: `${cardWidth}px` }}>
          <ProductCard product={p} sizes={`${Math.round(cardWidth * 1.4)}px`} />
        </div>
      ))}
    </div>
  );
}

/** 2 columns on phones, 3 on tablets, 4–5 on desktop. */
export const gridCols = 'grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 md:gap-x-6 md:gap-y-10';

export function ProductGrid({ items, className }: { items: Json[]; className?: string }) {
  return (
    <div className={cn(gridCols, className)}>
      {items.map((p, i) => (
        <ProductCard key={str(p, 'id')} product={p} priority={i < 4} />
      ))}
    </div>
  );
}

export function CardSkeleton() {
  return (
    <div>
      <Skeleton aspect={4 / 5} />
      <div className="mt-3 flex flex-col gap-2">
        <Skeleton w={60} h={10} />
        <Skeleton w={120} h={12} />
        <Skeleton w={70} h={14} />
      </div>
    </div>
  );
}

export function GridSkeleton({ count = 10, className }: { count?: number; className?: string }) {
  return (
    <div className={cn(gridCols, className)} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={cn(i >= 4 && 'hidden sm:block', i >= 6 && 'sm:hidden lg:block', i >= 8 && 'lg:hidden xl:block')}>
          <CardSkeleton />
        </div>
      ))}
    </div>
  );
}

/** Category tile: the category photo when the admin set one, otherwise its thin icon on blush. */
export function CategoryTile({ category: c, size = 96, fluid = false }: { category: Json; size?: number; fluid?: boolean }) {
  const name = str(c, 'name');
  return (
    <PLink href={`/c/${encodeURIComponent(str(c, 'slug'))}?title=${encodeURIComponent(name)}`} label={name} overlay={false} className="flex flex-col items-center" style={fluid ? undefined : { width: size }}>
      <span className="block w-full overflow-hidden rounded-md" style={{ aspectRatio: '1', width: fluid ? '100%' : size }}>
        {obj(c, 'image') ? (
          <SwImage media={obj(c, 'image')} aspect={1} rounded="rounded-md" sizes={`${size * 2}px`} />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-blush text-ink">
            <Icon icon={categoryIcon(str(c, 'icon'))} size={28} />
          </span>
        )}
      </span>
      <span className="t-caption mt-2 w-full truncate text-center font-semibold text-ink">{name}</span>
    </PLink>
  );
}
