'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CategoryTile, ProductGrid, ProductRail } from '@/components/product/product-card';
import { AppBar } from '@/components/shell/app-shell';
import { SwButton } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { categoryIcon, Ic, Icon } from '@/components/ui/icons';
import { ChoiceChip, LoadError, Reveal, RollingText, SectionHeader, Skeleton } from '@/components/ui/kit';
import { PLink } from '@/components/ui/plink';
import { openStories } from '@/components/home/stories';
import { SwImage } from '@/components/ui/sw-image';
import { api } from '@/lib/api';
import { useHome, useNow, useReducedMotion, useT, useWishlist } from '@/lib/hooks';
import { flag, int, list, obj, str, strN, type Json } from '@/lib/json';
import { linkHref, useAppNav } from '@/lib/nav';
import { useRouter } from 'next/navigation';

/** Home is whatever the admin's Home Layout builder says, in order. */
export function HomeScreen({ initial }: { initial?: Json | null }) {
  const home = useHome(initial);
  const t = useT();
  return (
    <main className="pb-tabbar min-h-dvh">
      <h1 className="sr-only">{t('brand.name')} — {t('brand.tagline')}</h1>
      <HomeHeader />
      <div className="sw-container">
        {home.isPending ? (
          <HomeSkeleton />
        ) : home.isError && !home.data ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <LoadError error={home.error} onRetry={() => void home.refetch()} />
          </div>
        ) : (
          list(home.data, 'sections').map((s, i) => (
            <Reveal key={str(s, 'id') || i} index={Math.min(i, 4)} offset={18}>
              <HomeSection s={s} t={t} />
            </Reveal>
          ))
        )}
      </div>
    </main>
  );
}

function HomeHeader() {
  const t = useT();
  const nav = useAppNav();
  const count = useWishlist().data?.size ?? 0;
  return (
    <div className="md:hidden">
      <AppBar
        title={<span className="t-wordmark block text-center">SmartWear</span>}
        titleClass=""
        onBack={undefined}
        className="!px-1"
        actions={
          <Link href="/notifications" aria-label={t('notifications.title')} className="flex size-11 items-center justify-center">
            <Icon icon={Ic.bell} size={22} />
          </Link>
        }
      />
      <button
        type="button"
        aria-label={count > 0 ? `${t('profile.wishlist')}, ${count}` : t('profile.wishlist')}
        onClick={() => void nav.requireSignIn(() => nav.router.push('/wishlist'))}
        className="fixed left-1 top-[calc(env(safe-area-inset-top))] z-30 flex size-14 items-center justify-center"
      >
        <span className="relative">
          <Icon icon={Ic.heart} size={22} />
          <span className="absolute -right-3 -top-2 flex h-4 min-w-4 items-center justify-center rounded-lg bg-accent px-1 text-[10px] font-bold leading-none text-on-accent transition-transform duration-[240ms]" style={{ transform: count > 0 ? 'scale(1)' : 'scale(0)' }}>
            {count > 99 ? '99+' : count}
          </span>
        </span>
      </button>
    </div>
  );
}

