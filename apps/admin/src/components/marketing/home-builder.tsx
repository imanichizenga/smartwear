'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'motion/react';
import {
  CalendarClock, CircleDot, Clock, Eye, EyeOff, GalleryHorizontal, GripVertical, Heart, History, Image as ImageIcon, LayoutGrid, Plus, Rows3, Sparkles, Store, Tag, Trash2, Users, Wand2,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { LoaderA } from '@/components/brand/LoaderA';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { fromLocalInput, toLocalInput } from '@/components/ui/kit';
import { MediaImage } from '@/components/ui/media-image';
import { ProductPicker } from '@/components/ui/pickers';
import { Card, Chip, PageHeader, Switch } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useBrands, useCategories, useCollections, type ProductRow } from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtMoney } from '@/lib/format';
import { useNow } from '@/lib/use-now';
import type { MediaOut } from '@/lib/types';

interface Section { id: string; type: string; title: string; titleSw: string | null; subtitle: string | null; config: Record<string, unknown>; sortOrder: number; isActive: boolean; startsAt: string | null; endsAt: string | null; segment: { customerTypes?: string[]; departments?: string[]; signedIn?: boolean } }
interface BannerLite { id: string; title: string; media: MediaOut; isActive: boolean }

const ICON: Record<string, LucideIcon> = { stories: CircleDot, hero: GalleryHorizontal, new_in: Sparkles, collections: LayoutGrid, for_you: Heart, brand_spotlight: Tag, beauty_corner: Wand2, recently_viewed: History, drop_countdown: CalendarClock, category_tiles: Rows3, product_rail: Store, banner: ImageIcon, looks_teaser: ImageIcon };

export function HomeBuilder() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['home-sections'], queryFn: () => api<{ items: Section[]; types: { key: string; label: string }[] }>('/admin/home/sections') });
  const [order, setOrder] = useState<string[] | null>(null);
  const [edit, setEdit] = useState<Partial<Section> | null>(null);
  const [seg, setSeg] = useState({ customerType: 'RETAIL', signedIn: true, locale: 'en' });
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const items = q.data?.items ?? [];
  const byId = new Map(items.map((s) => [s.id, s]));
  const ordered = (order ?? items.map((s) => s.id)).map((id) => byId.get(id)).filter(Boolean) as Section[];
  const types = q.data?.types ?? [];
  const label = (t: string) => types.find((x) => x.key === t)?.label ?? t;
  const refresh = () => { void qc.invalidateQueries({ queryKey: ['home-sections'] }); void qc.invalidateQueries({ queryKey: ['home-preview'] }); };

  const onSort = async ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = ordered.map((s) => s.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrder(next);
    try {
      await api('/admin/home/sections/reorder', { body: { ids: next } });
      void qc.invalidateQueries({ queryKey: ['home-preview'] });
    } catch {
      toast.error('Could not reorder');
      setOrder(null);
    }
  };
  const toggle = async (s: Section) => {
    await api(`/admin/home/sections/${s.id}`, { method: 'PATCH', body: { isActive: !s.isActive } });
    refresh();
  };
  const save = async () => {
    if (!edit) return;
    const body = { type: edit.type, title: edit.title ?? '', titleSw: edit.titleSw ?? '', subtitle: edit.subtitle ?? '', config: edit.config ?? {}, isActive: edit.isActive ?? true, startsAt: edit.startsAt ?? null, endsAt: edit.endsAt ?? null, segment: edit.segment ?? {} };
    try {
      await api(edit.id ? `/admin/home/sections/${edit.id}` : '/admin/home/sections', { method: edit.id ? 'PATCH' : 'POST', body });
      toast.success('Section saved');
      setEdit(null);
      setOrder(null);
      refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };

  return (
    <>
      <PageHeader title="Home layout" description="The app’s Home screen is exactly this list, top to bottom. Drag to reorder, schedule a section, or show it only to a segment."
        actions={<Button icon={<Plus strokeWidth={1.5} />} onClick={() => setEdit({ type: 'product_rail', isActive: true, config: { limit: 10 }, segment: {} })}>Add section</Button>} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card className="overflow-hidden">
          {q.isPending ? <div className="flex justify-center py-16"><LoaderA size="lg" /></div> : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onSort(e)}>
              <SortableContext items={ordered.map((s) => s.id)} strategy={verticalListSortingStrategy}>
                <ul className="divide-y divide-hairline">
                  {ordered.map((s, i) => <Row key={s.id} s={s} i={i} label={label(s.type)} onEdit={() => setEdit(s)} onToggle={() => void toggle(s)} />)}
                </ul>
              </SortableContext>
            </DndContext>
          )}
        </Card>
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="mb-3 flex items-center justify-center gap-2 text-[12px]">
            <Select value={seg.customerType} onChange={(e) => setSeg({ ...seg, customerType: e.target.value })} className="w-28" aria-label="Preview as"><option value="RETAIL">Retail</option><option value="WHOLESALE">Wholesale</option></Select>
            <Select value={seg.signedIn ? '1' : '0'} onChange={(e) => setSeg({ ...seg, signedIn: e.target.value === '1' })} className="w-28" aria-label="Signed in"><option value="1">Signed in</option><option value="0">Guest</option></Select>
            <Select value={seg.locale} onChange={(e) => setSeg({ ...seg, locale: e.target.value })} className="w-20" aria-label="Language"><option value="en">EN</option><option value="sw">SW</option></Select>
          </div>
          <HomePreview seg={seg} />
        </div>
      </div>
      <SectionDialog edit={edit} setEdit={setEdit} types={types} onSave={save} onDelete={async () => { if (!edit?.id) return; await api(`/admin/home/sections/${edit.id}`, { method: 'DELETE' }); setEdit(null); setOrder(null); refresh(); }} />
    </>
  );
}

