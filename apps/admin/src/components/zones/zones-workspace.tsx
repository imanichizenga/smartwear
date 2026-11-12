'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Hexagon, MapPin, Plus, Save, Trash2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { LiveMap, type MapMarker, type MapZone } from '@/components/maps/live-map';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Card, Chip, EmptyState, PageHeader, Switch } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { cn } from '@/lib/cn';
import { fmtMoney } from '@/lib/format';
import type { LatLng } from '@/lib/geo';

interface ZoneRow {
  id: string;
  name: string;
  polygon: [number, number][];
  flatFee: number | null;
  surcharge: number;
  serviceable: boolean;
  priority: number;
  color: string;
  isActive: boolean;
}
type Draft = Omit<ZoneRow, 'id'> & { id?: string };

/** Muted, map-friendly tones that sit with the champagne accent (never neon). */
const SWATCHES = ['#B8955A', '#1E6BFF', '#6E8B74', '#A86F5C', '#7C6FA8', '#5F7F9A', '#9A8A5F', '#0B0B0C'];

/** Drop an octagon of radius r km around a point — a quick start that admins then refine. */
function octagon(c: LatLng, km = 1.2): [number, number][] {
  const k = 1 / Math.cos((c.lat * Math.PI) / 180);
  return Array.from({ length: 8 }, (_, a) => {
    const t = (a * Math.PI) / 4 + Math.PI / 8;
    return [c.lng + (km / 111.32) * k * Math.cos(t), c.lat + (km / 110.57) * Math.sin(t)] as [number, number];
  });
}

/** Open ring (API returns closed rings: first point repeated at the end). */
const openRing = (p: [number, number][]) => {
  const a = p[0], b = p.at(-1);
  return p.length > 1 && a && b && a[0] === b[0] && a[1] === b[1] ? p.slice(0, -1) : p;
};

/** Approximate area in km² (equirectangular shoelace — fine at city scale). */
function areaKm2(p: [number, number][]) {
  const ring = openRing(p);
  if (ring.length < 3) return 0;
  const lat0 = (ring.reduce((a, [, y]) => a + y, 0) / ring.length) * (Math.PI / 180);
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    s += x1 * 111.32 * Math.cos(lat0) * (y2 * 110.57) - x2 * 111.32 * Math.cos(lat0) * (y1 * 110.57);
  }
  return Math.abs(s / 2);
}

