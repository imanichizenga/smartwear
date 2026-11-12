'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Bell, CalendarClock, LayoutGrid, ListFilter, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { fromLocalInput, Rise, toLocalInput } from '@/components/ui/kit';
import { MediaImage } from '@/components/ui/media-image';
import { MediaSlot, ProductPicker } from '@/components/ui/pickers';
import { Card, Chip, EmptyState, PageHeader, Skeleton, Switch } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { useBrands, useCategories, useCollections, type Collection, type ProductRow } from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtNum } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import type { MediaOut } from '@/lib/types';

interface Rule { categoryIds?: string[]; brandIds?: string[]; tags?: string[]; isNewDays?: number; minPrice?: number | null; maxPrice?: number | null }
type Draft = Partial<Collection> & { products?: { id: string; title: string }[]; cover?: MediaOut | null; mode?: 'manual' | 'rule' };

function Countdown({ to }: { to: string }) {
  const now = useNow(1000);
  const ms = Math.max(0, new Date(to).getTime() - now);
  const d = Math.floor(ms / 86_400_000), h = Math.floor(ms / 3_600_000) % 24, m = Math.floor(ms / 60_000) % 60, s = Math.floor(ms / 1000) % 60;
  if (!ms) return <span>Live now</span>;
  return <span className="tabular">{d ? `${d}d ` : ''}{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}</span>;
}

