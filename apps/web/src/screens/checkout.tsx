'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { showPlacePicker } from '@/components/checkout/place-picker';
import { SwMap, type MapMarker, type MapRoute } from '@/components/map/sw-map';
import { ALoader, ALoaderBlock } from '@/components/ui/aloader';
import { SwButton, SwIconButton } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Ic, Icon } from '@/components/ui/icons';
import { CountUpMoney, Label, LoadError, Reveal, Skeleton, SkeletonLine, TextArea, TextField, useLocalised } from '@/components/ui/kit';
import { openSheet, toast } from '@/components/ui/overlay';
import { SwImage } from '@/components/ui/sw-image';
import { api, ApiException, errorMessage } from '@/lib/api';
import { initDelivery, locate, useDelivery } from '@/lib/delivery';
import { decodePolyline, toLatLng } from '@/lib/geo';
import { useT } from '@/lib/hooks';
import { flag, int, list, obj, str, strN, type Json } from '@/lib/json';
import { formatMoney } from '@/lib/money';
import { useBack } from '@/lib/nav';
import { queryClient, useSession } from '@/lib/session';

/* shopper choices kept for the tab's life (leaving and returning keeps them) */
let choice: { optionId?: string; method?: string; msisdn?: string; extra: Record<string, string> } = { extra: {} };
let manual = { location: '', notes: '' };

