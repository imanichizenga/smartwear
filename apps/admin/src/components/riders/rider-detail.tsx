'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Ban, CheckCircle2, FileText, MessageSquareText, Pause, Phone, Play, Route, Star } from 'lucide-react';
import { toast } from 'sonner';
import { RiderAvatar } from '@/components/dispatch/control-room';
import { LiveMap, type MapMarker } from '@/components/maps/live-map';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Card, CardHeader, Chip, EmptyState, Stat } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { cn } from '@/lib/cn';
import { fmtAgo, fmtDate, fmtDateTime, fmtMoney, fmtNum, titleCase } from '@/lib/format';
import { bearing, distanceMeters, fmtDistance, type LatLng } from '@/lib/geo';
import { jobLabel, jobTone, presenceLabel, presenceState, VEHICLES, type RiderAdmin } from '@/lib/ops';

interface RiderFull extends RiderAdmin {
  nationalIdLast4: string | null;
  licenceNumber: string | null;
  payoutMethod: string | null;
  payout: { method?: string; provider?: string; account?: string } | null;
  notes: string;
  suspendedReason: string | null;
  documents: { id: number; kind: string; number: string; expiresAt: string | null; verified: boolean; media: { url: string } | null }[];
  earnings: { total: number | null; n: number };
  balance: { earned: number; paid: number; pending: number; unpaid: number };
  recentJobs: { id: string; orderNumber: string; status: string; completedAt: string | null; earning: number }[];
}
type Ping = LatLng & { heading: number | null; speed: number | null; at: string };

