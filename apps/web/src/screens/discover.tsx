'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useSearchParams } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ProductRail } from '@/components/product/product-card';
import { ALoader } from '@/components/ui/aloader';
import { SwButton } from '@/components/ui/button';
import { Ic, Icon } from '@/components/ui/icons';
import { EmptyState, HeartIcon, LoadError, Skeleton, SkeletonAvatar, SkeletonLine } from '@/components/ui/kit';
import { openSheet, toast } from '@/components/ui/overlay';
import { StreamVideo } from '@/components/ui/stream-video';
import { SwImage } from '@/components/ui/sw-image';
import { api } from '@/lib/api';
import { useT } from '@/lib/hooks';
import { flag, int, list, num, obj, str, strN, type Json } from '@/lib/json';
import { useAppNav } from '@/lib/nav';

/* one mute switch for the whole feed */
let muted = true;
const muteSubs = new Set<() => void>();
const setMuted = (v: boolean) => {
  muted = v;
  muteSubs.forEach((f) => f());
};
const useMuted = () => useSyncExternalStore((f) => (muteSubs.add(f), () => void muteSubs.delete(f)), () => muted, () => true);

const usable = (items: Json[]) => items.filter((l) => obj(l, 'media') && str(obj(l, 'media'), 'type'));

/** Full-screen, vertically swiped Looks. Double-tap to like; tags open the products; only the visible look plays. */
export function DiscoverScreen() {
  const t = useT();
  const feed = useInfiniteQuery({
    queryKey: ['looks'],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => api.get<Json>('/looks', { cursor: pageParam }),
    getNextPageParam: (l) => strN(l, 'nextCursor'),
  });
  const items = useMemo(() => usable((feed.data?.pages ?? []).flatMap((p) => list(p, 'items'))), [feed.data]);
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const want = useSearchParams().get('look');
  const jumped = useRef(false);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const f = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onScroll = () => {
      const i = Math.round(el.scrollTop / Math.max(1, el.clientHeight));
      setIndex(i);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [items.length]);

  useEffect(() => {
    if (index >= items.length - 3 && feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
  }, [index, items.length, feed]);

  useEffect(() => {
    if (!want || jumped.current || !items.length) return;
    jumped.current = true;
    const i = items.findIndex((l) => str(l, 'id') === want);
    if (i > 0) requestAnimationFrame(() => scroller.current?.scrollTo({ top: i * scroller.current.clientHeight }));
  }, [want, items]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = scroller.current;
      if (!el || (e.target as HTMLElement)?.closest('input,textarea')) return;
      if (e.key === 'ArrowDown' || e.key === 'j') el.scrollBy({ top: el.clientHeight, behavior: 'smooth' });
      if (e.key === 'ArrowUp' || e.key === 'k') el.scrollBy({ top: -el.clientHeight, behavior: 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <main className="fixed inset-0 bg-canvas md:static md:h-[calc(100dvh-65px)]">
      {feed.isPending ? (
        <DiscoverSkeleton />
      ) : feed.isError && !items.length ? (
        <div className="flex h-full items-center justify-center">
          <LoadError error={feed.error} onRetry={() => void feed.refetch()} />
        </div>
      ) : !items.length ? (
        <div className="flex h-full items-center justify-center">
          <EmptyState title={t('looks.empty')} icon={Ic.compass} />
        </div>
      ) : (
        <div ref={scroller} className="h-full snap-y snap-mandatory overflow-y-auto overscroll-contain scrollbar-none" aria-label={t('tab.discover')}>
          {items.map((l, i) => (
            <section key={str(l, 'id')} className="relative flex h-full snap-start snap-always items-center justify-center md:py-4">
              {Math.abs(i - index) <= 2 ? <LookPage look={l} active={visible && i === index} near={Math.abs(i - index) === 1} /> : <div className="h-full w-full md:aspect-[9/16] md:w-auto" />}
            </section>
          ))}
          <section className="flex h-full snap-start items-center justify-center">
            {feed.hasNextPage || feed.isFetchingNextPage ? (
              <ALoader size="lg" />
            ) : (
              <EmptyState title={t('looks.end.title')} body={t('looks.end.body')} icon={Ic.sparkles} action={<SwButton label={t('looks.end.top')} icon={Ic.chevronUp} variant="secondary" onPress={() => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })} />} />
            )}
          </section>
        </div>
      )}
    </main>
  );
}

function DiscoverSkeleton() {
  return (
    <div className="relative h-full md:mx-auto md:my-4 md:aspect-[9/16] md:h-[calc(100%-32px)] md:overflow-hidden md:rounded-md">
      <Skeleton h="100%" r={0} className="absolute inset-0" />
      <div className="absolute bottom-[calc(108px+env(safe-area-inset-bottom))] right-3 flex flex-col gap-5 md:bottom-6">
        <SkeletonAvatar size={44} />
        <SkeletonAvatar size={44} />
        <SkeletonAvatar size={44} />
      </div>
      <div className="absolute bottom-[calc(108px+env(safe-area-inset-bottom))] left-5 right-[88px] flex flex-col gap-2 md:bottom-6">
        <SkeletonLine w={220} h={22} />
        <SkeletonLine w={150} h={22} />
        <Skeleton w={200} h={48} r={999} className="mt-2" />
      </div>
    </div>
  );
}

function LookPage({ look, active, near }: { look: Json; active: boolean; near: boolean }) {
  const t = useT();
  const nav = useAppNav();
  const isMuted = useMuted();
  const media = obj(look, 'media') ?? {};
  const isVideo = str(media, 'type') === 'VIDEO';
  const hlsUrl = strN(media, 'hlsUrl');
  const mp4Url = strN(media, 'url');
  const videoUrl = hlsUrl || mp4Url;
  const [liked, setLiked] = useState(flag(look, 'liked'));
  const [saved, setSaved] = useState(flag(look, 'saved'));
  const [likes, setLikes] = useState(int(look, 'likes'));
  const [burst, setBurst] = useState(0);
  const [buffering, setBuffering] = useState(isVideo);
  const [failed, setFailed] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const lastTap = useRef(0);
  const id = str(look, 'id');
  const tags = list(look, 'tags').filter((x) => obj(x, 'product'));
  const products = tags.map((x) => obj(x, 'product')!);

  const react = (kind: 'like' | 'save', force?: boolean) =>
    nav.requireSignIn(async () => {
      const on = force ?? !(kind === 'like' ? liked : saved);
      if (kind === 'like') {
        if (on !== liked) setLikes((n) => n + (on ? 1 : -1));
        setLiked(on);
      } else setSaved(on);
      try {
        await api.post(`/looks/${id}/react/${kind}`, { on });
      } catch {
        /* optimistic; the next feed load reconciles */
      }
    });

  const share = async () => {
    const url = `${window.location.origin}/discover?look=${id}`;
    try {
      if (navigator.share) await navigator.share({ url, title: str(look, 'caption') || 'SmartWear' });
      else {
        await navigator.clipboard.writeText(url);
        toast(t('looks.linkCopied'), { icon: Ic.share2 });
      }
    } catch {
      /* dismissed */
    }
  };

  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      setBurst((n) => n + 1);
      void react('like', true);
    }
    lastTap.current = now;
  };

  return (
    <div className="relative h-full w-full overflow-hidden md:aspect-[9/16] md:w-auto md:rounded-md" onClick={onTap}>
      <SwImage media={media} aspect={null} rounded="" sizes="(min-width:768px) 480px, 100vw" priority={active} />
      {isVideo && videoUrl && !failed && (
        <StreamVideo
          ref={video}
          hls={hlsUrl}
          mp4={mp4Url}
          poster={strN(media, 'posterUrl')}
          active={active}
          near={near}
          muted={isMuted}
          className="absolute inset-0 h-full w-full object-cover"
          onBuffering={setBuffering}
          onError={() => setFailed(true)}
        />
      )}
      {/* Everything drawn over the look's media stays light-on-dark (own gradient scrim) so it reads on any photo,
          whatever the shopper's theme; the page around it follows the theme. */}
      <div data-theme="dark" className="contents">
      <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(14,14,16,.35), rgba(14,14,16,0) 25%, rgba(14,14,16,0) 60%, rgba(14,14,16,.75))' }} />
      {/* product pins at their x/y, clamped clear of the bars and the action column */}
      {tags.map((tg, i) => {
        const p = obj(tg, 'product')!;
        const x = Math.min(Math.max(num(tg, 'x', 0.5), 0.04), 0.72);
        const y = Math.min(Math.max(num(tg, 'y', 0.5), 0.14), 0.62);
        return (
          <button
            key={i}
            type="button"
            aria-label={str(p, 'title')}
            onClick={(e) => {
              e.stopPropagation();
              void nav.openProduct(p);
            }}
            className="absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
          >
            <span className="block size-7 rounded-full" style={{ background: 'rgba(245,242,236,.9)', boxShadow: '0 0 0 6px rgba(14,14,16,.2)' }} />
          </button>
        );
      })}
      {burst > 0 && (
        <span key={burst} className="pointer-events-none absolute inset-0 flex items-center justify-center" style={{ animation: 'sw-heart-burst 700ms var(--sw-ease-atelier) both' }}>
          <HeartIcon filled size={96} color="#F5F2EC" />
        </span>
      )}
      {buffering && active && isVideo && !failed && (
        <span className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+16px)] flex justify-center">
          <ALoader size="xs" color="#F5F2EC" />
        </span>
      )}
      {isVideo && !failed && (
        <button type="button" onClick={(e) => { e.stopPropagation(); setMuted(!isMuted); }} aria-label={isMuted ? t('looks.unmute') : t('looks.mute')} className="absolute right-3 top-[calc(env(safe-area-inset-top)+8px)] flex size-12 items-center justify-center rounded-full text-ink" style={{ background: 'rgba(0,0,0,.22)' }}>
          <Icon icon={isMuted ? Ic.volumeX : Ic.volume2} size={22} />
        </button>
      )}
      <div className="absolute bottom-[calc(100px+env(safe-area-inset-bottom))] right-2 flex flex-col rounded-full py-1 md:bottom-6" style={{ background: 'rgba(0,0,0,.22)' }} onClick={(e) => e.stopPropagation()}>
        <Action icon={<HeartIcon filled={liked} size={26} color="#F5F2EC" />} label={String(likes)} aria={liked ? t('looks.liked') : t('looks.like')} onPress={() => void react('like')} />
        <Action icon={<Icon icon={saved ? Ic.bookmarkCheck : Ic.bookmark} size={26} />} label={saved ? t('looks.saved') : t('looks.save')} onPress={() => void react('save')} />
        <Action icon={<Icon icon={Ic.share2} size={26} />} label={t('common.share')} onPress={() => void share()} />
      </div>
      <div className="absolute bottom-[calc(100px+env(safe-area-inset-bottom))] left-5 right-[88px] md:bottom-6" onClick={(e) => e.stopPropagation()}>
        {strN(look, 'caption') && <p className="t-display-s line-clamp-3 text-ink">{str(look, 'caption')}</p>}
        {strN(look, 'credit') && <p className="t-caption mt-1 text-muted">{str(look, 'credit')}</p>}
        {products.length > 0 && (
          <div className="mt-4">
            <SwButton
              label={`${t('looks.shopThisLook')} · ${products.length}`}
              icon={Ic.shoppingBag}
              variant="premium"
              onPress={() =>
                openSheet(() => (
                  <div className="pb-6">
                    <ProductRail items={products} className="md:!px-5" />
                  </div>
                ), { title: t('looks.shopThisLook'), wide: true })
              }
            />
          </div>
        )}
      </div>
      </div>
    </div>
  );
}

function Action({ icon, label, aria, onPress }: { icon: React.ReactNode; label: string; aria?: string; onPress: () => void }) {
  return (
    <button type="button" onClick={onPress} aria-label={aria ?? label} className="flex h-[68px] w-14 flex-col items-center justify-center text-ink">
      <span className="flex h-10 w-12 items-center justify-center">{icon}</span>
      <span className="t-caption max-w-[52px] truncate text-ink">{label}</span>
    </button>
  );
}