/** One screen, no forms: location from GPS (or the picker), contact from the profile, payment from the saved method. */
export function CheckoutScreen() {
  const t = useT();
  const router = useRouter();
  const back = useBack('/bag');
  const qc = useQueryClient();
  const { signedIn } = useSession();
  const dps = useDelivery();
  const [, rerender] = useState(0);
  const [placing, setPlacing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const idem = useRef(`co-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const manualRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void initDelivery(signedIn);
  }, [signedIn]);

  // Location mode is re-read every time checkout opens, so an admin switch applies to the very next checkout.
  const cfgQ = useQuery({
    queryKey: ['checkout-config'],
    staleTime: 0,
    queryFn: async () => {
      const fresh = await api.get<Json>('/config/public', undefined, { timeoutMs: 2500 }).catch(() => null);
      if (fresh) qc.setQueryData(['config'], fresh);
      return obj(fresh ?? (qc.getQueryData(['config']) as Json | undefined), 'checkout') ?? {};
    },
  });
  const cfg = cfgQ.data;
  const isManual = str(cfg, 'locationMode', 'automatic') === 'manual';
  const point = dps.point;
  const quoteQ = useQuery({
    queryKey: ['quote', point?.point.lat, point?.point.lng, choice.optionId, isManual],
    enabled: !!cfg && (!!point || isManual),
    queryFn: () => api.post<Json>('/checkout/quote', { ...(point ? { lat: point.point.lat, lng: point.point.lng } : {}), ...(choice.optionId ? { deliveryOptionId: choice.optionId } : {}) }),
    placeholderData: (prev) => prev,
  });
  const q = quoteQ.data;

  const setChoice = (c: Partial<typeof choice>) => {
    choice = { ...choice, ...c };
    rerender((n) => n + 1);
    if (c.optionId) void queryClient.invalidateQueries({ queryKey: ['quote'] });
  };

  const validateManual = () => {
    const lf = obj(obj(cfg, 'manualDetailFields'), 'location') ?? {};
    const nf = obj(obj(cfg, 'manualDetailFields'), 'notes') ?? {};
    const e: Record<string, string> = {};
    if (lf.required !== false && !manual.location.trim()) e.location = t('checkout.manual.required');
    if (nf.required === true && !manual.notes.trim()) e.notes = t('checkout.manual.required');
    setErrors(e);
    if (Object.keys(e).length) manualRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return !Object.keys(e).length;
  };

  const place = async () => {
    if (!q || placing) return;
    if (isManual && !validateManual()) return;
    if (!point && !isManual) return;
    const method = choice.method ?? strN(obj(obj(q, 'payment'), 'default'), 'method');
    setPlacing(true);
    try {
      const o = await api.post<Json>(
        '/orders',
        {
          ...(point ? { lat: point.point.lat, lng: point.point.lng } : {}),
          ...(point?.accuracy != null ? { accuracy: point.accuracy } : {}),
          deliveryOptionId: strN(q, 'selectedOptionId'),
          expectedTotal: int(obj(q, 'cart'), 'total'),
          paymentMethod: method,
          ...(choice.msisdn ? { msisdn: choice.msisdn } : {}),
          ...(!isManual && point?.label ? { label: point.label } : {}),
          ...(point?.area ? { area: point.area } : {}),
          ...(!isManual && point?.landmark ? { landmarkNote: point.landmark } : {}),
          ...(isManual ? { locationMode: 'manual', locationDetails: manual.location.trim(), deliveryNotes: manual.notes.trim() } : {}),
          ...(Object.keys(choice.extra).length ? { extraFields: choice.extra } : {}),
        },
        { 'Idempotency-Key': idem.current },
      );
      manual = { location: '', notes: '' };
      void qc.invalidateQueries({ queryKey: ['cart'] });
      void qc.invalidateQueries({ queryKey: ['me', 'orders'] });
      const pay = obj(o, 'payment');
      router.replace(str(pay, 'method') === 'MOBILE_MONEY' && str(pay, 'status') !== 'PAID' ? `/orders/${str(o, 'id')}/pay` : `/orders/${str(o, 'id')}/track`);
    } catch (e) {
      if (e instanceof ApiException && (e.code === 'total_changed' || e.code === 'checkout_problems')) {
        void qc.invalidateQueries({ queryKey: ['quote'] });
        toast(t('checkout.priceChanged'), { error: true });
      } else if (e instanceof ApiException && ['locationDetails', 'deliveryNotes', 'location'].includes(e.field ?? '')) {
        void cfgQ.refetch();
        toast(e.message, { error: true });
      } else toast(errorMessage(e, t), { error: true });
    } finally {
      setPlacing(false);
    }
  };

  if (!cfg) return <CheckoutSkeleton />;

  const sections = (
    <QuoteSections
      loading={quoteQ.isPending && !q}
      error={quoteQ.isError && !q ? quoteQ.error : null}
      retry={() => void quoteQ.refetch()}
      q={q}
      choice={choice}
      setChoice={setChoice}
    />
  );
  const bar = q ? <PlaceBar q={q} placing={placing} onPlace={place} /> : null;

  if (isManual)
    return (
      <main className="min-h-dvh pb-48 md:pb-16">
        <div className="sw-container">
          <div className="flex h-14 items-center px-1 md:h-auto md:px-0 md:pt-8">
            <SwIconButton icon={Ic.arrowLeft} label={t('common.back')} onPress={back} className="md:-ml-3" />
            <h1 className="t-title-m flex-1 text-center md:t-display-l md:text-left">{t('checkout.title')}</h1>
            <span className="w-11 md:hidden" />
          </div>
          <div className="md:grid md:grid-cols-[minmax(0,1fr)_400px] md:gap-12">
            <div className="px-5 pt-2 md:px-0 md:pt-6">
              <DetectedChip />
              <div ref={manualRef} className="mt-5">
                <ManualForm cfg={cfg} errors={errors} onEdited={(k) => errors[k] && setErrors((e) => { const n = { ...e }; delete n[k]; return n; })} />
              </div>
              <div className="mt-6">{sections}</div>
            </div>
            <aside className="hidden md:block md:pt-6">
              <div className="sticky top-24 rounded-md border border-hairline bg-surface p-6">{bar}</div>
            </aside>
          </div>
        </div>
        <div className="fixed inset-x-0 bottom-0 z-20 md:hidden">{bar && <div className="border-t border-hairline bg-surface px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-4 shadow-[0_-6px_24px_rgba(0,0,0,.06)]">{bar}</div>}</div>
      </main>
    );

  const dest = point?.point;
  const store = toLatLng(obj(q, 'store')?.location);
  const route = decodePolyline(strN(obj(q, 'route'), 'polyline'));
  const markers: MapMarker[] = [...(store ? [{ id: 'store', kind: 'store' as const, point: store, label: str(obj(q, 'store'), 'name') }] : []), ...(dest ? [{ id: 'me', kind: 'client' as const, point: dest }] : [])];
  const routes: MapRoute[] = store && dest ? [{ id: 'r', points: route.length ? route : [store, dest], dashed: !route.length }] : [];

  return (
    <main className="min-h-dvh pb-48 md:pb-16">
      <div className="md:sw-container md:grid md:grid-cols-[minmax(0,1fr)_400px] md:gap-12 md:pt-8">
        <div>
          <div className="relative h-[min(360px,42dvh)] md:h-[380px] md:overflow-hidden md:rounded-md">
            {dest ? <SwMap interactive={false} markers={markers} routes={routes} fitKey={`${dest.lat},${dest.lng},${store?.lat}`} padding={{ top: 90, bottom: 96, left: 24, right: 24 }} /> : <NoLocation />}
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[90px] md:hidden" style={{ background: 'linear-gradient(to bottom, transparent, var(--sw-canvas))' }} />
            <div className="absolute left-4 top-[calc(env(safe-area-inset-top)+8px)] md:top-4">
              <SwIconButton icon={Ic.arrowLeft} filled label={t('common.back')} onPress={back} />
            </div>
            <p className="t-title-m pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+16px)] text-center md:hidden">{t('checkout.title')}</p>
            {dest && (
              <div className="absolute inset-x-4 bottom-2 md:bottom-4">
                <DeliverToCard />
              </div>
            )}
          </div>
          <h1 className="t-display-l hidden md:mt-8 md:block">{t('checkout.title')}</h1>
          <div className="px-5 pt-4 md:px-0 md:pt-6">{dest ? sections : null}</div>
        </div>
        <aside className="hidden md:block">
          <div className="sticky top-24 rounded-md border border-hairline bg-surface p-6">{bar ?? <p className="t-body-s text-muted">{t('checkout.locationPermission.body')}</p>}</div>
        </aside>
      </div>
      {bar && <div className="fixed inset-x-0 bottom-0 z-20 border-t border-hairline bg-surface px-5 pb-[calc(16px+env(safe-area-inset-bottom))] pt-4 shadow-[0_-6px_24px_rgba(0,0,0,.06)] md:hidden">{bar}</div>}
    </main>
  );
}

function CheckoutSkeleton() {
  return (
    <main className="min-h-dvh md:sw-container md:pt-8">
      <Skeleton h="min(360px,42dvh)" r={0} className="md:!h-[380px] md:rounded-md" />
      <div className="p-5 md:px-0">
        <QuoteSkeleton />
      </div>
    </main>
  );
}
function QuoteSkeleton() {
  return (
    <div className="flex flex-col gap-3" role="status" aria-label="Loading">
      <SkeletonLine w={120} h={10} />
      <Skeleton h={72} r={12} />
      <Skeleton h={72} r={12} />
      <SkeletonLine w={80} h={10} />
      <Skeleton h={56} r={12} />
      <SkeletonLine w={90} h={10} />
      <Skeleton h={120} r={12} />
    </div>
  );
}

/* ------------------------------------------------------------------ location */

function NoLocation() {
  const t = useT();
  const d = useDelivery();
  if (d.locating) return <div className="flex h-full items-center justify-center bg-canvas"><ALoaderBlock message={t('checkout.locating')} /></div>;
  return (
    <div className="flex h-full flex-col justify-center bg-blush px-6 pt-14 md:pt-6">
      <span className="flex size-12 items-center justify-center rounded-full bg-surface">
        <Icon icon={Ic.locateFixed} size={22} />
      </span>
      <p className="t-display-s mt-4">{t('checkout.locationPermission.title')}</p>
      <p className="t-body-s mt-2 text-muted">{d.permission === 'denied' || d.permission === 'unsupported' ? t('checkout.locationDenied') : t('checkout.locationPermission.body')}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        <SwButton label={t('checkout.locationPermission.allow')} icon={Ic.locateFixed} onPress={async () => { if (!(await locate())) toast(t('checkout.locationDenied'), { error: true }); }} />
        <SwButton label={t('checkout.locationPermission.manual')} variant="ghost" onPress={() => showPlacePicker()} />
      </div>
    </div>
  );
}

function DeliverToCard() {
  const t = useT();
  const d = useDelivery();
  const p = d.point!;
  const title = p.area ?? (p.source === 'gps' ? t('checkout.currentLocation') : p.label ?? t('checkout.currentLocation'));
  const sub = [p.source === 'gps' && p.area ? t('checkout.currentLocation') : null, p.label && p.label !== title ? p.label : null, p.landmark ? `“${p.landmark}”` : null].filter(Boolean).join(' · ');
  return (
    <button type="button" onClick={() => void showPlacePicker()} className="press flex w-full items-center gap-3 rounded-md bg-surface py-3 pl-4 pr-3 text-left shadow-[0_10px_32px_rgba(0,0,0,.10)]" aria-label={`${t('checkout.deliverTo')} ${title}. ${t('checkout.change')}`}>
      <span className="block size-3 shrink-0 rounded-full" style={{ background: 'var(--sw-map-client)', border: '2px solid var(--sw-map-ring)', boxShadow: '0 0 4px rgba(0,0,0,.25)' }} />
      <span className="min-w-0 flex-1">
        <span className="t-label-s block text-muted">{t('checkout.deliverTo')}</span>
        <span key={title} className="t-title-m block truncate" style={{ animation: 'sw-fade-in 240ms both' }}>{title}</span>
        {sub && <span className="t-caption block truncate text-muted">{sub}</span>}
        {(d.locating || (p.accuracy ?? 0) > 40) && (
          <span className="t-caption mt-0.5 flex items-center gap-1.5 text-warning">
            {d.locating && <ALoader size="xs" />}
            {d.locating ? t('checkout.locating') : t('checkout.accuracy', { meters: Math.round(p.accuracy ?? 0) })}
          </span>
        )}
      </span>
      <span className="t-title-s underline decoration-hairline underline-offset-4">{t('checkout.change')}</span>
    </button>
  );
}

function DetectedChip() {
  const t = useT();
  const d = useDelivery();
  const p = d.point;
  let title: string, sub: string | null, action: string | null = null;
  if (p) {
    title = p.area ?? p.label ?? t('checkout.manual.detected');
    sub = [p.area && p.label && p.label !== p.area ? p.label : null, p.accuracy != null ? t('checkout.accuracy', { meters: Math.round(p.accuracy) }) : null].filter(Boolean).join(' · ');
  } else if (d.locating) {
    title = t('checkout.manual.detecting');
    sub = null;
  } else {
    title = t('checkout.manual.notDetected');
    sub = d.permission === 'denied' ? t('checkout.manual.deniedForever') : t('checkout.manual.optional');
    action = d.permission === 'denied' ? null : t('checkout.manual.useLocation');
  }
  return (
    <div className="flex items-center gap-3 rounded-md border border-hairline bg-surface py-3 pl-4 pr-3">
      {d.locating ? <ALoader size="xs" /> : <Icon icon={p ? Ic.mapPin : Ic.locateFixed} size={18} className={p ? 'text-ink' : 'text-muted'} />}
      <div className="min-w-0 flex-1">
        <p className="t-label-s text-muted">{t('checkout.manual.detectedLabel')}</p>
        <p className="t-title-s mt-0.5 truncate">{title}</p>
        {sub && <p className="t-caption line-clamp-2 text-muted">{sub}</p>}
      </div>
      {action && <SwButton label={action} variant="ghost" onPress={() => locate()} />}
    </div>
  );
}

function ManualForm({ cfg, errors, onEdited }: { cfg: Json; errors: Record<string, string>; onEdited: (k: string) => void }) {
  const t = useT();
  const loc = useLocalised();
  const lf = obj(obj(cfg, 'manualDetailFields'), 'location') ?? {};
  const nf = obj(obj(cfg, 'manualDetailFields'), 'notes') ?? {};
  const [l, setL] = useState(manual.location);
  const [n, setN] = useState(manual.notes);
  const label = (f: Json, fb: string) => `${loc(f, 'label') || fb}${f.required === false ? ` ${t('checkout.manual.optionalTag')}` : ''}`;
  return (
    <div className="flex flex-col gap-5">
      <TextArea label={label(lf, t('checkout.manual.location'))} placeholder={loc(lf, 'placeholder')} error={errors.location} rows={2} maxLength={int(lf, 'maxLength', 300)} counter value={l} onChange={(e) => { setL(e.target.value); manual.location = e.target.value; onEdited('location'); }} />
      <TextArea label={label(nf, t('checkout.manual.notes'))} placeholder={loc(nf, 'placeholder')} error={errors.notes} rows={2} maxLength={int(nf, 'maxLength', 300)} counter value={n} onChange={(e) => { setN(e.target.value); manual.notes = e.target.value; onEdited('notes'); }} />
    </div>
  );
}

/* ------------------------------------------------------------------ quote sections */

function QuoteSections({ loading, error, retry, q, choice: ch, setChoice }: { loading: boolean; error: unknown; retry: () => void; q: Json | undefined; choice: typeof choice; setChoice: (c: Partial<typeof choice>) => void }) {
  const t = useT();
  if (loading) return <QuoteSkeleton />;
  if (error) return <LoadError error={error} onRetry={retry} />;
  if (!q) return null;
  const cur = str(obj(q, 'cart'), 'currency', 'TZS');
  return (
    <div>
      {list(q, 'problems').map((p, i) => (
        <Problem key={i} p={p} currency={cur} />
      ))}
      <Label>{t('checkout.deliveryOption')}</Label>
      <Options q={q} onPick={(id) => setChoice({ optionId: id })} />
      <Label className="mt-6">{t('checkout.payment')}</Label>
      <PaymentRow q={q} ch={ch} setChoice={setChoice} />
      <Label className="mt-6">{t('checkout.summary')}</Label>
      <Summary q={q} />
      {list(q, 'extraFields').length > 0 && <ExtraFields fields={list(q, 'extraFields')} ch={ch} setChoice={setChoice} />}
      <p className="t-caption mt-5 flex items-center gap-2 text-muted">
        <Icon icon={Ic.phone} size={16} />
        {t('checkout.contact', { phone: str(obj(q, 'contact'), 'phone') })}
      </p>
    </div>
  );
}

function Problem({ p, currency }: { p: Json; currency: string }) {
  const t = useT();
  const text = str(p, 'reason') === 'min_order' ? t('checkout.problem.minOrder', { amount: formatMoney(int(p, 'minOrderAmount'), currency) }) : str(p, 'reason') === 'no_delivery_option' ? t('checkout.problem.notServed') : str(p, 'message') || t('common.error.body');
  return (
    <div className="mb-4 flex items-center gap-3 rounded-md bg-warning-soft p-4">
      <Icon icon={Ic.circleAlert} size={18} className="shrink-0 text-warning" />
      <p className="t-body-s">{text}</p>
    </div>
  );
}

const hm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

function Options({ q, onPick }: { q: Json; onPick: (id: string) => void }) {
  const t = useT();
  const loc = useLocalised();
  const cur = str(obj(q, 'cart'), 'currency', 'TZS');
  const sel = strN(q, 'selectedOptionId');
  return (
    <div className="flex flex-col gap-2">
      {list(q, 'options').map((o, i) => {
        const on = sel === str(o, 'id');
        const avail = flag(o, 'available');
        const kind = str(o, 'kind');
        return (
          <Reveal key={str(o, 'id')} index={i}>
            <button type="button" disabled={!avail} onClick={() => onPick(str(o, 'id'))} aria-pressed={on} className={cn('press flex w-full items-center gap-4 rounded-md p-4 text-left transition-[border-color,background-color] duration-[240ms]', on ? 'bg-surface' : 'bg-[color-mix(in_srgb,var(--sw-surface)_60%,transparent)]')} style={{ border: `${on ? 1.5 : 1}px solid ${on ? 'var(--sw-ink)' : 'var(--sw-hairline)'}`, opacity: avail ? 1 : 0.45 }}>
              <span className="flex size-11 shrink-0 items-center justify-center rounded-sm transition-colors" style={{ background: on ? 'var(--sw-ink)' : 'color-mix(in srgb, var(--sw-ink) 5%, transparent)', color: on ? 'var(--sw-on-ink)' : 'var(--sw-ink)' }}>
                <Icon icon={kind === 'pickup' ? Ic.store : kind === 'express' ? Ic.zap : Ic.bike} size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="t-title-m block">{loc(o, 'name')}</span>
                <span className="t-caption block text-muted">{!avail ? t('checkout.notServiceable') : kind === 'pickup' ? t('checkout.pickupAt', { store: str(obj(o, 'store'), 'name') }) : t('checkout.minutes', { min: int(o, 'etaMinMinutes'), max: int(o, 'etaMaxMinutes') })}</span>
              </span>
              <span className="flex flex-col items-end">
                <span className="t-price-s">{int(o, 'fee') === 0 ? t('checkout.free') : formatMoney(int(o, 'fee'), cur)}</span>
                {flag(o, 'freeDelivery') && int(o, 'feeBeforeFree') > 0 && <span className="t-caption text-subtle line-through">{formatMoney(int(o, 'feeBeforeFree'), cur)}</span>}
              </span>
              <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-accent text-on-accent transition-transform duration-[240ms] ease-[cubic-bezier(0.34,1.56,0.64,1)]" style={{ transform: on ? 'scale(1)' : 'scale(0)' }}>
                <Icon icon={Ic.check} size={14} />
              </span>
            </button>
          </Reveal>
        );
      })}
      {strN(q, 'arrivesBy') && (
        <p className="t-caption mt-1 flex items-center gap-2 text-muted">
          <Icon icon={Ic.clock} size={14} />
          {t('checkout.arrivesBy', { time: hm(str(q, 'arrivesBy')) })}
          {obj(q, 'store') && <span className="truncate">· {t('checkout.fromStore', { store: str(obj(q, 'store'), 'name') })}</span>}
        </p>
      )}
    </div>
  );
}

const payIcon = (m: string) => (m === 'MOBILE_MONEY' ? Ic.smartphone : m === 'CARD' ? Ic.creditCard : Ic.banknote);

function PaymentRow({ q, ch, setChoice }: { q: Json; ch: typeof choice; setChoice: (c: Partial<typeof choice>) => void }) {
  const t = useT();
  const pay = obj(q, 'payment') ?? {};
  const method = ch.method ?? strN(obj(pay, 'default'), 'method') ?? 'CASH_ON_DELIVERY';
  const saved = list(pay, 'saved').find((m) => str(m, 'method') === method);
  const number = ch.msisdn ?? strN(saved, 'msisdn') ?? strN(obj(q, 'contact'), 'phone');
  const pick = () =>
    openSheet((close) => <PaymentSheet available={list(pay, 'available')} current={method} number={number} onDone={(m, msisdn) => { setChoice({ method: m, msisdn }); close(); }} />, { title: t('checkout.paymentSheet') });
  return (
    <button type="button" onClick={() => void pick()} className="press flex w-full items-center gap-4 rounded-md border border-hairline bg-surface p-4 text-left">
      <span className="flex size-11 shrink-0 items-center justify-center rounded-sm bg-accent-soft">
        <Icon icon={payIcon(method)} size={20} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-title-m block">{t(`payment.${method}`)}</span>
        <span className="t-caption block text-muted">{method === 'MOBILE_MONEY' ? number ?? t('pay.networks') : method === 'CASH_ON_DELIVERY' ? t('pay.cashBody') : ''}</span>
      </span>
      <Icon icon={Ic.chevronRight} size={18} className="text-muted" />
    </button>
  );
}

function PaymentSheet({ available, current, number, onDone }: { available: Json[]; current: string; number: string | null; onDone: (m: string, msisdn?: string) => void }) {
  const t = useT();
  const [m, setM] = useState(current);
  const [num, setNum] = useState((number ?? '').replace('+255', ''));
  return (
    <div className="flex flex-col gap-2 px-5 pb-5 pt-2">
      {available.map((a) => {
        const on = m === str(a, 'method');
        return (
          <button key={str(a, 'method')} type="button" onClick={() => setM(str(a, 'method'))} className="flex items-center gap-4 rounded-md p-4 text-left transition-[border-color] duration-[240ms]" style={{ border: `${on ? 1.5 : 1}px solid ${on ? 'var(--sw-ink)' : 'var(--sw-hairline)'}` }}>
            <Icon icon={payIcon(str(a, 'method'))} size={22} />
            <span className="flex-1">
              <span className="t-title-m block">{t(`payment.${str(a, 'method')}`)}</span>
              {str(a, 'method') === 'MOBILE_MONEY' && <span className="t-caption block text-muted">{t('pay.networks')}</span>}
            </span>
            <Icon icon={Ic.circleCheck} size={22} style={{ opacity: on ? 1 : 0, transition: 'opacity 150ms' }} />
          </button>
        );
      })}
      {m === 'MOBILE_MONEY' && (
        <TextField className="mt-3" label={t('pay.number')} inputMode="tel" value={num} onChange={(e) => setNum(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="712 345 678" prefix={<span className="t-body-m ml-4">+255</span>} />
      )}
      <div className="mt-5">
        <SwButton label={t('common.done')} large expand onPress={() => { const d = num.replace(/^0/, ''); onDone(m, m === 'MOBILE_MONEY' && d.length >= 9 ? `+255${d}` : undefined); }} />
      </div>
    </div>
  );
}

function Summary({ q }: { q: Json }) {
  const t = useT();
  const cart = obj(q, 'cart') ?? {};
  const cur = str(cart, 'currency', 'TZS');
  const row = (k: string, v: string, cls?: string) => (
    <div className="flex py-[3px]">
      <span className="t-body-s flex-1 text-muted">{k}</span>
      <span className={cn('t-body-s', cls)}>{v}</span>
    </div>
  );
  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      <div className="sw-rail gap-2">
        {list(cart, 'items').map((i, k) => (
          <span key={k} className="relative block w-14">
            <SwImage media={obj(i, 'image')} sizes="56px" />
            {int(i, 'qty') > 1 && <span className="t-label-s absolute bottom-[3px] right-[3px] rounded-xs bg-ink px-[5px] py-px text-on-ink">×{int(i, 'qty')}</span>}
          </span>
        ))}
      </div>
      <div className="mt-3">
        {row(t('checkout.subtotal'), formatMoney(int(cart, 'subtotal'), cur))}
        {int(cart, 'discount') > 0 && row(t('checkout.discount'), `−${formatMoney(int(cart, 'discount'), cur)}`, 'text-success')}
        {row(t('checkout.deliveryFee'), int(cart, 'deliveryFee') === 0 ? t('checkout.free') : formatMoney(int(cart, 'deliveryFee'), cur))}
        {int(cart, 'savings') > 0 && row(t('bag.savings', { amount: '' }).trim(), formatMoney(int(cart, 'savings'), cur), 'text-success')}
      </div>
    </div>
  );
}

function ExtraFields({ fields, ch, setChoice }: { fields: Json[]; ch: typeof choice; setChoice: (c: Partial<typeof choice>) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-6">
      <button type="button" onClick={() => setOpen(!open)} className="t-title-s flex w-full items-center py-2">
        <span className="flex-1 text-left">{t('checkout.extraFields')}</span>
        <Icon icon={Ic.chevronDown} size={18} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 240ms' }} />
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-3">
          {fields.map((f) => (
            <TextField key={str(f, 'key')} label={str(f, 'label') || str(f, 'key')} placeholder={str(f, 'placeholder')} defaultValue={ch.extra[str(f, 'key')] ?? ''} onChange={(e) => setChoice({ extra: { ...ch.extra, [str(f, 'key')]: e.target.value } })} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ place bar (+ optional slide to confirm) */

function PlaceBar({ q, placing, onPlace }: { q: Json; placing: boolean; onPlace: () => Promise<void> }) {
  const t = useT();
  const cart = obj(q, 'cart') ?? {};
  const can = flag(q, 'canPlace') || (!list(q, 'problems').length && !!strN(q, 'selectedOptionId') && !flag(q, 'requiresPhone'));
  return (
    <div>
      <div className="flex items-center">
        <span className="t-title-m flex-1">{t('checkout.total')}</span>
        <CountUpMoney amount={int(cart, 'total')} currency={str(cart, 'currency', 'TZS')} className="t-price-l" />
      </div>
      {flag(q, 'requiresPhone') && <p className="t-caption mt-2 text-warning">{t('checkout.phoneRequired')}</p>}
      <div className="mt-3">{flag(q, 'slideToConfirm') ? <SlideToConfirm label={t('checkout.slideToConfirm')} enabled={can && !placing} busy={placing} onConfirm={onPlace} /> : <SwButton label={t('checkout.placeOrder')} icon={Ic.check} large expand pending={placing} onPress={can ? onPlace : null} />}</div>
    </div>
  );
}

function SlideToConfirm({ label, enabled, busy, onConfirm }: { label: string; enabled: boolean; busy: boolean; onConfirm: () => Promise<void> }) {
  const track = useRef<HTMLDivElement>(null);
  const [x, setX] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef(0);
  const max = () => (track.current?.clientWidth ?? 0) - 52 - 8;
  const pct = useMemo(() => (max() > 0 ? Math.min(1, x / max()) : 0), [x]);
  return (
    <div ref={track} className="relative h-[60px] rounded-full bg-ink" style={{ opacity: enabled || busy ? 1 : 0.45 }}>
      <span className="t-title-s pointer-events-none absolute inset-0 flex items-center justify-center text-on-ink" style={{ opacity: 1 - pct }}>
        {label}
      </span>
      <button
        type="button"
        aria-label={label}
        disabled={!enabled}
        onKeyDown={(e) => e.key === 'Enter' && enabled && void onConfirm()}
        onPointerDown={(e) => {
          if (!enabled) return;
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          start.current = e.clientX - x;
          setDragging(true);
        }}
        onPointerMove={(e) => dragging && setX(Math.max(0, Math.min(max(), e.clientX - start.current)))}
        onPointerUp={async () => {
          setDragging(false);
          if (x / Math.max(1, max()) > 0.86) {
            setX(max());
            await onConfirm();
          }
          setX(0);
        }}
        className="absolute left-1 top-1 flex size-[52px] touch-none items-center justify-center rounded-full bg-accent text-on-accent"
        style={{ transform: `translateX(${x}px)`, transition: dragging ? 'none' : 'transform 400ms var(--sw-ease-atelier)' }}
      >
        {busy ? <ALoader size="sm" color="var(--sw-on-accent)" /> : <Icon icon={Ic.arrowRight} size={22} />}
      </button>
    </div>
  );
}
