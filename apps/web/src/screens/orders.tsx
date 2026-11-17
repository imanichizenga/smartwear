'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { SubPage } from '@/components/profile/kit';
import { SwMap, type MapMarker, type MapRoute } from '@/components/map/sw-map';
import { ALoader } from '@/components/ui/aloader';
import { SwButton, SwIconButton } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Ic, Icon } from '@/components/ui/icons';
import { ChoiceChip, EmptyState, LoadError, Reveal, SectionHeader, Skeleton, SkeletonAvatar, SkeletonLine, SwChip, type ChipTone } from '@/components/ui/kit';
import { toast } from '@/components/ui/overlay';
import { PLink } from '@/components/ui/plink';
import { SwImage } from '@/components/ui/sw-image';
import { api, errorMessage } from '@/lib/api';
import { decodePolyline, etaMinutes, toLatLng, type LatLng } from '@/lib/geo';
import { useNow, useOrders, useT } from '@/lib/hooks';
import { flag, int, intN, list, num, obj, str, strN, type Json } from '@/lib/json';
import { formatMoney } from '@/lib/money';
import { useBack } from '@/lib/nav';
import { realtime } from '@/lib/realtime';
import { usePrefs, useSession } from '@/lib/session';
import { openSupportChat, openOrderChat } from './chat';

const ACTIVE = new Set(['PENDING_PAYMENT', 'CONFIRMED', 'PREPARING', 'READY_FOR_PICKUP', 'ASSIGNED', 'PICKED_UP', 'ON_THE_WAY', 'ARRIVED']);
export const orderTone = (s: string): ChipTone => (s === 'DELIVERED' ? 'success' : s === 'PENDING_PAYMENT' ? 'warning' : s === 'CANCELLED' || s === 'REFUNDED' ? 'neutral' : s === 'FAILED' ? 'danger' : 'ink');
const dmy = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
};

/* ================================================================== orders list */

export function OrdersScreen() {
  const t = useT();
  const router = useRouter();
  const q = useOrders();
  const items = list(q.data, 'items');
  const active = items.filter((o) => ACTIVE.has(str(o, 'status')));
  const past = items.filter((o) => !ACTIVE.has(str(o, 'status')));
  return (
    <SubPage title={t('orders.title')}>
      {q.isPending ? (
        <OrderCardSkeletonList />
      ) : q.isError && !q.data ? (
        <LoadError error={q.error} onRetry={() => void q.refetch()} />
      ) : !items.length ? (
        <EmptyState title={t('orders.empty.title')} body={t('orders.empty.body')} icon={Ic.package} action={<SwButton label={t('bag.empty.cta')} onPress={() => router.push('/')} />} className="min-h-[55vh] justify-center" />
      ) : (
        <div>
          {active.length > 0 && <SectionHeader title={t('orders.active')} className="!px-0 !pt-0 !pb-3" />}
          {active.map((o, i) => (
            <Reveal key={str(o, 'id')} index={i}>
              <OrderCard o={o} live />
            </Reveal>
          ))}
          {past.length > 0 && <SectionHeader title={t('orders.past')} className="!px-0 !pb-3 !pt-6" />}
          {past.map((o, i) => (
            <Reveal key={str(o, 'id')} index={active.length + i}>
              <OrderCard o={o} />
            </Reveal>
          ))}
        </div>
      )}
    </SubPage>
  );
}

function OrderCard({ o, live = false }: { o: Json; live?: boolean }) {
  const t = useT();
  const router = useRouter();
  const href = str(o, 'status') === 'PENDING_PAYMENT' ? `/orders/${str(o, 'id')}/pay` : `/orders/${str(o, 'id')}/track`;
  return (
    <div className="relative mb-3">
      <PLink href={href} overlay={false} label={`${str(o, 'number')}, ${str(o, 'statusLabel')}`} className="flex items-center gap-4 rounded-md border bg-surface p-4" style={{ borderColor: live ? 'color-mix(in srgb, var(--sw-ink) 60%, transparent)' : 'var(--sw-hairline)' }}>
        <Thumbs images={list(o, 'images')} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center">
            <span className="t-title-s flex-1">{str(o, 'number')}</span>
            <span className="t-price-s">{formatMoney(int(o, 'total'), str(o, 'currency', 'TZS'))}</span>
          </span>
          <span className="t-caption mt-1 block truncate text-muted">{[t('checkout.items', { count: int(o, 'itemCount') }), dmy(str(o, 'placedAt'))].filter(Boolean).join(' · ')}</span>
          <span className="mt-2 flex items-center">
            <SwChip label={str(o, 'statusLabel') || str(o, 'status')} tone={orderTone(str(o, 'status'))} />
            <span className="flex-1" />
            <span className="w-10" />
            {live ? (
              <span className="t-title-s flex items-center">
                {t('orders.track')}
                <Icon icon={Ic.chevronRight} size={16} />
              </span>
            ) : null}
          </span>
        </span>
      </PLink>
      <div className="absolute bottom-3 right-[88px]" style={{ right: live ? 88 : 12 }}>
        <SwIconButton icon={Ic.messageCircle} size={40} label={t('support.askAboutOrder')} onPress={() => openSupportChat(router, str(o, 'id'), t)} />
      </div>
    </div>
  );
}

