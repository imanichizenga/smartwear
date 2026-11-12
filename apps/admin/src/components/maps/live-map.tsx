'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AdvancedMarker, APIProvider, ColorScheme, Map as GMap, Polygon, Polyline, useMap } from '@vis.gl/react-google-maps';
import { Minus, Plus, Scan } from 'lucide-react';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { boundsOf, decodePolyline, type LatLng } from '@/lib/geo';
import { MarkerDot, type MarkerKind, type RiderState } from './markers';
import { useGlide } from './use-glide';

export interface MapMarker {
  id: string;
  kind: MarkerKind;
  position: LatLng;
  heading?: number | null;
  state?: RiderState;
  label?: string;
  selected?: boolean;
  dimmed?: boolean;
  dropTarget?: boolean;
  onClick?: () => void;
  /** Accepts HTML5 drops (drag an order onto a rider). */
  onDrop?: (data: string) => void;
}
export interface MapRoute {
  id: string;
  /** Encoded polyline or points. */
  path: string | LatLng[];
  tone?: 'primary' | 'secondary';
  dashed?: boolean;
}
export interface MapZone {
  id: string;
  name: string;
  /** [lng, lat] pairs, as the API sends them. */
  polygon: [number, number][];
  color: string;
}
export interface LiveMapProps {
  markers: MapMarker[];
  routes?: MapRoute[];
  zones?: MapZone[];
  /** Changing this re-fits the camera to everything on the map. */
  fitKey?: string;
  className?: string;
  overlay?: ReactNode;
  /** Map click (set a pin). */
  onMapClick?: (p: LatLng) => void;
  /** Fallback centre when there is nothing to show (Dar es Salaam). */
  center?: LatLng;
}

interface MapsConfig {
  browserApiKey: string | null;
  mapId: string | null;
  regionCode: string;
  language: string;
}

const DAR: LatLng = { lat: -6.7924, lng: 39.2083 };
const toPath = (p: MapRoute['path']) => (typeof p === 'string' ? decodePolyline(p) : p);

/** One map for every admin screen: Google when a browser key is configured, otherwise a schematic plan view. */
export function LiveMap(props: LiveMapProps) {
  const { data: cfg, isPending } = useQuery({ queryKey: ['maps-config'], queryFn: () => api<MapsConfig>('/admin/maps/config'), staleTime: 10 * 60_000 });
  return (
    <div className={cn('relative overflow-hidden bg-canvas', props.className)}>
      {isPending ? <div className="sw-skeleton absolute inset-0 rounded-none" /> : cfg?.browserApiKey ? <GoogleLiveMap {...props} cfg={cfg} /> : <SchematicMap {...props} />}
      {props.overlay}
    </div>
  );
}

/* ================================================================== Google */
function useDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => setDark(document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches));
    read();
    const mo = new MutationObserver(read);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);
  return dark;
}

function GoogleLiveMap({ markers, routes = [], zones = [], fitKey, onMapClick, center = DAR, cfg }: LiveMapProps & { cfg: MapsConfig }) {
  const dark = useDark();
  return (
    <APIProvider apiKey={cfg.browserApiKey!} region={cfg.regionCode.toUpperCase()} language={cfg.language}>
      <GMap
        className="absolute inset-0"
        mapId={cfg.mapId ?? 'DEMO_MAP_ID'}
        defaultCenter={center}
        defaultZoom={13}
        gestureHandling="greedy"
        disableDefaultUI
        clickableIcons={false}
        colorScheme={dark ? ColorScheme.DARK : ColorScheme.LIGHT}
        onClick={(e) => e.detail.latLng && onMapClick?.(e.detail.latLng)}
      >
        {zones.map((z) => (
          <Polygon key={z.id} clickable={false} paths={[z.polygon.map(([lng, lat]) => ({ lat, lng }))]} strokeColor={z.color} strokeOpacity={0.7} strokeWeight={1.5} fillColor={z.color} fillOpacity={0.08} />
        ))}
        {routes.map((r) =>
          r.dashed ? (
            <Polyline key={r.id} path={toPath(r.path)} strokeOpacity={0} icons={[{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeColor: '#B8955A', scale: 3 }, offset: '0', repeat: '12px' }]} />
          ) : (
            <Polyline key={r.id} path={toPath(r.path)} strokeColor={r.tone === 'secondary' ? '#B8955A' : dark ? '#F5F2EC' : '#0B0B0C'} strokeOpacity={0.9} strokeWeight={4} />
          ),
        )}
        {markers.map((m) => (
          <GoogleMarker key={m.id} m={m} />
        ))}
        <FitBounds markers={markers} routes={routes} fitKey={fitKey} />
      </GMap>
    </APIProvider>
  );
}

