'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { APIProvider, Map, useMap } from '@vis.gl/react-google-maps';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DAR, lerpAngle, type LatLng } from '@/lib/geo';
import { useConfig, useMediaQuery, useReducedMotion } from '@/lib/hooks';
import { obj, type Json } from '@/lib/json';
import { usePrefs } from '@/lib/session';
import { cn } from '../ui/cn';
import { Ic, Icon } from '../ui/icons';

export type PinKind = 'client' | 'rider' | 'store';
export interface MapMarker {
  id: string;
  kind: PinKind;
  point: LatLng;
  heading?: number | null;
  label?: string | null;
}
export interface MapRoute {
  id: string;
  points: LatLng[];
  dashed?: boolean;
}
export interface Pad {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}
export interface SwMapProps {
  markers?: MapMarker[];
  routes?: MapRoute[];
  padding?: Pad;
  /** Changing it re-fits the camera to all markers and routes. */
  fitKey?: string;
  /** Fixed camera centre (set-on-map); with onCameraIdle the map reports where it settled. */
  center?: LatLng;
  zoom?: number;
  interactive?: boolean;
  onCameraIdle?: (p: LatLng) => void;
  onMoveStart?: () => void;
  /** Expanding radius rings around the client dot ("Finding your rider…"). */
  searching?: boolean;
  className?: string;
}

/** Browser map config: Google Maps JS when a referrer-restricted browser key exists; else the plan view. */
export function useMapsClient() {
  return useQuery({ queryKey: ['maps-client'], queryFn: () => api.get<Json>('/maps/client-config'), staleTime: 10 * 60_000, retry: 1 });
}
let authFailed = false;
const authSubs = new Set<() => void>();
if (typeof window !== 'undefined') {
  (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => {
    authFailed = true;
    authSubs.forEach((f) => f());
  };
}

/** The one map of the site (checkout, set-on-map, tracking, Rider Mode). */
export function SwMap(props: SwMapProps) {
  const cfg = useMapsClient();
  const [failed, setFailed] = useState(authFailed);
  useEffect(() => {
    const f = () => setFailed(true);
    authSubs.add(f);
    return () => void authSubs.delete(f);
  }, []);
  const key = typeof cfg.data?.browserApiKey === 'string' ? cfg.data.browserApiKey : null;
  return (
    <div className={cn('relative h-full w-full overflow-hidden', props.className)}>
      {cfg.isPending ? <span className="sw-skeleton absolute inset-0" /> : key && !failed ? <GoogleMap {...props} apiKey={key} mapId={(cfg.data?.mapId as string) || undefined} region={String(cfg.data?.regionCode ?? 'tz')} language={String(cfg.data?.language ?? 'en')} /> : <PlanMap {...props} />}
      {props.searching && <SearchRings padding={props.padding} />}
    </div>
  );
}
export const useHasLiveMap = () => {
  const cfg = useMapsClient();
  return !!cfg.data?.browserApiKey && !authFailed;
};

function SearchRings({ padding }: { padding?: Pad }) {
  return (
    <div className="pointer-events-none absolute flex items-center justify-center" style={{ top: padding?.top ?? 0, bottom: padding?.bottom ?? 0, left: 0, right: 0 }}>
      <span className="sw-rings relative block size-[360px]">
        {[0, 1, 2].map((i) => (
          <span key={i} className="absolute inset-0 rounded-full border" style={{ borderColor: 'var(--sw-accent)', background: 'color-mix(in srgb, var(--sw-accent) 6%, transparent)' }} />
        ))}
      </span>
    </div>
  );
}

/* ================================================================== gliding rider */

/** Eases a marker to its latest fix over ~1.2 s (heading the short way round). Reduce Motion snaps. */
function useGlide(p: LatLng, heading?: number | null) {
  const reduce = useReducedMotion();
  const [pos, setPos] = useState({ ...p, h: heading ?? null });
  const from = useRef(pos);
  useEffect(() => {
    if (reduce) return setPos({ ...p, h: heading ?? null });
    const a = from.current;
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - t0) / 1200);
      const e = 1 - Math.pow(1 - t, 3);
      const next = { lat: a.lat + (p.lat - a.lat) * e, lng: a.lng + (p.lng - a.lng) * e, h: a.h != null && heading != null ? lerpAngle(a.h, heading, e) : heading ?? a.h };
      from.current = next;
      setPos(next);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.lat, p.lng, heading, reduce]);
  return pos;
}