export function OrderCardSkeletonList({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="flex gap-4 rounded-md border border-hairline bg-surface p-4">
          <Skeleton w={56} h={70} />
          <div className="flex flex-1 flex-col gap-2">
            <div className="flex justify-between">
              <SkeletonLine w={88} h={14} />
              <SkeletonLine w={72} h={14} />
            </div>
            <SkeletonLine w={140} h={10} />
            <Skeleton w={84} h={24} r={999} className="mt-1" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Up to three item photos fanned like a small stack of lookbook prints. */
function Thumbs({ images }: { images: Json[] }) {
  const shown = images.slice(0, 3);
  if (!shown.length)
    return (
      <span className="flex h-[70px] w-14 shrink-0 items-center justify-center rounded-xs bg-blush text-muted">
        <Icon icon={Ic.shoppingBag} size={20} />
      </span>
    );
  return (
    <span className="relative block h-[70px] shrink-0" style={{ width: 56 + (shown.length - 1) * 8 }}>
      {shown
        .map((m, i) => (
          <span key={i} className="absolute overflow-hidden rounded-xs" style={{ left: i * 8, top: i * 3, bottom: i * 3, width: 56 - i * 4.8, boxShadow: i ? '0 0 0 1.5px var(--sw-surface)' : undefined, zIndex: 3 - i }}>
            <SwImage media={m} aspect={null} rounded="" sizes="56px" />
          </span>
        ))
        .reverse()}
    </span>
  );
}

/* ================================================================== tracking */

type Phase = 'payment' | 'searching' | 'noRider' | 'preparing' | 'toStore' | 'onTheWay' | 'arrived' | 'delivered' | 'closed';
export function phaseOf(o: Json): Phase {
  const st = str(o, 'status');
  const js = str(obj(o, 'delivery'), 'status');
  if (st === 'PENDING_PAYMENT') return 'payment';
  if (st === 'DELIVERED') return 'delivered';
  if (['CANCELLED', 'REFUNDED', 'FAILED'].includes(st)) return 'closed';
  if (str(o, 'fulfilment') === 'pickup') return 'preparing';
  if (js === 'NO_RIDER') return 'noRider';
  if (js === 'ARRIVED' || st === 'ARRIVED') return 'arrived';
  if (['PICKED_UP', 'EN_ROUTE'].includes(js) || ['ON_THE_WAY', 'PICKED_UP'].includes(st)) return 'onTheWay';
  if (['ACCEPTED', 'AT_STORE'].includes(js)) return 'toStore';
  if (['SEARCHING', 'OFFERED'].includes(js)) return 'searching';
  return 'preparing';
}

/** Live tracking in SmartWear's editorial skin: map, rider glide, phase sheet, PIN, rating. */
export function TrackingScreen({ id }: { id: string }) {
  const t = useT();
  const back = useBack('/orders');
  const router = useRouter();
  const qc = useQueryClient();
  const [rider, setRider] = useState<{ p: LatLng; h: number | null; at: number } | null>(null);
  const [eta, setEta] = useState<{ s: number; at: number } | null>(null);
  const q = useQuery({ queryKey: ['me', 'order', id], queryFn: () => api.get<Json>(`/me/orders/${id}`), refetchInterval: (qq) => (qq.state.data && ['delivered', 'closed'].includes(phaseOf(qq.state.data)) ? false : 10_000) });
  const o = q.data;
  const now = useNow(1000);

  useEffect(() => {
    if (!o) return;
    const loc = obj(obj(o, 'delivery'), 'riderLocation');
    const p = toLatLng(loc);
    if (p) setRider((r) => ({ p, h: loc?.heading != null ? num(loc, 'heading') : r?.h ?? null, at: Date.parse(str(loc, 'at')) || Date.now() }));
    else if (!obj(obj(o, 'delivery'), 'rider')) setRider(null);
    const live = intN(obj(o, 'eta'), 'liveSeconds');
    if (live != null) setEta({ s: live, at: Date.now() });
  }, [o]);

  useEffect(() => {
    const unsub = realtime.subscribe(`order.${id}`);
    const off = realtime.onEvent((e) => {
      if (e.orderId && e.orderId !== id) return;
      if (e.type === 'rider.location' && typeof e.lat === 'number') {
        setRider((r) => ({ p: { lat: e.lat as number, lng: e.lng as number }, h: typeof e.heading === 'number' ? e.heading : r?.h ?? null, at: Date.now() }));
        if (typeof e.etaSeconds === 'number') setEta({ s: e.etaSeconds, at: Date.now() });
      } else void qc.invalidateQueries({ queryKey: ['me', 'order', id] });
    });
    return () => {
      unsub();
      off();
    };
  }, [id, qc]);

  if (!o) {
    if (q.isError)
      return (
        <main className="min-h-dvh">
          <div className="flex h-14 items-center px-1">
            <SwIconButton icon={Ic.arrowLeft} label={t('common.back')} onPress={back} />
          </div>
          <LoadError error={q.error} onRetry={() => void q.refetch()} />
        </main>
      );
    return <TrackingSkeleton />;
  }
  const phase = phaseOf(o);
  const store = toLatLng(obj(o, 'store')?.location);
  const dest = toLatLng(obj(o, 'destination')?.location);
  const route = decodePolyline(strN(obj(o, 'delivery'), 'route'));
  const showRider = !!rider && ['toStore', 'onTheWay', 'arrived'].includes(phase);
  const markers: MapMarker[] = [...(store ? [{ id: 'store', kind: 'store' as const, point: store, label: str(obj(o, 'store'), 'name') }] : []), ...(dest ? [{ id: 'me', kind: 'client' as const, point: dest }] : []), ...(showRider ? [{ id: 'rider', kind: 'rider' as const, point: rider!.p, heading: rider!.h }] : [])];
  const routes: MapRoute[] = route.length
    ? [{ id: 'live', points: route }]
    : showRider && phase === 'toStore' && store
      ? [{ id: 'r', points: [rider!.p, store], dashed: true }]
      : showRider && dest
        ? [{ id: 'r', points: [rider!.p, dest], dashed: true }]
        : store && dest
          ? [{ id: 'r', points: [store, dest], dashed: true }]
          : [];
  const stale = showRider && now - rider!.at > 30_000;
  const etaNow = eta ? Math.max(0, eta.s - Math.floor((now - eta.at) / 1000)) : null;
  const share = strN(o, 'shareToken') && !['delivered', 'closed'].includes(phase);

  return (
    <main className="relative h-dvh overflow-hidden md:grid md:grid-cols-[minmax(0,1fr)_440px]">
      <div className="absolute inset-0 md:relative">
        <SwMap markers={markers} routes={routes} searching={phase === 'searching'} fitKey={`${phase}|${showRider ? 'r' : ''}`} padding={{ top: 90, bottom: typeof window !== 'undefined' && window.innerWidth < 768 ? Math.round(window.innerHeight * 0.45) : 40, left: 24, right: 24 }} />
        {phase === 'searching' && (
          <div className="pointer-events-none absolute inset-x-0 top-[70px] bottom-[45%] flex items-center justify-center md:bottom-0">
            <span className="rounded-full p-5 shadow-[0_0_30px_rgba(0,0,0,.12)]" style={{ background: 'color-mix(in srgb, var(--sw-surface) 86%, transparent)' }}>
              <ALoader size="xl" />
            </span>
          </div>
        )}
        <div className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+8px)] flex items-center">
          <SwIconButton icon={Ic.arrowLeft} filled label={t('common.back')} onPress={back} />
          <span className="flex-1" />
          <span className="flex h-9 items-center gap-2 rounded-full bg-surface px-4 shadow-[0_4px_16px_rgba(0,0,0,.12)]">
            <span className="t-title-s">{str(o, 'number')}</span>
            {stale && (
              <>
                <ALoader size="xs" />
                <span className="t-caption text-muted">{t('common.updating')}</span>
              </>
            )}
          </span>
          <span className="flex-1" />
          {share ? (
            <SwIconButton
              icon={Ic.share2}
              filled
              label={t('track.shareLink')}
              onPress={async () => {
                const url = `${window.location.origin}/api/v1/track/${str(o, 'shareToken')}`;
                try {
                  if (navigator.share) await navigator.share({ url, title: str(o, 'number') });
                  else {
                    await navigator.clipboard.writeText(url);
                    toast(t('track.shareLink'), { icon: Ic.copy });
                  }
                } catch {
                  /* dismissed */
                }
              }}
            />
          ) : (
            <span className="w-11" />
          )}
        </div>
      </div>
      <section className="absolute inset-x-0 bottom-0 max-h-[62dvh] overflow-y-auto rounded-t-lg bg-surface px-5 pb-[calc(12px+env(safe-area-inset-bottom))] pt-3 shadow-[0_-8px_40px_rgba(0,0,0,.14)] md:relative md:max-h-none md:rounded-none md:border-l md:border-hairline md:px-8 md:pt-24 md:shadow-none">
        <div className="mx-auto mb-4 h-1 w-9 rounded-sm bg-hairline md:hidden" />
        <div key={phase} style={{ animation: 'sw-reveal 400ms var(--sw-ease-atelier) both' }}>
          <PhaseContent o={o} phase={phase} eta={etaNow} reload={() => void q.refetch()} />
        </div>
        <div className="mt-2">
          <SwButton label={t('support.askAboutOrder')} icon={Ic.messageCircle} variant="ghost" expand onPress={() => openSupportChat(router, id, t)} />
        </div>
      </section>
    </main>
  );
}