export function ZonesWorkspace() {
  const qc = useQueryClient();
  const canManage = useCan('settings.manage');
  const { data } = useQuery({ queryKey: ['zones'], queryFn: () => api<{ items: ZoneRow[] }>('/admin/zones') });
  const { data: stores } = useQuery({ queryKey: ['stores'], queryFn: () => api<{ items: { id: string; name: string; location: LatLng; isActive: boolean }[] }>('/admin/stores') });
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const items = data?.items ?? [];

  const storeMarkers: MapMarker[] = (stores?.items ?? []).filter((s) => s.isActive).map((s) => ({ id: `s-${s.id}`, kind: 'store', position: s.location, label: s.name }));
  const zones: MapZone[] = items.filter((z) => z.isActive).map((z) => ({ id: z.id, name: z.name, polygon: z.polygon, color: sel === z.id ? '#0B0B0C' : z.serviceable ? z.color : '#A86F5C' }));

  const save = async () => {
    if (!draft) return;
    const body = { ...draft, polygon: openRing(draft.polygon) };
    try {
      if (draft.id) await api(`/admin/zones/${draft.id}`, { method: 'PATCH', body });
      else await api('/admin/zones', { body });
      toast.success(`${draft.name} saved — delivery quotes use it right away`);
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['zones'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save the zone');
    }
  };
  const remove = async (z: ZoneRow) => {
    if (!window.confirm(`Delete ${z.name}? Deliveries there fall back to the distance formula.`)) return;
    await api(`/admin/zones/${z.id}`, { method: 'DELETE' });
    toast.success(`${z.name} deleted`);
    await qc.invalidateQueries({ queryKey: ['zones'] });
  };
  const fresh = (): Draft => ({ name: '', polygon: [], flatFee: null, surcharge: 0, serviceable: true, priority: 0, color: SWATCHES[items.length % SWATCHES.length] ?? '#B8955A', isActive: true });

  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        title="Delivery zones"
        description="Neighbourhood outlines on the map. A zone can fix the delivery fee, add a surcharge, or mark an area as not serviced; anywhere else is priced by distance from the nearest store. Zones also name dropped pins when Google Maps isn't configured."
        actions={canManage && <Button icon={<Plus strokeWidth={1.5} />} onClick={() => setDraft(fresh())}>Draw a zone</Button>}
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden">
          <LiveMap className="h-[560px]" markers={storeMarkers} zones={zones} fitKey={`${items.length}`} />
        </Card>
        <Card className="max-h-[560px] overflow-y-auto">
          {items.length === 0 ? (
            <EmptyState icon={<Hexagon />} title="No zones yet" body="Every delivery is priced by distance. Draw a zone to fix fees for a neighbourhood or block an area." />
          ) : (
            <ul className="divide-y divide-hairline">
              {items.map((z) => (
                <li key={z.id} className="group">
                  <div className={cn('flex w-full items-start gap-3 px-5 py-3.5 transition-colors', sel === z.id ? 'bg-accent-soft/60' : 'hover:bg-ink/[0.025]')}>
                    <button type="button" onClick={() => setSel(sel === z.id ? null : z.id)} className="flex min-w-0 flex-1 items-start gap-3 text-left" aria-pressed={sel === z.id}>
                      <span className="mt-1 size-3 shrink-0 rounded-[3px] border" style={{ background: `${z.color}22`, borderColor: z.color }} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2 text-sm font-semibold">
                          {z.name}
                          {!z.isActive && <Chip>Off</Chip>}
                          {!z.serviceable && <Chip tone="danger">No delivery</Chip>}
                        </span>
                        <span className="mt-1 flex flex-wrap gap-1.5">
                          {z.flatFee != null ? <Chip tone="ink">Flat {fmtMoney(z.flatFee)}</Chip> : <Chip>Distance fee</Chip>}
                          {z.surcharge > 0 && <Chip tone="accent">+{fmtMoney(z.surcharge)}</Chip>}
                          <Chip>{areaKm2(z.polygon).toFixed(1)} km²</Chip>
                        </span>
                      </span>
                    </button>
                    {canManage && (
                      <div className="flex shrink-0 gap-1 opacity-70 transition-opacity group-hover:opacity-100">
                        <Button size="sm" variant="ghost" onClick={() => setDraft({ ...z, polygon: openRing(z.polygon) })}>Edit</Button>
                        <Button size="icon-sm" variant="ghost" aria-label={`Delete ${z.name}`} onClick={() => remove(z)}><Trash2 className="size-4" strokeWidth={1.5} /></Button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {draft && <ZoneDialog draft={draft} setDraft={setDraft} others={zones.filter((z) => z.id !== draft.id)} storeMarkers={storeMarkers} onSave={save} />}
    </>
  );
}

function ZoneDialog({ draft, setDraft, others, storeMarkers, onSave }: { draft: Draft; setDraft: (d: Draft | null) => void; others: MapZone[]; storeMarkers: MapMarker[]; onSave: () => Promise<void> }) {
  const [mode, setMode] = useState<'points' | 'octagon'>(draft.polygon.length ? 'points' : 'octagon');
  const [radius, setRadius] = useState(1.2);
  const ring = draft.polygon;
  const vertexMarkers: MapMarker[] = useMemo(() => ring.map(([lng, lat], i) => ({ id: `v${i}`, kind: 'client', position: { lat, lng }, label: `Point ${i + 1}` })), [ring]);
  const zoneLayer: MapZone[] = [...others.map((z) => ({ ...z, color: '#A29D95' })), ...(ring.length >= 2 ? [{ id: 'draft', name: draft.name || 'New zone', polygon: ring, color: draft.color }] : [])];
  const onClick = (p: LatLng) => {
    if (mode === 'octagon') {
      setDraft({ ...draft, polygon: octagon(p, radius) });
      setMode('points');
    } else setDraft({ ...draft, polygon: [...ring, [p.lng, p.lat]] });
  };
  const n = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v.replace(/[^\d.]/g, '')) || 0)));

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && setDraft(null)}
      size="lg"
      title={draft.id ? `Edit ${draft.name}` : 'Draw a delivery zone'}
      description={mode === 'octagon' ? 'Click the centre of the neighbourhood to drop a starting outline.' : 'Click the map to add corners in order. Undo removes the last one.'}
      footer={
        <>
          <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          <ActionButton icon={<Save strokeWidth={1.5} />} onAction={onSave} disabled={ring.length < 3 || !draft.name.trim()}>Save zone</ActionButton>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex flex-col gap-2">
          <div className="overflow-hidden rounded-md border border-hairline">
            <LiveMap className="h-[380px]" markers={[...storeMarkers, ...vertexMarkers]} zones={zoneLayer} fitKey={draft.id ?? 'new'} onMapClick={onClick} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-sm border border-hairline p-0.5" role="radiogroup" aria-label="Drawing mode">
              {(['octagon', 'points'] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={cn('h-7 rounded-[3px] px-2.5 text-xs font-semibold transition-colors', mode === m ? 'bg-ink text-on-ink' : 'text-muted hover:text-ink')}>
                  {m === 'octagon' ? 'Quick outline' : 'Add corners'}
                </button>
              ))}
            </div>
            {mode === 'octagon' && (
              <label className="flex items-center gap-2 text-xs text-muted">
                Radius
                <input type="range" min={0.4} max={4} step={0.1} value={radius} onChange={(e) => setRadius(Number(e.target.value))} className="accent-[var(--sw-accent)]" aria-label="Outline radius in km" />
                <span className="w-12 tabular text-ink">{radius.toFixed(1)} km</span>
              </label>
            )}
            <div className="ml-auto flex gap-1">
              <Button size="sm" variant="ghost" icon={<Undo2 strokeWidth={1.5} />} disabled={!ring.length} onClick={() => setDraft({ ...draft, polygon: ring.slice(0, -1) })}>Undo</Button>
              <Button size="sm" variant="ghost" disabled={!ring.length} onClick={() => { setDraft({ ...draft, polygon: [] }); setMode('octagon'); }}>Clear</Button>
            </div>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-muted tabular">
            <MapPin className="size-3.5" strokeWidth={1.5} />
            {ring.length < 3 ? `${ring.length} of at least 3 corners` : `${ring.length} corners · ${areaKm2(ring).toFixed(2)} km²`}
          </p>
        </div>
        <div className="flex flex-col gap-4">
          <Field label="Name">{(id) => <Input id={id} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Masaki" autoFocus />}</Field>
          <Field label="Flat delivery fee" optional help="Replaces the distance formula inside this zone.">
            {(id) => <Input id={id} inputMode="numeric" value={draft.flatFee ?? ''} onChange={(e) => setDraft({ ...draft, flatFee: n(e.target.value) })} placeholder="Distance-based" trailing={<span className="text-xs">TZS</span>} />}
          </Field>
          <Field label="Surcharge" help="Added on top (e.g. hard-to-reach areas).">
            {(id) => <Input id={id} inputMode="numeric" value={draft.surcharge || ''} onChange={(e) => setDraft({ ...draft, surcharge: n(e.target.value) ?? 0 })} placeholder="0" trailing={<span className="text-xs">TZS</span>} />}
          </Field>
          <Field label="Priority" help="Where zones overlap, the higher number wins.">
            {(id) => <Input id={id} inputMode="numeric" value={String(draft.priority)} onChange={(e) => setDraft({ ...draft, priority: Math.round(Number(e.target.value) || 0) })} />}
          </Field>
          <div>
            <div className="mb-1.5 text-[13px] font-semibold">Colour</div>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Zone colour">
              {SWATCHES.map((c) => (
                <button key={c} type="button" role="radio" aria-checked={draft.color === c} aria-label={c} onClick={() => setDraft({ ...draft, color: c })} className={cn('size-7 rounded-full border-2 transition-transform', draft.color === c ? 'scale-110 border-ink' : 'border-transparent hover:scale-105')} style={{ background: c }} />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-3 rounded-md border border-hairline p-3 text-[13px]">
            <label className="flex items-center justify-between gap-3 font-semibold">We deliver here<Switch checked={draft.serviceable} onCheckedChange={(v) => setDraft({ ...draft, serviceable: v })} label="We deliver here" /></label>
            <label className="flex items-center justify-between gap-3 font-semibold">Active<Switch checked={draft.isActive} onCheckedChange={(v) => setDraft({ ...draft, isActive: v })} label="Active" /></label>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
