'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { motion } from 'motion/react';
import { Bike, Columns3, Download, Rows3, Search, Store } from 'lucide-react';
import { toast } from 'sonner';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Card, Chip, EmptyState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtAgo, fmtMoney, titleCase } from '@/lib/format';
import { jobLabel, orderTone, PAYMENT_LABEL, paymentTone, type OrderRow } from '@/lib/ops';
import { useRealtime } from '@/lib/realtime';

const TABS = [
  { key: '', label: 'All' },
  { key: 'PENDING_PAYMENT', label: 'Awaiting payment' },
  { key: 'CONFIRMED,PREPARING', label: 'To prepare' },
  { key: 'READY_FOR_PICKUP', label: 'Ready' },
  { key: 'ASSIGNED,PICKED_UP,ON_THE_WAY,ARRIVED', label: 'On the road' },
  { key: 'DELIVERED', label: 'Delivered' },
  { key: 'CANCELLED,FAILED,REFUNDED', label: 'Closed' },
];

interface Page {
  items: OrderRow[];
  nextCursor: string | null;
  counts: Record<string, number>;
}
interface Kanban {
  columns: { status: string; label: string; items: OrderRow[]; count: number; dropTargets: string[] }[];
}

export function OrdersWorkspace() {
  const sp = useSearchParams();
  const router = useRouter();
  const view = sp.get('view') === 'board' ? 'board' : 'table';
  const status = sp.get('status') ?? '';
  const [q, setQ] = useState(sp.get('q') ?? '');
  const [payment, setPayment] = useState('');
  const setParam = (k: string, v: string) => {
    const p = new URLSearchParams(sp.toString());
    if (v) p.set(k, v);
    else p.delete(k);
    router.replace(`/orders?${p.toString()}`, { scroll: false });
  };

  return (
    <>
      <PageHeader
        title="Orders"
        description="Every order from bag to doorstep. Rows update live as riders move them along."
        actions={
          <>
            <div className="flex rounded-sm border border-hairline bg-surface p-0.5" role="tablist" aria-label="View">
              {(['table', 'board'] as const).map((v) => (
                <button key={v} role="tab" aria-selected={view === v} onClick={() => setParam('view', v === 'board' ? 'board' : '')} className={cn('flex h-8 items-center gap-1.5 rounded-[3px] px-3 text-[13px] font-semibold', view === v ? 'bg-ink text-on-ink' : 'text-muted hover:text-ink')}>
                  {v === 'table' ? <Rows3 className="size-4" strokeWidth={1.5} /> : <Columns3 className="size-4" strokeWidth={1.5} />}
                  {v === 'table' ? 'Table' : 'Board'}
                </button>
              ))}
            </div>
            <a href={`/api/v1/admin/orders?format=csv${status ? `&status=${status}` : ''}`} className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink/18 bg-surface px-4 text-sm font-semibold hover:border-ink/40">
              <Download className="size-4" strokeWidth={1.5} /> Export
            </a>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          className="min-w-0 flex-1 sm:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setParam('q', q.trim());
          }}
        >
          <Input leading={<Search />} placeholder="Order number, customer or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search orders" />
        </form>
        <Select value={payment} onChange={(e) => setPayment(e.target.value)} aria-label="Payment method" className="w-48">
          <option value="">Any payment</option>
          <option value="CASH_ON_DELIVERY">Cash on delivery</option>
          <option value="MOBILE_MONEY">Mobile money</option>
        </Select>
      </div>
      {view === 'table' ? <OrdersTable status={status} q={sp.get('q') ?? ''} payment={payment} onStatus={(s) => setParam('status', s)} /> : <OrdersBoard q={sp.get('q') ?? ''} payment={payment} />}
    </>
  );
}

