'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { SwMap, type MapMarker, type MapRoute } from '@/components/map/sw-map';
import { SubPage } from '@/components/profile/kit';
import { ALoaderBlock } from '@/components/ui/aloader';
import { SwButton, SwIconButton } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Ic, Icon } from '@/components/ui/icons';
import { CountUpMoney, EmptyState, Reveal, SectionHeader } from '@/components/ui/kit';
import { OtpInput } from '@/components/ui/otp';
import { openSheet, toast } from '@/components/ui/overlay';
import { api, errorMessage } from '@/lib/api';
import { decodePolyline, fmtDistance, toLatLng, type LatLng } from '@/lib/geo';
import { useNow, useT } from '@/lib/hooks';
import { flag, int, list, num, obj, str, strN, type Json } from '@/lib/json';
import { formatMoney } from '@/lib/money';

import { realtime } from '@/lib/realtime';
import { openOrderChat } from './chat';

/** Rider Mode for the browser: presence, live offers, job steps, PIN. Location streams while this tab is open. */
export function RiderHomeScreen() {
  const t = useT();
  const router = useRouter();
  const me = useQuery({ queryKey: ['rider', 'me'], queryFn: () => api.get<Json>('/rider/me') });
  const [offer, setOffer] = useState<Json | null>(null);
  const [job, setJob] = useState<Json | null>(null);
  const [done, setDone] = useState<Json | null>(null);
  const [here, setHere] = useState<LatLng | null>(null);
  const [riderOverride, setRider] = useState<Json | null>(null);
  const watch = useRef<number | null>(null);
  const batch = useRef<Json[]>([]);
  const lastSent = useRef(0);
  const data = me.data;
  const rider = riderOverride ?? obj(data, 'rider') ?? {};
  const online = str(rider, 'presence', 'OFFLINE') !== 'OFFLINE';

  useEffect(() => {
    if (!data) return;
    setOffer(obj(data, 'pendingOffer'));
    setJob(obj(data, 'activeJob'));
    setRider(null);
  }, [data]);

  const refresh = useCallback(() => void me.refetch(), [me]);
  useEffect(() => {
    realtime.ensure();
    return realtime.onEvent((e) => {
      const ty = String(e.type);
      if (ty === 'job.offer') {
        setOffer(e.offer as Json);
        navigator.vibrate?.([200, 100, 200]);
      } else if (ty === 'job.offer_expired' || ty === 'job.offer_taken') setOffer((o) => (o && o.id === e.offerId ? null : o));
      else if (ty === 'job.assigned') {
        if (e.job) setJob(e.job as Json);
        setOffer(null);
        refresh();
      } else if (['job.cancelled', 'job.reassigned', 'job.status'].includes(ty)) refresh();
    });
  }, [refresh]);

  const stop = () => {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
  };
  const start = useCallback(() => {
    if (watch.current != null || !navigator.geolocation) return;
    watch.current = navigator.geolocation.watchPosition(
      (p) => {
        const pt = { lat: p.coords.latitude, lng: p.coords.longitude };
        setHere(pt);
        if (Date.now() - lastSent.current < 3000) return;
        lastSent.current = Date.now();
        const fix = { ...pt, heading: p.coords.heading, speed: p.coords.speed, accuracy: p.coords.accuracy, at: new Date().toISOString() };
        if (!realtime.emit({ type: 'rider.location', ...fix })) batch.current.push(fix);
      },
      () => undefined,
      { enableHighAccuracy: true, maximumAge: 3000 },
    );
  }, []);
  useEffect(() => {
    if (online) start();
    else stop();
    const flush = setInterval(async () => {
      if (!batch.current.length) return;
      const pts = batch.current.splice(0);
      try {
        await api.post('/rider/location', { points: pts });
      } catch {
        batch.current.unshift(...pts.slice(-20));
      }
    }, 5000);
    return () => clearInterval(flush);
  }, [online, start]);
  useEffect(() => () => stop(), []);

  const setOnline = async (on: boolean) => {
    try {
      if (on) {
        const pos = await new Promise<GeolocationPosition>((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000 })).catch(() => null);
        if (!pos) return toast(t('rider.locationNeeded'), { error: true });
        const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setHere(pt);
        setRider(await api.post<Json>('/rider/presence', { online: true, ...pt }));
      } else {
        setRider(await api.post<Json>('/rider/presence', { online: false }));
      }
    } catch (e) {
      toast(errorMessage(e, t), { error: true });
    }
  };

  const step = async (s: string, pin?: string) => {
    if (!job) return;
    const r = await api.post<Json>(`/rider/jobs/${str(job, 'id')}`, { step: s, ...(pin ? { pin } : {}), ...(here ?? {}) });
    if (str(r, 'status') === 'COMPLETED') {
      setJob(null);
      setDone(r);
      refresh();
    } else setJob(r);
  };

  if (me.isPending) return <ALoaderBlock message={t('loader.preparing')} className="min-h-dvh" />;
  if (me.isError) return <EmptyState title={t('common.error.title')} body={errorMessage(me.error, t)} action={<SwButton label={t('rider.switchToShopping')} onPress={() => router.push('/')} />} className="min-h-dvh justify-center" />;
  if (done) return <Completed job={done} onBack={() => setDone(null)} />;
  if (job) return <JobScreen job={job} here={here} step={step} release={async (reason) => { await api.post(`/rider/jobs/${str(job, 'id')}`, { release: reason }); refresh(); }} />;

  const today = obj(rider, 'today') ?? {};
  const cur = str(rider, 'currency', 'TZS');
  const stores = list(data, 'stores');
  const pos = here ?? toLatLng(obj(rider, 'location')) ?? toLatLng(stores[0]?.location);
  const markers: MapMarker[] = [...stores.flatMap((x) => { const p = toLatLng(x.location); return p ? [{ id: `s${str(x, 'id')}`, kind: 'store' as const, point: p, label: str(x, 'name') }] : []; }), ...(pos && online ? [{ id: 'me', kind: 'rider' as const, point: pos }] : [])];
  const mins = int(today, 'onlineMinutes');
  return (
    <main className="relative h-dvh overflow-hidden">
      <SwMap markers={markers} fitKey={`idle-${stores.length}`} searching={online} padding={{ top: 170, bottom: 240 }} />
      <div className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+8px)] mx-auto max-w-[560px]">
        <div className="flex items-center gap-3">
          <SwIconButton icon={Ic.shoppingBag} filled label={t('rider.switchToShopping')} onPress={() => router.push('/')} />
          <div className="flex h-11 flex-1 items-center gap-2 rounded-full bg-surface px-4 shadow-[0_4px_16px_rgba(0,0,0,.1)]">
            <span className="block size-2 rounded-full transition-colors" style={{ background: online ? 'var(--sw-success)' : 'var(--sw-subtle)' }} />
            <span className="t-title-s flex-1">{online ? t('rider.online') : t('rider.offline')}</span>
            {online && mins > 0 && <span className="t-caption text-muted">{mins >= 60 ? t('rider.onlineForHours', { hours: Math.floor(mins / 60), minutes: mins % 60 }) : t('rider.onlineFor', { minutes: mins })}</span>}
          </div>
          <SwIconButton icon={Ic.wallet} filled label={t('rider.earnings')} onPress={() => router.push('/rider/earnings')} />
        </div>
        <div className="mt-3 flex rounded-md bg-surface py-3 shadow-[0_6px_20px_rgba(0,0,0,.08)]">
          {[
            [t('rider.todayEarnings'), formatMoney(int(today, 'earnings'), cur)],
            [t('rider.deliveries'), String(int(today, 'deliveries'))],
            [t('rider.rating'), num(rider, 'rating').toFixed(1)],
          ].map(([l, v], i) => (
            <div key={i} className={cn('flex-1 text-center', i > 0 && 'border-l border-hairline')}>
              <p className="t-price-m">{v}</p>
              <p className="t-caption text-muted">{l}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="absolute inset-x-0 bottom-0 rounded-t-lg bg-surface p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-[0_-8px_40px_rgba(0,0,0,.14)] md:inset-x-auto md:bottom-6 md:left-1/2 md:w-[480px] md:-translate-x-1/2 md:rounded-lg">
        {str(rider, 'status') !== 'ACTIVE' ? (
          <p className="t-body-s text-center text-muted">{t('rider.notApproved')}</p>
        ) : (
          <>
            <p key={String(online)} className="t-display-s text-center" style={{ animation: 'sw-fade-in 240ms both' }}>
              {online ? t('rider.waiting') : t('rider.offline')}
            </p>
            <p className="t-caption mt-1 text-center text-muted">{t('rider.backgroundNotice')}</p>
            <div className="mt-4">
              <SwButton label={online ? t('rider.goOffline') : t('rider.goOnline')} icon={online ? Ic.x : Ic.bike} variant={online ? 'secondary' : 'premium'} large expand onPress={() => setOnline(!online)} />
            </div>
          </>
        )}
      </div>
      {offer && <OfferOverlay offer={offer} onAccept={async () => { try { const r = await api.post<Json>(`/rider/offers/${int(offer, 'id')}/accept`); setJob(obj(r, 'job')); setOffer(null); } catch (e) { toast(errorMessage(e, t), { error: true }); setOffer(null); } }} onDecline={async () => { await api.post(`/rider/offers/${int(offer, 'id')}/decline`, { reason: '' }).catch(() => undefined); setOffer(null); }} onExpire={() => setOffer(null)} />}
    </main>
  );
}

function OfferOverlay({ offer: o, onAccept, onDecline, onExpire }: { offer: Json; onAccept: () => Promise<void>; onDecline: () => Promise<void>; onExpire: () => void }) {
  const t = useT();
  const total = Math.max(1, int(o, 'timeoutSeconds', 20));
  const [t0] = useState(Date.now());
  const now = useNow(250);
  const left = Math.max(0, Math.ceil(total - (now - t0) / 1000));
  const frac = Math.max(0, 1 - (now - t0) / 1000 / total);
  useEffect(() => {
    if (left <= 0) onExpire();
  }, [left, onExpire]);
  const store = obj(o, 'store') ?? {};
  const danger = left <= 5;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay p-3 md:items-center" style={{ animation: 'sw-fade-in 240ms both' }}>
      <div className="w-full max-w-[480px] rounded-lg bg-surface p-6" style={{ animation: 'sw-sheet-up 400ms cubic-bezier(0.34,1.56,0.64,1) both' }}>
        <div className="flex items-center">
          <div className="flex-1">
            <p className="t-label text-accent">{t('rider.newRequest')}</p>
            <p className="t-display-l mt-1">{formatMoney(int(o, 'earning'), str(o, 'currency', 'TZS'))}</p>
            <p className="t-caption text-muted">{t('rider.estimatedEarning')}</p>
          </div>
          <span className="relative flex size-[76px] items-center justify-center">
            <svg viewBox="0 0 76 76" className="absolute inset-0 -rotate-90">
              <circle cx="38" cy="38" r="34" fill="none" stroke="var(--sw-hairline)" strokeWidth="4" />
              <circle cx="38" cy="38" r="34" fill="none" stroke={danger ? 'var(--sw-danger)' : 'var(--sw-ink)'} strokeWidth="4" strokeLinecap="round" strokeDasharray={2 * Math.PI * 34} strokeDashoffset={2 * Math.PI * 34 * (1 - frac)} style={{ transition: 'stroke-dashoffset 250ms linear' }} />
            </svg>
            <span className="t-price-m" style={{ color: danger ? 'var(--sw-danger)' : 'var(--sw-ink)' }}>{t('rider.offerExpires', { seconds: left })}</span>
          </span>
        </div>
        <div className="mt-5 flex flex-col gap-3">
          <Leg icon={Ic.store} title={str(store, 'name')} sub={`${t('rider.pickup')} · ${t('rider.toStore', { distance: fmtDistance(o.distanceToStoreMeters as number) })}`} />
          <Leg icon={Ic.mapPin} title={str(obj(o, 'dropoff'), 'area') || str(obj(o, 'dropoff'), 'label')} sub={`${t('rider.dropoff')} · ${t('rider.trip', { distance: fmtDistance(o.tripDistanceMeters as number) })}`} />
          <p className="t-caption text-muted">{t('rider.items', { count: int(o, 'items') })}</p>
        </div>
        <div className="mt-5 flex gap-2">
          <div className="flex-1"><SwButton label={t('rider.decline')} variant="secondary" large expand onPress={onDecline} /></div>
          <div className="flex-[2]"><SwButton label={t('rider.accept')} icon={Ic.check} large expand onPress={onAccept} /></div>
        </div>
      </div>
    </div>
  );
}

