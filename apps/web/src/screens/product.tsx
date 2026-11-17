'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ProductRail } from '@/components/product/product-card';
import { RailWithArrows } from './home';
import { SwButton, SwIconButton } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Ic, Icon } from '@/components/ui/icons';
import { EmptyState, Hairline, OptionLabel, PriceTag, RatingStars, SectionHeader, SizePicker, Skeleton, SwatchPicker, SwChip, TierTable, toneOf } from '@/components/ui/kit';
import { openSheet, toast } from '@/components/ui/overlay';
import { ALoader } from '@/components/ui/aloader';
import { SwImage } from '@/components/ui/sw-image';
import { ApiException, errorMessage } from '@/lib/api';
import { cartApi, useProduct, useT, useWishlist } from '@/lib/hooks';
import { flag, int, intN, list, num, obj, str, strN, type Json } from '@/lib/json';
import { pickUrl } from '@/lib/media';
import { useAppNav, useBack } from '@/lib/nav';
import { usePrefs } from '@/lib/session';
import { useQueryClient } from '@tanstack/react-query';

export function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '· ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;|&rsquo;/g, '’')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function ProductScreen({ slug, initial }: { slug: string; initial?: Json | null }) {
  const qc = useQueryClient();
  // Server-rendered copy (anonymous prices) shows at once; the signed-in copy replaces it.
  if (initial && !qc.getQueryData(['product', slug])) qc.setQueryData(['product', slug], initial, { updatedAt: 0 });
  const p = useProduct(slug);
  const t = useT();
  const back = useBack('/');
  if (p.isPending) return <ProductSkeleton />;
  if (p.isError || !p.data)
    return (
      <main className="min-h-dvh">
        <div className="flex h-14 items-center px-1 md:hidden">
          <SwIconButton icon={Ic.arrowLeft} label={t('common.back')} onPress={back} />
        </div>
        <EmptyState
          title={p.error instanceof ApiException && p.error.status === 404 ? t('search.noResults.title') : t('common.error.title')}
          body={p.error instanceof ApiException ? p.error.message : t('common.error.body')}
          action={<SwButton label={t('common.retry')} onPress={() => p.refetch()} />}
          className="min-h-[70vh] justify-center"
        />
      </main>
    );
  return <ProductView key={str(p.data, 'id')} p={p.data} />;
}