/* ================================================================== pins (shared HTML) */

export function Pin({ m, style }: { m: MapMarker; style?: CSSProperties }) {
  if (m.kind === 'client')
    return (
      <span className="pointer-events-none absolute" style={{ ...style, transform: 'translate(-50%,-50%)' }} aria-label="Delivery point">
        <span className="sw-halo absolute left-1/2 top-1/2 -ml-[22px] -mt-[22px] block size-11 rounded-full" style={{ background: 'color-mix(in srgb, var(--sw-map-client) 18%, transparent)' }} />
        <span className="relative block size-[18px] rounded-full" style={{ background: 'var(--sw-map-client)', border: '3px solid var(--sw-map-ring)', boxShadow: '0 2px 6px rgba(0,0,0,.3)' }} />
      </span>
    );
  if (m.kind === 'rider')
    return (
      <span className="pointer-events-none absolute" style={{ ...style, transform: 'translate(-50%,-50%)' }} aria-label="Rider">
        {m.heading != null && (
          <span className="absolute left-1/2 top-1/2 block size-10 -translate-x-1/2 -translate-y-1/2" style={{ transform: `translate(-50%,-50%) rotate(${m.heading}deg)` }}>
            <span className="absolute left-1/2 top-0 -ml-[6px] block h-0 w-0" style={{ borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderBottom: '9px solid var(--sw-map-rider)' }} />
          </span>
        )}
        <span className="relative block size-5 rounded-full" style={{ background: 'var(--sw-map-rider)', border: '3px solid var(--sw-map-ring)', boxShadow: '0 2px 8px rgba(30,107,255,.45)' }} />
      </span>
    );
  return (
    <span className="pointer-events-none absolute flex flex-col items-center" style={{ ...style, transform: 'translate(-50%,-50%)' }} aria-label={m.label ?? 'Store'}>
      <span className="flex size-7 items-center justify-center rounded-full text-white" style={{ background: 'var(--sw-map-office)', border: '2.5px solid var(--sw-map-ring)', boxShadow: '0 2px 8px rgba(0,0,0,.25)' }}>
        <Icon icon={Ic.store} size={13} strokeWidth={2} />
      </span>
      {m.label && <span className="t-caption absolute top-8 whitespace-nowrap rounded-full bg-surface px-2 py-0.5 text-ink shadow-[0_2px_8px_rgba(0,0,0,.12)]">{m.label}</span>}
    </span>
  );
}

function GlidingPin({ m, project }: { m: MapMarker; project: (p: LatLng) => { x: number; y: number } | null }) {
  const g = useGlide(m.point, m.heading);
  const xy = project(g);
  if (!xy) return null;
  return <Pin m={{ ...m, heading: g.h }} style={{ left: xy.x, top: xy.y }} />;
}

/* ================================================================== plan view (no key) */

const R = 6378137;
const merc = (p: LatLng) => ({ x: (R * p.lng * Math.PI) / 180, y: R * Math.log(Math.tan(Math.PI / 4 + (p.lat * Math.PI) / 360)) });
const unmerc = (x: number, y: number): LatLng => ({ lng: (x / R) * (180 / Math.PI), lat: (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI) });