function Leg({ icon, title, sub }: { icon: typeof Ic.store; title: string; sub: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--sw-ink)_5%,transparent)]"><Icon icon={icon} size={18} /></span>
      <div className="min-w-0">
        <p className="t-title-s truncate">{title}</p>
        <p className="t-caption text-muted">{sub}</p>
      </div>
    </div>
  );
}

const STEPS = ['ACCEPTED', 'AT_STORE', 'PICKED_UP', 'ARRIVED'];

function JobScreen({ job: j, here, step, release }: { job: Json; here: LatLng | null; step: (s: string, pin?: string) => Promise<void>; release: (r: string) => Promise<void> }) {
  const t = useT();
  const router = useRouter();
  const status = str(j, 'status');
  const toStore = status === 'ACCEPTED' || status === 'AT_STORE';
  const store = toLatLng(obj(j, 'store')?.location);
  const drop = toLatLng(obj(j, 'dropoff')?.location);
  const route = decodePolyline(strN(j, 'route'));
  const target = toStore ? store : drop;
  const collect = int(obj(j, 'payment'), 'collect');
  const cur = str(j, 'currency', 'TZS');
  const [label, next, icon] = status === 'ACCEPTED' ? [t('rider.arrivedAtStore'), 'AT_STORE', Ic.store] : status === 'AT_STORE' ? [t('rider.pickedUp'), 'PICKED_UP', Ic.package] : status === 'PICKED_UP' || status === 'EN_ROUTE' ? [t('rider.arrived'), 'ARRIVED', Ic.mapPin] : [flag(j, 'pinRequired') ? t('rider.enterPin') : t('rider.complete'), 'COMPLETED', Ic.keyRound];
  const stepKey = status === 'ACCEPTED' || status === 'AT_STORE' || status === 'ARRIVED' ? status : 'EN_ROUTE';
  const person = obj(j, 'customer');
  const phone = toStore ? strN(obj(j, 'store'), 'phone') : strN(person, 'phone');
  const markers: MapMarker[] = [...(store ? [{ id: 'store', kind: 'store' as const, point: store }] : []), ...(drop ? [{ id: 'drop', kind: 'client' as const, point: drop }] : []), ...(here ? [{ id: 'me', kind: 'rider' as const, point: here }] : [])];
  const routes: MapRoute[] = route.length ? [{ id: 'r', points: route }] : here && target ? [{ id: 'r', points: [here, target], dashed: true }] : [];
  const act = async () => {
    try {
      if (next === 'COMPLETED' && flag(j, 'pinRequired')) {
        const pin = await openSheet<string>((close) => <PinSheet onDone={close} />, { title: t('rider.enterPin') });
        if (pin) await step('COMPLETED', pin);
      } else await step(next);
    } catch (e) {
      toast(errorMessage(e, t), { error: true });
    }
  };
  return (
    <main className="relative h-dvh overflow-hidden">
      <SwMap markers={markers} routes={routes} fitKey={`job-${status}`} padding={{ top: 100, bottom: 340, left: 24, right: 24 }} />
      <div className="absolute inset-x-4 top-[calc(env(safe-area-inset-top)+8px)] mx-auto flex max-w-[560px] items-center gap-3 rounded-md bg-ink px-4 py-3 text-on-ink">
        <Icon icon={toStore ? Ic.store : Ic.navigation} size={22} className="text-accent" />
        <div className="min-w-0 flex-1">
          <p className="t-title-m">{t(`rider.step.${stepKey}`)}</p>
          <p className="t-caption truncate opacity-70">{toStore ? str(obj(j, 'store'), 'address') : str(obj(j, 'dropoff'), 'label')}</p>
        </div>
        {!toStore && int(j, 'etaSeconds') > 0 && (
          <div className="text-right">
            <p className="t-price-m">{Math.ceil(int(j, 'etaSeconds') / 60)}</p>
            <p className="t-label-s text-accent">{t('track.min')}</p>
          </div>
        )}
        {strN(j, 'navigationUrl') && <a href={str(j, 'navigationUrl')} target="_blank" rel="noopener noreferrer" aria-label={t('rider.openInMaps')} className="flex size-11 items-center justify-center"><Icon icon={Ic.externalLink} size={20} /></a>}
      </div>
      <div className="absolute inset-x-0 bottom-0 rounded-t-lg bg-surface p-5 pb-[calc(20px+env(safe-area-inset-bottom))] shadow-[0_-8px_40px_rgba(0,0,0,.14)] md:inset-x-auto md:bottom-6 md:left-1/2 md:w-[480px] md:-translate-x-1/2 md:rounded-lg">
        <div className="flex gap-1">
          {STEPS.map((s, i) => (
            <span key={s} className="h-1 flex-1 rounded-sm transition-colors" style={{ background: STEPS.indexOf(status === 'EN_ROUTE' ? 'PICKED_UP' : status) >= i ? 'var(--sw-ink)' : 'var(--sw-hairline)' }} />
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <p className="t-label text-muted">{str(j, 'orderNumber')}</p>
            <p className="t-display-s truncate">{toStore ? str(obj(j, 'store'), 'name') : str(person, 'firstName') || str(obj(j, 'dropoff'), 'area')}</p>
            {!toStore && strN(obj(j, 'dropoff'), 'landmark') && <p className="t-caption text-muted">“{str(obj(j, 'dropoff'), 'landmark')}”</p>}
          </div>
          <SwIconButton icon={Ic.messageCircle} filled label={t('track.chat')} onPress={() => openOrderChat(router, str(j, 'orderId'), t)} />
          {phone && <a href={`tel:${phone}`} aria-label={toStore ? t('track.call') : t('rider.callCustomer')} className="flex size-11 items-center justify-center"><span className="flex size-9 items-center justify-center rounded-full bg-scrim"><Icon icon={Ic.phone} size={20} /></span></a>}
        </div>
        {collect > 0 && (
          <div className="mt-4 flex items-center gap-3 rounded-md bg-warning-soft px-4 py-3">
            <Icon icon={Ic.banknote} size={18} />
            <p className="t-title-s">{t('rider.cashToCollect', { amount: formatMoney(collect, cur) })}</p>
          </div>
        )}
        <div className="mt-4">
          <SwButton label={label} icon={icon} large expand onPress={act} />
        </div>
        {toStore && <div className="mt-2"><SwButton label={t('rider.release')} variant="ghost" expand onPress={() => release('rider_unavailable')} /></div>}
      </div>
    </main>
  );
}

function PinSheet({ onDone }: { onDone: (v: string) => void }) {
  const t = useT();
  const [v, setV] = useState('');
  return (
    <div className="px-5 pb-6">
      <p className="t-body-s mb-5 text-muted">{t('rider.pinHelp')}</p>
      <OtpInput value={v} onChange={setV} length={4} onComplete={onDone} />
    </div>
  );
}

function Completed({ job, onBack }: { job: Json; onBack: () => void }) {
  const t = useT();
  return (
    <main data-theme="dark" className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-6 text-center">
      <span className="sw-pop-in flex size-24 items-center justify-center rounded-full bg-accent text-on-accent"><Icon icon={Ic.check} size={44} /></span>
      <h1 className="t-display-l mt-8 text-ink">{t('rider.delivered')}</h1>
      <p className="t-body-m mt-3 text-muted">{t('rider.deliveredBody', { amount: formatMoney(int(job, 'earning'), str(job, 'currency', 'TZS')) })}</p>
      <div className="mt-10 w-full max-w-[400px]">
        <SwButton label={t('rider.backOnline')} variant="premium" large expand onPress={onBack} />
      </div>
    </main>
  );
}

/* ================================================================== earnings */

export function RiderEarningsScreen() {
  const t = useT();
  const h = useQuery({ queryKey: ['rider', 'history'], queryFn: () => api.get<Json>('/rider/history') });
  const cur = str(obj(useQuery({ queryKey: ['rider', 'me'], queryFn: () => api.get<Json>('/rider/me') }).data, 'rider'), 'currency', 'TZS');
  const [sel, setSel] = useState<number | null>(null);
  return (
    <SubPage title={t('rider.earnings')} back="/rider">
      {h.isPending ? (
        <ALoaderBlock />
      ) : h.isError ? (
        <EmptyState title={t('common.error.title')} />
      ) : (
        (() => {
          const by = new Map(list(h.data, 'week').map((d) => [str(d, 'date'), d]));
          const week = Array.from({ length: 7 }, (_, k) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - k));
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            return { key, day: 'SMTWTFS'[d.getDay()]!, earnings: int(by.get(key), 'earnings'), deliveries: int(by.get(key), 'deliveries') };
          });
          const total = week.reduce((a, x) => a + x.earnings, 0);
          const trips = week.reduce((a, x) => a + x.deliveries, 0);
          const maxE = Math.max(1, ...week.map((x) => x.earnings));
          const si = sel ?? Math.max(0, week.map((x) => x.earnings > 0).lastIndexOf(true));
          const bal = obj(h.data, 'balance');
          return (
            <div>
              <p className="t-label text-muted">{t('rider.weekEarnings')}</p>
              <CountUpMoney amount={total} currency={cur} className="t-display-l mt-1 block" />
              <p className="t-caption text-muted">{t('rider.tripCount', { count: trips })}</p>
              <div className="mt-6 rounded-md border border-hairline bg-surface p-4">
                <p className="t-title-s">
                  {formatMoney(week[si]!.earnings, cur)} <span className="t-caption text-muted">· {t('rider.tripCount', { count: week[si]!.deliveries })}</span>
                </p>
                <div className="mt-4 flex h-32 items-end gap-2">
                  {week.map((d, i) => (
                    <button key={d.key} type="button" onClick={() => setSel(i)} className="flex h-full flex-1 flex-col items-center justify-end gap-2" aria-label={`${d.key}: ${formatMoney(d.earnings, cur)}`}>
                      <span className="w-full max-w-9 rounded-t-sm transition-[height] duration-700 ease-[var(--sw-ease-atelier)]" style={{ height: `${Math.max(3, (d.earnings / maxE) * 100)}%`, background: i === si ? 'var(--sw-ink)' : 'var(--sw-hairline)' }} />
                      <span className={cn('t-caption', i === si ? 'text-ink' : 'text-muted')}>{d.day}</span>
                    </button>
                  ))}
                </div>
              </div>
              {bal && (
                <Reveal className="mt-3">
                  <div data-theme="dark" className="rounded-md bg-canvas p-5">
                    <p className="t-label text-accent">{t('rider.unpaid')}</p>
                    <p className="t-display-m mt-1 text-ink">{formatMoney(int(bal, 'unpaid', int(bal, 'amount')), cur)}</p>
                    <p className="t-caption mt-1 text-muted">{t('rider.unpaidHint')}</p>
                  </div>
                </Reveal>
              )}
              {list(h.data, 'payouts').length > 0 && (
                <>
                  <SectionHeader title={t('rider.payouts')} className="!px-0 !pb-2 !pt-8" />
                  {list(h.data, 'payouts').map((p, i) => (
                    <div key={i} className="flex items-center gap-3 py-3">
                      <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft"><Icon icon={Ic.wallet} size={18} /></span>
                      <div className="flex-1">
                        <p className="t-title-s">{t(`rider.payout.${str(p, 'status')}`)}</p>
                        <p className="t-caption text-muted">{str(p, 'method') === 'manual' ? t('rider.payout.manual') : str(p, 'recipient')}</p>
                      </div>
                      <p className="t-price-s">{formatMoney(int(p, 'amount'), cur)}</p>
                    </div>
                  ))}
                </>
              )}
              <SectionHeader title={t('rider.history')} className="!px-0 !pb-2 !pt-8" />
              {list(h.data, 'items').map((j, i) => (
                <Reveal key={i} index={i}>
                  <div className="flex items-center gap-3 py-3">
                    <span className="flex size-10 items-center justify-center rounded-full" style={{ background: str(j, 'status') === 'COMPLETED' ? 'var(--sw-success-soft)' : 'color-mix(in srgb, var(--sw-ink) 5%, transparent)', color: str(j, 'status') === 'COMPLETED' ? 'var(--sw-success)' : 'var(--sw-muted)' }}>
                      <Icon icon={str(j, 'status') === 'COMPLETED' ? Ic.check : Ic.x} size={18} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="t-title-s truncate">{`${str(j, 'orderNumber')} · ${str(j, 'area') || str(j, 'store')}`}</p>
                      <p className="t-caption text-muted">{`${str(j, 'store')} · ${fmtDistance(j.distanceMeters as number)}`}</p>
                    </div>
                    <p className="t-price-s">{int(j, 'earning') > 0 ? formatMoney(int(j, 'earning'), cur) : '—'}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          );
        })()
      )}
    </SubPage>
  );
}