function Block({ eyebrow, title, body, children }: { eyebrow?: string; title: React.ReactNode; body?: string | null; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      {eyebrow && <p className="t-label mb-1 text-muted">{eyebrow}</p>}
      {typeof title === 'string' ? <h1 className="t-display-s">{title}</h1> : title}
      {body && <p className="t-body-s mt-2 text-muted">{body}</p>}
      {children && <div className="flex flex-col gap-4 pt-4">{children}</div>}
    </div>
  );
}

function PhaseContent({ o, phase, eta, reload }: { o: Json; phase: Phase; eta: number | null; reload: () => void }) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const id = str(o, 'id');
  const rider = obj(obj(o, 'delivery'), 'rider');
  switch (phase) {
    case 'payment':
      return (
        <Block title={t('track.status.PENDING_PAYMENT')} body={t('pay.approve.steps')}>
          <SwButton label={t('pay.approve.title')} icon={Ic.smartphone} large expand onPress={() => router.push(`/orders/${id}/pay`)} />
        </Block>
      );
    case 'searching':
      return (
        <Block eyebrow={str(o, 'number')} title={t('checkout.findingRider')} body={t('track.findingBody')}>
          <StoreLine o={o} />
          <Progress value={null} />
        </Block>
      );
    case 'noRider':
      return (
        <Block title={t('track.noRider.title')} body={t('track.noRider.body')}>
          <div className="flex gap-2">
            <div className="flex-1">
              <SwButton label={t('track.keepWaiting')} expand onPress={async () => { await api.post(`/me/orders/${id}/keep-searching`); reload(); }} />
            </div>
            <div className="flex-1">
              <SwButton label={t('track.cancelOrder')} variant="secondary" expand onPress={async () => { try { await api.post(`/me/orders/${id}/cancel`, { reason: 'No rider available' }); reload(); } catch (e) { toast(errorMessage(e, t), { error: true }); } }} />
            </div>
          </div>
        </Block>
      );
    case 'preparing':
      return (
        <Block eyebrow={str(o, 'number')} title={t(`track.status.${str(o, 'status')}`)} body={str(o, 'fulfilment') === 'pickup' ? t('checkout.pickupAt', { store: str(obj(o, 'store'), 'name') }) : t('track.preparing')}>
          <StoreLine o={o} />
          <Progress value={0.25} />
        </Block>
      );
    case 'toStore':
      return (
        <Block eyebrow={t('track.status.ASSIGNED')} title={t('track.assigned', { name: str(rider, 'firstName') })}>
          {rider && <RiderCard rider={rider} orderId={id} storePhone={strN(obj(o, 'store'), 'phone')} />}
          <Progress value={0.5} />
          <PinRow pin={strN(o, 'pin')} />
        </Block>
      );
    case 'onTheWay':
      return (
        <Block
          eyebrow={t('track.status.ON_THE_WAY')}
          title={
            <div className="flex items-end gap-3">
              <h1 className="t-display-s flex-1">{t('track.pickedUpBy', { name: str(rider, 'firstName') })}</h1>
              {eta != null && (
                <span className="flex flex-col items-center rounded-sm bg-ink px-3 py-2">
                  <span key={etaMinutes(eta)} className="t-price-l sw-roll text-on-ink" style={{ lineHeight: 1 }}>
                    {etaMinutes(eta)}
                  </span>
                  <span className="t-label-s text-accent">{t('track.min')}</span>
                </span>
              )}
            </div>
          }
        >
          {rider && <RiderCard rider={rider} orderId={id} storePhone={strN(obj(o, 'store'), 'phone')} />}
          <Progress value={0.78} />
          <PinRow pin={strN(o, 'pin')} />
        </Block>
      );
    case 'arrived':
      return (
        <Block eyebrow={t('track.arriving')} title={t('track.status.ARRIVED')}>
          <BigPin pin={strN(o, 'pin')} />
          {rider && <RiderCard rider={rider} orderId={id} compact storePhone={strN(obj(o, 'store'), 'phone')} />}
        </Block>
      );
    case 'delivered':
      return <Delivered o={o} onRated={reload} />;
    case 'closed':
      return (
        <Block title={t(`track.status.${str(o, 'status')}`)} body={strN(o, 'cancelReason')}>
          <SwButton label={t('track.reorder')} icon={Ic.rotateCcw} variant="secondary" expand onPress={async () => { await api.post(`/me/orders/${id}/reorder`); void qc.invalidateQueries({ queryKey: ['cart'] }); router.push('/bag'); }} />
        </Block>
      );
  }
}