function Row({ s, i, label, onEdit, onToggle }: { s: Section; i: number; label: string; onEdit: () => void; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: s.id });
  const Icon = ICON[s.type] ?? Rows3;
  const now = useNow(60_000);
  const scheduled = (s.startsAt && new Date(s.startsAt).getTime() > now) || (s.endsAt && new Date(s.endsAt).getTime() < now);
  const segs = [...(s.segment.customerTypes ?? []).map((t) => (t === 'WHOLESALE' ? 'Wholesale' : 'Retail')), ...(s.segment.departments ?? []), ...(s.segment.signedIn === true ? ['Signed in'] : s.segment.signedIn === false ? ['Guests'] : [])];
  return (
    <motion.li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(i, 12) * 0.02 }}
      className={cn('flex items-center gap-3 bg-surface px-3 py-3 sm:px-4', isDragging && 'relative z-10 shadow-floating', !s.isActive && 'opacity-55')}>
      <button type="button" {...attributes} {...listeners} aria-label={`Drag ${label}`} className="flex size-8 cursor-grab items-center justify-center rounded-xs text-muted hover:bg-ink/5 active:cursor-grabbing"><GripVertical className="size-4" strokeWidth={1.5} /></button>
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent-soft"><Icon className="size-4" strokeWidth={1.5} /></span>
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-semibold">{s.title || label}</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {s.title && s.title !== label && <span>{label}</span>}
          {!s.title && <span>{s.isActive ? 'Always shown' : 'Hidden'}</span>}
          {scheduled && <span className="inline-flex items-center gap-1 text-warning"><Clock className="size-3" strokeWidth={1.75} />{s.startsAt && new Date(s.startsAt).getTime() > now ? `from ${fmtDateTime(s.startsAt)}` : 'ended'}</span>}
          {segs.length > 0 && <span className="inline-flex items-center gap-1"><Users className="size-3" strokeWidth={1.75} />{segs.join(', ')}</span>}
        </div>
      </button>
      <Button size="icon-sm" variant="ghost" onClick={onToggle} aria-label={s.isActive ? 'Hide section' : 'Show section'}>{s.isActive ? <Eye strokeWidth={1.5} /> : <EyeOff strokeWidth={1.5} />}</Button>
    </motion.li>
  );
}

