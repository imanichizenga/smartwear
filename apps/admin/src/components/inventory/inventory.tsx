'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, ArrowRightLeft, Boxes, Minus, PackageCheck, Plus, Search, Truck, X } from 'lucide-react';
import { toast } from 'sonner';
import { LoaderA } from '@/components/brand/LoaderA';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { LoadMore, Meter, Rise, RowsSkeleton, Tabs, Toolbar } from '@/components/ui/kit';
import { useDebounced } from '@/components/ui/pickers';
import { Card, Chip, EmptyState, PageHeader, Switch } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { useStores } from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { fmtAgo, fmtDateTime, fmtNum, titleCase } from '@/lib/format';

interface Level { id: number; store: { id: string; name: string }; variantId: string; sku: string; product: { id: string; title: string }; options: string; onHand: number; reserved: number; available: number; lowStockThreshold: number; low: boolean; updatedAt: string }
interface Movement { id: number; store: string; sku: string; deltaOnHand: number; deltaReserved: number; reason: string; note: string; order: string | null; by: string | null; at: string }
interface Transfer { id: string; from: string; to: string; status: 'DRAFT' | 'IN_TRANSIT' | 'RECEIVED' | 'CANCELLED'; lines: { variantId: string; qty: number }[]; note: string; createdAt: string; shippedAt: string | null; receivedAt: string | null }

const REASON_LABEL: Record<string, string> = { receive: 'Received', adjust: 'Adjustment', count: 'Stock count', damage: 'Damaged', return: 'Customer return', sale: 'Sold', transfer_out: 'Transfer out', transfer_in: 'Transfer in', reserve: 'Reserved', release: 'Released' };

export function InventoryWorkspace() {
  const [tab, setTab] = useState<'levels' | 'movements' | 'transfers'>('levels');
  const canManage = useCan('inventory.manage');
  const [newTransfer, setNewTransfer] = useState(false);
  return (
    <>
      <PageHeader title="Inventory" description="Stock per store and warehouse. Every change is a movement with a reason, so counts are always explainable."
        actions={canManage && <Button variant="secondary" icon={<ArrowRightLeft strokeWidth={1.5} />} onClick={() => setNewTransfer(true)}>New transfer</Button>} />
      <Card className="overflow-hidden">
        <div className="border-b border-hairline px-3"><Tabs id="inv" value={tab} onChange={setTab} tabs={[{ key: 'levels', label: 'Stock levels' }, { key: 'movements', label: 'History' }, { key: 'transfers', label: 'Transfers' }]} /></div>
        {tab === 'levels' ? <Levels /> : tab === 'movements' ? <Movements /> : <Transfers />}
      </Card>
      {newTransfer && <TransferDialog onClose={() => setNewTransfer(false)} onCreated={() => setTab('transfers')} />}
    </>
  );
}

