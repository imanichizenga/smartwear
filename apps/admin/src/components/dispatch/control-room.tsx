'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, ArrowUpRight, Bike, Clock, GripVertical, MapPin, Package, Radar, Star, Wand2, X } from 'lucide-react';
import { toast } from 'sonner';
import { LoaderA } from '@/components/brand/LoaderA';
import { LiveMap, type MapMarker, type MapRoute } from '@/components/maps/live-map';
import { MapLegend } from '@/components/maps/markers';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton, Button } from '@/components/ui/button';
import { Select } from '@/components/ui/field';
import { Chip, EmptyState } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { cn } from '@/lib/cn';
import { fmtMoney } from '@/lib/format';
import { distanceMeters, fmtDistance, fmtEta } from '@/lib/geo';
import { jobLabel, jobTone, presenceLabel, presenceState, VEHICLES, type DispatchBoard, type DispatchJob, type RiderAdmin } from '@/lib/ops';
import { useRealtime, type RealtimeEvent } from '@/lib/realtime';
import { minutesSince, useNow } from '@/lib/use-now';

type Tab = 'queue' | 'active' | 'riders';
const WAITING = new Set(['SEARCHING', 'OFFERED', 'NO_RIDER']);

export function ControlRoom({ initial, currency }: { initial: DispatchBoard; currency: string }) {
  const qc = useQueryClient();
  const canAssign = useCan('dispatch.assign');
  const now = useNow(10_000);
  const { data = initial, refetch } = useQuery({ queryKey: ['dispatch'], queryFn: () => api<DispatchBoard>('/admin/dispatch'), initialData: initial, staleTime: 5_000 });
  const [tab, setTab] = useState<Tab>('queue');
  const [zone, setZone] = useState('');
  const [selJob, setSelJob] = useState<string | null>(null);
  const [selRider, setSelRider] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const status = useRealtime(
    ['dispatch'],
    (e: RealtimeEvent) => {
      if (e.type === 'rider.location') {
        qc.setQueryData<DispatchBoard>(['dispatch'], (b) =>
          b && { ...b, riders: b.riders.map((r) => (r.id === e.riderId ? { ...r, location: { lat: e.lat as number, lng: e.lng as number, heading: (e.heading as number | null) ?? r.location?.heading ?? null, at: e.at as string } } : r)) },
        );
        return;
      }
      if (e.type === 'job.no_rider' || e.type === 'job.stuck') toast.warning(`Order ${String(e.number ?? '')} needs a rider`, { description: e.type === 'job.stuck' ? 'It has been waiting longer than the SLA.' : 'No rider accepted. Assign one or retry.', duration: 10_000 });
      if (e.type === 'job.created') toast(`New order ${String(e.number ?? '')}`, { description: 'Added to the dispatch queue.' });
      void refetch();
    },
    { onPoll: () => void refetch(), pollMs: 5000 },
  );

  const inZone = (p: { lat: number; lng: number }) => {
    if (!zone) return true;
    const z = data.zones.find((x) => x.id === zone);
    return z ? pointInPolygon(p, z.polygon) : true;
  };
  const jobs = data.jobs.filter((j) => inZone(j.dropoff));
  const queue = jobs.filter((j) => WAITING.has(j.status)).sort((a, b) => slaRank(b) - slaRank(a) || a.placedAt.localeCompare(b.placedAt));
  const active = jobs.filter((j) => !WAITING.has(j.status));
  const riders = data.riders.filter((r) => !r.location || inZone(r.location));
  const job = data.jobs.find((j) => j.jobId === selJob) ?? null;
  const rider = data.riders.find((r) => r.id === selRider) ?? null;
  const storeOf = (id: string) => data.stores.find((s) => s.id === id);

  const assign = async (j: DispatchJob, riderId: string) => {
    try {
      await api(`/admin/orders/${j.orderId}/actions`, { body: { action: 'assign', riderId } });
      const r = data.riders.find((x) => x.id === riderId);
      toast.success(`${j.number} assigned to ${r?.name ?? 'rider'}`, { description: 'They have been notified in Rider Mode.' });
      setSelJob(j.jobId);
      await refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not assign');
    }
  };
  const auto = async (j: DispatchJob) => {
    try {
      const r = await api<{ offered?: number; riderId?: string; pending?: boolean; restarted?: boolean }>(`/admin/dispatch/jobs/${j.jobId}/auto`, { method: 'POST' });
      toast.success(r.pending ? 'An offer is already out' : r.restarted ? 'Searching again' : r.riderId ? 'Assigned to the nearest rider' : 'Offer sent to the nearest riders');
      await refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Auto-assign failed');
    }
  };

  const markers: MapMarker[] = useMemo(() => {
    const focusStore = job?.store.id;
    const ms: MapMarker[] = data.stores.map((s) => ({ id: `s-${s.id}`, kind: 'store', position: s.location, label: s.name, dimmed: !!focusStore && focusStore !== s.id }));
    for (const j of jobs) {
      ms.push({ id: `j-${j.jobId}`, kind: 'client', position: j.dropoff, label: selJob === j.jobId ? `${j.number} · ${j.dropoff.area}` : undefined, selected: selJob === j.jobId, dimmed: !!selJob && selJob !== j.jobId, onClick: () => { setSelJob(j.jobId); setSelRider(null); } });
    }
    for (const r of riders) {
      if (!r.location) continue;
      ms.push({
        id: `r-${r.id}`, kind: 'rider', position: r.location, heading: r.location.heading, state: presenceState(r.presence), label: selRider === r.id || dragging ? r.name.split(' ')[0] : undefined,
        selected: selRider === r.id, dropTarget: !!dragging && r.presence === 'IDLE', onClick: () => { setSelRider(r.id); setSelJob(null); },
        onDrop: canAssign ? (orderId) => { const j = data.jobs.find((x) => x.orderId === orderId); if (j) void assign(j, r.id); } : undefined,
      });
    }
    return ms;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, zone, selJob, selRider, dragging]);

  const routes: MapRoute[] = [];
  if (job) {
    if (job.route) routes.push({ id: 'sel', path: job.route });
    else {
      const st = storeOf(job.store.id);
      if (st) routes.push({ id: 'sel', path: [st.location, job.dropoff], dashed: true });
    }
  }

  return (
    <div className="relative flex h-[calc(100dvh-64px)] min-h-[560px] flex-col lg:flex-row">
      {/* ---------------------------------------------------------- queue panel */}
      <aside className="order-2 flex min-h-0 w-full flex-1 flex-col border-hairline bg-surface lg:order-1 lg:w-[380px] lg:flex-none lg:border-r">
        <div className="border-b border-hairline px-5 pb-3 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="label-caps text-muted">Control room</div>
              <h1 className="mt-1 text-[28px] leading-9">Dispatch</h1>
            </div>
            <LiveBadge status={status} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Kpi label="Waiting" value={queue.length} tone={queue.some((j) => j.sla.level === 'danger') ? 'danger' : queue.length ? 'warning' : undefined} />
            <Kpi label="On the road" value={active.length} />
            <Kpi label="Riders free" value={data.riders.filter((r) => r.presence === 'IDLE').length} tone="success" />
          </div>
          <div className="mt-4 flex items-center gap-2">
            <div className="flex flex-1 rounded-sm bg-ink/5 p-0.5" role="tablist">
              {(['queue', 'active', 'riders'] as Tab[]).map((t) => (
                <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn('h-8 flex-1 rounded-[3px] text-[12.5px] font-semibold capitalize transition-colors', tab === t ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]' : 'text-muted hover:text-ink')}>
                  {t === 'queue' ? `Queue ${queue.length}` : t === 'active' ? `Active ${active.length}` : `Riders ${riders.length}`}
                </button>
              ))}
            </div>
          </div>
          {data.zones.length > 0 && (
            <Select className="mt-2" value={zone} onChange={(e) => setZone(e.target.value)} aria-label="Filter by zone">
              <option value="">All zones</option>
              {data.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
            </Select>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <AnimatePresence initial={false} mode="popLayout">
            {tab !== 'riders' &&
              (tab === 'queue' ? queue : active).map((j) => (
                <motion.div key={j.jobId} layout initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ type: 'spring', damping: 30, stiffness: 340 }}>
                  <JobCard
                    j={j}
                    now={now}
                    currency={currency}
                    selected={selJob === j.jobId}
                    draggable={canAssign && WAITING.has(j.status)}
                    onDragStart={() => setDragging(j.orderId)}
                    onDragEnd={() => setDragging(null)}
                    onSelect={() => { setSelJob(j.jobId); setSelRider(null); }}
                  />
                </motion.div>
              ))}
            {tab === 'riders' &&
              riders.map((r) => (
                <motion.div key={r.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <RiderRow r={r} selected={selRider === r.id} drop={dragging && r.presence === 'IDLE' ? (oid) => { const j = data.jobs.find((x) => x.orderId === oid); if (j) void assign(j, r.id); } : undefined} onSelect={() => { setSelRider(r.id); setSelJob(null); }} />
                </motion.div>
              ))}
          </AnimatePresence>
          {tab === 'queue' && queue.length === 0 && <EmptyState icon={<Radar />} title="Queue is clear" body="Every paid order has a rider. New orders appear here the moment they are confirmed." />}
          {tab === 'active' && active.length === 0 && <EmptyState icon={<Bike />} title="Nothing on the road" body="Deliveries in progress show up here with live ETAs." />}
          {tab === 'riders' && riders.length === 0 && <EmptyState icon={<Bike />} title="No riders online" body="Riders appear when they go online in Rider Mode." action={<AppLink href="/riders" className="text-sm font-semibold underline-offset-4 hover:underline">Manage riders</AppLink>} />}
        </div>
      </aside>

      {/* ---------------------------------------------------------- map */}
      <div className="relative order-1 h-[52vh] lg:order-2 lg:h-auto lg:flex-1">
        <LiveMap className="absolute inset-0" markers={markers} routes={routes} zones={zone ? data.zones.filter((z) => z.id === zone) : data.zones} fitKey={`${zone}|${data.stores.length}`} />
        <div className="pointer-events-none absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <MapLegend className="pointer-events-auto" />
          <Chip tone={data.mode === 'manual' ? 'warning' : 'neutral'} className="pointer-events-auto bg-surface shadow-floating">{data.mode === 'auto' ? 'Auto dispatch' : data.mode === 'hybrid' ? 'Hybrid dispatch' : 'Manual dispatch'}</Chip>
        </div>
        {dragging && (
          <div className="sw-rise pointer-events-none absolute inset-x-0 top-16 mx-auto w-fit rounded-full bg-ink px-4 py-2 text-[13px] font-semibold text-on-ink shadow-floating">Drop on a free rider to assign</div>
        )}
        <AnimatePresence>
          {(job || rider) && (
            <motion.div
              key={job?.jobId ?? rider?.id}
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="absolute bottom-3 left-3 right-3 z-10 max-w-md rounded-md border border-hairline bg-surface shadow-sheet sm:right-auto sm:w-[420px]"
            >
              {job && <JobPanel j={job} data={data} now={now} currency={currency} canAssign={canAssign} onClose={() => setSelJob(null)} onAssign={(rid) => assign(job, rid)} onAuto={() => auto(job)} />}
              {rider && !job && <RiderPanel r={rider} data={data} onClose={() => setSelRider(null)} onPickJob={(id) => { setSelJob(id); setSelRider(null); }} />}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ pieces */
function LiveBadge({ status }: { status: 'connecting' | 'live' | 'polling' }) {
  return (
    <span className="inline-flex h-7 items-center gap-2 rounded-full border border-hairline px-3 text-[11.5px] font-semibold text-muted" aria-live="polite">
      {status === 'connecting' ? <LoaderA size="xs" /> : <span className={cn('size-2 rounded-full', status === 'live' ? 'sw-live-dot bg-success' : 'bg-warning')} />}
      {status === 'live' ? 'Live' : status === 'polling' ? 'Every 5s' : 'Connecting'}
    </span>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warning' | 'danger' }) {
  return (
    <div className="rounded-sm bg-canvas px-3 py-2.5">
      <div className={cn('font-display text-[24px] leading-7 tabular', tone === 'danger' && 'text-danger', tone === 'warning' && 'text-warning', tone === 'success' && 'text-success')}>{value}</div>
      <div className="mt-0.5 text-[11px] font-semibold text-muted">{label}</div>
    </div>
  );
}

function slaRank(j: DispatchJob) {
  return j.sla.level === 'danger' ? 2 : j.sla.level === 'warning' ? 1 : 0;
}

function JobCard({ j, now, currency, selected, draggable, onSelect, onDragStart, onDragEnd }: { j: DispatchJob; now: number; currency: string; selected: boolean; draggable: boolean; onSelect: () => void; onDragStart: () => void; onDragEnd: () => void }) {
  const waited = minutesSince(j.searchingSince ?? j.placedAt, now);
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', j.orderId);
        e.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onSelect}
      className={cn(
        'group flex w-full gap-3 border-b border-hairline px-5 py-4 text-left transition-colors',
        selected ? 'bg-accent-soft/60' : 'hover:bg-ink/[0.025]',
        j.sla.level === 'danger' && 'shadow-[inset_3px_0_0_var(--sw-danger)]',
        j.sla.level === 'warning' && 'shadow-[inset_3px_0_0_var(--sw-warning)]',
      )}
    >
      {draggable && <GripVertical className="mt-0.5 size-4 shrink-0 text-subtle opacity-50 group-hover:opacity-100" strokeWidth={1.5} aria-hidden />}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-semibold tabular">{j.number}</span>
          <Chip tone={jobTone(j.status)}>{jobLabel(j.status)}</Chip>
          <span className="ml-auto text-[13px] font-semibold tabular">{fmtMoney(j.total, currency)}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 truncate text-[13px] text-muted">
          <MapPin className="size-3.5 shrink-0" strokeWidth={1.5} /> {j.store.name} → {j.dropoff.area || 'Customer'}
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-subtle">
          <span className="flex items-center gap-1"><Package className="size-3.5" strokeWidth={1.5} /> {j.items}</span>
          {j.rider ? <span className="flex items-center gap-1"><Bike className="size-3.5" strokeWidth={1.5} /> {j.rider.name}</span> : <span suppressHydrationWarning className={cn('flex items-center gap-1', j.sla.level !== 'ok' && 'font-semibold text-warning', j.sla.level === 'danger' && 'text-danger')}><Clock className="size-3.5" strokeWidth={1.5} /> {waited} min</span>}
          {j.etaSeconds != null && <span>ETA {fmtEta(j.etaSeconds)}</span>}
          {j.pendingOffers > 0 && <span className="flex items-center gap-1 text-accent"><Radar className="size-3.5" strokeWidth={1.5} /> {j.pendingOffers} offered</span>}
          {!j.ready && WAITING.has(j.status) && <span>Preparing</span>}
        </div>
      </div>
    </button>
  );
}

function RiderRow({ r, selected, onSelect, drop }: { r: RiderAdmin; selected: boolean; onSelect: () => void; drop?: (orderId: string) => void }) {
  const [over, setOver] = useState(false);
  return (
    <button
      type="button"
      onClick={onSelect}
      onDragOver={drop ? (e) => { e.preventDefault(); setOver(true); } : undefined}
      onDragLeave={() => setOver(false)}
      onDrop={drop ? (e) => { e.preventDefault(); setOver(false); drop(e.dataTransfer.getData('text/plain')); } : undefined}
      className={cn('flex w-full items-center gap-3 border-b border-hairline px-5 py-3.5 text-left transition-colors', selected ? 'bg-accent-soft/60' : 'hover:bg-ink/[0.025]', drop && 'bg-success-soft/40', over && 'bg-success-soft')}
    >
      <RiderAvatar r={r} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{r.name}</div>
        <div className="truncate text-xs text-muted">{r.vehicle ? `${VEHICLES[r.vehicle.type] ?? r.vehicle.type}${r.vehicle.plate ? ` · ${r.vehicle.plate}` : ''}` : 'No vehicle'}</div>
      </div>
      <Chip tone={r.presence === 'IDLE' ? 'success' : r.presence === 'OFFLINE' ? 'neutral' : 'ink'} dot>{presenceLabel[r.presence]}</Chip>
    </button>
  );
}

export function RiderAvatar({ r, size = 36 }: { r: { name: string; photo: { url: string } | null; presence?: string }; size?: number }) {
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      {r.photo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.photo.url} alt="" className="size-full rounded-full object-cover" />
      ) : (
        <span className="flex size-full items-center justify-center rounded-full bg-blush font-display text-[15px]">{r.name.slice(0, 1)}</span>
      )}
      {r.presence && r.presence !== 'OFFLINE' && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-surface bg-map-rider" />}
    </span>
  );
}

function JobPanel({ j, data, now, currency, canAssign, onClose, onAssign, onAuto }: { j: DispatchJob; data: DispatchBoard; now: number; currency: string; canAssign: boolean; onClose: () => void; onAssign: (riderId: string) => Promise<void>; onAuto: () => Promise<void> }) {
  const store = data.stores.find((s) => s.id === j.store.id);
  const free = data.riders
    .filter((r) => r.presence === 'IDLE' && r.location)
    .map((r) => ({ r, d: store ? distanceMeters(store.location, r.location!) : 0 }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 4);
  const waiting = WAITING.has(j.status);
  return (
    <div>
      <div className="flex items-start gap-3 border-b border-hairline px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display text-xl">{j.number}</span>
            <Chip tone={jobTone(j.status)}>{jobLabel(j.status)}</Chip>
          </div>
          <div className="mt-1 text-[13px] text-muted" suppressHydrationWarning>{j.store.name} → {j.dropoff.area || 'Customer'} · {fmtMoney(j.total, currency)} · placed {minutesSince(j.placedAt, now)} min ago</div>
          {j.sla.label && <div className={cn('mt-1.5 flex items-center gap-1.5 text-xs font-semibold', j.sla.level === 'danger' ? 'text-danger' : 'text-warning')}><AlertTriangle className="size-3.5" strokeWidth={2} /> {j.sla.label}</div>}
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose} icon={<X strokeWidth={1.5} />} />
      </div>
      {waiting && canAssign ? (
        <div className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="label-caps text-muted">Closest free riders</span>
            <ActionButton size="sm" variant="premium" icon={<Wand2 strokeWidth={1.5} />} onAction={onAuto}>Auto-assign</ActionButton>
          </div>
          {free.length === 0 ? (
            <p className="py-3 text-[13px] text-muted">No idle riders online near {j.store.name}. Auto-assign keeps widening the search.</p>
          ) : (
            <ul className="divide-y divide-hairline">
              {free.map(({ r, d }) => (
                <li key={r.id} className="flex items-center gap-3 py-2.5">
                  <RiderAvatar r={r} size={32} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">{r.name}</div>
                    <div className="flex items-center gap-2 text-xs text-muted">
                      <span>{fmtDistance(d)} from store</span>
                      <span className="flex items-center gap-0.5"><Star className="size-3 fill-accent text-accent" strokeWidth={0} /> {r.rating.toFixed(1)}</span>
                    </div>
                  </div>
                  <ActionButton size="sm" variant="secondary" icon={<Bike strokeWidth={1.5} />} onAction={() => onAssign(r.id)}>Assign</ActionButton>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 px-5 py-4 text-[13px]">
          <div><div className="label-caps text-muted">Rider</div><div className="mt-1 truncate font-semibold">{j.rider?.name ?? '—'}</div></div>
          <div><div className="label-caps text-muted">ETA</div><div className="mt-1 font-semibold tabular">{fmtEta(j.etaSeconds)}</div></div>
          <div><div className="label-caps text-muted">Items</div><div className="mt-1 font-semibold tabular">{j.items}</div></div>
        </div>
      )}
      <div className="flex justify-end border-t border-hairline px-5 py-3">
        <AppLink href={`/orders/${j.orderId}`} icon={<ArrowUpRight strokeWidth={1.5} />} className="text-[13px] font-semibold text-muted hover:text-ink">Open order</AppLink>
      </div>
    </div>
  );
}

function RiderPanel({ r, data, onClose, onPickJob }: { r: RiderAdmin; data: DispatchBoard; onClose: () => void; onPickJob: (jobId: string) => void }) {
  const current = data.jobs.find((j) => j.rider?.id === r.id);
  return (
    <div>
      <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
        <RiderAvatar r={r} size={44} />
        <div className="min-w-0 flex-1">
          <div className="font-display text-xl leading-7">{r.name}</div>
          <div className="text-[13px] text-muted">{r.vehicle ? `${VEHICLES[r.vehicle.type]}${r.vehicle.plate ? ` · ${r.vehicle.plate}` : ''}${r.vehicle.color ? ` · ${r.vehicle.color}` : ''}` : 'No vehicle'}</div>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close" onClick={onClose} icon={<X strokeWidth={1.5} />} />
      </div>
      <div className="grid grid-cols-3 gap-2 px-5 py-4 text-[13px]">
        <div><div className="label-caps text-muted">Status</div><div className="mt-1 font-semibold">{presenceLabel[r.presence]}</div></div>
        <div><div className="label-caps text-muted">Rating</div><div className="mt-1 flex items-center gap-1 font-semibold"><Star className="size-3.5 fill-accent text-accent" strokeWidth={0} /> {r.rating.toFixed(1)}</div></div>
        <div><div className="label-caps text-muted">Deliveries</div><div className="mt-1 font-semibold tabular">{r.deliveries}</div></div>
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-hairline px-5 py-3">
        {current ? (
          <Button variant="secondary" size="sm" icon={<Package strokeWidth={1.5} />} onClick={() => onPickJob(current.jobId)}>{current.number} · {jobLabel(current.status)}</Button>
        ) : (
          <span className="text-[13px] text-muted">Free for the next order</span>
        )}
        <AppLink href={`/riders/${r.id}`} icon={<ArrowUpRight strokeWidth={1.5} />} className="text-[13px] font-semibold text-muted hover:text-ink">Profile</AppLink>
      </div>
    </div>
  );
}

function pointInPolygon(p: { lat: number; lng: number }, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