export function CollectionsWorkspace() {
  const qc = useQueryClient();
  const canManage = useCan('catalog.manage');
  const cols = useCollections();
  const cats = useCategories();
  const brands = useBrands();
  const [edit, setEdit] = useState<Draft | null>(null);
  const openEdit = async (c: Collection) => {
    let products: { id: string; title: string }[] = [];
    if (c.productIds.length && !c.rule) {
      const r = await api<{ items: ProductRow[] }>('/admin/products', { query: { ids: c.productIds.join(','), limit: 200 } });
      const t = new Map(r.items.map((p) => [p.id, p.title]));
      products = c.productIds.filter((i) => t.has(i)).map((i) => ({ id: i, title: t.get(i)! }));
    }
    setEdit({ ...c, products, mode: c.rule ? 'rule' : 'manual' });
  };
  const save = async () => {
    if (!edit) return;
    const body = {
      title: edit.title, titleSw: edit.titleSw, subtitle: edit.subtitle, description: edit.description, isDrop: !!edit.isDrop, launchesAt: edit.launchesAt ?? null, endsAt: edit.endsAt ?? null,
      published: edit.published ?? false, coverMediaId: edit.cover?.id ?? edit.coverMediaId ?? null,
      rule: edit.mode === 'rule' ? edit.rule ?? {} : null, ...(edit.mode === 'manual' ? { productIds: (edit.products ?? []).map((p) => p.id) } : {}),
    };
    try {
      await api(edit.id ? `/admin/collections/${edit.id}` : '/admin/collections', { method: edit.id ? 'PATCH' : 'POST', body });
      toast.success('Collection saved');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['collections'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  const remove = async () => {
    if (!edit?.id) return;
    await api(`/admin/collections/${edit.id}`, { method: 'DELETE' });
    toast.success('Collection deleted');
    setEdit(null);
    void qc.invalidateQueries({ queryKey: ['collections'] });
  };
  const rule = (edit?.rule ?? {}) as Rule;
  const setRule = (p: Partial<Rule>) => edit && setEdit({ ...edit, rule: { ...rule, ...p } as Record<string, unknown> });
  const list = cols.data ?? [];
  return (
    <>
      <PageHeader title="Collections & drops" description="Hand-picked edits or rule-based sets. A drop gets a real countdown in the app and a “Notify me” list."
        actions={canManage && <Button icon={<Plus strokeWidth={1.5} />} onClick={() => setEdit({ mode: 'manual', published: false, products: [] })}>New collection</Button>} />
      {cols.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-64" />)}</div>
      ) : list.length === 0 ? (
        <Card><EmptyState icon={<LayoutGrid />} title="No collections" body="Create an edit like “Wedding guest” or schedule your next drop." /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((c, i) => (
            <Rise key={c.id} i={i}>
              <button type="button" disabled={!canManage} onClick={() => void openEdit(c)} className="group block w-full text-left">
                <Card className="overflow-hidden transition-colors group-hover:border-ink/25">
                  <div className="relative overflow-hidden">
                    <motion.div whileHover={{ scale: 1.03 }} transition={{ duration: 0.5 }}>
                      <MediaImage media={c.cover} ratio="16 / 10" rounded="none" sizes="(min-width:1280px) 33vw, 50vw" />
                    </motion.div>
                    <div className="absolute left-3 top-3 flex gap-1.5">
                      {c.isDrop && <Chip tone="ink">Drop</Chip>}
                      {c.rule && <Chip tone="neutral" className="bg-surface/90">Rule</Chip>}
                      {!c.published && <Chip tone="warning">Draft</Chip>}
                    </div>
                    {c.isDrop && c.launchesAt && new Date(c.launchesAt) > new Date() && (
                      <div className="absolute inset-x-3 bottom-3 flex items-center justify-between rounded-sm bg-ink/80 px-3 py-2 text-[13px] text-on-ink backdrop-blur">
                        <span className="flex items-center gap-1.5"><CalendarClock className="size-3.5" strokeWidth={1.5} /> Launches in</span>
                        <Countdown to={c.launchesAt} />
                      </div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="font-display text-xl leading-7">{c.title}</div>
                    <p className="mt-0.5 line-clamp-1 text-[13px] text-muted">{c.subtitle ?? '—'}</p>
                    <div className="mt-3 flex items-center gap-3 text-xs text-muted">
                      <span className="tabular">{c.rule ? 'Auto-filled' : `${fmtNum(c.productIds.length)} products`}</span>
                      {c.isDrop && <span className="flex items-center gap-1 tabular"><Bell className="size-3" strokeWidth={1.5} /> {fmtNum(c.subscribers)} waiting</span>}
                    </div>
                  </div>
                </Card>
              </button>
            </Rise>
          ))}
        </div>
      )}
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} size="lg" title={edit?.id ? edit.title ?? 'Collection' : 'New collection'}
        footer={<>
          {edit?.id && <ActionButton variant="danger" className="mr-auto" icon={<Trash2 strokeWidth={1.5} />} onAction={remove}>Delete</ActionButton>}
          <Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          <ActionButton disabled={!edit?.title?.trim()} onAction={save}>Save</ActionButton>
        </>}>
        {edit && (
          <div className="grid gap-5 md:grid-cols-[200px_1fr]">
            <MediaSlot media={edit.cover ?? null} onChange={(m) => setEdit({ ...edit, cover: m, coverMediaId: m?.id ?? null })} ratio="4 / 5" label="Cover image" purpose="collection" />
            <div className="grid content-start gap-4">
              <Field label="Title">{(id) => <Input id={id} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="The Coastal Edit" />}</Field>
              <Field label="Swahili title" optional>{(id) => <Input id={id} value={edit.titleSw ?? ''} onChange={(e) => setEdit({ ...edit, titleSw: e.target.value })} />}</Field>
              <Field label="Subtitle" optional>{(id) => <Input id={id} value={edit.subtitle ?? ''} onChange={(e) => setEdit({ ...edit, subtitle: e.target.value })} placeholder="Linen, florals and sandals for long days by the ocean." />}</Field>
              <Field label="Description" optional>{(id) => <Textarea id={id} rows={2} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />}</Field>
              <div className="flex flex-wrap gap-5">
                <label className="flex items-center gap-2 text-[13px]"><Switch checked={!!edit.published} onCheckedChange={(v) => setEdit({ ...edit, published: v })} label="Published" /> Published</label>
                <label className="flex items-center gap-2 text-[13px]"><Switch checked={!!edit.isDrop} onCheckedChange={(v) => setEdit({ ...edit, isDrop: v })} label="Drop" /> This is a drop</label>
              </div>
              {edit.isDrop && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Launches" help="Shoppers see a live countdown until this moment.">{(id) => <Input id={id} type="datetime-local" value={toLocalInput(edit.launchesAt)} onChange={(e) => setEdit({ ...edit, launchesAt: fromLocalInput(e.target.value) })} />}</Field>
                  <Field label="Ends" optional>{(id) => <Input id={id} type="datetime-local" value={toLocalInput(edit.endsAt)} onChange={(e) => setEdit({ ...edit, endsAt: fromLocalInput(e.target.value) })} />}</Field>
                </div>
              )}
              <div className="flex rounded-sm border border-hairline p-0.5 text-[13px] font-semibold">
                {(['manual', 'rule'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setEdit({ ...edit, mode: m })} className={cn('relative flex-1 rounded-xs py-1.5 transition-colors', edit.mode === m ? 'text-on-ink' : 'text-muted')}>
                    {edit.mode === m && <motion.span layoutId="col-mode" className="absolute inset-0 -z-0 rounded-xs bg-ink" />}
                    <span className="relative">{m === 'manual' ? 'Pick products' : 'Fill by rule'}</span>
                  </button>
                ))}
              </div>
              {edit.mode === 'manual' ? (
                <ProductPicker value={edit.products ?? []} max={120} onChange={(products) => setEdit({ ...edit, products })} />
              ) : (
                <div className="grid gap-3 rounded-sm bg-canvas p-4">
                  <div className="flex items-center gap-2 text-[13px] font-semibold"><ListFilter className="size-4" strokeWidth={1.5} /> Published products matching all of:</div>
                  <Field label="Category">{(id) => <Select id={id} value={rule.categoryIds?.[0] ?? ''} onChange={(e) => setRule({ categoryIds: e.target.value ? [e.target.value] : [] })}><option value="">Any</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>}</Field>
                  <Field label="Brand">{(id) => <Select id={id} value={rule.brandIds?.[0] ?? ''} onChange={(e) => setRule({ brandIds: e.target.value ? [e.target.value] : [] })}><option value="">Any</option>{brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
                  <Field label="Tags" help="Comma-separated, any of">{(id) => <Input id={id} value={(rule.tags ?? []).join(', ')} onChange={(e) => setRule({ tags: e.target.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) })} />}</Field>
                  <div className="grid grid-cols-3 gap-3">
                    <Field label="New in (days)">{(id) => <Input id={id} inputMode="numeric" value={rule.isNewDays ?? ''} onChange={(e) => setRule({ isNewDays: e.target.value ? +e.target.value : undefined })} />}</Field>
                    <Field label="Min price">{(id) => <Input id={id} inputMode="numeric" value={rule.minPrice ?? ''} onChange={(e) => setRule({ minPrice: e.target.value ? +e.target.value.replace(/\D/g, '') : null })} />}</Field>
                    <Field label="Max price">{(id) => <Input id={id} inputMode="numeric" value={rule.maxPrice ?? ''} onChange={(e) => setRule({ maxPrice: e.target.value ? +e.target.value.replace(/\D/g, '') : null })} />}</Field>
                  </div>
                </div>
              )}
              {edit.launchesAt && <p className="text-xs text-muted">Drop goes live {fmtDateTime(edit.launchesAt)}.</p>}
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