function Levels() {
  const qc = useQueryClient();
  const canManage = useCan('inventory.manage');
  const stores = useStores();
  const [storeId, setStoreId] = useState('');
  const [low, setLow] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [adj, setAdj] = useState<Level | null>(null);
  const key = ['inventory', storeId, low, dq];
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => api<{ items: Level[]; nextCursor: string | null }>('/admin/inventory', { query: { storeId, low: low ? 1 : undefined, q: dq, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const bump = async (l: Level, delta: number) => {
    try {
      const r = await api<{ onHand: number; reserved: number; available: number }>('/admin/inventory', { body: { storeId: l.store.id, variantId: l.variantId, delta, reason: delta > 0 ? 'receive' : 'adjust', note: 'Quick adjust' } });
      qc.setQueryData<{ pages: { items: Level[] }[] }>(key, (d) => d && { ...d, pages: d.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === l.id ? { ...x, ...r, low: r.onHand <= x.lowStockThreshold } : x)) })) });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not adjust');
    }
  };
  return (
    <>
      <Toolbar>
        <Input className="min-w-0 flex-1 sm:max-w-xs" leading={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="SKU or product" aria-label="Search stock" />
        <Select value={storeId} onChange={(e) => setStoreId(e.target.value)} className="w-52" aria-label="Location"><option value="">All locations</option>{stores.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <label className="flex items-center gap-2 px-2 text-[13px]"><Switch checked={low} onCheckedChange={setLow} label="Low stock only" /> Low stock only</label>
      </Toolbar>
      {query.isPending ? <RowsSkeleton rows={10} /> : rows.length === 0 ? <EmptyState icon={<Boxes />} title={low ? 'Nothing is running low' : 'No stock records'} body={low ? 'Every variant is above its alert level.' : 'Stock appears once products have variants at a location.'} /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead><tr className="label-caps border-b border-hairline text-left text-muted"><th className="px-5 py-3 font-semibold">Product</th><th className="px-3 py-3 font-semibold">Location</th><th className="px-3 py-3 text-right font-semibold">On hand</th><th className="px-3 py-3 text-right font-semibold">Reserved</th><th className="w-40 px-3 py-3 font-semibold">Available</th><th className="w-44 px-5 py-3" /></tr></thead>
            <tbody className="divide-y divide-hairline">
              {rows.map((l, i) => (
                <Rise as="tr" i={i} key={l.id} className="hover:bg-ink/[0.025]">
                  <td className="px-5 py-3">
                    <AppLink href={`/products/${l.product.id}`} className="font-semibold hover:underline">{l.product.title}</AppLink>
                    <div className="text-xs text-muted"><span className="font-mono">{l.sku}</span>{l.options && ` · ${l.options}`}</div>
                  </td>
                  <td className="px-3 py-3 text-[13px]">{l.store.name}</td>
                  <td className="px-3 py-3 text-right font-semibold tabular"><motion.span key={l.onHand} initial={{ opacity: 0.3, y: -3 }} animate={{ opacity: 1, y: 0 }} className="inline-block">{fmtNum(l.onHand)}</motion.span></td>
                  <td className="px-3 py-3 text-right tabular text-muted">{fmtNum(l.reserved)}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2"><span className={cn('w-8 text-right text-[13px] tabular', l.low && 'font-semibold text-warning', l.available <= 0 && 'text-danger')}>{fmtNum(l.available)}</span><Meter value={l.available} max={Math.max(l.lowStockThreshold * 4, l.available, 1)} tone={l.available <= 0 ? 'danger' : l.low ? 'warning' : 'ink'} /></div>
                    {l.low && <div className="mt-0.5 text-[11px] text-warning">Alert at {l.lowStockThreshold}</div>}
                  </td>
                  <td className="px-5 py-3">
                    {canManage && (
                      <div className="flex items-center justify-end gap-1">
                        <ActionButton size="icon-sm" variant="ghost" aria-label="Remove one" icon={<Minus strokeWidth={1.5} />} onAction={() => bump(l, -1)} />
                        <ActionButton size="icon-sm" variant="ghost" aria-label="Add one" icon={<Plus strokeWidth={1.5} />} onAction={() => bump(l, 1)} />
                        <Button size="sm" variant="secondary" onClick={() => setAdj(l)}>Adjust</Button>
                      </div>
                    )}
                  </td>
                </Rise>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <LoadMore hasMore={query.hasNextPage} onMore={() => query.fetchNextPage()} />
      {adj && <AdjustDialog level={adj} onClose={() => setAdj(null)} onDone={() => void qc.invalidateQueries({ queryKey: ['inventory'] })} />}
    </>
  );
}

function AdjustDialog({ level, onClose, onDone }: { level: Level; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<'delta' | 'count'>('delta');
  const [delta, setDelta] = useState('');
  const [count, setCount] = useState(String(level.onHand));
  const [reason, setReason] = useState('receive');
  const [threshold, setThreshold] = useState(String(level.lowStockThreshold));
  const [note, setNote] = useState('');
  const d = Number(delta || 0) * (reason === 'damage' ? -1 : 1);
  const after = mode === 'count' ? Number(count || 0) : level.onHand + d;
  const run = async () => {
    try {
      await api('/admin/inventory', { body: mode === 'count' ? { storeId: level.store.id, variantId: level.variantId, setTo: Number(count), lowStockThreshold: Number(threshold), note } : { storeId: level.store.id, variantId: level.variantId, delta: d, reason, note } });
      toast.success('Stock updated');
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not update');
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} size="sm" title="Adjust stock" description={`${level.product.title} · ${level.sku} · ${level.store.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><ActionButton disabled={after < level.reserved || (mode === 'delta' && !d)} onAction={run}>Save</ActionButton></>}>
      <div className="grid gap-4">
        <div className="grid grid-cols-2 rounded-sm border border-hairline p-0.5 text-[13px] font-semibold">
          {(['delta', 'count'] as const).map((m) => <button key={m} type="button" onClick={() => setMode(m)} className={cn('rounded-xs py-1.5', mode === m ? 'bg-ink text-on-ink' : 'text-muted')}>{m === 'delta' ? 'Add or remove' : 'Set counted total'}</button>)}
        </div>
        {mode === 'delta' ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reason">{(id) => <Select id={id} value={reason} onChange={(e) => setReason(e.target.value)}><option value="receive">Received delivery</option><option value="damage">Damaged / lost</option><option value="adjust">Correction</option></Select>}</Field>
            <Field label={reason === 'damage' ? 'Pieces removed' : 'Pieces (use − to remove)'}>{(id) => <Input id={id} inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value.replace(/[^\d-]/g, ''))} placeholder="12" />}</Field>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Counted on hand">{(id) => <Input id={id} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} />}</Field>
            <Field label="Alert at">{(id) => <Input id={id} inputMode="numeric" value={threshold} onChange={(e) => setThreshold(e.target.value.replace(/\D/g, ''))} />}</Field>
          </div>
        )}
        <Field label="Note" optional>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Supplier invoice #1042" />}</Field>
        <div className="flex items-center justify-between rounded-sm bg-canvas px-4 py-3 text-sm">
          <span className="text-muted">On hand</span>
          <span className="flex items-center gap-2 tabular">{fmtNum(level.onHand)} <ArrowRight className="size-3.5 text-muted" strokeWidth={1.5} /> <b className={cn('font-semibold', after < level.reserved && 'text-danger')}>{fmtNum(after)}</b></span>
        </div>
        {after < level.reserved && <p className="text-xs text-danger">{level.reserved} are reserved for open orders — stock can’t go below that.</p>}
      </div>
    </Dialog>
  );
}

function Movements() {
  const q = useInfiniteQuery({
    queryKey: ['movements'],
    queryFn: ({ pageParam }) => api<{ items: Movement[]; nextCursor: string | null }>('/admin/inventory/movements', { query: { cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (q.isPending) return <RowsSkeleton rows={10} />;
  return (
    <>
      <ul className="divide-y divide-hairline">
        {rows.map((m, i) => (
          <Rise as="li" i={i} key={m.id} className="flex items-center gap-4 px-5 py-3 text-[13px]">
            <span className={cn('w-14 text-right font-semibold tabular', m.deltaOnHand > 0 ? 'text-success' : m.deltaOnHand < 0 ? 'text-ink' : 'text-muted')}>{m.deltaOnHand > 0 ? '+' : ''}{m.deltaOnHand || (m.deltaReserved ? `${m.deltaReserved > 0 ? '+' : ''}${m.deltaReserved}r` : '0')}</span>
            <span className="min-w-0 flex-1"><span className="font-mono text-[12px]">{m.sku}</span><span className="text-muted"> · {m.store}</span>{m.note && <span className="block truncate text-xs text-muted">{m.note}</span>}</span>
            <Chip tone={m.reason === 'sale' ? 'ink' : m.reason === 'damage' ? 'danger' : m.reason === 'receive' || m.reason === 'return' ? 'success' : 'neutral'}>{REASON_LABEL[m.reason] ?? m.reason}</Chip>
            <span className="hidden w-24 text-xs text-muted sm:block">{m.order ?? m.by ?? 'System'}</span>
            <span className="w-24 text-right text-xs text-muted">{fmtAgo(m.at)}</span>
          </Rise>
        ))}
      </ul>
      <LoadMore hasMore={q.hasNextPage} onMore={() => q.fetchNextPage()} />
    </>
  );
}

function Transfers() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['transfers'], queryFn: () => api<{ items: Transfer[] }>('/admin/inventory/transfers') });
  const act = async (t: Transfer, action: 'ship' | 'receive' | 'cancel') => {
    try {
      await api(`/admin/inventory/transfers/${t.id}/${action}`, { method: 'POST' });
      toast.success(action === 'ship' ? 'Shipped — stock left the origin' : action === 'receive' ? 'Received — stock added' : 'Cancelled');
      void qc.invalidateQueries({ queryKey: ['transfers'] });
      void qc.invalidateQueries({ queryKey: ['inventory'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not update');
    }
  };
  if (q.isPending) return <RowsSkeleton />;
  const items = q.data?.items ?? [];
  if (!items.length) return <EmptyState icon={<Truck />} title="No transfers" body="Move stock between stores and the warehouse. It leaves on ship and arrives on receive." />;
  return (
    <ul className="divide-y divide-hairline">
      {items.map((t, i) => (
        <Rise as="li" i={i} key={t.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
          <div className="flex min-w-0 flex-1 items-center gap-3 text-sm">
            <span className="font-semibold">{t.from}</span>
            <span className="relative h-px w-16 bg-hairline">{t.status === 'IN_TRANSIT' && <motion.span className="absolute -top-1 size-2 rounded-full bg-ink" animate={{ left: ['0%', '100%'] }} transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }} />}</span>
            <span className="font-semibold">{t.to}</span>
          </div>
          <span className="text-[13px] text-muted tabular">{t.lines.reduce((a, l) => a + l.qty, 0)} pieces · {t.lines.length} SKUs</span>
          <Chip tone={t.status === 'RECEIVED' ? 'success' : t.status === 'IN_TRANSIT' ? 'ink' : t.status === 'DRAFT' ? 'warning' : 'neutral'}>{titleCase(t.status)}</Chip>
          <span className="w-28 text-xs text-muted">{fmtDateTime(t.receivedAt ?? t.shippedAt ?? t.createdAt)}</span>
          <div className="flex gap-2">
            {t.status === 'DRAFT' && <><ActionButton size="sm" variant="ghost" icon={<X strokeWidth={1.5} />} onAction={() => act(t, 'cancel')}>Cancel</ActionButton><ActionButton size="sm" icon={<Truck strokeWidth={1.5} />} onAction={() => act(t, 'ship')}>Ship</ActionButton></>}
            {t.status === 'IN_TRANSIT' && <ActionButton size="sm" icon={<PackageCheck strokeWidth={1.5} />} onAction={() => act(t, 'receive')}>Receive</ActionButton>}
          </div>
        </Rise>
      ))}
    </ul>
  );
}

function TransferDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const qc = useQueryClient();
  const stores = useStores();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [lines, setLines] = useState<{ l: Level; qty: number }[]>([]);
  const [note, setNote] = useState('');
  const search = useQuery({ queryKey: ['inv-search', from, dq], enabled: !!from && dq.length > 1, queryFn: () => api<{ items: Level[] }>('/admin/inventory', { query: { storeId: from, q: dq, limit: 10 } }) });
  const create = async () => {
    try {
      await api('/admin/inventory/transfers', { body: { fromStoreId: from, toStoreId: to, note, lines: lines.map((x) => ({ variantId: x.l.variantId, qty: x.qty })) } });
      toast.success('Transfer created — ship it when it leaves');
      void qc.invalidateQueries({ queryKey: ['transfers'] });
      onCreated();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not create');
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} size="lg" title="New transfer" description="Choose where stock is going, then add SKUs from the origin."
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><ActionButton disabled={!from || !to || from === to || !lines.length} onAction={create}>Create transfer</ActionButton></>}>
      <div className="grid gap-4">
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
          <Field label="From">{(id) => <Select id={id} value={from} onChange={(e) => { setFrom(e.target.value); setLines([]); }}><option value="">Choose…</option>{stores.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
          <ArrowRight className="mb-3 hidden size-4 text-muted sm:block" strokeWidth={1.5} />
          <Field label="To">{(id) => <Select id={id} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose…</option>{stores.data?.filter((s) => s.id !== from).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}</Field>
        </div>
        {from && (
          <div className="relative">
            <Input leading={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a SKU or product at the origin" trailing={search.isFetching ? <LoaderA size="xs" /> : undefined} aria-label="Find SKU" />
            {dq.length > 1 && search.data && (
              <ul className="mt-1 max-h-56 overflow-y-auto rounded-sm border border-hairline">
                {search.data.items.filter((l) => !lines.some((x) => x.l.variantId === l.variantId)).map((l) => (
                  <li key={l.id}><button type="button" onClick={() => { setLines([...lines, { l, qty: Math.min(1, l.available) || 1 }]); setQ(''); }} className="flex w-full items-center gap-3 px-3 py-2 text-left text-[13px] hover:bg-ink/5"><span className="flex-1 truncate">{l.product.title} <span className="text-muted">· {l.options}</span></span><span className="text-xs text-muted tabular">{l.available} available</span><Plus className="size-4 text-muted" strokeWidth={1.5} /></button></li>
                ))}
              </ul>
            )}
          </div>
        )}
        <ul className="grid gap-2">
          <AnimatePresence initial={false}>
            {lines.map((x, i) => (
              <motion.li key={x.l.variantId} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="flex items-center gap-3 rounded-sm border border-hairline px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1 truncate"><span className="font-semibold">{x.l.product.title}</span> <span className="font-mono text-[11px] text-muted">{x.l.sku}</span></span>
                <Input inputMode="numeric" value={x.qty} onChange={(e) => setLines(lines.map((y, j) => (j === i ? { ...y, qty: Math.min(x.l.available, Number(e.target.value.replace(/\D/g, '')) || 0) } : y)))} className="h-8 w-20 [&_input]:h-8" aria-label="Quantity" />
                <span className="w-20 text-xs text-muted">of {x.l.available}</span>
                <Button size="icon-sm" variant="ghost" aria-label="Remove line" onClick={() => setLines(lines.filter((_, j) => j !== i))}><X strokeWidth={1.5} /></Button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <Field label="Note" optional>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}
