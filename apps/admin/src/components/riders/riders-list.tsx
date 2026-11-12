'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bike, Map, Search, Star, UserPlus } from 'lucide-react';
import { motion } from 'motion/react';
import { RiderAvatar } from '@/components/dispatch/control-room';
import { AppLink } from '@/components/ui/app-link';
import { Input } from '@/components/ui/field';
import { Card, Chip, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { cn } from '@/lib/cn';
import { fmtAgo, fmtNum } from '@/lib/format';
import { presenceLabel, VEHICLES, type RiderAdmin } from '@/lib/ops';

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'ACTIVE', label: 'Active' },
  { key: 'PENDING', label: 'Pending approval' },
  { key: 'SUSPENDED', label: 'Suspended' },
  { key: 'OFFBOARDED', label: 'Offboarded' },
];
const statusTone = (s: RiderAdmin['status']) => (s === 'ACTIVE' ? 'success' : s === 'PENDING' ? 'warning' : s === 'SUSPENDED' ? 'danger' : 'neutral');

export function RidersList() {
  const canManage = useCan('riders.manage');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const { data, isPending } = useQuery({ queryKey: ['riders', status, q], queryFn: () => api<{ items: RiderAdmin[]; counts: Record<string, number> }>('/admin/riders', { query: { status, q } }), refetchInterval: 15_000 });
  const items = data?.items ?? [];
  const online = items.filter((r) => r.presence !== 'OFFLINE').length;

  return (
    <>
      <PageHeader
        title="Riders"
        description={`${fmtNum(online)} online now. Register a rider and they get an SMS invite — they sign in with that phone and can go online straight away.`}
        actions={
          <>
            <AppLink href="/dispatch" icon={<Map strokeWidth={1.5} />} className="h-10 rounded-sm border border-ink/18 bg-surface px-4 text-sm font-semibold hover:border-ink/40">Live map</AppLink>
            {canManage && <AppLink href="/riders/new" icon={<UserPlus strokeWidth={1.5} />} className="h-10 rounded-sm bg-ink px-4 text-sm font-semibold text-on-ink hover:bg-ink/88">Register rider</AppLink>}
          </>
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3">
          <div className="scrollbar-none flex flex-1 gap-1 overflow-x-auto" role="tablist">
            {STATUS_TABS.map((t) => (
              <button key={t.key || 'all'} role="tab" aria-selected={status === t.key} onClick={() => setStatus(t.key)} className={cn('relative flex h-12 shrink-0 items-center gap-2 px-3 text-[13px] font-semibold', status === t.key ? 'text-ink' : 'text-muted hover:text-ink')}>
                {t.label}
                <span className="rounded-full bg-ink/5 px-1.5 text-[11px] tabular">{t.key ? data?.counts[t.key] ?? 0 : Object.values(data?.counts ?? {}).reduce((a, b) => a + b, 0)}</span>
                {status === t.key && <motion.span layoutId="riders-tab" className="absolute inset-x-2 bottom-0 h-0.5 bg-ink" />}
              </button>
            ))}
          </div>
          <Input className="my-2 w-full sm:w-64" leading={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or plate" aria-label="Search riders" />
        </div>
        {isPending ? (
          <div className="divide-y divide-hairline">{Array.from({ length: 6 }, (_, i) => <div key={i} className="flex items-center gap-4 px-5 py-4"><Skeleton className="size-10 rounded-full" /><Skeleton className="w-48" /><Skeleton className="ml-auto w-24" /></div>)}</div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Bike />} title="No riders yet" body="Register your first rider — it takes about a minute." action={canManage && <AppLink href="/riders/new" icon={<UserPlus strokeWidth={1.5} />} className="h-10 rounded-sm bg-ink px-4 text-sm font-semibold text-on-ink">Register rider</AppLink>} />
        ) : (
          <ul className="divide-y divide-hairline">
            {items.map((r, i) => (
              <motion.li key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.025 }}>
                <AppLink href={`/riders/${r.id}`} className="flex w-full items-center gap-4 px-5 py-3.5 hover:bg-ink/[0.025]">
                  <RiderAvatar r={r} size={40} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold">{r.name} {!r.signedIn && r.status === 'ACTIVE' && <Chip tone="neutral">Invited</Chip>}</div>
                    <div className="truncate text-xs text-muted tabular">{r.phone} · {r.vehicle ? `${VEHICLES[r.vehicle.type] ?? r.vehicle.type}${r.vehicle.plate ? ` ${r.vehicle.plate}` : ''}` : 'No vehicle'}{r.zone ? ` · ${r.zone.name}` : ''}</div>
                  </div>
                  {r.documentAlerts.length > 0 && (
                    <span className={cn('hidden items-center gap-1 text-xs font-semibold md:flex', r.documentAlerts.some((d) => d.expired) ? 'text-danger' : 'text-warning')}>
                      <AlertTriangle className="size-3.5" strokeWidth={2} /> {r.documentAlerts.some((d) => d.expired) ? 'Document expired' : 'Document expiring'}
                    </span>
                  )}
                  <div className="hidden w-28 text-right text-xs text-muted sm:block">
                    <div className="flex items-center justify-end gap-1 font-semibold text-ink"><Star className="size-3 fill-accent text-accent" strokeWidth={0} /> {r.rating.toFixed(1)}</div>
                    {fmtNum(r.deliveries)} deliveries
                  </div>
                  <div className="w-32 text-right">
                    <Chip tone={statusTone(r.status)}>{r.status === 'ACTIVE' ? presenceLabel[r.presence] : r.status.toLowerCase()}</Chip>
                    <div className="mt-1 text-[11px] text-subtle">{r.location?.at ? `seen ${fmtAgo(r.location.at)}` : 'never online'}</div>
                  </div>
                </AppLink>
              </motion.li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