function StoreLine({ o }: { o: Json }) {
  const t = useT();
  const items = list(o, 'items');
  const n = Math.min(3, items.length);
  return (
    <div className="flex items-center gap-3">
      <span className="relative block h-11 shrink-0" style={{ width: 26 * n + 18 }}>
        {items.slice(0, 3).map((i, k) => (
          <span key={k} className="absolute h-11 w-9 overflow-hidden rounded-xs" style={{ left: k * 26, boxShadow: '0 0 0 2px var(--sw-surface)' }}>
            <SwImage media={obj(i, 'image')} aspect={null} rounded="" sizes="36px" />
          </span>
        ))}
      </span>
      <span className="min-w-0">
        <span className="t-title-s block truncate">{t('track.storeAt', { store: str(obj(o, 'store'), 'name') })}</span>
        <span className="t-caption block text-muted">{`${t('checkout.items', { count: items.reduce((a, i) => a + int(i, 'qty'), 0) })} · ${formatMoney(int(o, 'total'), str(o, 'currency', 'TZS'))}`}</span>
      </span>
    </div>
  );
}

function Progress({ value }: { value: number | null }) {
  const [v, setV] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setV(value ?? 0));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return (
    <div className="relative h-[3px] overflow-hidden rounded-sm bg-hairline">
      {value == null ? <span className="sw-indeterminate absolute inset-y-0 left-0 w-[40%] bg-accent" /> : <span className="absolute inset-y-0 left-0 bg-ink transition-[width] duration-[900ms] ease-[var(--sw-ease-atelier)]" style={{ width: `${v * 100}%` }} />}
    </div>
  );
}

