'use client';

import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, ScrollText, Search } from 'lucide-react';
import { Input, Select } from '@/components/ui/field';
import { LoadMore, RowsSkeleton, Toolbar } from '@/components/ui/kit';
import { useDebounced } from '@/components/ui/pickers';
import { Card, Chip, EmptyState, PageHeader, type Tone } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtDateTime } from '@/lib/format';

interface Entry { id: number; action: string; entityType: string; entityId: string; actorType: string; actor: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; meta: Record<string, unknown> | null; ip: string | null; requestId: string | null; createdAt: string }

const AREAS = [
  ['', 'Everything'], ['settings', 'Settings'], ['product', 'Products'], ['order', 'Orders'], ['rider', 'Riders'], ['payout', 'Payouts'], ['payment', 'Payments'], ['customer', 'Customers'], ['wholesale', 'Wholesale'], ['team', 'Team'], ['admin', 'Sign-ins'], ['promo', 'Promos'], ['campaign', 'Campaigns'], ['home', 'Home layout'],
] as const;
const toneFor = (a: string): Tone => (/delete|block|reject|cancel|suspend|reveal/.test(a) ? 'danger' : /create|approve|publish|invite/.test(a) ? 'success' : /login|mfa/.test(a) ? 'neutral' : 'ink');

/** Diff of two snapshots, one row per changed key (secrets arrive already redacted from the API). */
function Diff({ before, after }: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])].filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
  if (!keys.length) return <p className="text-xs text-muted">No field changes recorded.</p>;
  const show = (v: unknown) => (v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
  return (
    <div className="grid gap-1 font-mono text-[11.5px]">
      {keys.slice(0, 30).map((k) => (
        <div key={k} className="grid grid-cols-[140px_1fr] gap-3">
          <span className="truncate text-muted">{k}</span>
          <span className="min-w-0 break-words"><span className="bg-danger-soft px-1 text-danger line-through decoration-danger/50">{show(before?.[k]).slice(0, 160)}</span> → <span className="bg-success-soft px-1 text-success">{show(after?.[k]).slice(0, 160)}</span></span>
        </div>
      ))}
    </div>
  );
}

export function AuditLog() {
  const [area, setArea] = useState('');
  const [entity, setEntity] = useState('');
  const de = useDebounced(entity, 300);
  const [open, setOpen] = useState<number | null>(null);
  const q = useInfiniteQuery({
    queryKey: ['audit', area, de],
    queryFn: ({ pageParam }) => api<{ items: Entry[]; nextCursor: string | null }>('/admin/audit', { query: { action: area || undefined, entityId: de.trim() || undefined, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  return (
    <>
      <PageHeader title="Audit log" description="Who changed what, and when — every setting, price, approval, refund and sign-in. Secrets are always redacted." />
      <Card className="overflow-hidden">
        <Toolbar>
          <Select value={area} onChange={(e) => setArea(e.target.value)} className="w-44" aria-label="Area">{AREAS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
          <Input className="min-w-0 flex-1 sm:max-w-sm" leading={<Search />} value={entity} onChange={(e) => setEntity(e.target.value)} placeholder="Filter by record ID" aria-label="Record ID" />
        </Toolbar>
        {q.isPending ? <RowsSkeleton rows={10} /> : rows.length === 0 ? <EmptyState icon={<ScrollText />} title="Nothing recorded" /> : (
          <ol className="divide-y divide-hairline">
            {rows.map((r) => {
              const expanded = open === r.id;
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpen(expanded ? null : r.id)} aria-expanded={expanded} className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-ink/[0.025]">
                    <motion.span animate={{ rotate: expanded ? 90 : 0 }} className="text-muted"><ChevronRight className="size-4" strokeWidth={1.5} /></motion.span>
                    <span className="w-32 shrink-0 text-xs text-muted tabular">{fmtDateTime(r.createdAt)}</span>
                    <Chip tone={toneFor(r.action)}>{r.action}</Chip>
                    <span className="min-w-0 flex-1 truncate text-[13px]"><b className="font-semibold">{r.actor}</b> <span className="text-muted">· {r.entityType}{r.entityId ? ` ${r.entityId.slice(0, 8)}` : ''}</span></span>
                    <span className="hidden text-xs text-subtle md:block">{r.ip}</span>
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                        <div className={cn('mx-5 mb-4 grid gap-3 rounded-sm bg-canvas p-4')}>
                          {(r.before || r.after) && <Diff before={r.before} after={r.after} />}
                          {r.meta && Object.keys(r.meta).length > 0 && <pre className="overflow-x-auto font-mono text-[11.5px] text-muted">{JSON.stringify(r.meta, null, 2)}</pre>}
                          <div className="text-[11px] text-subtle">Entity {r.entityType} {r.entityId || '—'} · request {r.requestId ?? '—'}</div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ol>
        )}
        <LoadMore hasMore={q.hasNextPage} onMore={() => q.fetchNextPage()} />
      </Card>
    </>
  );
}
