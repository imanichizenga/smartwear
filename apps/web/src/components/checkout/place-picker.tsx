'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { LucideIcon } from 'lucide-react';
import { SwMap, useHasLiveMap } from '../map/sw-map';
import { ALoader } from '../ui/aloader';
import { SwButton, SwIconButton } from '../ui/button';
import { Ic, Icon } from '../ui/icons';
import { ChoiceChip, SearchBar, Skeleton, TextField } from '../ui/kit';
import { openSheet, toast } from '../ui/overlay';
import { api, ApiException } from '@/lib/api';
import { getDelivery, locate, setPoint } from '@/lib/delivery';
import { DAR, fmtDistance, toLatLng, type LatLng } from '@/lib/geo';
import { useT } from '@/lib/hooks';
import { int, list, num, str, strN, type Json } from '@/lib/json';
import { getSession } from '@/lib/session';

const session = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

/** "Where to?" — saved places, recent, then live Places results. Resolves true when a point was set. */
export async function showPlacePicker(): Promise<boolean> {
  const r = await openSheet<boolean>((close) => <PlaceSearch close={close} />, { expand: true });
  return r === true;
}

export function usePlaces() {
  return useQuery({ queryKey: ['me', 'places'], queryFn: () => api.get<Json>('/me/places'), enabled: getSession().signedIn });
}

function PlaceSearch({ close }: { close: (v?: boolean) => void }) {
  const t = useT();
  const places = usePlaces().data;
  const live = useHasLiveMap();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Json[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tok = useRef(session());
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setResults([]);
      return;
    }
    const n = ++seq.current;
    const id = setTimeout(async () => {
      setLoading(true);
      const here = getDelivery().point?.point;
      try {
        const r = await api.get<Json>('/maps/autocomplete', { q: text, session: tok.current, lat: here?.lat, lng: here?.lng });
        if (n === seq.current) {
          setResults(list(r, 'items'));
          setError(null);
        }
      } catch (e) {
        if (n === seq.current) setError(e instanceof ApiException && e.code === 'not_configured' ? t('checkout.setOnMap') : e instanceof ApiException ? e.message : t('common.error.body'));
      } finally {
        if (n === seq.current) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(id);
  }, [q, t]);

  const pick = async (item: Json) => {
    let d = item;
    let loc = toLatLng(item.location);
    if (!loc) {
      try {
        d = await api.get<Json>(`/maps/places/${encodeURIComponent(str(item, 'placeId'))}`, { session: tok.current });
        loc = toLatLng(d.location) ?? { lat: num(d, 'lat'), lng: num(d, 'lng') };
      } catch (e) {
        toast(e instanceof ApiException ? e.message : t('common.error.body'), { error: true });
        return;
      }
    }
    setPoint({ point: loc, label: strN(d, 'address') ?? strN(item, 'secondary') ?? str(item, 'primary'), area: strN(d, 'area') ?? strN(item, 'primary'), source: 'search', placeId: strN(item, 'placeId') });
    close(true);
  };
  const pickSaved = (p: Json) => {
    const at = toLatLng(p.location);
    if (!at) return;
    setPoint({ point: at, label: str(p, 'address'), area: strN(p, 'area') ?? strN(p, 'label'), landmark: strN(p, 'landmarkNote'), source: 'saved' });
    close(true);
  };
  const setOnMap = async () => {
    const ok = await openSetOnMap();
    if (ok) close(true);
  };
  const searching = q.trim().length >= 2;
  const saved = list(places, 'saved');
  const recent = list(places, 'recent');

  return (
    <div className="flex h-[80dvh] flex-col md:h-[70vh]">
      <div className="px-5 pt-2">
        <h2 className="t-display-s mb-3">{t('checkout.deliverTo')}</h2>
        <SearchBar value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('checkout.searchPlaces')} autoFocus trailing={loading ? <span className="mr-3"><ALoader size="sm" /></span> : null} />
      </div>
      <div className="mt-2 min-h-0 flex-1 overflow-y-auto pb-10">
        {!searching ? (
          <>
            <Row
              icon={Ic.locateFixed}
              accent
              title={t('checkout.useCurrent')}
              onPress={async () => {
                close(true);
                const ok = await locate();
                if (!ok) toast(t('checkout.locationDenied'), { error: true });
              }}
            />
            {live && <Row icon={Ic.mapPin} title={t('checkout.setOnMap')} subtitle={t('checkout.moveMap')} onPress={setOnMap} />}
            {saved.length > 0 && <p className="t-label px-5 pb-2 pt-6 text-muted">{t('checkout.savedPlaces')}</p>}
            {saved.map((p) => (
              <Row key={str(p, 'id')} icon={str(p, 'kind') === 'home' ? Ic.house : str(p, 'kind') === 'work' ? Ic.briefcase : Ic.bookmark} title={str(p, 'label') || str(p, 'address')} subtitle={str(p, 'address')} onPress={() => pickSaved(p)} />
            ))}
            {recent.length > 0 && <p className="t-label px-5 pb-2 pt-6 text-muted">{t('checkout.recent')}</p>}
            {recent.map((p, i) => (
              <Row key={i} icon={Ic.history} title={str(p, 'label') || str(p, 'area') || str(p, 'address') || t('checkout.droppedPin')} subtitle={str(p, 'landmarkNote') || str(p, 'address')} onPress={() => pickSaved(p)} />
            ))}
          </>
        ) : (
          <>
            {error && <p className="t-body-s p-5 text-muted">{error}</p>}
            {results.map((r, i) => (
              <Row
                key={str(r, 'placeId') || i}
                icon={str(r, 'kind') === 'plus_code' ? Ic.crosshair : Ic.mapPin}
                title={<Highlight text={str(r, 'primary')} matches={list(r, 'matches')} />}
                subtitle={[str(r, 'secondary'), r.distanceMeters != null ? fmtDistance(num(r, 'distanceMeters')) : ''].filter(Boolean).join(' · ')}
                onPress={() => pick(r)}
              />
            ))}
            {live && <Row icon={Ic.mapPin} title={t('checkout.setOnMap')} subtitle={t('checkout.moveMap')} onPress={setOnMap} />}
          </>
        )}
      </div>
    </div>
  );
}