function RiderCard({ rider, orderId, compact, storePhone }: { rider: Json; orderId: string; compact?: boolean; storePhone?: string | null }) {
  const t = useT();
  const router = useRouter();
  const v = obj(rider, 'vehicle');
  const phone = strN(rider, 'phone') ?? storePhone;
  return (
    <div className="flex items-center gap-4">
      <span className="relative shrink-0">
        <span className="flex size-[52px] items-center justify-center overflow-hidden rounded-full bg-blush">
          {obj(rider, 'photo') ? <SwImage media={obj(rider, 'photo')} aspect={null} rounded="rounded-full" sizes="104px" /> : <span className="t-display-s">{str(rider, 'firstName', 'R').slice(0, 1)}</span>}
        </span>
        <span className="t-label-s absolute -bottom-0.5 -right-1 flex items-center gap-0.5 rounded-full border border-hairline bg-surface px-[5px] py-0.5">
          <Icon icon={Ic.star} size={10} className="text-accent" fill="currentColor" />
          {num(rider, 'rating').toFixed(1)}
        </span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-title-m block truncate">{str(rider, 'name')}</span>
        {v && !compact && <span className="t-caption block truncate text-muted">{[str(v, 'color'), str(v, 'make')].filter(Boolean).join(' ')}</span>}
        {v && str(v, 'plate') && <span className="t-label-s mt-1 inline-block rounded-xs border px-1.5 py-0.5" style={{ background: 'var(--sw-warning-soft)', borderColor: 'color-mix(in srgb, var(--sw-ink) 20%, transparent)', letterSpacing: '1.2px' }}>{str(v, 'plate')}</span>}
      </span>
      <SwIconButton icon={Ic.messageCircle} filled label={t('track.chat')} onPress={() => openOrderChat(router, orderId, t)} />
      {phone && (
        <a href={`tel:${phone}`} aria-label={t('track.call')} className="flex size-11 items-center justify-center">
          <span className="flex size-9 items-center justify-center rounded-full bg-scrim">
            <Icon icon={Ic.phone} size={20} />
          </span>
        </a>
      )}
    </div>
  );
}