function SectionDialog({ edit, setEdit, types, onSave, onDelete }: { edit: Partial<Section> | null; setEdit: (s: Partial<Section> | null) => void; types: { key: string; label: string }[]; onSave: () => Promise<void>; onDelete: () => Promise<void> }) {
  const cols = useCollections();
  const brands = useBrands();
  const cats = useCategories();
  const banners = useQuery({ queryKey: ['banners'], enabled: !!edit, queryFn: async () => (await api<{ items: BannerLite[] }>('/admin/banners')).items });
  const [prodTitles, setProdTitles] = useState<{ id: string; title: string }[] | null>(null);
  const cfg = (edit?.config ?? {}) as Record<string, unknown>;
  const setCfg = (p: Record<string, unknown>) => edit && setEdit({ ...edit, config: { ...cfg, ...p } });
  const segment = edit?.segment ?? {};
  const setSeg = (p: Partial<Section['segment']>) => edit && setEdit({ ...edit, segment: { ...segment, ...p } });
  const ids = (k: string) => (cfg[k] as string[] | undefined) ?? [];
  const toggleId = (k: string, id: string) => setCfg({ [k]: ids(k).includes(id) ? ids(k).filter((x) => x !== id) : [...ids(k), id] });
  const productIds = ids('productIds');
  const titles = useQuery({
    queryKey: ['section-products', edit?.id],
    enabled: !!edit?.id && productIds.length > 0,
    queryFn: async () => (await api<{ items: ProductRow[] }>('/admin/products', { query: { ids: productIds.join(','), limit: 200 } })).items.map((p) => ({ id: p.id, title: p.title })),
  });
  const pickerValue = prodTitles ?? titles.data ?? [];
  const t = edit?.type;
  return (
    <Dialog open={!!edit} onOpenChange={(v) => { if (!v) { setEdit(null); setProdTitles(null); } }} size="lg" title={edit?.id ? 'Edit section' : 'New section'}
      footer={<>{edit?.id && <ActionButton variant="danger" className="mr-auto" icon={<Trash2 strokeWidth={1.5} />} onAction={onDelete}>Delete</ActionButton>}<Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><ActionButton onAction={onSave}>Save</ActionButton></>}>
      {edit && (
        <div className="grid gap-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type">{(id) => <Select id={id} value={edit.type} disabled={!!edit.id} onChange={(e) => setEdit({ ...edit, type: e.target.value, config: {} })}>{types.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</Select>}</Field>
            <label className="flex items-end gap-2 pb-2 text-[13px]"><Switch checked={edit.isActive ?? true} onCheckedChange={(v) => setEdit({ ...edit, isActive: v })} label="Visible" /> Visible</label>
            {t !== 'stories' && t !== 'hero' && t !== 'banner' && (
              <>
                <Field label="Title" optional>{(id) => <Input id={id} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Wedding guest edit" />}</Field>
                <Field label="Swahili title" optional>{(id) => <Input id={id} value={edit.titleSw ?? ''} onChange={(e) => setEdit({ ...edit, titleSw: e.target.value })} />}</Field>
                <Field label="Subtitle" optional className="sm:col-span-2">{(id) => <Input id={id} value={edit.subtitle ?? ''} onChange={(e) => setEdit({ ...edit, subtitle: e.target.value })} />}</Field>
              </>
            )}
          </div>

          <div className="grid gap-4 rounded-sm bg-canvas p-4">
            <div className="label-caps text-muted">Content</div>
            {(t === 'hero' || t === 'banner') && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {(banners.data ?? []).map((b) => {
                  const on = t === 'hero' ? ids('bannerIds').includes(b.id) : cfg.bannerId === b.id;
                  return (
                    <button key={b.id} type="button" onClick={() => (t === 'hero' ? toggleId('bannerIds', b.id) : setCfg({ bannerId: b.id }))} className={cn('relative overflow-hidden rounded-xs text-left outline-offset-2', on && 'outline-2 outline-ink')}>
                      <MediaImage media={b.media} ratio="4 / 5" sizes="120px" rounded="xs" />
                      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 p-1.5 text-[11px] text-white">{b.title}</span>
                    </button>
                  );
                })}
              </div>
            )}
            {t === 'hero' && <Field label="Auto-advance (seconds)">{(id) => <Input id={id} inputMode="numeric" value={Number(cfg.autoAdvanceMs ?? 5500) / 1000} onChange={(e) => setCfg({ autoAdvanceMs: Math.max(2, Number(e.target.value) || 5.5) * 1000 })} className="w-32" />}</Field>}
            {t === 'collections' && (
              <div className="flex flex-wrap gap-1.5">{cols.data?.map((c) => <button key={c.id} type="button" onClick={() => toggleId('collectionIds', c.id)} className={cn('h-8 rounded-sm border px-2.5 text-[13px]', ids('collectionIds').includes(c.id) ? 'border-ink bg-ink text-on-ink' : 'border-hairline bg-surface')}>{c.title}</button>)}</div>
            )}
            {t === 'drop_countdown' && <Field label="Drop">{(id) => <Select id={id} value={(cfg.collectionId as string) ?? ''} onChange={(e) => setCfg({ collectionId: e.target.value || undefined })}><option value="">Next upcoming drop</option>{cols.data?.filter((c) => c.isDrop).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>}</Field>}
            {t === 'brand_spotlight' && <Field label="Brand">{(id) => <Select id={id} value={(cfg.brandId as string) ?? ''} onChange={(e) => setCfg({ brandId: e.target.value || undefined })}><option value="">Rotate featured brands</option>{brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>}
            {t === 'category_tiles' && (
              <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto">{cats.data?.filter((c) => c.depth <= 1).map((c) => <button key={c.id} type="button" onClick={() => toggleId('categoryIds', c.id)} className={cn('h-8 rounded-sm border px-2.5 text-[13px]', ids('categoryIds').includes(c.id) ? 'border-ink bg-ink text-on-ink' : 'border-hairline bg-surface')}>{c.label}</button>)}</div>
            )}
            {t === 'new_in' && <Field label="Published in the last (days)">{(id) => <Input id={id} inputMode="numeric" value={Number(cfg.days ?? 30)} onChange={(e) => setCfg({ days: Number(e.target.value) || 30 })} className="w-32" />}</Field>}
            {(t === 'beauty_corner' || t === 'product_rail') && <Field label="Category" optional>{(id) => <Select id={id} value={(cfg.categoryId as string) ?? ''} onChange={(e) => setCfg({ categoryId: e.target.value || undefined })}><option value="">{t === 'beauty_corner' ? 'All beauty' : 'Any'}</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>}</Field>}
            {t === 'product_rail' && (
              <>
                <Field label="Hand-pick products" optional help="Leave empty to fill from the category, collection or tag.">{() => <ProductPicker value={pickerValue} onChange={(v) => { setProdTitles(v); setCfg({ productIds: v.map((x) => x.id) }); }} />}</Field>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Collection" optional>{(id) => <Select id={id} value={(cfg.collectionId as string) ?? ''} onChange={(e) => setCfg({ collectionId: e.target.value || undefined })}><option value="">—</option>{cols.data?.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>}</Field>
                  <Field label="Tag" optional>{(id) => <Input id={id} value={(cfg.tag as string) ?? ''} onChange={(e) => setCfg({ tag: e.target.value.toLowerCase() || undefined })} />}</Field>
                  <Field label="Sort">{(id) => <Select id={id} value={(cfg.sort as string) ?? 'popular'} onChange={(e) => setCfg({ sort: e.target.value })}><option value="popular">Most popular</option><option value="newest">Newest</option><option value="price_asc">Price ↑</option></Select>}</Field>
                </div>
              </>
            )}
            {!['hero', 'banner', 'drop_countdown', 'brand_spotlight', 'category_tiles', 'collections'].includes(t ?? '') && (
              <Field label="How many items">{(id) => <Input id={id} inputMode="numeric" value={Number(cfg.limit ?? 10)} onChange={(e) => setCfg({ limit: Math.min(30, Number(e.target.value) || 10) })} className="w-32" />}</Field>
            )}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Show from" optional>{(id) => <Input id={id} type="datetime-local" value={toLocalInput(edit.startsAt)} onChange={(e) => setEdit({ ...edit, startsAt: fromLocalInput(e.target.value) })} />}</Field>
            <Field label="Until" optional>{(id) => <Input id={id} type="datetime-local" value={toLocalInput(edit.endsAt)} onChange={(e) => setEdit({ ...edit, endsAt: fromLocalInput(e.target.value) })} />}</Field>
          </div>
          <Field label="Audience" help="Leave everything off to show it to everyone.">
            {() => (
              <div className="flex flex-wrap gap-1.5">
                {(['RETAIL', 'WHOLESALE'] as const).map((ct) => {
                  const on = segment.customerTypes?.includes(ct);
                  return <button key={ct} type="button" onClick={() => setSeg({ customerTypes: on ? (segment.customerTypes ?? []).filter((x) => x !== ct) : [...(segment.customerTypes ?? []), ct] })} className={cn('h-8 rounded-sm border px-2.5 text-[13px]', on ? 'border-ink bg-ink text-on-ink' : 'border-hairline')}>{ct === 'RETAIL' ? 'Retail' : 'Wholesale'}</button>;
                })}
                <span className="mx-1 w-px bg-hairline" />
                {['women', 'men', 'kids'].map((d) => {
                  const on = segment.departments?.includes(d);
                  return <button key={d} type="button" onClick={() => setSeg({ departments: on ? (segment.departments ?? []).filter((x) => x !== d) : [...(segment.departments ?? []), d] })} className={cn('h-8 rounded-sm border px-2.5 text-[13px] capitalize', on ? 'border-ink bg-ink text-on-ink' : 'border-hairline')}>{d}</button>;
                })}
                <span className="mx-1 w-px bg-hairline" />
                <Select value={segment.signedIn === undefined ? '' : segment.signedIn ? '1' : '0'} onChange={(e) => setSeg({ signedIn: e.target.value === '' ? undefined : e.target.value === '1' })} className="w-36" aria-label="Signed in"><option value="">Guests & members</option><option value="1">Signed in only</option><option value="0">Guests only</option></Select>
              </div>
            )}
          </Field>
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------ phone preview (server-rendered feed) */
interface Card_ { id: string; title: string; brand: { name: string } | null; cover: MediaOut | null; price: { yourPrice: number; currency: string } | null }
interface PreviewSection { id: string; type: string; title: string | null; subtitle: string | null; items?: (Card_ & { media?: MediaOut; name?: string; caption?: string; ctaLabel?: string; eyebrow?: string })[]; drop?: { title: string; subtitle: string | null; launchesAt: string | null; cover: MediaOut | null }; brand?: { name: string; story: string | null; cover: MediaOut | null } }

function HomePreview({ seg }: { seg: { customerType: string; signedIn: boolean; locale: string } }) {
  const q = useQuery({ queryKey: ['home-preview', seg], queryFn: () => api<{ sections: PreviewSection[] }>('/admin/home/preview', { body: seg }) });
  return (
    <div className="relative mx-auto h-[640px] w-[316px] overflow-hidden rounded-[42px] border-[7px] border-black bg-canvas shadow-floating">
      <div className="absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-black" />
      {q.isFetching && <div className="absolute inset-x-0 top-9 z-20 flex justify-center"><LoaderA size="sm" /></div>}
      <div className="scrollbar-none h-full overflow-y-auto pb-10 pt-10">
        <div className="px-4 pb-2 font-display text-[26px] leading-8">SmartWear</div>
        <AnimatePresence initial={false}>
          {(q.data?.sections ?? []).map((s) => (
            <motion.div key={s.id} layout initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 30 }} className="mb-5">
              <PreviewBlock s={s} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}

function PreviewBlock({ s }: { s: PreviewSection }) {
  const items = s.items ?? [];
  const head = s.title && <div className="mb-2 flex items-baseline justify-between px-4"><span className="font-display text-[17px]">{s.title}</span><span className="text-[10px] uppercase tracking-[0.08em] text-muted">View all</span></div>;
  switch (s.type) {
    case 'stories':
      return <div className="scrollbar-none flex gap-3 overflow-x-auto px-4">{items.map((st) => <div key={st.id} className="w-14 shrink-0 text-center"><div className="rounded-full p-[2px] ring-1 ring-accent"><MediaImage media={st.cover} ratio="1 / 1" className="rounded-full" sizes="56px" /></div><div className="mt-1 truncate text-[9.5px]">{st.title}</div></div>)}</div>;
    case 'hero': {
      const b = items[0];
      return b ? <div className="relative mx-4"><MediaImage media={b.media} ratio="4 / 5" sizes="300px" /><div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 p-4 text-white"><div className="text-[9px] uppercase tracking-[0.1em]">{b.eyebrow}</div><div className="font-display text-[22px] leading-7">{b.title}</div><div className="mt-2 inline-block border-b border-white text-[11px]">{b.ctaLabel ?? 'Discover'}</div></div><div className="absolute right-3 top-3 flex gap-1">{items.map((x, i) => <span key={x.id} className={cn('h-1 rounded-full bg-white', i === 0 ? 'w-4' : 'w-1 opacity-60')} />)}</div></div> : null;
    }
    case 'collections':
      return <>{head}<div className="scrollbar-none flex gap-2 overflow-x-auto px-4">{items.map((c) => <div key={c.id} className="relative w-40 shrink-0"><MediaImage media={c.cover} ratio="4 / 5" sizes="160px" rounded="xs" /><div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 p-2 font-display text-[14px] text-white">{c.title}</div></div>)}</div></>;
    case 'category_tiles':
      return <>{head}<div className="grid grid-cols-4 gap-2 px-4">{items.slice(0, 8).map((c) => <div key={c.id} className="flex flex-col items-center gap-1"><span className="flex size-12 items-center justify-center rounded-full bg-blush font-display text-sm">{c.name?.slice(0, 1)}</span><span className="truncate text-[9.5px]">{c.name}</span></div>)}</div></>;
    case 'drop_countdown':
      return s.drop ? <div className="mx-4 overflow-hidden rounded-md bg-ink text-on-ink">{s.drop.cover && <MediaImage media={s.drop.cover} ratio="16 / 9" rounded="none" sizes="300px" />}<div className="p-3"><div className="text-[9px] uppercase tracking-[0.1em] text-accent">{s.title ?? 'Coming soon'}</div><div className="font-display text-[18px]">{s.drop.title}</div>{s.drop.launchesAt && <DropClock to={s.drop.launchesAt} />}</div></div> : null;
    case 'brand_spotlight':
      return s.brand ? <>{head}<div className="mx-4 rounded-md bg-blush p-3"><div className="font-display text-[18px]">{s.brand.name}</div><p className="line-clamp-2 text-[10.5px] text-muted">{s.brand.story}</p><Rail items={items} /></div></> : null;
    case 'looks_teaser':
      return <>{head}<div className="scrollbar-none flex gap-2 overflow-x-auto px-4">{items.map((l) => <div key={l.id} className="w-24 shrink-0"><MediaImage media={l.media} ratio="9 / 16" sizes="96px" rounded="xs" /></div>)}</div></>;
    case 'banner': {
      const b = items[0];
      return b ? <div className="relative mx-4"><MediaImage media={b.media} ratio="16 / 9" sizes="300px" /><div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/50 p-3 font-display text-[16px] text-white">{b.title}</div></div> : null;
    }
    default:
      return <>{head}<div className="px-4"><Rail items={items} /></div></>;
  }
}

function Rail({ items }: { items: Card_[] }) {
  return (
    <div className="scrollbar-none -mx-1 mt-1 flex gap-2 overflow-x-auto px-1">
      {items.map((p) => (
        <div key={p.id} className="w-[104px] shrink-0">
          <MediaImage media={p.cover} sizes="104px" rounded="xs" />
          <div className="mt-1 truncate text-[8.5px] uppercase tracking-[0.08em] text-muted">{p.brand?.name}</div>
          <div className="truncate text-[11px]">{p.title}</div>
          {p.price && <div className="font-display text-[12px] tabular">{fmtMoney(p.price.yourPrice, p.price.currency)}</div>}
        </div>
      ))}
    </div>
  );
}

function DropClock({ to }: { to: string }) {
  const now = useNow(1000);
  const ms = Math.max(0, new Date(to).getTime() - now);
  const parts = [Math.floor(ms / 86_400_000), Math.floor(ms / 3_600_000) % 24, Math.floor(ms / 60_000) % 60, Math.floor(ms / 1000) % 60];
  return (
    <div className="mt-2 flex gap-1.5">
      {parts.map((n, i) => <span key={i} className="flex w-9 flex-col items-center rounded-xs bg-on-ink/10 py-1"><span className="font-display text-[15px] tabular">{String(n).padStart(2, '0')}</span><span className="text-[7px] uppercase tracking-[0.1em] opacity-70">{['days', 'hrs', 'min', 'sec'][i]}</span></span>)}
    </div>
  );
}