function Highlight({ text, matches }: { text: string; matches: Json[] }) {
  if (!matches.length) return <>{text}</>;
  const out: React.ReactNode[] = [];
  let i = 0;
  matches.forEach((m, k) => {
    const a = Math.max(0, Math.min(text.length, int(m, 'start')));
    const b = Math.max(0, Math.min(text.length, int(m, 'end')));
    if (a > i) out.push(<span key={`a${k}`} className="font-medium text-muted">{text.slice(i, a)}</span>);
    out.push(<span key={`b${k}`} className="font-bold">{text.slice(a, b)}</span>);
    i = b;
  });
  if (i < text.length) out.push(<span key="z" className="font-medium text-muted">{text.slice(i)}</span>);
  return <>{out}</>;
}

function Row({ icon, title, subtitle, onPress, accent }: { icon: LucideIcon; title: React.ReactNode; subtitle?: string; onPress: () => unknown; accent?: boolean }) {
  return (
    <button type="button" onClick={() => void onPress()} className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-[color-mix(in_srgb,var(--sw-ink)_3%,transparent)]">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full" style={{ background: accent ? 'var(--sw-accent-soft)' : 'color-mix(in srgb, var(--sw-ink) 5%, transparent)' }}>
        <Icon icon={icon} size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-title-s block truncate">{title}</span>
        {subtitle && <span className="t-caption block truncate text-muted">{subtitle}</span>}
      </span>
    </button>
  );
}

/* ================================================================== set on map */

export async function openSetOnMap(): Promise<boolean> {
  const r = await openSheet<boolean>((close) => <SetOnMap close={close} />, { wide: true, expand: true });
  return r === true;
}