function GoogleMarker({ m }: { m: MapMarker }) {
  const g = useGlide(m.position, m.heading);
  return (
    <AdvancedMarker position={g.pos} onClick={m.onClick} zIndex={m.kind === 'rider' ? 30 : m.kind === 'client' ? 20 : 10} anchorPoint={['50%', '50%']}>
      <DropZone onDrop={m.onDrop}>
        <MarkerDot kind={m.kind} heading={g.heading} state={m.state} label={m.label} selected={m.selected} dimmed={m.dimmed} dropTarget={m.dropTarget} />
      </DropZone>
    </AdvancedMarker>
  );
}

function FitBounds({ markers, routes, fitKey }: { markers: MapMarker[]; routes: MapRoute[]; fitKey?: string }) {
  const map = useMap();
  const done = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!map || done.current === (fitKey ?? 'once')) return;
    const pts = [...markers.map((m) => m.position), ...routes.flatMap((r) => toPath(r.path))];
    const b = boundsOf(pts);
    if (!b) return;
    done.current = fitKey ?? 'once';
    if (pts.length === 1) {
      map.setCenter(pts[0]!);
      map.setZoom(15);
    } else map.fitBounds({ north: b.n, south: b.s, east: b.e, west: b.w }, 64);
  }, [map, markers, routes, fitKey]);
  return null;
}

function DropZone({ onDrop, children }: { onDrop?: (d: string) => void; children: ReactNode }) {
  const [over, setOver] = useState(false);
  if (!onDrop) return <>{children}</>;
  return (
    <span
      className={cn('block rounded-full p-2 transition-transform duration-150', over && 'scale-125')}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const d = e.dataTransfer.getData('text/plain');
        if (d) onDrop(d);
      }}
    >
      {children}
    </span>
  );
}

/* ================================================================== Schematic (no API key) */
/**
 * Web-Mercator plan view drawn in SVG + HTML pins: zones, routes and live pins, with wheel/drag zoom.
 * Used until a Google Maps browser key is added, so dispatch keeps working on day one.
 */
