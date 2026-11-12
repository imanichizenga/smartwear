'use client';

import { useRef, useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Copy, Download, FileUp, Package, Percent, Plus, Search, Sparkles, Star } from 'lucide-react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { LinkButton, LoadMore, Rise, RowsSkeleton, Tabs, Toolbar } from '@/components/ui/kit';
import { MediaImage } from '@/components/ui/media-image';
import { useDebounced } from '@/components/ui/pickers';
import { Card, Checkbox, Chip, EmptyState, PageHeader, Switch, Tooltip } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { STATUS_TONE, useBrands, useCategories, type ProductRow } from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { fmtAgo, fmtMoney, fmtNum, titleCase } from '@/lib/format';
import { downloadApiFile } from '@/lib/upload';

const TABS = [
  { key: '', label: 'All' },
  { key: 'PUBLISHED', label: 'Published' },
  { key: 'DRAFT', label: 'Drafts' },
  { key: 'SCHEDULED', label: 'Scheduled' },
  { key: 'ARCHIVED', label: 'Archived' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

interface ListRes { items: ProductRow[]; nextCursor: string | null; counts: Record<string, number> }

export function ProductsList() {
  const qc = useQueryClient();
  const router = useRouter();
  const canManage = useCan('products.manage');
  const canPublish = useCan('products.publish');
  const [status, setStatus] = useState<TabKey>('');
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [flag, setFlag] = useState('');
  const [sort, setSort] = useState('updated');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const dq = useDebounced(q, 250);
  const cats = useCategories();
  const brands = useBrands();

  const key = ['products', status, dq, categoryId, brandId, flag, sort];
  const query = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => api<ListRes>('/admin/products', { query: { status, q: dq, categoryId, brandId, sort, cursor: pageParam, lowStock: flag === 'low' ? 1 : undefined, noWholesale: flag === 'nows' ? 1 : undefined } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const counts = query.data?.pages[0]?.counts ?? {};
  const tabCounts = { '': Object.values(counts).reduce((a, b) => a + b, 0), ...counts } as Record<TabKey, number>;

  const patchRow = async (p: ProductRow, body: Record<string, unknown>) => {
    try {
      const next = await api<ProductRow>(`/admin/products/${p.id}`, { method: 'PATCH', body });
      qc.setQueryData<{ pages: ListRes[]; pageParams: unknown[] }>(key, (d) => d && { ...d, pages: d.pages.map((pg) => ({ ...pg, items: pg.items.map((r) => (r.id === p.id ? next : r)) })) });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  const duplicate = async (p: ProductRow) => {
    const d = await api<{ id: string }>(`/admin/products/${p.id}/duplicate`, { method: 'POST' });
    toast.success('Duplicated as a draft');
    router.push(`/products/${d.id}`);
  };
  const toggleSel = (id: string, on: boolean) => setSelected((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const allOn = rows.length > 0 && rows.every((r) => selected.has(r.id));

  return (
    <>
      <PageHeader
        title="Products"
        description="Everything in the catalogue, with media, variants and retail/wholesale pricing. Edit price, stock and visibility inline."
        actions={
          <>
            <ActionButton variant="ghost" icon={<Download strokeWidth={1.5} />} onAction={() => downloadApiFile('/admin/products/export', 'smartwear-products.csv')}>Export CSV</ActionButton>
            {canManage && <Button variant="secondary" icon={<FileUp strokeWidth={1.5} />} onClick={() => setImportOpen(true)}>Import</Button>}
            {canManage && <LinkButton variant="primary" href="/products/new" icon={<Plus strokeWidth={1.5} />}>New product</LinkButton>}
          </>
        }
      />
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3">
          <Tabs id="products" tabs={[...TABS]} value={status} onChange={(k) => { setStatus(k); setSelected(new Set()); }} counts={tabCounts} />
        </div>
        <Toolbar>
          <Input className="min-w-0 flex-1 sm:max-w-xs" leading={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Title, SKU, barcode or brand" aria-label="Search products" />
          <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className="w-48" aria-label="Category">
            <option value="">All categories</option>
            {cats.data?.filter((c) => c.depth < 2).map((c) => <option key={c.id} value={c.id}>{' '.repeat(c.depth)}{c.name}</option>)}
          </Select>
          <Select value={brandId} onChange={(e) => setBrandId(e.target.value)} className="w-40" aria-label="Brand">
            <option value="">All brands</option>
            {brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select value={flag} onChange={(e) => setFlag(e.target.value)} className="w-44" aria-label="Quick filter">
            <option value="">No quick filter</option>
            <option value="low">Low stock</option>
            <option value="nows">No wholesale tiers</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-40" aria-label="Sort">
            <option value="updated">Recently edited</option>
            <option value="title">Title A–Z</option>
            <option value="price">Price ↑</option>
            <option value="-price">Price ↓</option>
          </Select>
        </Toolbar>
        <AnimatePresence>
          {selected.size > 0 && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden border-b border-hairline bg-accent-soft/40">
              <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 text-[13px]">
                <span className="font-semibold">{selected.size} selected</span>
                <span className="mx-1 h-4 w-px bg-hairline" />
                {canManage && <Button size="sm" variant="secondary" icon={<Percent strokeWidth={1.5} />} onClick={() => setBulkOpen(true)}>Adjust prices</Button>}
                {canPublish && (
                  <ActionButton size="sm" variant="secondary" onAction={async () => { for (const id of selected) { const r = rows.find((x) => x.id === id); if (r && r.status !== 'PUBLISHED') await patchRow(r, { status: 'PUBLISHED' }); } toast.success('Published'); void qc.invalidateQueries({ queryKey: ['products'] }); }}>Publish</ActionButton>
                )}
                {canManage && (
                  <ActionButton size="sm" variant="secondary" onAction={async () => { for (const id of selected) { const r = rows.find((x) => x.id === id); if (r) await patchRow(r, { status: 'ARCHIVED' }); } toast.success('Archived'); void qc.invalidateQueries({ queryKey: ['products'] }); }}>Archive</ActionButton>
                )}
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>Clear</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {query.isPending ? (
          <RowsSkeleton avatar rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState icon={<Package />} title={dq || categoryId || brandId || flag ? 'Nothing matches' : 'No products yet'} body={dq ? 'Try another title, SKU or brand.' : 'Add your first piece — photos, variants and pricing in one place.'} action={canManage && !dq && <LinkButton variant="primary" href="/products/new" icon={<Plus strokeWidth={1.5} />}>New product</LinkButton>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] text-sm">
              <thead>
                <tr className="label-caps border-b border-hairline text-left text-muted">
                  <th className="w-10 py-3 pl-5"><Checkbox checked={allOn ? true : selected.size ? 'indeterminate' : false} onCheckedChange={(v) => setSelected(v ? new Set(rows.map((r) => r.id)) : new Set())} label="Select all" /></th>
                  <th className="px-3 py-3 font-semibold">Product</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 font-semibold">Price</th>
                  <th className="px-3 py-3 text-right font-semibold">Stock</th>
                  <th className="px-3 py-3 font-semibold">Featured</th>
                  <th className="px-3 py-3 font-semibold">Edited</th>
                  <th className="w-12 px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((p, i) => (
                  <Rise as="tr" i={i} key={p.id} className={cn('group hover:bg-ink/[0.025]', selected.has(p.id) && 'bg-accent-soft/25')}>
                    <td className="py-3 pl-5"><Checkbox checked={selected.has(p.id)} onCheckedChange={(v) => toggleSel(p.id, v)} label={`Select ${p.title}`} /></td>
                    <td className="px-3 py-3">
                      <AppLink href={`/products/${p.id}`} className="flex min-w-0 items-center gap-3">
                        <MediaImage media={p.cover} className="w-11 shrink-0 transition-transform duration-300 group-hover:scale-[1.03]" sizes="44px" rounded="xs" />
                        <span className="min-w-0">
                          <span className="block max-w-80 truncate font-semibold hover:underline">{p.title}</span>
                          <span className="block max-w-80 truncate text-xs text-muted">{p.brand ?? 'No brand'} · {p.category?.name ?? '—'} · {p.variants} {p.variants === 1 ? 'variant' : 'variants'}</span>
                        </span>
                      </AppLink>
                    </td>
                    <td className="px-3 py-3"><Chip tone={STATUS_TONE[p.status]} dot={p.status === 'SCHEDULED'}>{titleCase(p.status)}</Chip></td>
                    <td className="px-3 py-3 tabular">
                      <div className="font-semibold">{p.minPrice === p.maxPrice ? fmtMoney(p.minPrice, p.currency) : `${fmtMoney(p.minPrice, p.currency)} – ${fmtNum(p.maxPrice)}`}</div>
                      <div className={cn('text-xs', p.hasWholesale ? 'text-muted' : 'text-subtle')}>{p.hasWholesale ? 'Wholesale tiers' : 'Retail only'}</div>
                    </td>
                    <td className="px-3 py-3 text-right tabular">
                      <div className={cn('font-semibold', !p.inStock ? 'text-danger' : p.stock < 10 ? 'text-warning' : '')}>{fmtNum(p.stock)}</div>
                      <div className="text-xs text-muted">{p.inStock ? 'in stock' : 'sold out'}</div>
                    </td>
                    <td className="px-3 py-3">
                      <Switch checked={p.featured} disabled={!canManage} onCheckedChange={(v) => void patchRow(p, { featured: v })} label={`Feature ${p.title}`} />
                    </td>
                    <td className="px-3 py-3 text-xs text-muted">{fmtAgo(p.updatedAt)}</td>
                    <td className="px-5 py-3 text-right">
                      {canManage && (
                        <Tooltip content="Duplicate as draft">
                          <span><ActionButton size="icon-sm" variant="ghost" aria-label={`Duplicate ${p.title}`} icon={<Copy strokeWidth={1.5} />} onAction={() => duplicate(p)} /></span>
                        </Tooltip>
                      )}
                    </td>
                  </Rise>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore hasMore={query.hasNextPage} onMore={() => query.fetchNextPage()} />
      </Card>
      <BulkPriceDialog open={bulkOpen} onOpenChange={setBulkOpen} productIds={[...selected]} onDone={() => { setSelected(new Set()); void qc.invalidateQueries({ queryKey: ['products'] }); }} />
      <ImportDialog open={importOpen} onOpenChange={setImportOpen} onDone={() => void qc.invalidateQueries({ queryKey: ['products'] })} />
    </>
  );
}

function BulkPriceDialog({ open, onOpenChange, productIds, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; productIds: string[]; onDone: () => void }) {
  const [pct, setPct] = useState('10');
  const [rounding, setRounding] = useState('nearest_100');
  const [tiers, setTiers] = useState(true);
  const n = Number(pct);
  const run = async () => {
    try {
      const r = await api<{ variantsUpdated: number; productsUpdated: number }>('/admin/products/bulk-price', { body: { productIds, percent: n, rounding, includeTiers: tiers } });
      toast.success(`Updated ${r.variantsUpdated} variants across ${r.productsUpdated} products`);
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not update prices');
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" title="Adjust prices" description={`${productIds.length} selected products. Compare-at prices that would no longer be a real discount are cleared.`}
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><ActionButton disabled={!n} onAction={run}>{n > 0 ? `Raise ${n}%` : n < 0 ? `Lower ${Math.abs(n)}%` : 'Apply'}</ActionButton></>}>
      <div className="grid gap-4">
        <Field label="Change by" help="Use a negative number to lower prices, e.g. −15">
          {(id) => <Input id={id} type="number" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} trailing={<span className="pr-1 text-sm">%</span>} />}
        </Field>
        <Field label="Rounding">
          {(id) => (
            <Select id={id} value={rounding} onChange={(e) => setRounding(e.target.value)}>
              <option value="nearest_100">Nearest 100</option>
              <option value="nearest_500">Nearest 500</option>
              <option value="nearest_1000">Nearest 1,000</option>
              <option value="up_100">Round up to 100</option>
              <option value="none">Don’t round</option>
            </Select>
          )}
        </Field>
        <label className="flex items-center justify-between gap-3 text-sm">Also change wholesale tiers <Switch checked={tiers} onCheckedChange={setTiers} label="Include tiers" /></label>
      </div>
    </Dialog>
  );
}

interface ImportRes { dryRun: boolean; ok: number; failed: number; results: { product: string; ok: boolean; action?: string; error?: string }[] }

function ImportDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [res, setRes] = useState<ImportRes | null>(null);
  const send = async (dry: boolean) => {
    if (!file) return;
    const fd = new FormData();
    fd.append('file', file);
    fd.append('dryRun', dry ? '1' : '0');
    try {
      const r = await api<ImportRes>('/admin/products/import', { body: fd });
      setRes(r);
      if (!dry) {
        toast.success(`Imported ${r.ok} products${r.failed ? `, ${r.failed} need fixing` : ''}`);
        onDone();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Import failed');
    }
  };
  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setFile(null); setRes(null); } }} title="Import products" description="CSV or XLSX in the export format — rows sharing a product_slug become one product with variants. Check first, then import."
      footer={<>
        <Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>
        <ActionButton variant="secondary" disabled={!file} icon={<Sparkles strokeWidth={1.5} />} onAction={() => send(true)}>Check file</ActionButton>
        <ActionButton disabled={!file || !res?.dryRun || res.ok === 0} onAction={() => send(false)}>Import {res?.dryRun ? res.ok : ''}</ActionButton>
      </>}>
      <input ref={input} type="file" hidden accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setRes(null); }} />
      <button type="button" onClick={() => input.current?.click()} className="flex w-full items-center gap-3 rounded-sm border border-dashed border-ink/25 px-4 py-6 text-left hover:border-ink/45">
        <FileUp className="size-6 text-muted" strokeWidth={1.25} />
        <span className="text-sm">{file ? <><b>{file.name}</b> · {Math.round(file.size / 1024)} KB</> : 'Choose a CSV or XLSX file (up to 10 MB)'}</span>
      </button>
      {res && (
        <div className="mt-4">
          <div className="mb-2 flex gap-2 text-[13px]"><Chip tone="success">{res.ok} ready</Chip>{res.failed > 0 && <Chip tone="danger">{res.failed} with errors</Chip>}{!res.dryRun && <Chip tone="ink">Imported</Chip>}</div>
          <ul className="max-h-64 divide-y divide-hairline overflow-y-auto rounded-sm border border-hairline text-[13px]">
            {res.results.map((r) => (
              <li key={r.product} className="flex items-start gap-3 px-3 py-2">
                <span className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', r.ok ? 'bg-success' : 'bg-danger')} />
                <span className="min-w-0 flex-1"><span className="font-semibold">{r.product}</span>{r.error && <span className="block text-danger">{r.error}</span>}</span>
                {r.action && <span className="text-xs text-muted">{r.action}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted"><Star className="size-3" strokeWidth={1.5} /> Tip: export first to get a template with every column.</p>
    </Dialog>
  );
}