/** Branded plan: soft city blocks + dot grid, the same pins and routes. Pannable / zoomable when interactive. */
function PlanMap({ markers = [], routes = [], padding = {}, fitKey, center, zoom = 15, interactive = true, onCameraIdle, onMoveStart }: SwMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<{ cx: number; cy: number; mpp: number } | null>(null);
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // fit / centre
  useEffect(() => {
    if (!size.w || !size.h) return;
    const pts = [...markers.map((m) => m.point), ...routes.flatMap((r) => r.points)];
    const pt = { top: padding.top ?? 0, bottom: padding.bottom ?? 0, left: padding.left ?? 0, right: padding.right ?? 0 };
    const W = Math.max(40, size.w - pt.left - pt.right);
    const H = Math.max(40, size.h - pt.top - pt.bottom);
    if (center || pts.length <= 1) {
      const c = merc(center ?? pts[0] ?? DAR);
      const mpp = (156543.03392 * Math.cos(((center ?? pts[0] ?? DAR).lat * Math.PI) / 180)) / 2 ** zoom;
      setView({ cx: c.x - ((pt.left - pt.right) / 2) * mpp, cy: c.y + ((pt.top - pt.bottom) / 2) * mpp, mpp });
      return;
    }
    const ms = pts.map(merc);
    const minX = Math.min(...ms.map((m) => m.x)), maxX = Math.max(...ms.map((m) => m.x));
    const minY = Math.min(...ms.map((m) => m.y)), maxY = Math.max(...ms.map((m) => m.y));
    const mpp = Math.max((maxX - minX) / W, (maxY - minY) / H, 1.2) * 1.15;
    const cx = (minX + maxX) / 2 - ((pt.left - pt.right) / 2) * mpp;
    const cy = (minY + maxY) / 2 + ((pt.top - pt.bottom) / 2) * mpp;
    setView({ cx, cy, mpp });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, fitKey, center?.lat, center?.lng]);

  const project = (p: LatLng) => {
    if (!view) return null;
    const m = merc(p);
    return { x: size.w / 2 + (m.x - view.cx) / view.mpp, y: size.h / 2 - (m.y - view.cy) / view.mpp };
  };
  const settle = (v: { cx: number; cy: number; mpp: number }) => {
    if (!onCameraIdle) return;
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => {
      const pt = { top: padding.top ?? 0, bottom: padding.bottom ?? 0, left: padding.left ?? 0, right: padding.right ?? 0 };
      onCameraIdle(unmerc(v.cx + ((pt.left - pt.right) / 2) * v.mpp, v.cy - ((pt.top - pt.bottom) / 2) * v.mpp));
    }, 250);
  };

  const grid = 22;
  const ox = view ? ((-view.cx / view.mpp) % (grid * 4)) + size.w / 2 : 0;
  const oy = view ? ((view.cy / view.mpp) % (grid * 4)) + size.h / 2 : 0;
  return (
    <div
      ref={box}
      className={cn('absolute inset-0 touch-none select-none bg-canvas', interactive && 'cursor-grab active:cursor-grabbing')}
      onPointerDown={(e) => {
        if (!interactive || !view) return;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        drag.current = { x: e.clientX, y: e.clientY, cx: view.cx, cy: view.cy };
        onMoveStart?.();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d || !view) return;
        setView({ ...view, cx: d.cx - (e.clientX - d.x) * view.mpp, cy: d.cy + (e.clientY - d.y) * view.mpp });
      }}
      onPointerUp={() => {
        if (drag.current && view) settle(view);
        drag.current = null;
      }}
      onWheel={(e) => {
        if (!interactive || !view) return;
        const k = Math.exp(e.deltaY * 0.0015);
        const v = { ...view, mpp: Math.min(400, Math.max(0.15, view.mpp * k)) };
        setView(v);
        settle(v);
      }}
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          backgroundImage: `radial-gradient(color-mix(in srgb, var(--sw-ink) 8%, transparent) 0.9px, transparent 1.2px), linear-gradient(color-mix(in srgb, var(--sw-ink) 2.5%, transparent), color-mix(in srgb, var(--sw-ink) 2.5%, transparent))`,
          backgroundSize: `${grid}px ${grid}px, ${grid * 4 - 12}px ${grid * 4 - 12}px`,
          backgroundPosition: `${ox}px ${oy}px, ${ox + 6}px ${oy + 6}px`,
          maskImage: undefined,
        }}
      />
      {view && (
        <svg className="absolute inset-0 h-full w-full overflow-visible">
          {routes.map((r) => {
            const pts = r.points.map(project).filter(Boolean) as { x: number; y: number }[];
            if (pts.length < 2) return null;
            const d = `M${pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join('L')}`;
            return <RoutePath key={r.id + fitKey} d={d} dashed={!!r.dashed} />;
          })}
        </svg>
      )}
      {view &&
        markers.map((m) =>
          m.kind === 'rider' ? (
            <GlidingPin key={m.id} m={m} project={project} />
          ) : (
            (() => {
              const xy = project(m.point);
              return xy ? <Pin key={m.id} m={m} style={{ left: xy.x, top: xy.y }} /> : null;
            })()
          ),
        )}
    </div>
  );
}