function HomeSection({ s, t }: { s: Json; t: (k: string, v?: Record<string, string | number>) => string }) {
  const title = strN(s, 'title');
  const items = list(s, 'items');
  switch (str(s, 'type')) {
    case 'stories':
      return <Stories items={items} />;
    case 'hero':
      return <Hero items={items} autoAdvance={int(s, 'autoAdvanceMs', 5500)} />;
    case 'banner':
      return items.length ? <Hero items={items.slice(0, 1)} autoAdvance={0} /> : null;
    case 'new_in':
    case 'product_rail':
    case 'recently_viewed': {
      if (!items.length) return null;
      const href = linkHref(obj(s, 'link'), title ?? undefined) ?? `/c/all?title=${encodeURIComponent(title ?? '')}`;
      return (
        <section>
          <SectionHeader title={title ?? t('home.newIn')} subtitle={strN(s, 'subtitle')} viewAllHref={href} />
          <RailWithArrows items={items} />
        </section>
      );
    }
    case 'collections':
      return items.length ? <Collections title={title ?? t('home.collections')} items={items} /> : null;
    case 'drop_countdown':
      return obj(s, 'drop') ? <DropCountdown drop={obj(s, 'drop')!} /> : null;
    case 'category_tiles':
      return items.length ? <CategoryTiles title={title ?? t('home.collections')} items={items} /> : null;
    case 'for_you':
      return items.length ? (
        <section>
          <SectionHeader title={title ?? t('home.forYou')} subtitle={strN(s, 'subtitle')} />
          <div className="px-5 md:px-0">
            <ProductGrid items={items.slice(0, 10)} className="[&>*:nth-child(n+9)]:hidden lg:[&>*:nth-child(n+9)]:block lg:[&>*:nth-child(n+9)]:max-xl:hidden" />
          </div>
        </section>
      ) : null;
    case 'brand_spotlight':
      return obj(s, 'brand') ? <BrandSpotlight brand={obj(s, 'brand')!} items={items} title={title} /> : null;
    case 'beauty_corner':
      return items.length ? <BeautyCorner title={title ?? t('home.beautyCorner')} categories={list(s, 'categories')} items={items} /> : null;
    case 'looks_teaser':
      return items.length ? <LooksTeaser title={title ?? t('looks.shopThisLook')} items={items} /> : null;
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ rails with desktop arrows */

export function RailWithArrows({ items, cardWidth = 156 }: { items: Json[]; cardWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });
  const update = () => {
    const el = ref.current?.firstElementChild as HTMLElement | null;
    if (!el) return;
    setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
  };
  useEffect(() => {
    const el = ref.current?.firstElementChild as HTMLElement | null;
    update();
    el?.addEventListener('scroll', update, { passive: true });
    return () => el?.removeEventListener('scroll', update);
  }, [items.length]);
  const go = (dir: 1 | -1) => {
    const el = ref.current?.firstElementChild as HTMLElement | null;
    el?.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' });
  };
  return (
    <div ref={ref} className="group/rail relative">
      <ProductRail items={items} cardWidth={cardWidth} />
      {(['prev', 'next'] as const).map((k) => {
        const hidden = k === 'prev' ? edge.start : edge.end;
        return (
          <button
            key={k}
            type="button"
            aria-label={k === 'prev' ? 'Previous' : 'Next'}
            onClick={() => go(k === 'prev' ? -1 : 1)}
            className={cn(
              'absolute top-[calc((100%-136px)/2)] z-20 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full border border-hairline bg-surface shadow-[0_8px_24px_rgba(0,0,0,.12)] transition-opacity duration-200 md:flex',
              k === 'prev' ? '-left-5' : '-right-5',
              hidden ? 'pointer-events-none opacity-0' : 'opacity-0 group-hover/rail:opacity-100',
            )}
          >
            <Icon icon={k === 'prev' ? Ic.chevronLeft : Ic.chevronRight} size={20} />
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ stories */

function Stories({ items }: { items: Json[] }) {
  if (!items.length) return null;
  return (
    <div className="sw-rail gap-4 px-5 pt-3 md:px-0 md:pt-6">
      {items.map((st, i) => (
        <button key={str(st, 'id')} type="button" onClick={() => openStories(items, i)} className="press flex w-[68px] flex-col items-center md:w-[84px]" aria-label={str(st, 'title')}>
          <span className="block size-[68px] rounded-full p-[2.5px] md:size-[84px]" style={{ border: `1.5px solid ${flag(st, 'seen') ? 'var(--sw-hairline)' : 'var(--sw-accent)'}` }}>
            <span className="block h-full w-full overflow-hidden rounded-full">
              <SwImage media={obj(st, 'cover')} aspect={1} rounded="rounded-full" sizes="168px" />
            </span>
          </span>
          <span className="t-caption mt-2 w-full truncate text-center text-ink">{str(st, 'title')}</span>
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ hero carousel */

function Hero({ items, autoAdvance }: { items: Json[]; autoAdvance: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [hover, setHover] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const cards = Array.from(el.children) as HTMLElement[];
        const center = el.scrollLeft;
        let best = 0;
        let bestD = Infinity;
        cards.forEach((c, i) => {
          const d = Math.abs(c.offsetLeft - el.offsetLeft - center - (i === 0 ? 0 : 0));
          if (d < bestD) {
            bestD = d;
            best = i;
          }
          if (!reduce) {
            const off = (c.offsetLeft - el.scrollLeft - el.offsetLeft) / Math.max(1, c.clientWidth);
            c.style.setProperty('--px', String(Math.max(-1, Math.min(1, off))));
          }
        });
        setIndex(best);
      });
    };
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [items.length, reduce]);

  useEffect(() => {
    if (!autoAdvance || items.length < 2 || reduce || hover) return;
    const t = setInterval(() => {
      const el = ref.current;
      if (!el || document.hidden) return;
      const next = (index + 1) % items.length;
      const card = el.children[next] as HTMLElement | undefined;
      if (card) el.scrollTo({ left: card.offsetLeft - el.offsetLeft - (next === 0 ? 0 : 0), behavior: 'smooth' });
    }, autoAdvance);
    return () => clearInterval(t);
  }, [autoAdvance, items.length, index, reduce, hover]);

  const go = (i: number) => {
    const el = ref.current;
    const card = el?.children[i] as HTMLElement | undefined;
    if (el && card) el.scrollTo({ left: card.offsetLeft - el.offsetLeft, behavior: 'smooth' });
  };

  return (
    <div className="pt-6 md:pt-8" onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
      <div ref={ref} className="sw-rail gap-3 scroll-px-5 px-5 md:scroll-px-0 md:px-0 [scroll-snap-type:x_mandatory]" style={{ scrollPaddingInline: undefined }}>
        {items.map((b, i) => {
          const href = linkHref(obj(b, 'link'), str(b, 'title')) ?? '#';
          return (
            <div key={str(b, 'id') || i} className={cn('w-[88%] md:w-[72%] lg:w-[64%]', items.length === 1 && '!w-full')}>
              <PLink href={href} label={str(b, 'title')} className="block">
                <HeroCard banner={b} priority={i === 0} />
              </PLink>
            </div>
          );
        })}
      </div>
      {items.length > 1 && (
        <div className="mt-4 flex justify-center">
          {items.map((_, i) => (
            <button key={i} type="button" aria-label={`Slide ${i + 1}`} onClick={() => go(i)} className="flex h-4 items-center px-[3px]">
              <span className="block h-0.5 transition-[width,background-color] duration-[240ms]" style={{ width: i === index ? 18 : 5, background: i === index ? 'var(--sw-ink)' : 'var(--sw-hairline)' }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Editorial banner: the photograph stays clean; the type sits on a soft scrim at the foot. */
function HeroCard({ banner: b, priority }: { banner: Json; priority?: boolean }) {
  return (
    <div data-theme="dark" className="relative aspect-[4/5] overflow-hidden rounded-xs md:aspect-[16/10] lg:aspect-[16/8]">
      <div className="absolute inset-[-6%]" style={{ transform: 'translateX(calc(var(--px, 0) * -36px)) scale(1.06)', transition: 'transform 60ms linear' }}>
        <SwImage media={obj(b, 'media')} aspect={null} rounded="" sizes="(min-width:1024px) 64vw, (min-width:768px) 72vw, 88vw" priority={priority} alt={str(b, 'title')} />
      </div>
      <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(14,14,16,0) 45%, rgba(14,14,16,.72))' }} />
      <div className="absolute inset-x-5 bottom-6 md:inset-x-10 md:bottom-10 lg:max-w-[60%]">
        {strN(b, 'eyebrow') && <p className="t-label text-accent">{str(b, 'eyebrow')}</p>}
        <h2 className="t-display-l mt-2 text-ink md:text-[44px] md:leading-[50px] lg:text-[52px] lg:leading-[58px]">{str(b, 'title')}</h2>
        {strN(b, 'subtitle') && <p className="t-body-s mt-2 md:t-body-m" style={{ color: 'rgba(245,242,236,.82)' }}>{str(b, 'subtitle')}</p>}
        {strN(b, 'ctaLabel') && (
          <p className="t-label mt-4 flex items-center gap-2 text-ink">
            {str(b, 'ctaLabel')}
            <Icon icon={Ic.arrowRight} size={16} />
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ collections */

function Collections({ title, items }: { title: string; items: Json[] }) {
  return (
    <section>
      <SectionHeader title={title} />
      <div className="sw-rail gap-4 px-5 md:gap-6 md:px-0">
        {items.map((c) => (
          <PLink key={str(c, 'id')} href={`/collection/${encodeURIComponent(str(c, 'slug') || str(c, 'id'))}?title=${encodeURIComponent(str(c, 'title'))}`} label={str(c, 'title')} className="w-60 md:w-[300px] lg:w-[340px]">
            <SwImage media={obj(c, 'cover')} sizes="340px" alt={str(c, 'title')} />
            <p className="t-display-s mt-3 text-ink">{str(c, 'title')}</p>
            <p className="t-body-s mt-1 line-clamp-2 text-muted">{str(c, 'subtitle')}</p>
          </PLink>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ drop countdown (real data only) */

function DropCountdown({ drop }: { drop: Json }) {
  const t = useT();
  const nav = useAppNav();
  const now = useNow(1000);
  const [subscribed, setSubscribed] = useState(flag(drop, 'subscribed'));
  const at = Date.parse(str(drop, 'launchesAt'));
  if (!at || at - now <= 0) return null;
  const left = Math.floor((at - now) / 1000);
  const parts: [number, string][] = [
    [Math.floor(left / 86400), 'D'],
    [Math.floor(left / 3600) % 24, 'H'],
    [Math.floor(left / 60) % 60, 'M'],
    [left % 60, 'S'],
  ];
  const id = str(drop, 'id');
  return (
    <div className="px-5 pt-10 md:px-0">
      <div data-theme="dark" className="sw-sheen flex h-[232px] overflow-hidden rounded-md bg-canvas md:h-[280px]" style={{ ['--sheen-delay' as string]: '900ms' }}>
        <div className="w-32 shrink-0 md:w-[38%]">
          <SwImage media={obj(drop, 'cover')} aspect={null} rounded="" sizes="(min-width:768px) 40vw, 128px" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col justify-center p-5 md:p-10">
          <p className="t-label-s text-accent">{t('home.dropIn')}</p>
          <p className="t-display-s mt-2 text-ink md:t-display-m">{str(drop, 'title')}</p>
          <div className="mt-4 flex items-baseline">
            {parts.map(([v, u]) => (
              <span key={u} className="flex items-baseline">
                <RollingText live text={String(v).padStart(2, '0')} className="t-price-m tabular text-ink md:t-price-l" />
                <span className="t-caption ml-0.5 mr-3 text-muted">{u}</span>
              </span>
            ))}
          </div>
          <div className="mt-4">
            <SwButton
              label={subscribed ? t('home.notifyOn') : t('home.notifyMe')}
              icon={subscribed ? Ic.bookmarkCheck : Ic.bell}
              variant="premium"
              onPress={
                subscribed
                  ? null
                  : () =>
                      nav.requireSignIn(
                        async () => {
                          await api.post(`/collections/${id}/notify`);
                          setSubscribed(true);
                        },
                        { kind: 'notify', collectionId: id },
                      )
              }
            />
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ categories */

function CategoryTiles({ title, items }: { title: string; items: Json[] }) {
  return (
    <section>
      <SectionHeader title={title} />
      <div className="sw-rail gap-3 px-5 md:hidden">
        {items.map((c) => (
          <CategoryTile key={str(c, 'id')} category={c} />
        ))}
      </div>
      <div className="hidden grid-cols-6 gap-5 md:grid lg:grid-cols-8 xl:grid-cols-9">
        {items.map((c) => (
          <CategoryTile key={str(c, 'id')} category={c} fluid />
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ brand spotlight */

function BrandSpotlight({ brand, items, title }: { brand: Json; items: Json[]; title: string | null }) {
  return (
    <section>
      <SectionHeader title={title ?? str(brand, 'name')} />
      <div className="md:grid md:grid-cols-[1.25fr_1fr] md:items-center md:gap-10">
        <div className="px-5 md:px-0">
          <SwImage media={obj(brand, 'cover')} aspect={16 / 10} sizes="(min-width:768px) 55vw, 100vw" alt={str(brand, 'name')} />
        </div>
        <div className="px-5 pb-5 pt-4 md:p-0">
          <p className="t-display-s text-ink md:t-display-m">{str(brand, 'name')}</p>
          <p className="t-body-s mt-2 line-clamp-3 text-muted md:t-body-m md:line-clamp-5">{str(brand, 'story')}</p>
          {str(brand, 'slug') && (
            <Link href={`/brand/${encodeURIComponent(str(brand, 'slug'))}`} className="t-label link-accent mt-5 inline-block text-ink">
              {str(brand, 'name')} →
            </Link>
          )}
        </div>
      </div>
      {items.length > 0 && (
        <div className="md:mt-8">
          <RailWithArrows items={items} cardWidth={140} />
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ beauty corner */

function BeautyCorner({ title, categories, items }: { title: string; categories: Json[]; items: Json[] }) {
  const router = useRouter();
  return (
    <section className="relative mt-10 pb-8">
      <div aria-hidden className="absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 bg-blush" />
      <div className="relative">
        <SectionHeader title={title} className="!pt-8" />
        {categories.length > 0 && (
          <div className="sw-rail gap-2 px-5 md:px-0">
            {categories.map((c) => (
              <ChoiceChip
                key={str(c, 'id')}
                label={str(c, 'name')}
                selected={false}
                leading={<Icon icon={categoryIcon(str(c, 'icon'))} size={16} />}
                onPress={() => router.push(`/c/${encodeURIComponent(str(c, 'slug'))}?title=${encodeURIComponent(str(c, 'name'))}`)}
              />
            ))}
          </div>
        )}
        <div className="mt-5">
          <RailWithArrows items={items} />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ looks teaser */

function LooksTeaser({ title, items }: { title: string; items: Json[] }) {
  return (
    <section>
      <SectionHeader title={title} viewAllHref="/discover" />
      <div className="sw-rail gap-3 px-5 md:gap-4 md:px-0">
        {items.map((l) => (
          <PLink key={str(l, 'id')} href={`/discover?look=${encodeURIComponent(str(l, 'id'))}`} label={str(l, 'caption')} className="w-[146px] md:w-[180px] lg:w-[200px]">
            <span className="relative block">
              <SwImage media={obj(l, 'media')} aspect={9 / 16} sizes="200px" />
              <span className="absolute bottom-3 left-3 text-[#F5F2EC]">
                <Icon icon={Ic.play} size={16} fill="currentColor" />
              </span>
            </span>
          </PLink>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ skeleton */

function HomeSkeleton() {
  return (
    <div className="p-5 md:px-0 md:pt-6">
      <div className="flex gap-4 overflow-hidden">
        {Array.from({ length: 9 }, (_, i) => (
          <Skeleton key={i} w={60} h={60} r={30} className="shrink-0 md:!size-[84px]" />
        ))}
      </div>
      <div className="mt-6 w-[88%] md:w-[72%] lg:w-[64%]">
        <Skeleton className="md:hidden" aspect={4 / 5} />
        <Skeleton className="hidden md:block lg:hidden" aspect={16 / 10} />
        <Skeleton className="hidden lg:block" aspect={16 / 8} />
      </div>
      <Skeleton w={160} h={24} className="mt-8" />
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} aspect={4 / 5} className={cn(i >= 2 && 'hidden sm:block', i >= 3 && 'sm:hidden lg:block')} />
        ))}
      </div>
    </div>
  );
}