/** Fixed centre pin over a draggable map; the address updates when the map settles. Optional Home/Work save. */
function SetOnMap({ close }: { close: (v?: boolean) => void }) {
  const t = useT();
  const qc = useQueryClient();
  const startRef = useRef<LatLng>(getDelivery().point?.point ?? DAR);
  const [at, setAt] = useState<LatLng>(startRef.current);
  const [moving, setMoving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [place, setPlace] = useState<{ label: string | null; area: string | null }>({ label: null, area: null });
  const [landmark, setLandmark] = useState(getDelivery().point?.landmark ?? '');
  const [saveAs, setSaveAs] = useState<string | null>(null);
  const seq = useRef(0);

  const resolve = async (p: LatLng) => {
    const n = ++seq.current;
    setResolving(true);
    setMoving(false);
    try {
      const r = await api.get<Json>('/maps/reverse', { lat: p.lat, lng: p.lng });
      if (n === seq.current) setPlace({ label: strN(r, 'address'), area: strN(r, 'area') });
    } catch {
      if (n === seq.current) setPlace({ label: null, area: null });
    } finally {
      if (n === seq.current) setResolving(false);
    }
  };
  useEffect(() => {
    void resolve(startRef.current);
  }, []);

  const confirm = async () => {
    const lm = landmark.trim() || null;
    setPoint({ point: at, label: place.label, area: place.area, landmark: lm, source: 'map' });
    if (saveAs) {
      try {
        await api.post('/me/places', { kind: saveAs, lat: at.lat, lng: at.lng, address: place.label ?? 'Pinned location', area: place.area, landmarkNote: lm });
        void qc.invalidateQueries({ queryKey: ['me', 'places'] });
      } catch {
        /* saving is a convenience; the order still uses the pin */
      }
    }
    close(true);
  };

  return (
    <div className="flex flex-col">
      <div className="relative h-[46dvh] min-h-[280px] md:h-[420px]">
        <SwMap center={startRef.current} zoom={17} onMoveStart={() => setMoving(true)} onCameraIdle={(p) => { setAt(p); void resolve(p); }} />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="flex flex-col items-center" style={{ marginTop: -22 }}>
            <div className="flex flex-col items-center transition-transform duration-[220ms]" style={{ transform: moving ? 'translateY(-10px)' : 'none', transitionTimingFunction: moving ? 'var(--sw-ease-atelier)' : 'cubic-bezier(0.34,1.56,0.64,1)' }}>
              <span className="block size-[26px] rounded-full" style={{ background: 'var(--sw-map-client)', border: '4px solid var(--sw-map-ring)', boxShadow: '0 4px 10px rgba(0,0,0,.3)' }} />
              <span className="block h-[18px] w-[2.5px]" style={{ background: 'var(--sw-map-client)' }} />
            </div>
            <span className="block h-1 rounded transition-all duration-[220ms]" style={{ width: moving ? 14 : 8, background: `color-mix(in srgb, var(--sw-ink) ${moving ? 15 : 30}%, transparent)` }} />
          </div>
        </div>
        <div className="absolute left-4 top-4">
          <SwIconButton icon={Ic.locateFixed} filled label={t('checkout.useCurrent')} onPress={async () => {
            if (await locate()) {
              const p = getDelivery().point?.point;
              if (p) {
                startRef.current = { ...p };
                setAt(p);
                void resolve(p);
              }
            }
          }} />
        </div>
      </div>
      <div className="px-5 pb-5 pt-5">
        <p className="t-label text-muted">{t('checkout.moveMap')}</p>
        <div className="mt-2 h-[52px]">
          {moving || resolving ? (
            <Skeleton w={220} h={18} className="mt-2" />
          ) : (
            <div>
              <p className="t-title-l truncate">{place.area ?? place.label ?? t('checkout.currentLocation')}</p>
              {place.label && place.area && <p className="t-caption truncate text-muted">{place.label}</p>}
            </div>
          )}
        </div>
        <TextField value={landmark} onChange={(e) => setLandmark(e.target.value)} placeholder={t('checkout.landmarkPlaceholder')} leadingIcon={Ic.flower2} maxLength={120} className="mt-3" />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="t-caption mr-1 text-muted">{t('checkout.saveAs')}</span>
          <ChoiceChip label={t('places.home')} leading={<Icon icon={Ic.house} size={14} />} selected={saveAs === 'home'} onPress={() => setSaveAs(saveAs === 'home' ? null : 'home')} />
          <ChoiceChip label={t('places.work')} leading={<Icon icon={Ic.briefcase} size={14} />} selected={saveAs === 'work'} onPress={() => setSaveAs(saveAs === 'work' ? null : 'work')} />
        </div>
        <div className="mt-4">
          <SwButton label={t('checkout.confirmLocation')} icon={Ic.check} large expand onPress={moving ? null : confirm} />
        </div>
      </div>
    </div>
  );
}