export function RiderDetail({ initial, currency }: { initial: RiderFull; currency: string }) {
  const qc = useQueryClient();
  const canManage = useCan('riders.manage');
  const { data: r = initial } = useQuery({ queryKey: ['rider', initial.id], queryFn: () => api<RiderFull>(`/admin/riders/${initial.id}`), initialData: initial, refetchInterval: 10_000 });
  const [suspend, setSuspend] = useState(false);
  const [jobId, setJobId] = useState<string | null>(r.recentJobs.find((j) => j.status === 'COMPLETED')?.id ?? null);

  const patch = async (body: Record<string, unknown>, ok: string) => {
    try {
      qc.setQueryData(['rider', r.id], await api<RiderFull>(`/admin/riders/${r.id}`, { method: 'PATCH', body }));
      toast.success(ok);
      setSuspend(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not update');
    }
  };

  return (
    <>
      <AppLink href="/riders" icon={<ArrowLeft strokeWidth={1.5} />} className="mb-5 text-[13px] font-semibold text-muted hover:text-ink">Riders</AppLink>
      <div className="mb-6 flex flex-wrap items-center gap-5">
        <RiderAvatar r={r} size={72} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[32px] leading-10">{r.name}</h1>
            <Chip tone={r.status === 'ACTIVE' ? 'success' : r.status === 'PENDING' ? 'warning' : 'danger'}>{titleCase(r.status)}</Chip>
            {r.status === 'ACTIVE' && <Chip tone={r.presence === 'OFFLINE' ? 'neutral' : 'ink'} dot>{presenceLabel[r.presence]}</Chip>}
          </div>
          <p className="mt-1 text-sm text-muted tabular">
            {r.phone} · {r.vehicle ? `${VEHICLES[r.vehicle.type]}${r.vehicle.plate ? ` ${r.vehicle.plate}` : ''}${r.vehicle.color ? ` · ${r.vehicle.color}` : ''}` : 'No vehicle'}
            {r.zone && ` · ${r.zone.name}`}{r.homeStore && ` · ${r.homeStore.name}`}
          </p>
          {r.suspendedReason && r.status === 'SUSPENDED' && <p className="mt-1 text-[13px] text-danger">Suspended: {r.suspendedReason}</p>}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <a href={`tel:${r.phone}`} className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink/18 bg-surface px-3 text-sm font-semibold hover:border-ink/40"><Phone className="size-4" strokeWidth={1.5} /> Call</a>
            {!r.signedIn && <ActionButton variant="secondary" icon={<MessageSquareText strokeWidth={1.5} />} onAction={async () => { const x = await api<{ sent: boolean; reason?: string }>(`/admin/riders/${r.id}/invite`, { method: 'POST' }); if (x.sent) toast.success('Invite sent by SMS'); else toast.error(x.reason ?? 'Invite not sent'); }}>Resend invite</ActionButton>}
            {r.status === 'ACTIVE' ? (
              <Button variant="danger" icon={<Ban strokeWidth={1.5} />} onClick={() => setSuspend(true)}>Suspend</Button>
            ) : (
              <ActionButton icon={<CheckCircle2 strokeWidth={1.5} />} onAction={() => patch({ status: 'ACTIVE' }, r.status === 'PENDING' ? 'Approved — they can go online' : 'Reactivated')}>{r.status === 'PENDING' ? 'Approve' : 'Reactivate'}</ActionButton>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat label="Rating" value={<span className="flex items-center gap-2">{r.rating.toFixed(2)} <Star className="size-5 fill-accent text-accent" strokeWidth={0} /></span>} hint={`${fmtNum(r.ratingCount)} ratings`} />
        <Stat label="Deliveries" value={fmtNum(r.deliveries)} hint={r.approvedAt ? `Since ${fmtDate(r.approvedAt)}` : 'Not approved yet'} />
        <Stat label="Lifetime earnings" value={fmtMoney(r.earnings.total ?? 0, currency)} hint={<>{fmtNum(r.earnings.n)} paid trips · {r.balance.unpaid > 0 ? <AppLink href="/payouts" className="font-semibold text-ink underline-offset-4 hover:underline">{fmtMoney(r.balance.unpaid, currency)} unpaid — pay out</AppLink> : 'all paid'}</>} />
        <Stat label="Last seen" value={r.location?.at ? fmtAgo(r.location.at) : '—'} hint={r.signedIn ? 'Signed in to Rider Mode' : 'Has not signed in yet'} />
      </div>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <RouteReplay riderId={r.id} jobId={jobId} jobs={r.recentJobs} onPick={setJobId} live={r.location} presence={r.presence} />
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader title="Documents" />
            {r.documents.length === 0 ? (
              <p className="px-5 py-4 text-[13px] text-muted">No documents uploaded.</p>
            ) : (
              <ul className="divide-y divide-hairline">
                {r.documents.map((d) => {
                  const alert = r.documentAlerts.find((a) => a.kind === d.kind);
                  return (
                    <li key={d.id} className="flex items-center gap-3 px-5 py-3 text-[13px]">
                      <FileText className="size-4 shrink-0 text-muted" strokeWidth={1.5} />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold">{titleCase(d.kind)}</div>
                        <div className="text-xs text-muted">{d.number || 'No number'}{d.expiresAt ? ` · expires ${fmtDate(d.expiresAt)}` : ''}</div>
                      </div>
                      {alert && <Chip tone={alert.expired ? 'danger' : 'warning'}>{alert.expired ? 'Expired' : 'Expiring'}</Chip>}
                      {d.media && <a href={d.media.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-muted hover:text-ink">View</a>}
                    </li>
                  );
                })}
              </ul>
            )}
            <dl className="grid grid-cols-2 gap-3 border-t border-hairline px-5 py-4 text-[13px]">
              <div><dt className="label-caps text-muted">NIDA</dt><dd className="mt-1 tabular">{r.nationalIdLast4 ? `•••• ${r.nationalIdLast4}` : '—'}</dd></div>
              <div><dt className="label-caps text-muted">Licence</dt><dd className="mt-1">{r.licenceNumber ?? '—'}</dd></div>
              <div className="col-span-2"><dt className="label-caps text-muted">Payouts</dt><dd className="mt-1">{r.payout ? `${titleCase(r.payout.method ?? '')} · ${r.payout.provider ?? ''} ${r.payout.account ?? ''}` : 'Not set'}</dd></div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Recent deliveries" />
            {r.recentJobs.length === 0 ? (
              <EmptyState title="No deliveries yet" body="Completed trips appear here with route replay." />
            ) : (
              <ul className="divide-y divide-hairline">
                {r.recentJobs.map((j) => (
                  <li key={j.id}>
                    <button type="button" onClick={() => setJobId(j.id)} className={cn('flex w-full items-center gap-3 px-5 py-3 text-left text-[13px] transition-colors', jobId === j.id ? 'bg-accent-soft/60' : 'hover:bg-ink/[0.025]')}>
                      <Route className="size-4 shrink-0 text-muted" strokeWidth={1.5} />
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold tabular">{j.orderNumber}</div>
                        <div className="text-xs text-muted">{j.completedAt ? fmtDateTime(j.completedAt) : jobLabel(j.status)}</div>
                      </div>
                      <Chip tone={jobTone(j.status)}>{jobLabel(j.status)}</Chip>
                      <span className="w-20 text-right font-semibold tabular">{j.earning ? fmtMoney(j.earning, currency) : '—'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
      <SuspendDialog open={suspend} onOpenChange={setSuspend} onConfirm={(reason) => patch({ status: 'SUSPENDED', reason }, 'Rider suspended and signed out')} />
    </>
  );
}

function RouteReplay({ riderId, jobId, jobs, onPick, live, presence }: { riderId: string; jobId: string | null; jobs: RiderFull['recentJobs']; onPick: (id: string) => void; live: RiderAdmin['location']; presence: RiderAdmin['presence'] }) {
  const { data, isFetching } = useQuery({ queryKey: ['route', riderId, jobId], queryFn: () => api<{ points: Ping[] }>(`/admin/riders/${riderId}/route`, { query: { jobId: jobId ?? undefined } }) });
  const pts = useMemo(() => data?.points ?? [], [data]);
  const [t, setT] = useState(1);
  const [playing, setPlaying] = useState(false);
  const raf = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => {
      setT(1);
      setPlaying(false);
    }, 0);
    return () => clearTimeout(id);
  }, [jobId]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      setT((x) => {
        const n = Math.min(1, x + dt / 12_000); // 12s for the whole trip
        if (n >= 1) setPlaying(false);
        return n;
      });
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [playing]);

  const idx = Math.min(pts.length - 1, Math.floor(t * (pts.length - 1)));
  const cur = pts[idx];
  const total = pts.reduce((a, p, i) => (i ? a + distanceMeters(pts[i - 1]!, p) : 0), 0);
  const markers: MapMarker[] = [];
  if (pts.length) {
    markers.push({ id: 'start', kind: 'store', position: pts[0]!, label: 'Start' });
    markers.push({ id: 'end', kind: 'client', position: pts[pts.length - 1]!, label: 'Drop-off' });
    if (cur) markers.push({ id: 'rider', kind: 'rider', position: cur, heading: cur.heading ?? (pts[idx + 1] ? bearing(cur, pts[idx + 1]!) : null), state: 'en_route' });
  } else if (live && presence !== 'OFFLINE') {
    markers.push({ id: 'live', kind: 'rider', position: live, heading: live.heading, state: presenceState(presence), label: 'Now' });
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Route replay"
        description={pts.length ? `${fmtDistance(total)} · ${pts.length} location fixes${cur ? ` · ${new Date(cur.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : ''}` : jobId ? 'No location breadcrumbs were recorded for this trip.' : 'Pick a delivery to replay its route.'}
        actions={
          jobs.length > 0 && (
            <select aria-label="Delivery" value={jobId ?? ''} onChange={(e) => onPick(e.target.value)} className="h-8 rounded-sm border border-hairline bg-surface px-2 text-[13px]">
              {jobs.map((j) => <option key={j.id} value={j.id}>{j.orderNumber}</option>)}
            </select>
          )
        }
      />
      <LiveMap className="h-[420px]" markers={markers} routes={pts.length > 1 ? [{ id: 'trail', path: pts.slice(0, idx + 1) }, { id: 'rest', path: pts.slice(idx), dashed: true }] : []} fitKey={`${jobId}|${pts.length}`} />
      <div className="flex items-center gap-3 border-t border-hairline px-5 py-3">
        <Button variant="secondary" size="icon" aria-label={playing ? 'Pause' : 'Play'} pending={isFetching} disabled={pts.length < 2} onClick={() => { if (t >= 1) setT(0); setPlaying((p) => !p); }} icon={playing ? <Pause strokeWidth={1.5} /> : <Play strokeWidth={1.5} />} />
        <input type="range" min={0} max={1000} value={Math.round(t * 1000)} onChange={(e) => { setPlaying(false); setT(Number(e.target.value) / 1000); }} disabled={pts.length < 2} aria-label="Scrub route" className="h-1 flex-1 cursor-pointer accent-[var(--sw-ink)]" />
        <span className="w-14 text-right text-xs text-muted tabular">{Math.round(t * 100)}%</span>
      </div>
    </Card>
  );
}

function SuspendDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Suspend this rider?" description="They go offline, are signed out of Rider Mode and can’t receive jobs until reactivated." size="sm"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><ActionButton variant="danger" icon={<Ban strokeWidth={1.5} />} onAction={() => onConfirm(reason)}>Suspend</ActionButton></>}>
      <Field label="Reason" help="Kept on their record.">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Licence expired" />}</Field>
    </Dialog>
  );
}