function PinRow({ pin }: { pin: string | null }) {
  const t = useT();
  if (!pin) return null;
  return (
    <div className="flex items-center gap-3 rounded-md bg-accent-soft px-4 py-3">
      <Icon icon={Ic.keyRound} size={18} />
      <span className="t-title-s flex-1">{t('track.pin')}</span>
      <span className="t-price-m" style={{ letterSpacing: 2 }}>{pin.split('').join(' ')}</span>
    </div>
  );
}

function BigPin({ pin }: { pin: string | null }) {
  const t = useT();
  if (!pin) return null;
  return (
    <div className="text-center">
      <div className="flex justify-center">
        {pin.split('').map((d, i) => (
          <span key={i} className="sw-digit-in t-display-l mx-[5px] flex h-[76px] w-[62px] items-center justify-center rounded-md bg-ink text-on-ink" style={{ animationDelay: `${i * 90}ms` }}>
            {d}
          </span>
        ))}
      </div>
      <p className="t-body-s mt-3 text-muted">{t('track.pinHelp')}</p>
      <p className="t-caption text-subtle">{t('track.pinSecret')}</p>
    </div>
  );
}

function Delivered({ o, onRated }: { o: Json; onRated: () => void }) {
  const t = useT();
  const router = useRouter();
  const [stars, setStars] = useState(0);
  const [tags, setTags] = useState<string[]>([]);
  const [sent, setSent] = useState(false);
  const rider = obj(obj(o, 'delivery'), 'rider');
  const canRate = flag(o, 'canRate') && !sent;
  return (
    <div className="flex flex-col text-center">
      <div className="relative mx-auto flex h-24 w-40 items-center justify-center">
        <span className="sw-sparkles absolute inset-0" aria-hidden>
          {Array.from({ length: 10 }, (_, i) => (
            <i key={i} style={{ ['--a' as string]: `${i * 36}deg` }}>
              <svg viewBox="0 0 10 10" className="h-full w-full">
                <path d="M5 0Q5 5 10 5Q5 5 5 10Q5 5 0 5Q5 5 5 0Z" fill={i % 3 === 0 ? 'var(--sw-ink)' : 'var(--sw-accent)'} />
              </svg>
            </i>
          ))}
        </span>
        <span className="sw-pop-in flex size-16 items-center justify-center rounded-full bg-ink text-accent">
          <Icon icon={Ic.check} size={30} />
        </span>
      </div>
      <h1 className="t-display-s">{t('track.delivered.title')}</h1>
      <p className="t-body-s mt-1 text-muted">{sent || !flag(o, 'canRate') ? t('track.rateThanks') : t('track.delivered.body')}</p>
      {canRate && rider ? (
        <>
          <p className="t-title-s mt-5">{t('track.rateRider')}</p>
          <div className="mt-2 flex justify-center">
            {[1, 2, 3, 4, 5].map((i) => (
              <button key={i} type="button" aria-label={`${i}`} onClick={() => setStars(i)} className="p-1.5">
                <Icon icon={Ic.star} size={34} fill={i <= stars ? 'currentColor' : 'none'} style={{ color: i <= stars ? 'var(--sw-accent)' : 'var(--sw-hairline)', transform: i <= stars ? 'scale(1.15)' : 'none', transition: 'transform 240ms cubic-bezier(0.34,1.56,0.64,1)' }} />
              </button>
            ))}
          </div>
          {stars > 0 && (
            <div className="mt-3 flex flex-wrap justify-center gap-2">
              {['fast', 'friendly', 'careful', 'onTime', 'communication'].map((k) => (
                <ChoiceChip key={k} label={t(`track.tags.${k}`)} selected={tags.includes(k)} onPress={() => setTags((x) => (x.includes(k) ? x.filter((y) => y !== k) : [...x, k]))} />
              ))}
            </div>
          )}
          <div className="mt-4">
            <SwButton
              label={t('track.submitRating')}
              large
              expand
              onPress={
                stars
                  ? async () => {
                      try {
                        await api.post(`/me/orders/${str(o, 'id')}/rate`, { riderRating: stars, riderTags: tags });
                        setSent(true);
                        onRated();
                      } catch (e) {
                        toast(errorMessage(e, t), { error: true });
                      }
                    }
                  : null
              }
            />
          </div>
        </>
      ) : (
        <div className="mt-5">
          <SwButton label={t('common.done')} large expand onPress={() => router.push('/')} />
        </div>
      )}
    </div>
  );
}