function ProductView({ p }: { p: Json }) {
  const t = useT();
  const nav = useAppNav();
  const back = useBack('/');
  const { locale } = usePrefs();
  const types = list(p, 'optionTypes');
  const colourType = types.find((x) => ['color', 'shade'].includes(str(x, 'kind')));
  const sizeType = types.find((x) => ['size', 'volume'].includes(str(x, 'kind')));
  const variants = list(p, 'variants');
  const ids = (v: Json) => ((v.optionValueIds as unknown[]) ?? []).map(String);

  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const s: Record<string, string> = {};
    if (colourType) {
      const vals = list(colourType, 'values');
      const first = vals.find((v) => variants.some((x) => ids(x).includes(str(v, 'id')) && flag(x, 'inStock'))) ?? vals[0];
      if (first) s[str(colourType, 'id')] = str(first, 'id');
    }
    for (const ty of types) if (list(ty, 'values').length === 1) s[str(ty, 'id')] = str(list(ty, 'values')[0], 'id');
    return s;
  });
  const [qty, setQty] = useState(1);
  const gallery = useRef<HTMLDivElement>(null);
  const bagBtn = useRef<HTMLDivElement>(null);
  const wished = useWishlist().data?.has(str(p, 'id')) ?? false;

  const variant = useMemo(() => {
    if (Object.keys(selected).length < types.length) return null;
    const want = Object.values(selected);
    return variants.find((v) => want.every((w) => ids(v).includes(w))) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, variants, types.length]);

  const colour = colourType ? selected[str(colourType, 'id')] : undefined;
  const unavailable = useMemo(() => {
    const out = new Set<string>();
    if (!sizeType) return out;
    for (const v of list(sizeType, 'values')) {
      const vid = str(v, 'id');
      if (!variants.some((x) => ids(x).includes(vid) && (!colour || ids(x).includes(colour)) && flag(x, 'inStock'))) out.add(vid);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sizeType, colour, variants]);

  const media = useMemo(() => {
    const all = list(p, 'media').filter((m) => ['IMAGE', 'VIDEO'].includes(str(m, 'type')));
    if (!colour) return all;
    const mine = all.filter((m) => !strN(m, 'optionValueId') || strN(m, 'optionValueId') === colour);
    return mine.length ? mine : all;
  }, [p, colour]);

  const price = obj(variant, 'price') ?? obj(p, 'price');
  const inStock = flag(p, 'inStock');

  const flyToBag = () => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const from = gallery.current?.getBoundingClientRect();
    const headerBag = document.querySelector<HTMLElement>('header a[href="/bag"]');
    const to = (headerBag && headerBag.offsetParent ? headerBag : bagBtn.current)?.getBoundingClientRect();
    const url = pickUrl(media[0], 320);
    if (!from || !to || !url) return;
    const img = document.createElement('img');
    img.src = url;
    Object.assign(img.style, { position: 'fixed', left: `${from.left + 80}px`, top: `${from.top + 120}px`, width: '72px', aspectRatio: '4/5', objectFit: 'cover', borderRadius: '4px', zIndex: '100', pointerEvents: 'none', boxShadow: '0 10px 30px rgba(0,0,0,.2)' });
    document.body.appendChild(img);
    const dx = to.left + 12 - (from.left + 80);
    const dy = to.top - (from.top + 120);
    img
      .animate(
        [
          { transform: 'translate(0,0) scale(1)', opacity: 1 },
          { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 120}px) scale(0.7)`, opacity: 0.9, offset: 0.5 },
          { transform: `translate(${dx}px, ${dy}px) scale(0.38)`, opacity: 0.4 },
        ],
        { duration: 620, easing: 'cubic-bezier(0.22,0.61,0.36,1)' },
      )
      .finished.finally(() => img.remove());
  };

  const addToBag = async () => {
    if (!variant) {
      toast(t('product.selectSize'), { icon: Ic.ruler });
      return;
    }
    await nav.requireSignIn(
      async () => {
        try {
          await cartApi.add(str(variant, 'id'), qty);
          flyToBag();
          toast(t('product.added'), { icon: Ic.shoppingBag, action: { label: t('tab.bag'), onPress: () => nav.router.push('/bag') } });
        } catch (e) {
          toast(errorMessage(e, t), { error: true });
        }
      },
      { kind: 'bag', variantId: str(variant, 'id'), qty },
    );
  };

  const share = async () => {
    const url = `${window.location.origin}/p/${str(p, 'slug')}`;
    try {
      if (navigator.share) await navigator.share({ url, title: str(p, 'title') });
      else {
        await navigator.clipboard.writeText(url);
        toast(t('looks.linkCopied'), { icon: Ic.share2 });
      }
    } catch {
      /* dismissed */
    }
  };

  const brand = obj(p, 'brand');
  const fit = strN(p, 'fitNote');
  const addBar = (
    <div className="flex items-center gap-3">
      <QtyStepper qty={qty} onChange={setQty} />
      <div ref={bagBtn} className="flex-1">
        <SwButton label={inStock ? t('product.addToBag') : t('product.outOfStock')} icon={Ic.shoppingBag} large expand onPress={inStock ? addToBag : null} />
      </div>
    </div>
  );

  return (
    <main className="min-h-dvh pb-[calc(100px+env(safe-area-inset-bottom))] md:pb-16">
      <div className="md:sw-container md:grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:gap-10 md:pt-8 lg:gap-16">
        {/* gallery */}
        <div ref={gallery} className="relative md:sticky md:top-24 md:self-start">
          <Gallery media={media} title={str(p, 'title')} />
          <div className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+8px)] z-10 flex md:hidden">
            <SwIconButton icon={Ic.arrowLeft} filled label={t('common.back')} onPress={back} />
            <span className="flex-1" />
            <SwIconButton icon={Ic.share2} filled label={t('common.share')} onPress={share} />
            <SwIconButton icon={Ic.heart} activeIcon={Ic.heart} active={wished} filled label={t('wishlist.add')} onPress={() => nav.toggleWishlist(str(p, 'id'))} />
          </div>
        </div>

        {/* details */}
        <div className="px-5 pt-6 md:px-0 md:pt-0">
          <div className="mb-6 hidden items-center gap-1 md:flex">
            <button type="button" onClick={back} className="t-caption -ml-1 flex items-center gap-1 text-muted hover:text-ink">
              <Icon icon={Ic.arrowLeft} size={16} />
              {t('common.back')}
            </button>
            <span className="flex-1" />
            <SwIconButton icon={Ic.share2} label={t('common.share')} onPress={share} />
            <SwIconButton icon={Ic.heart} activeIcon={Ic.heart} active={wished} label={t('wishlist.add')} onPress={() => nav.toggleWishlist(str(p, 'id'))} />
          </div>
          {brand && <p className="t-label text-muted">{str(brand, 'name')}</p>}
          <h1 className="t-display-l mt-2 text-ink">{str(p, 'title')}</h1>
          {str(p, 'tagline') && <p className="t-body-m mt-2 text-muted">{str(p, 'tagline')}</p>}
          <div className="mt-4 flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <PriceTag price={price} size="l" range={variant ? null : obj(p, 'priceRange')} />
            </div>
            {int(p, 'reviewCount') > 0 && <RatingStars rating={num(obj(p, 'reviews'), 'average')} count={int(p, 'reviewCount')} />}
          </div>
          {list(p, 'badges').length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {list(p, 'badges').map((b, i) => (
                <SwChip key={i} label={(locale === 'sw' && str(b, 'labelSw')) || str(b, 'label')} tone={toneOf(str(b, 'tone'))} />
              ))}
            </div>
          )}
          {price && list(price, 'tiers').length > 0 && flag(price, 'showWholesale') && (
            <div className="mt-6">
              <TierTable price={price} qty={qty} />
            </div>
          )}
          {colourType && list(colourType, 'values').length > 1 && (
            <div className="mt-6">
              <OptionLabel label={str(colourType, 'kind') === 'shade' ? t('product.shade') : t('product.colour')} value={strN(list(colourType, 'values').find((v) => str(v, 'id') === colour), 'label')} />
              <SwatchPicker values={list(colourType, 'values')} selected={colour} onSelect={(id) => setSelected((s) => ({ ...s, [str(colourType, 'id')]: id }))} />
            </div>
          )}
          {sizeType && list(sizeType, 'values').length > 1 && (
            <div className="mt-6">
              <div className="flex items-center">
                <div className="flex-1">
                  <OptionLabel label={t('product.size')} />
                </div>
                {obj(p, 'sizeChart') && (
                  <button type="button" className="t-title-s link-accent flex items-center gap-1.5 py-2" onClick={() => void openSheet(() => <SizeGuide chart={obj(p, 'sizeChart')!} />, { title: t('product.sizeGuide'), wide: true })}>
                    <Icon icon={Ic.ruler} size={16} />
                    {t('product.sizeGuide')}
                  </button>
                )}
              </div>
              <div className="mt-2">
                <SizePicker values={list(sizeType, 'values')} selected={selected[str(sizeType, 'id')]} unavailable={unavailable} onSelect={(id) => setSelected((s) => ({ ...s, [str(sizeType, 'id')]: id }))} />
              </div>
              {fit && (
                <p className="t-caption mt-3 flex items-center gap-1.5 text-muted">
                  <Icon icon={Ic.info} size={14} />
                  {t(`product.fit.${fit === 'small' ? 'runs_small' : fit === 'large' ? 'runs_large' : 'true_to_size'}`)}
                </p>
              )}
            </div>
          )}
          {variant && flag(variant, 'lowStock') && intN(variant, 'stockLevel') != null && <p className="t-caption mt-3 text-warning">{t('product.lowStock', { count: int(variant, 'stockLevel') })}</p>}

          <div className="mt-8 hidden md:block">{addBar}</div>

          {obj(p, 'audioNote') && (
            <div className="mt-8">
              <DesignerNote media={obj(p, 'audioNote')!} title={t('product.designerNote')} />
            </div>
          )}
          <div className="mt-8">
            <Hairline />
            <Accordion title={t('product.description')} open>
              <p className="t-body-m whitespace-pre-line text-ink">{htmlToText(str(p, 'descriptionHtml'))}</p>
            </Accordion>
            {str(p, 'story') && (
              <Accordion title={t('product.story')}>
                <p className="t-body-m whitespace-pre-line text-ink">{str(p, 'story')}</p>
              </Accordion>
            )}
            {str(p, 'materials') && !flag(p, 'isBeauty') && (
              <Accordion title={t('product.materials')}>
                <Facts p={p} />
              </Accordion>
            )}
            {flag(p, 'isBeauty') && obj(p, 'beauty') && (
              <Accordion title={t('product.ingredients')}>
                <Beauty b={obj(p, 'beauty')!} />
              </Accordion>
            )}
            {str(p, 'care') && (
              <Accordion title={t('product.care')}>
                <p className="t-body-m whitespace-pre-line text-ink">{str(p, 'care')}</p>
              </Accordion>
            )}
          </div>
        </div>
      </div>

      <div className="md:sw-container">
        {list(p, 'completeTheLook').length > 0 && (
          <section>
            <SectionHeader title={t('product.completeTheLook')} />
            <RailWithArrows items={list(p, 'completeTheLook')} cardWidth={140} />
          </section>
        )}
        {list(p, 'pairsWellWith').length > 0 && (
          <section>
            <SectionHeader title={t('product.pairsWellWith')} />
            <RailWithArrows items={list(p, 'pairsWellWith')} cardWidth={140} />
          </section>
        )}
      </div>

      {/* sticky add-to-bag bar (phones) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl md:hidden" style={{ background: 'color-mix(in srgb, var(--sw-surface) 92%, transparent)' }}>
        {addBar}
      </div>
    </main>
  );
}

/* ------------------------------------------------------------------ gallery + zoom */

function Gallery({ media, title }: { media: Json[]; title: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState<number | null>(null);
  useEffect(() => {
    ref.current?.scrollTo({ left: 0 });
    setI(0);
  }, [str(media[0], 'id')]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const f = () => setI(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
    el.addEventListener('scroll', f, { passive: true });
    return () => el.removeEventListener('scroll', f);
  }, []);
  const go = (k: number) => ref.current?.scrollTo({ left: k * (ref.current?.clientWidth ?? 0), behavior: 'smooth' });
  const items = media.length ? media : [null];
  return (
    <div>
      <div className="group relative">
        <div ref={ref} className="flex snap-x snap-mandatory overflow-x-auto scrollbar-none md:rounded-xs">
          {items.map((m, k) => (
            <button key={k} type="button" className="w-full shrink-0 snap-start cursor-zoom-in" onClick={() => m && setZoom(k)} aria-label={`${title}, image ${k + 1}`}>
              <SwImage media={m} rounded="" sizes="(min-width:768px) 55vw, 100vw" priority={k === 0} alt={title} />
            </button>
          ))}
        </div>
        {media.length > 1 && (
          <>
            <div className="pointer-events-none absolute inset-x-5 bottom-4 flex gap-1">
              {media.map((_, k) => (
                <span key={k} className="h-0.5 flex-1 transition-colors duration-[240ms]" style={{ background: k === i ? 'rgba(245,242,236,.95)' : 'rgba(245,242,236,.35)' }} />
              ))}
            </div>
            {i > 0 && (
              <button type="button" aria-label="Previous image" onClick={() => go(i - 1)} className="absolute left-3 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-scrim opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100 md:flex">
                <Icon icon={Ic.chevronLeft} size={20} />
              </button>
            )}
            {i < media.length - 1 && (
              <button type="button" aria-label="Next image" onClick={() => go(i + 1)} className="absolute right-3 top-1/2 hidden size-11 -translate-y-1/2 items-center justify-center rounded-full bg-scrim opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100 md:flex">
                <Icon icon={Ic.chevronRight} size={20} />
              </button>
            )}
          </>
        )}
      </div>
      {media.length > 1 && (
        <div className="mt-3 hidden gap-2 md:flex">
          {media.slice(0, 8).map((m, k) => (
            <button key={k} type="button" onClick={() => go(k)} aria-label={`Image ${k + 1}`} className={cn('w-16 overflow-hidden rounded-xs transition-opacity', k === i ? 'opacity-100 ring-1 ring-ink ring-offset-2 ring-offset-canvas' : 'opacity-60 hover:opacity-100')}>
              <SwImage media={m} sizes="64px" />
            </button>
          ))}
        </div>
      )}
      {zoom != null && <ZoomViewer media={media} start={zoom} onClose={() => setZoom(null)} />}
    </div>
  );
}

/** Full-resolution viewer: click / double-tap zooms 2.4× at the point, arrows & swipe move, Esc closes. */
function ZoomViewer({ media, start, onClose }: { media: Json[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [z, setZ] = useState<{ x: number; y: number } | null>(null);
  const touch = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((k) => Math.min(media.length - 1, k + 1));
      if (e.key === 'ArrowLeft') setI((k) => Math.max(0, k - 1));
    };
    window.addEventListener('keydown', onKey);
    const o = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = o;
    };
  }, [media.length, onClose]);
  useEffect(() => setZ(null), [i]);
  const url = pickUrl(media[i], 1920);
  return createPortal(
    <div data-theme="dark" className="fixed inset-0 z-[85] bg-canvas" style={{ animation: 'sw-fade-in 240ms both' }} role="dialog" aria-modal="true">
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setZ(z ? null : { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
        }}
        onTouchStart={(e) => (touch.current = e.touches.length === 1 ? e.touches[0]!.clientX : null)}
        onTouchEnd={(e) => {
          if (touch.current == null || z) return;
          const dx = (e.changedTouches[0]?.clientX ?? 0) - touch.current;
          if (dx < -60) setI((k) => Math.min(media.length - 1, k + 1));
          if (dx > 60) setI((k) => Math.max(0, k - 1));
        }}
      >
        {url ? (
          <img src={url} alt="" className="max-h-full max-w-full select-none object-contain transition-transform duration-300 ease-[var(--sw-ease-atelier)]" style={{ transform: z ? 'scale(2.4)' : 'none', transformOrigin: z ? `${z.x}% ${z.y}%` : '50% 50%', cursor: z ? 'zoom-out' : 'zoom-in' }} draggable={false} />
        ) : (
          <ALoader size="lg" color="#F5F2EC" />
        )}
      </div>
      <div className="absolute right-3 top-[calc(env(safe-area-inset-top)+8px)]">
        <SwIconButton icon={Ic.x} color="#F5F2EC" label="Close" onPress={onClose} />
      </div>
      {media.length > 1 && (
        <div className="absolute inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+20px)] flex justify-center gap-2">
          {media.map((_, k) => (
            <button key={k} type="button" aria-label={`Image ${k + 1}`} onClick={() => setI(k)} className="h-4 px-1">
              <span className="block h-0.5 w-6" style={{ background: k === i ? '#F5F2EC' : 'rgba(245,242,236,.3)' }} />
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ designer's note (audio) */

function DesignerNote({ media, title }: { media: Json; title: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const peaks = ((media.waveform as unknown[]) ?? []).map(Number);
  const n = peaks.length || 48;
  const secs = Math.round(int(media, 'durationMs') / 1000);
  useEffect(() => () => audio.current?.pause(), []);
  const toggle = async () => {
    if (!audio.current) {
      const a = new Audio(str(media, 'url'));
      audio.current = a;
      a.ontimeupdate = () => setProgress(a.duration ? a.currentTime / a.duration : 0);
      a.onended = () => {
        setPlaying(false);
        a.currentTime = 0;
        setProgress(0);
      };
      a.onplaying = () => {
        setLoading(false);
        setPlaying(true);
      };
      a.onpause = () => setPlaying(false);
      setLoading(true);
    }
    if (playing) audio.current.pause();
    else await audio.current.play().catch(() => setLoading(false));
  };
  return (
    <div className="flex items-center gap-4 rounded-md bg-accent-soft p-4">
      <button type="button" onClick={() => void toggle()} aria-label={`${playing ? 'Pause' : 'Play'} ${title}`} className="flex size-12 shrink-0 items-center justify-center rounded-full bg-ink text-on-ink">
        {loading ? <ALoader size="sm" color="var(--sw-on-ink)" /> : <Icon icon={playing ? Ic.pause : Ic.play} size={20} fill="currentColor" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className="t-title-s">{title}</p>
        <div className="mt-2 flex h-7 items-center gap-[2px]">
          {Array.from({ length: n }, (_, k) => {
            const v = peaks.length ? Math.max(0.08, Math.min(1, peaks[k] ?? 0)) : 0.3;
            return <span key={k} className="flex-1 rounded-full" style={{ height: `${v * 100}%`, minWidth: 1.5, maxWidth: 3, background: k / n <= progress ? 'var(--sw-ink)' : 'color-mix(in srgb, var(--sw-ink) 25%, transparent)' }} />;
          })}
        </div>
      </div>
      <span className="t-caption tabular text-muted">{`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ details */

function Accordion({ title, open: initial = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(initial);
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex h-14 w-full items-center text-left">
        <span className="t-title-m flex-1">{title}</span>
        <Icon icon={Ic.chevronDown} size={18} className="transition-transform duration-[240ms]" style={{ transform: open ? 'rotate(180deg)' : 'none' }} />
      </button>
      <div className="grid transition-[grid-template-rows] duration-[240ms] ease-[var(--sw-ease-atelier)]" style={{ gridTemplateRows: open ? '1fr' : '0fr' }}>
        <div className="overflow-hidden">
          <div className="pb-5">{children}</div>
        </div>
      </div>
      <Hairline />
    </div>
  );
}

function Facts({ p }: { p: Json }) {
  const rows: [string, string][] = [['Composition', str(p, 'materials')]];
  if (str(p, 'countryOfOrigin')) rows.push(['Made in', str(p, 'countryOfOrigin')]);
  for (const [k, v] of Object.entries(obj(p, 'attributes') ?? {})) rows.push([k, String(v)]);
  return (
    <div className="flex flex-col">
      {rows.map(([k, v]) => (
        <div key={k} className="flex gap-3 py-1.5">
          <span className="t-body-s w-[120px] shrink-0 text-muted">{k}</span>
          <span className="t-body-s flex-1">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Beauty({ b }: { b: Json }) {
  const t = useT();
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {flag(b, 'crueltyFree') && <SwChip label={t('product.crueltyFree')} tone="blush" icon={Ic.heartHandshake} />}
        {flag(b, 'vegan') && <SwChip label={t('product.vegan')} tone="success" icon={Ic.leaf} />}
        {strN(b, 'volume') && <SwChip label={str(b, 'volume')} />}
        {intN(b, 'paoMonths') != null && <SwChip label={`${int(b, 'paoMonths')}M PAO`} />}
      </div>
      <p className="t-body-s mt-3 text-muted">{str(b, 'ingredients')}</p>
    </div>
  );
}

function SizeGuide({ chart }: { chart: Json }) {
  const cols = ((chart.columns as unknown[]) ?? []).map(String);
  return (
    <div className="px-5 pb-8 pt-2">
      <p className="t-body-s text-muted">{`${str(chart, 'name')} · ${str(chart, 'unit')}`}</p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-max border-collapse">
          <thead>
            <tr className="border-b border-hairline">
              <th className="t-label-s h-10 pr-6 text-left text-muted">SIZE</th>
              {cols.map((c) => (
                <th key={c} className="t-label-s h-10 pr-6 text-left text-muted">
                  {c.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list(chart, 'rows').map((r, k) => (
              <tr key={k} className="border-b border-hairline">
                <td className="t-title-s h-11 pr-6">{str(r, 'label')}</td>
                {((r.values as unknown[]) ?? []).map((v, j) => (
                  <td key={j} className="t-body-s h-11 pr-6">
                    {String(v)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {str(chart, 'note') && <p className="t-caption mt-4 text-muted">{str(chart, 'note')}</p>}
    </div>
  );
}

function QtyStepper({ qty, onChange }: { qty: number; onChange: (q: number) => void }) {
  return (
    <div className="flex h-[52px] shrink-0 items-center rounded-sm border border-hairline">
      <SwIconButton icon={Ic.minus} size={40} label="Decrease quantity" onPress={qty > 1 ? () => onChange(qty - 1) : null} />
      <span className="t-title-m w-6 text-center tabular">{qty}</span>
      <SwIconButton icon={Ic.plus} size={40} label="Increase quantity" onPress={() => onChange(qty + 1)} />
    </div>
  );
}

function ProductSkeleton() {
  return (
    <main className="md:sw-container md:grid md:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] md:gap-10 md:pt-8 lg:gap-16">
      <Skeleton aspect={4 / 5} r={0} className="md:rounded-xs" />
      <div className="flex flex-col gap-3 p-5 md:p-0 md:pt-14">
        <Skeleton w={90} h={12} />
        <Skeleton w={260} h={32} />
        <Skeleton w={120} h={22} className="mt-1" />
        <Skeleton w={200} h={44} className="mt-6" />
        <Skeleton h={52} className="mt-6 hidden md:block" />
      </div>
    </main>
  );
}

export { ProductRail };