function OrdersTable({ status, q, payment, onStatus }: { status: string; q: string; payment: string; onStatus: (s: string) => void }) {
  const query = useInfiniteQuery({
    queryKey: ['orders', status, q, payment],
    queryFn: ({ pageParam }) => api<Page>('/admin/orders', { query: { status, q, payment, cursor: pageParam, limit: 50 } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  useRealtime(['dispatch'], (e) => e.type.startsWith('job.') && void query.refetch(), { onPoll: () => void query.refetch(), pollMs: 15_000 });
  const counts = query.data?.pages[0]?.counts ?? {};
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const countFor = (key: string) => (key ? key.split(',').reduce((a, k) => a + (counts[k] ?? 0), 0) : Object.values(counts).reduce((a, b) => a + b, 0));

  return (
    <Card className="overflow-hidden">
      <div className="scrollbar-none flex gap-1 overflow-x-auto border-b border-hairline px-3" role="tablist">
        {TABS.map((t) => (
          <button key={t.key || 'all'} role="tab" aria-selected={status === t.key} onClick={() => onStatus(t.key)} className={cn('relative flex h-12 shrink-0 items-center gap-2 px-3 text-[13px] font-semibold transition-colors', status === t.key ? 'text-ink' : 'text-muted hover:text-ink')}>
            {t.label}
            <span className="rounded-full bg-ink/5 px-1.5 text-[11px] tabular">{countFor(t.key)}</span>
            {status === t.key && <motion.span layoutId="orders-tab" className="absolute inset-x-2 bottom-0 h-0.5 bg-ink" />}
          </button>
        ))}
      </div>
      {query.isPending ? (
        <div className="divide-y divide-hairline">{Array.from({ length: 8 }, (_, i) => <div key={i} className="flex gap-4 px-5 py-4"><Skeleton className="w-24" /><Skeleton className="w-40" /><Skeleton className="ml-auto w-20" /></div>)}</div>
      ) : rows.length === 0 ? (
        <EmptyState title="No orders here" body={q ? 'Nothing matches that search.' : 'Orders in this state will appear here.'} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead>
              <tr className="label-caps border-b border-hairline text-left text-muted">
                <th className="px-5 py-3 font-semibold">Order</th>
                <th className="px-3 py-3 font-semibold">Customer</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-3 py-3 font-semibold">Delivery</th>
                <th className="px-3 py-3 font-semibold">Payment</th>
                <th className="px-5 py-3 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((o) => (
                <tr key={o.id} className={cn('group transition-colors hover:bg-ink/[0.025]', o.sla.level === 'danger' && 'shadow-[inset_3px_0_0_var(--sw-danger)]', o.sla.level === 'warning' && 'shadow-[inset_3px_0_0_var(--sw-warning)]')}>
                  <td className="px-5 py-3.5">
                    <AppLink href={`/orders/${o.id}`} className="font-semibold tabular hover:underline">{o.number}</AppLink>
                    <div className="text-xs text-subtle">{fmtAgo(o.placedAt)} · {o.items} {o.items === 1 ? 'item' : 'items'}</div>
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="flex items-center gap-2 font-medium">{o.customer.name}{o.customer.type === 'WHOLESALE' && <Chip tone="accent">Wholesale</Chip>}</div>
                    <div className="text-xs text-muted tabular">{o.customer.phone}</div>
                  </td>
                  <td className="px-3 py-3.5">
                    <Chip tone={orderTone(o.status)}>{o.statusLabel}</Chip>
                    {o.sla.label && <div className={cn('mt-1 text-xs font-semibold', o.sla.level === 'danger' ? 'text-danger' : 'text-warning')}>{o.sla.label}</div>}
                  </td>
                  <td className="px-3 py-3.5 text-[13px]">
                    {o.fulfilment === 'pickup' ? (
                      <span className="flex items-center gap-1.5 text-muted"><Store className="size-3.5" strokeWidth={1.5} /> Pickup · {o.store}</span>
                    ) : (
                      <>
                        <div className="truncate">{o.area ?? '—'}</div>
                        <div className="flex items-center gap-1.5 text-xs text-muted">
                          <Bike className="size-3.5" strokeWidth={1.5} /> {o.delivery?.rider ?? (o.delivery ? jobLabel(o.delivery.status) : 'Not dispatched')}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="px-3 py-3.5">
                    <div className="text-[13px]">{PAYMENT_LABEL[o.payment.method] ?? titleCase(o.payment.method)}</div>
                    <Chip tone={paymentTone(o.payment.status)} className="mt-1">{titleCase(o.payment.status)}</Chip>
                  </td>
                  <td className="px-5 py-3.5 text-right font-semibold tabular">{fmtMoney(o.total, o.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {query.hasNextPage && (
        <div className="flex justify-center border-t border-hairline p-3">
          <ActionButton variant="ghost" onAction={() => query.fetchNextPage()}>Load more</ActionButton>
        </div>
      )}
    </Card>
  );
}

function OrdersBoard({ q, payment }: { q: string; payment: string }) {
  const { data, refetch, isPending } = useQuery({ queryKey: ['orders-board', q, payment], queryFn: () => api<Kanban>('/admin/orders/kanban', { query: { q, payment } }) });
  useRealtime(['dispatch'], (e) => e.type.startsWith('job.') && void refetch(), { onPoll: () => void refetch(), pollMs: 15_000 });
  const [drag, setDrag] = useState<{ id: string; from: string } | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const allowed = (to: string) => !!drag && !!data?.columns.find((c) => c.status === drag.from)?.dropTargets.includes(to);

  const move = async (id: string, to: string) => {
    try {
      if (to === 'READY_FOR_PICKUP') await api(`/admin/orders/${id}/actions`, { body: { action: 'ready' } });
      else await api(`/admin/orders/${id}/actions`, { body: { action: 'status', to } });
      toast.success(`Moved to ${titleCase(to)}`);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not move the order');
    }
    await refetch();
  };

  if (isPending) return <div className="flex gap-3 overflow-hidden">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-96 w-72 shrink-0" />)}</div>;
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 sm:-mx-6 sm:px-6 lg:-mx-10 lg:px-10">
      <div className="flex gap-3">
        {data?.columns.map((c) => (
          <section
            key={c.status}
            aria-label={c.label}
            onDragOver={(e) => {
              if (allowed(c.status)) {
                e.preventDefault();
                setOver(c.status);
              }
            }}
            onDragLeave={() => setOver(null)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              if (drag && allowed(c.status)) void move(drag.id, c.status);
              setDrag(null);
            }}
            className={cn('flex w-72 shrink-0 flex-col rounded-md border border-hairline bg-canvas transition-colors', drag && (allowed(c.status) ? 'border-dashed border-ink/30' : 'opacity-50'), over === c.status && 'border-ink bg-accent-soft/40')}
          >
            <header className="flex items-center justify-between px-4 py-3">
              <span className="text-[13px] font-semibold">{c.label}</span>
              <span className="rounded-full bg-ink/5 px-2 text-[11px] font-semibold tabular text-muted">{c.count}</span>
            </header>
            <div className="flex max-h-[68vh] min-h-24 flex-col gap-2 overflow-y-auto px-2 pb-2">
              {c.items.map((o) => (
                <motion.div key={o.id} layout layoutId={`kb-${o.id}`} transition={{ type: 'spring', damping: 30, stiffness: 340 }}>
                  <div
                    draggable={c.dropTargets.length > 0}
                    onDragStart={() => setDrag({ id: o.id, from: c.status })}
                    onDragEnd={() => setDrag(null)}
                    className={cn('cursor-grab rounded-sm border border-hairline bg-surface p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] active:cursor-grabbing', o.sla.level === 'danger' && 'border-l-2 border-l-danger', o.sla.level === 'warning' && 'border-l-2 border-l-warning')}
                  >
                    <div className="flex items-center justify-between">
                      <AppLink href={`/orders/${o.id}`} className="text-[13px] font-semibold tabular hover:underline">{o.number}</AppLink>
                      <span className="text-[12px] font-semibold tabular">{fmtMoney(o.total, o.currency)}</span>
                    </div>
                    <div className="mt-1 truncate text-[12.5px]">{o.customer.name}</div>
                    <div className="mt-1 flex items-center justify-between text-[11.5px] text-muted">
                      <span className="truncate">{o.fulfilment === 'pickup' ? `Pickup · ${o.store}` : o.area ?? o.store}</span>
                      <span>{fmtAgo(o.placedAt)}</span>
                    </div>
                    {o.delivery?.rider && <div className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted"><Bike className="size-3.5" strokeWidth={1.5} /> {o.delivery.rider}</div>}
                  </div>
                </motion.div>
              ))}
              {c.items.length === 0 && <p className="px-2 py-6 text-center text-xs text-subtle">Empty</p>}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