function RoutePath({ d, dashed }: { d: string; dashed: boolean }) {
  const ref = useRef<SVGPathElement>(null);
  const [len, setLen] = useState(0);
  useEffect(() => setLen(ref.current?.getTotalLength() ?? 0), [d]);
  if (dashed) return <path d={d} fill="none" stroke="var(--sw-map-route-secondary)" strokeWidth={3.2} strokeLinecap="round" strokeDasharray="0 10" />;
  return (
    <g>
      <path d={d} fill="none" stroke="var(--sw-surface)" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
      <path ref={ref} d={d} fill="none" stroke="var(--sw-map-route)" strokeWidth={4.5} strokeLinecap="round" strokeLinejoin="round" className={len ? 'sw-route-draw' : undefined} style={len ? ({ strokeDasharray: len, ['--len' as string]: len } as CSSProperties) : undefined} />
      {len > 0 && <path d={d} fill="none" stroke="var(--sw-accent)" strokeWidth={2.2} strokeLinecap="round" className="sw-stitch-run" style={{ strokeDasharray: `${Math.min(46, len * 0.3)} ${len}`, animationDelay: '900ms', opacity: 0.9 }} />}
    </g>
  );
}

/* ================================================================== Google Maps JS */

function GoogleMap(props: SwMapProps & { apiKey: string; mapId?: string; region: string; language: string }) {
  const cfg = useConfig().data;
  const { theme } = usePrefs();
  const sysDark = useMediaQuery('(prefers-color-scheme: dark)');
  const dark = theme === 'dark' || (theme === 'system' && sysDark);
  const styles = (obj(cfg, 'maps_google')?.[dark ? 'mapStyleDark' : 'mapStyleLight'] as google.maps.MapTypeStyle[] | undefined) ?? undefined;
  const start = props.center ?? props.markers?.[0]?.point ?? DAR;
  return (
    <APIProvider apiKey={props.apiKey} region={props.region.toUpperCase()} language={props.language}>
      <Map
        key={dark ? 'd' : 'l'}
        defaultCenter={start}
        defaultZoom={props.zoom ?? 15}
        mapId={props.mapId}
        styles={props.mapId ? undefined : styles}
        disableDefaultUI
        clickableIcons={false}
        keyboardShortcuts={false}
        gestureHandling={props.interactive === false ? 'none' : 'greedy'}
        backgroundColor={dark ? '#0E0E10' : '#F3F1EC'}
        className="absolute inset-0"
      >
        <GoogleLayers {...props} />
      </Map>
    </APIProvider>
  );
}