function TrackingSkeleton() {
  return (
    <main className="relative h-dvh overflow-hidden">
      <Skeleton h="100%" r={0} className="absolute inset-0" />
      <div className="absolute inset-x-0 bottom-0 flex h-[42dvh] flex-col gap-3 rounded-t-lg bg-surface p-5 md:inset-y-0 md:left-auto md:right-0 md:h-auto md:w-[440px] md:rounded-none md:pt-24">
        <SkeletonLine w={200} h={22} />
        <SkeletonLine w={140} h={12} />
        <Skeleton h={4} r={2} className="mt-2" />
        <div className="mt-4 flex items-center gap-3">
          <SkeletonAvatar size={44} />
          <div className="flex flex-1 flex-col gap-2">
            <SkeletonLine w={120} h={14} />
            <SkeletonLine w={80} h={10} />
          </div>
        </div>
      </div>
    </main>
  );
}

/* ================================================================== mobile money wait */

export function PaymentWaitScreen({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const qc = useQueryClient();
  const { user } = useSession();
  const order = useQuery({ queryKey: ['me', 'order', id], queryFn: () => api.get<Json>(`/me/orders/${id}`) }).data;
  const [status, setStatus] = useState('PENDING');
  const [stale, setStale] = useState(false);
  const done = useRef(false);
  const payKey = useRef(`pay-${Date.now()}`);

  const check = useCallback(async () => {
    if (done.current) return;
    try {
      const r = await api.get<Json>(`/me/orders/${id}/payment`);
      const st = str(r, 'paymentStatus', 'PENDING');
      setStatus(st);
      if (st === 'PAID') {
        done.current = true;
        void qc.invalidateQueries({ queryKey: ['me', 'order', id] });
        setTimeout(() => router.replace(`/orders/${id}/track`), 1100);
      }
    } catch {
      /* poll again */
    }
  }, [id, qc, router]);

  useEffect(() => {
    let poll = setInterval(check, 3000);
    const timeout = setTimeout(() => {
      if (done.current) return;
      setStale(true);
      clearInterval(poll);
      poll = setInterval(check, 10_000);
    }, 120_000);
    const unsub = realtime.subscribe(`order.${id}`);
    const off = realtime.onEvent((e) => (e.orderId === id || String(e.type ?? '').startsWith('order.')) && void check());
    void check();
    return () => {
      clearInterval(poll);
      clearTimeout(timeout);
      unsub();
      off();
    };
  }, [id, check]);

  const failed = status === 'FAILED';
  const paid = status === 'PAID';
  const amount = order ? formatMoney(int(order, 'total'), str(order, 'currency', 'TZS')) : '';
  return (
    <main className="flex min-h-dvh flex-col items-center bg-canvas px-6 pt-[env(safe-area-inset-top)] md:justify-center">
      <div className="flex min-h-dvh w-full max-w-[440px] flex-col md:min-h-0">
        <div className="flex justify-end pt-4">
          <SwIconButton icon={Ic.x} label={t('common.close')} onPress={() => router.replace('/orders')} />
        </div>
        <div className="flex-1 md:hidden" />
        <div className="flex h-[220px] items-center justify-center">
          {paid ? (
            <span className="sw-pop-in flex size-28 items-center justify-center rounded-full bg-ink text-accent"><Icon icon={Ic.check} size={48} /></span>
          ) : failed ? (
            <span className="sw-pop-in flex size-28 items-center justify-center rounded-full bg-danger-soft text-danger"><Icon icon={Ic.x} size={44} /></span>
          ) : (
            <PhoneArt />
          )}
        </div>
        <h1 key={status} className="t-display-m mt-8 text-center" style={{ animation: 'sw-fade-in 240ms both' }}>
          {paid ? t('pay.approve.paid') : failed ? t('pay.approve.failed') : t('pay.approve.title')}
        </h1>
        <p className="t-body-m mt-3 text-center text-muted">{failed ? t('pay.approve.failedBody') : stale ? t('pay.approve.stale') : t('pay.approve.body', { phone: str(user, 'phone'), amount })}</p>
        {!failed && !paid && <p className="t-caption mx-auto mt-5 rounded-full bg-accent-soft px-4 py-3 text-center">{t('pay.approve.steps')}</p>}
        <div className="flex-1 md:h-10 md:flex-none" />
        {!paid && (
          <div className="pb-[calc(24px+env(safe-area-inset-bottom))]">
            {!failed && (
              <p className="t-caption mb-5 flex items-center justify-center gap-2 text-muted">
                <ALoader size="sm" />
                {t('pay.approve.waiting')}
              </p>
            )}
            <SwButton
              label={failed ? t('common.retry') : t('pay.approve.resend')}
              icon={Ic.refreshCw}
              variant={failed ? 'primary' : 'secondary'}
              large
              expand
              onPress={async () => {
                try {
                  if (failed) {
                    await api.post(`/me/orders/${id}/pay`, {}, { 'Idempotency-Key': payKey.current });
                    payKey.current = `pay-${Date.now()}`;
                    setStatus('PENDING');
                  } else await api.post(`/me/orders/${id}/payment`);
                  setStale(false);
                  toast(t('pay.approve.resent'), { icon: Ic.send });
                } catch (e) {
                  toast(errorMessage(e, t), { error: true });
                }
              }}
            />
            <div className="mt-2">
              <SwButton
                label={t('track.cancelOrder')}
                variant="ghost"
                expand
                onPress={async () => {
                  try {
                    await api.post(`/me/orders/${id}/cancel`, { reason: 'Payment not completed' });
                    void qc.invalidateQueries({ queryKey: ['me', 'orders'] });
                    router.replace('/bag');
                  } catch (e) {
                    toast(errorMessage(e, t), { error: true });
                  }
                }}
              />
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

/** A phone outline with a USSD prompt card breathing on its screen. */
function PhoneArt() {
  return (
    <span className="relative flex items-center justify-center">
      <span className="sw-ring-pulse absolute size-[240px]">
        <span className="absolute inset-0 rounded-full border-[1.2px] border-accent" />
        <span className="absolute inset-0 rounded-full border-[1.2px] border-accent" />
      </span>
      <span className="relative flex h-[200px] w-[108px] flex-col items-center rounded-[22px] border-[2.5px] border-ink bg-surface shadow-[0_14px_30px_rgba(0,0,0,.12)]">
        <span className="mt-2.5 block h-1 w-[30px] rounded-sm bg-[color-mix(in_srgb,var(--sw-ink)_20%,transparent)]" />
        <span className="flex-1" />
        <span className="mx-2.5 block w-[calc(100%-20px)] rounded-lg bg-ink p-2" style={{ animation: 'sw-breathe 1800ms var(--sw-ease-atelier) infinite' }}>
          <span className="block h-1 w-[50px] bg-[color-mix(in_srgb,var(--sw-on-ink)_50%,transparent)]" />
          <span className="mt-[5px] block h-1 w-[70px] max-w-full bg-[color-mix(in_srgb,var(--sw-on-ink)_30%,transparent)]" />
          <span className="mt-2 flex gap-1">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className="block size-2 rounded-full" style={{ background: 'var(--sw-accent)', animation: `sw-typing 1800ms ${i * 250}ms infinite` }} />
            ))}
          </span>
        </span>
        <span className="flex-1" />
        <span className="mb-2.5 block size-[26px] rounded-full border border-[color-mix(in_srgb,var(--sw-ink)_20%,transparent)]" />
      </span>
    </span>
  );
}

export const useLocaleIsSw = () => usePrefs().locale === 'sw';
export { cn };