function SchematicMap({ markers, routes = [], zones = [], fitKey, onMapClick, center = DAR }: LiveMapProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 500 });
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e!.contentRect.width, h: e!.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit everything (markers, routes, zones) with padding; recomputed on fitKey.
  const hasMarkers = markers.length > 0;
  const frame = useMemo(() => {
    const pts = [...markers.map((m) => m.position), ...routes.flatMap((r) => toPath(r.path)), ...zones.flatMap((z) => z.polygon.map(([lng, lat]) => ({ lat, lng })))];
    const b = boundsOf(pts.length ? pts : [center]) ?? { n: center.lat, s: center.lat, e: center.lng, w: center.lng };
    const pad = 0.004;
    return { n: merc(b.n + pad), s: merc(b.s - pad), e: b.e + pad, w: b.w - pad };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, zones.length, hasMarkers]);
  useEffect(() => {
    const t = setTimeout(() => setView({ k: 1, x: 0, y: 0 }), 0);
    return () => clearTimeout(t);
  }, [fitKey]);

  const pad = 56;
  const scale = Math.min((size.w - pad * 2) / Math.max(1e-6, frame.e - frame.w), (size.h - pad * 2) / Math.max(1e-6, (frame.n - frame.s) * (180 / Math.PI)));
  const project = (p: LatLng) => {
    const x = (p.lng - (frame.w + frame.e) / 2) * scale;
    const y = -(merc(p.lat) - (frame.n + frame.s) / 2) * (180 / Math.PI) * scale;
    return { x: size.w / 2 + (x * view.k + view.x), y: size.h / 2 + (y * view.k + view.y) };
  };
  const unproject = (sx: number, sy: number): LatLng => {
    const x = (sx - size.w / 2 - view.x) / view.k / scale;
    const y = -(sy - size.h / 2 - view.y) / view.k / scale / (180 / Math.PI);
    return { lng: x + (frame.w + frame.e) / 2, lat: unmerc(y + (frame.n + frame.s) / 2) };
  };
  const zoom = (f: number, cx = size.w / 2, cy = size.h / 2) =>
    setView((v) => {
      const k = Math.min(12, Math.max(0.5, v.k * f));
      const r = k / v.k;
      return { k, x: (v.x - (cx - size.w / 2)) * r + (cx - size.w / 2), y: (v.y - (cy - size.h / 2)) * r + (cy - size.h / 2) };
    });
  const grid = 40 * view.k;

  return (
    <div
      ref={ref}
      className="absolute inset-0 cursor-grab touch-none select-none active:cursor-grabbing"
      style={{
        backgroundColor: 'var(--sw-canvas)',
        backgroundImage: 'radial-gradient(circle, color-mix(in srgb, var(--sw-ink) 9%, transparent) 1px, transparent 1.2px)',
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${(size.w / 2 + view.x) % grid}px ${(size.h / 2 + view.y) % grid}px`,
      }}
      onWheel={(e) => {
        const r = ref.current!.getBoundingClientRect();
        zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - r.left, e.clientY - r.top);
      }}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) d.moved = true;
        setView((v) => ({ ...v, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }));
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        if (d && !d.moved && onMapClick && e.target === ref.current) {
          const r = ref.current!.getBoundingClientRect();
          onMapClick(unproject(e.clientX - r.left, e.clientY - r.top));
        }
      }}
    >
      <svg className="pointer-events-none absolute inset-0" width={size.w} height={size.h} aria-hidden>
        {zones.map((z) => (
          <g key={z.id}>
            <polygon points={z.polygon.map(([lng, lat]) => { const p = project({ lat, lng }); return `${p.x},${p.y}`; }).join(' ')} fill={z.color} fillOpacity={0.07} stroke={z.color} strokeOpacity={0.65} strokeWidth={1.25} strokeDasharray="5 4" />
          </g>
        ))}
        {routes.map((r) => {
          const pts = toPath(r.path).map(project);
          if (pts.length < 2) return null;
          const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
          return r.dashed ? (
            <path key={r.id} d={d} fill="none" stroke="var(--sw-map-route-secondary)" strokeWidth={2.5} strokeDasharray="2 7" strokeLinecap="round" />
          ) : (
            <g key={r.id}>
              <path d={d} fill="none" stroke="var(--sw-surface)" strokeWidth={8} strokeLinecap="round" strokeLinejoin="round" />
              <path d={d} fill="none" stroke={r.tone === 'secondary' ? 'var(--sw-map-route-secondary)' : 'var(--sw-map-route)'} strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" className="sw-route-draw" />
            </g>
          );
        })}
      </svg>
      {zones.map((z) => {
        const c = z.polygon.reduce((a, [lng, lat]) => ({ lat: a.lat + lat / z.polygon.length, lng: a.lng + lng / z.polygon.length }), { lat: 0, lng: 0 });
        const p = project(c);
        return (
          <span key={`zl-${z.id}`} className="label-caps pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-[10px]" style={{ left: p.x, top: p.y, color: z.color, opacity: 0.85 }}>
            {z.name}
          </span>
        );
      })}
      {markers.map((m) => (
        <SchematicPin key={m.id} m={m} project={project} />
      ))}
      <div className="absolute bottom-3 right-3 flex flex-col overflow-hidden rounded-sm border border-hairline bg-surface shadow-floating" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" aria-label="Zoom in" onClick={() => zoom(1.4)} className="flex size-9 items-center justify-center hover:bg-ink/5"><Plus className="size-4" strokeWidth={1.5} /></button>
        <button type="button" aria-label="Zoom out" onClick={() => zoom(1 / 1.4)} className="flex size-9 items-center justify-center border-t border-hairline hover:bg-ink/5"><Minus className="size-4" strokeWidth={1.5} /></button>
        <button type="button" aria-label="Fit everything" onClick={() => setView({ k: 1, x: 0, y: 0 })} className="flex size-9 items-center justify-center border-t border-hairline hover:bg-ink/5"><Scan className="size-4" strokeWidth={1.5} /></button>
      </div>
      <p className="pointer-events-none absolute bottom-3 left-3 max-w-[60%] text-[11px] text-subtle">Plan view · add a Google Maps browser key in Settings → Maps for street maps</p>
    </div>
  );
}

function SchematicPin({ m, project }: { m: MapMarker; project: (p: LatLng) => { x: number; y: number } }) {
  const g = useGlide(m.position, m.heading);
  const p = project(g.pos);
  return (
    <div
      className={cn('absolute -translate-x-1/2 -translate-y-1/2', m.onClick && 'cursor-pointer')}
      style={{ left: p.x, top: p.y, zIndex: m.kind === 'rider' ? 30 : m.kind === 'client' ? 20 : 10 }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={m.onClick}
      role={m.onClick ? 'button' : undefined}
      aria-label={m.label}
    >
      <DropZone onDrop={m.onDrop}>
        <MarkerDot kind={m.kind} heading={g.heading} state={m.state} label={m.label} selected={m.selected} dimmed={m.dimmed} dropTarget={m.dropTarget} />
      </DropZone>
    </div>
  );
}

function merc(lat: number) {
  const r = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + r / 2));
}
function unmerc(y: number) {
  return ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
}