function GoogleLayers({ markers = [], routes = [], padding = {}, fitKey, center, interactive, onCameraIdle, onMoveStart }: SwMapProps) {
  const map = useMap();
  const [, force] = useState(0);
  const overlay = useRef<google.maps.OverlayView | null>(null);
  const lines = useRef<google.maps.Polyline[]>([]);
  const pad = useMemo(() => ({ top: padding.top ?? 0, right: padding.right ?? 0, bottom: padding.bottom ?? 0, left: padding.left ?? 0 }), [padding.top, padding.right, padding.bottom, padding.left]);

  // A projection overlay so the HTML pins can sit at lat/lng and follow the camera.
  useEffect(() => {
    if (!map) return;
    const o = new google.maps.OverlayView();
    o.onAdd = () => undefined;
    o.draw = () => force((n) => n + 1);
    o.onRemove = () => undefined;
    o.setMap(map);
    overlay.current = o;
    const l1 = map.addListener('bounds_changed', () => force((n) => n + 1));
    const l2 = map.addListener('dragstart', () => onMoveStart?.());
    const l3 = map.addListener('idle', () => {
      const c = map.getCenter();
      if (c && onCameraIdle) onCameraIdle({ lat: c.lat(), lng: c.lng() });
    });
    return () => {
      o.setMap(null);
      l1.remove();
      l2.remove();
      l3.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Camera fit.
  useEffect(() => {
    if (!map) return;
    const pts = [...markers.map((m) => m.point), ...routes.flatMap((r) => r.points)];
    if (center) {
      map.panTo(center);
      return;
    }
    if (pts.length === 1) {
      map.setCenter(pts[0]!);
      map.setZoom(15);
    } else if (pts.length > 1) {
      const b = new google.maps.LatLngBounds();
      pts.forEach((p) => b.extend(p));
      map.fitBounds(b, pad);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey]);

  // Routes with a 900 ms draw-on.
  useEffect(() => {
    if (!map) return;
    lines.current.forEach((l) => l.setMap(null));
    lines.current = [];
    const raf: number[] = [];
    for (const r of routes) {
      if (r.points.length < 2) continue;
      if (r.dashed) {
        lines.current.push(new google.maps.Polyline({ map, path: r.points, strokeOpacity: 0, icons: [{ icon: { path: google.maps.SymbolPath.CIRCLE, fillOpacity: 1, fillColor: '#B8955A', strokeOpacity: 0, scale: 2 }, offset: '0', repeat: '10px' }] }));
        continue;
      }
      lines.current.push(new google.maps.Polyline({ map, path: r.points, strokeColor: '#FFFFFF', strokeWeight: 9, strokeOpacity: 1, zIndex: 1 }));
      const ink = new google.maps.Polyline({ map, path: [r.points[0]!], strokeColor: getComputedStyle(document.documentElement).getPropertyValue('--sw-map-route').trim() || '#0B0B0C', strokeWeight: 4.5, zIndex: 2 });
      lines.current.push(ink);
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / 900);
        const n = Math.max(2, Math.ceil(r.points.length * (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)));
        ink.setPath(r.points.slice(0, n));
        if (t < 1) raf.push(requestAnimationFrame(tick));
      };
      raf.push(requestAnimationFrame(tick));
    }
    return () => raf.forEach(cancelAnimationFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, JSON.stringify(routes.map((r) => [r.id, r.points.length, r.points[0], r.points[r.points.length - 1], r.dashed]))]);
  useEffect(() => () => lines.current.forEach((l) => l.setMap(null)), []);

  useEffect(() => {
    map?.setOptions({ gestureHandling: interactive === false ? 'none' : 'greedy' });
  }, [map, interactive]);

  const project = (p: LatLng) => {
    const proj = overlay.current?.getProjection();
    if (!proj) return null;
    const pt = proj.fromLatLngToContainerPixel(new google.maps.LatLng(p.lat, p.lng));
    return pt ? { x: pt.x, y: pt.y } : null;
  };
  return (
    <div className="pointer-events-none absolute inset-0 z-[1]">
      {markers.map((m) =>
        m.kind === 'rider' ? (
          <GlidingPin key={m.id} m={m} project={project} />
        ) : (
          (() => {
            const xy = project(m.point);
            return xy ? <Pin key={m.id} m={m} style={{ left: xy.x, top: xy.y }} /> : null;
          })()
        ),
      )}
    </div>
  );
}
