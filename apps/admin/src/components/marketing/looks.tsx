'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Bookmark, CircleDot, Eye, GalleryHorizontal, GripVertical, Heart, Image as ImageIcon, Play, Plus, Share2, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { fromLocalInput, Rise, RowsSkeleton, Tabs, toLocalInput } from '@/components/ui/kit';
import { MediaImage } from '@/components/ui/media-image';
import { MediaPicker, MediaSlot, ProductPicker } from '@/components/ui/pickers';
import { Card, Chip, EmptyState, PageHeader, Switch } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useBrands, useCategories, useCollections } from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { fmtNum, titleCase } from '@/lib/format';
import type { MediaOut } from '@/lib/types';

interface Look { id: string; media: MediaOut; caption: string; captionSw: string | null; credit: string | null; department: string | null; published: boolean; publishedAt: string | null; stats: { likes: number; saves: number; shares: number; views: number }; tags: { productId: string; title: string; x: number; y: number }[] }
interface StoryItem { id?: number; media: MediaOut; caption: string | null; durationMs: number; link: Link | null }
interface Story { id: string; title: string; kind: string; cover: MediaOut; brand: { name: string } | null; items: StoryItem[]; isActive: boolean; sortOrder: number; startsAt: string | null; endsAt: string | null; views: number }
interface Banner { id: string; title: string; subtitle: string | null; eyebrow: string | null; media: MediaOut; link: Link; ctaLabel: string | null; theme: 'light' | 'dark'; isActive: boolean; sortOrder: number; startsAt: string | null; endsAt: string | null }
interface Link { type: string; id?: string; url?: string; params?: Record<string, string> }

export function LooksWorkspace() {
  const [tab, setTab] = useState<'looks' | 'stories' | 'banners'>('looks');
  return (
    <>
      <PageHeader title="Looks & stories" description="The shoppable feed, the stories row and the hero banners. Tag products on a look so “Shop this look” works." />
      <Card className="overflow-hidden">
        <div className="border-b border-hairline px-3"><Tabs id="looks" value={tab} onChange={setTab} tabs={[{ key: 'looks', label: 'Looks feed' }, { key: 'stories', label: 'Stories' }, { key: 'banners', label: 'Banners' }]} /></div>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {tab === 'looks' ? <Looks /> : tab === 'stories' ? <Stories /> : <Banners />}
          </motion.div>
        </AnimatePresence>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------ looks */
function Looks() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['looks'], queryFn: () => api<{ items: Look[] }>('/admin/looks') });
  const [edit, setEdit] = useState<Partial<Look> | null>(null);
  const save = async () => {
    if (!edit) return;
    try {
      await api(edit.id ? `/admin/looks/${edit.id}` : '/admin/looks', { method: edit.id ? 'PATCH' : 'POST', body: { mediaId: edit.media?.id, caption: edit.caption ?? '', captionSw: edit.captionSw, credit: edit.credit, department: edit.department, published: !!edit.published, tags: (edit.tags ?? []).map(({ productId, x, y }) => ({ productId, x, y })) } });
      toast.success('Look saved');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['looks'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  if (q.isPending) return <RowsSkeleton />;
  const items = q.data?.items ?? [];
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <p className="text-[13px] text-muted">Full-screen, swipeable. Videos autoplay muted; double-tap to wishlist.</p>
        <Button size="sm" icon={<Plus strokeWidth={1.5} />} onClick={() => setEdit({ published: false, tags: [] })}>New look</Button>
      </div>
      {items.length === 0 ? <EmptyState icon={<ImageIcon />} title="No looks yet" body="Upload a short video or a styled photo and tag the pieces in it." /> : (
        <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 xl:grid-cols-6">
          {items.map((l, i) => (
            <Rise key={l.id} i={i}>
              <button type="button" onClick={() => setEdit(l)} className="group relative block w-full overflow-hidden rounded-sm text-left">
                <div className="transition-transform duration-500 group-hover:scale-[1.04]">
                  {l.media.type === 'VIDEO' ? <div className="relative aspect-[9/16] bg-ink">{l.media.posterUrl && <img src={l.media.posterUrl} alt="" className="size-full object-cover" />}<Play className="absolute left-2 top-2 size-4 text-white" strokeWidth={1.5} /></div> : <MediaImage media={l.media} ratio="9 / 16" sizes="200px" rounded="none" />}
                </div>
                {l.tags.map((t) => <span key={t.productId} className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow ring-2 ring-white/40" style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }} />)}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/30 p-2.5 text-white">
                  <div className="line-clamp-2 text-[12px] leading-4">{l.caption}</div>
                  <div className="mt-1.5 flex gap-2.5 text-[10.5px] opacity-85 tabular">
                    <span className="flex items-center gap-0.5"><Eye className="size-3" strokeWidth={1.5} />{fmtNum(l.stats.views)}</span>
                    <span className="flex items-center gap-0.5"><Heart className="size-3" strokeWidth={1.5} />{fmtNum(l.stats.likes)}</span>
                    <span className="flex items-center gap-0.5"><Bookmark className="size-3" strokeWidth={1.5} />{fmtNum(l.stats.saves)}</span>
                    <span className="flex items-center gap-0.5"><Share2 className="size-3" strokeWidth={1.5} />{fmtNum(l.stats.shares)}</span>
                  </div>
                </div>
                {!l.published && <Chip tone="warning" className="absolute right-2 top-2">Draft</Chip>}
              </button>
            </Rise>
          ))}
        </div>
      )}
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} size="lg" title={edit?.id ? 'Edit look' : 'New look'}
        footer={<>{edit?.id && <ActionButton variant="danger" className="mr-auto" icon={<Trash2 strokeWidth={1.5} />} onAction={async () => { await api(`/admin/looks/${edit.id}`, { method: 'DELETE' }); setEdit(null); void qc.invalidateQueries({ queryKey: ['looks'] }); }}>Delete</ActionButton>}<Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><ActionButton disabled={!edit?.media} onAction={save}>Save</ActionButton></>}>
        {edit && <LookEditor edit={edit} setEdit={setEdit} />}
      </Dialog>
    </>
  );
}

function LookEditor({ edit, setEdit }: { edit: Partial<Look>; setEdit: (l: Partial<Look>) => void }) {
  const [pick, setPick] = useState(false);
  const [pending, setPending] = useState<{ x: number; y: number } | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const tags = edit.tags ?? [];
  const pos = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: +Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)).toFixed(3), y: +Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)).toFixed(3) };
  };
  return (
    <div className="grid gap-5 md:grid-cols-[240px_1fr]">
      <div>
        {edit.media ? (
          <div ref={box} className="relative cursor-crosshair select-none overflow-hidden rounded-sm"
            onClick={(e) => { if (!drag) setPending(pos(e)); }}
            onPointerMove={(e) => { if (drag) { const p = pos(e); setEdit({ ...edit, tags: tags.map((t) => (t.productId === drag ? { ...t, ...p } : t)) }); } }}
            onPointerUp={() => setTimeout(() => setDrag(null), 0)}>
            {edit.media.type === 'VIDEO' ? <video src={edit.media.sources?.mp4?.[0]?.url ?? edit.media.url} poster={edit.media.posterUrl ?? undefined} muted loop autoPlay playsInline className="aspect-[9/16] w-full bg-ink object-cover" /> : <MediaImage media={edit.media} ratio="9 / 16" sizes="240px" rounded="none" />}
            <AnimatePresence>
              {tags.map((t) => (
                <motion.span key={t.productId} initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} onPointerDown={(e) => { e.stopPropagation(); setDrag(t.productId); }} onClick={(e) => e.stopPropagation()}
                  className="absolute flex -translate-x-1/2 -translate-y-1/2 cursor-grab items-center gap-1 rounded-full bg-white/95 py-0.5 pl-1 pr-2 text-[10px] font-semibold text-black shadow-floating active:cursor-grabbing" style={{ left: `${t.x * 100}%`, top: `${t.y * 100}%` }}>
                  <span className="size-2 rounded-full bg-black" />{t.title.slice(0, 18)}
                </motion.span>
              ))}
              {pending && <motion.span initial={{ scale: 0 }} animate={{ scale: [1, 1.3, 1] }} transition={{ repeat: Infinity, duration: 1.2 }} className="absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-black/40" style={{ left: `${pending.x * 100}%`, top: `${pending.y * 100}%` }} />}
            </AnimatePresence>
          </div>
        ) : (
          <button type="button" onClick={() => setPick(true)} className="flex aspect-[9/16] w-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-ink/25 text-[13px] text-muted hover:border-ink/45"><Play className="size-6" strokeWidth={1.25} />Choose video or photo</button>
        )}
        {edit.media && <div className="mt-2 flex justify-between text-xs text-muted"><span>Tap to tag · drag to move</span><button type="button" className="underline" onClick={() => setPick(true)}>Replace</button></div>}
        <MediaPicker open={pick} onOpenChange={setPick} kinds={['VIDEO', 'IMAGE']} purpose="look" onPick={(m) => m[0] && setEdit({ ...edit, media: m[0] })} />
      </div>
      <div className="grid content-start gap-4">
        <AnimatePresence>
          {pending && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="rounded-sm border border-accent/50 bg-accent-soft/40 p-3">
              <div className="mb-2 flex items-center justify-between text-[13px] font-semibold">Which product is here?<button type="button" aria-label="Cancel tag" onClick={() => setPending(null)}><X className="size-4" strokeWidth={1.5} /></button></div>
              <ProductPicker value={[]} exclude={tags.map((t) => t.productId)} onChange={(v) => { const p = v[0]; if (p) setEdit({ ...edit, tags: [...tags, { productId: p.id, title: p.title, ...pending }] }); setPending(null); }} placeholder="Search the product in this spot" />
            </motion.div>
          )}
        </AnimatePresence>
        {tags.length > 0 && (
          <ul className="grid gap-1.5">
            {tags.map((t) => <li key={t.productId} className="flex items-center gap-2 rounded-sm border border-hairline px-3 py-1.5 text-[13px]"><GripVertical className="size-3.5 text-muted" strokeWidth={1.5} /><span className="flex-1 truncate">{t.title}</span><span className="text-xs text-muted tabular">{Math.round(t.x * 100)}%, {Math.round(t.y * 100)}%</span><button type="button" aria-label={`Remove ${t.title}`} onClick={() => setEdit({ ...edit, tags: tags.filter((x) => x.productId !== t.productId) })}><X className="size-3.5" strokeWidth={1.5} /></button></li>)}
          </ul>
        )}
        <Field label="Caption">{(id) => <Input id={id} value={edit.caption ?? ''} onChange={(e) => setEdit({ ...edit, caption: e.target.value })} placeholder="Sunday in white linen." />}</Field>
        <Field label="Swahili caption" optional>{(id) => <Input id={id} value={edit.captionSw ?? ''} onChange={(e) => setEdit({ ...edit, captionSw: e.target.value })} />}</Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Credit" optional>{(id) => <Input id={id} value={edit.credit ?? ''} onChange={(e) => setEdit({ ...edit, credit: e.target.value })} placeholder="Photographer" />}</Field>
          <Field label="Department" optional>{(id) => <Select id={id} value={edit.department ?? ''} onChange={(e) => setEdit({ ...edit, department: e.target.value || null })}><option value="">Everyone</option><option value="women">Women</option><option value="men">Men</option><option value="kids">Kids</option></Select>}</Field>
        </div>
        <label className="flex items-center gap-2 text-[13px]"><Switch checked={!!edit.published} onCheckedChange={(v) => setEdit({ ...edit, published: v })} label="Published" /> Published {tags.length === 0 && <span className="text-xs text-muted">(needs at least one tag)</span>}</label>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ link picker (stories + banners) */
function LinkField({ value, onChange }: { value: Link | null; onChange: (l: Link | null) => void }) {
  const cols = useCollections();
  const cats = useCategories();
  const brands = useBrands();
  const type = value?.type ?? '';
  return (
    <div className="grid gap-2 sm:grid-cols-[160px_1fr]">
      <Select value={type} onChange={(e) => onChange(e.target.value ? { type: e.target.value } : null)} aria-label="Link type">
        <option value="">No link</option><option value="collection">Collection</option><option value="category">Category</option><option value="brand">Brand</option><option value="product">Product</option><option value="url">Web page</option>
      </Select>
      {type === 'collection' && <Select value={value?.id ?? ''} onChange={(e) => onChange({ type, id: e.target.value })} aria-label="Collection"><option value="">Choose…</option>{cols.data?.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</Select>}
      {type === 'category' && <Select value={value?.id ?? ''} onChange={(e) => onChange({ type, id: e.target.value })} aria-label="Category"><option value="">Choose…</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>}
      {type === 'brand' && <Select value={value?.id ?? ''} onChange={(e) => onChange({ type, id: e.target.value })} aria-label="Brand"><option value="">Choose…</option>{brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}
      {type === 'product' && <ProductPicker value={[]} max={1} onChange={(v) => v[0] && onChange({ type, id: v[0].id })} placeholder={value?.id ? 'Product chosen — search to change' : 'Search a product'} />}
      {type === 'url' && <Input value={value?.url ?? ''} onChange={(e) => onChange({ type, url: e.target.value })} placeholder="https://" aria-label="URL" />}
    </div>
  );
}

/* ------------------------------------------------------------ stories */
function Stories() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['stories'], queryFn: () => api<{ items: Story[] }>('/admin/stories') });
  const brands = useBrands();
  const [edit, setEdit] = useState<(Partial<Story> & { brandId?: string | null }) | null>(null);
  const [addItem, setAddItem] = useState(false);
  const save = async () => {
    if (!edit) return;
    try {
      await api(edit.id ? `/admin/stories/${edit.id}` : '/admin/stories', { method: edit.id ? 'PATCH' : 'POST', body: { title: edit.title, kind: edit.kind ?? 'editorial', coverMediaId: edit.cover?.id, brandId: edit.brandId ?? null, isActive: edit.isActive ?? true, startsAt: edit.startsAt ?? null, endsAt: edit.endsAt ?? null, items: (edit.items ?? []).map((i) => ({ mediaId: i.media.id, caption: i.caption, durationMs: i.durationMs, link: i.link ?? {} })) } });
      toast.success('Story saved');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['stories'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  if (q.isPending) return <RowsSkeleton />;
  const items = q.data?.items ?? [];
  const slides = edit?.items ?? [];
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <p className="text-[13px] text-muted">Short tap-through slides at the top of Home: new drops, brand stories and beauty tutorials.</p>
        <Button size="sm" icon={<Plus strokeWidth={1.5} />} onClick={() => setEdit({ kind: 'editorial', isActive: true, items: [] })}>New story</Button>
      </div>
      {items.length === 0 ? <EmptyState icon={<CircleDot />} title="No stories" /> : (
        <div className="flex flex-wrap gap-6 p-5">
          {items.map((s, i) => (
            <Rise key={s.id} i={i}>
              <button type="button" onClick={() => setEdit({ ...s })} className={cn('group w-20 text-center', !s.isActive && 'opacity-50')}>
                <div className="rounded-full p-[3px] ring-[1.5px] ring-accent transition-transform duration-300 group-hover:scale-105"><MediaImage media={s.cover} ratio="1 / 1" className="rounded-full" sizes="80px" /></div>
                <div className="mt-2 truncate text-[12.5px] font-semibold">{s.title}</div>
                <div className="text-[11px] text-muted">{titleCase(s.kind)} · {s.items.length}</div>
              </button>
            </Rise>
          ))}
        </div>
      )}
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} size="lg" title={edit?.id ? edit.title ?? 'Story' : 'New story'}
        footer={<>{edit?.id && <ActionButton variant="danger" className="mr-auto" icon={<Trash2 strokeWidth={1.5} />} onAction={async () => { await api(`/admin/stories/${edit.id}`, { method: 'DELETE' }); setEdit(null); void qc.invalidateQueries({ queryKey: ['stories'] }); }}>Delete</ActionButton>}<Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><ActionButton disabled={!edit?.title?.trim() || !edit?.cover} onAction={save}>Save</ActionButton></>}>
        {edit && (
          <div className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
              <MediaSlot media={edit.cover ?? null} onChange={(m) => m && setEdit({ ...edit, cover: m })} ratio="1 / 1" label="Cover" purpose="story" />
              <div className="grid content-start gap-4 sm:grid-cols-2">
                <Field label="Title" help="Up to 40 characters">{(id) => <Input id={id} maxLength={40} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="Glow" />}</Field>
                <Field label="Kind">{(id) => <Select id={id} value={edit.kind ?? 'editorial'} onChange={(e) => setEdit({ ...edit, kind: e.target.value })}><option value="drop">New drop</option><option value="brand">Brand story</option><option value="tutorial">Beauty tutorial</option><option value="editorial">Editorial</option></Select>}</Field>
                <Field label="Brand" optional>{(id) => <Select id={id} value={edit.brandId ?? ''} onChange={(e) => setEdit({ ...edit, brandId: e.target.value || null })}><option value="">None</option>{brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
                <label className="flex items-end gap-2 pb-2 text-[13px]"><Switch checked={edit.isActive ?? true} onCheckedChange={(v) => setEdit({ ...edit, isActive: v })} label="Active" /> Active</label>
                <Field label="Show from" optional>{(id) => <Input id={id} type="datetime-local" value={toLocalInput(edit.startsAt)} onChange={(e) => setEdit({ ...edit, startsAt: fromLocalInput(e.target.value) })} />}</Field>
                <Field label="Until" optional>{(id) => <Input id={id} type="datetime-local" value={toLocalInput(edit.endsAt)} onChange={(e) => setEdit({ ...edit, endsAt: fromLocalInput(e.target.value) })} />}</Field>
              </div>
            </div>
            <div>
              <div className="mb-2 flex items-center justify-between"><div className="label-caps text-muted">Slides</div><Button size="sm" variant="secondary" icon={<Plus strokeWidth={1.5} />} onClick={() => setAddItem(true)}>Add slides</Button></div>
              <div className="grid gap-2">
                <AnimatePresence initial={false}>
                  {slides.map((it, i) => (
                    <motion.div key={`${it.media.id}-${i}`} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="grid items-start gap-3 rounded-sm border border-hairline p-2.5 sm:grid-cols-[56px_1fr_auto]">
                      <MediaImage media={it.media} ratio="9 / 16" sizes="56px" rounded="xs" className="w-14" />
                      <div className="grid gap-2">
                        <Input value={it.caption ?? ''} onChange={(e) => setEdit({ ...edit, items: slides.map((x, j) => (j === i ? { ...x, caption: e.target.value } : x)) })} placeholder="Caption" aria-label="Caption" />
                        <LinkField value={it.link} onChange={(l) => setEdit({ ...edit, items: slides.map((x, j) => (j === i ? { ...x, link: l } : x)) })} />
                      </div>
                      <div className="flex items-center gap-1">
                        <Input inputMode="numeric" value={it.durationMs / 1000} onChange={(e) => setEdit({ ...edit, items: slides.map((x, j) => (j === i ? { ...x, durationMs: Math.max(2, Number(e.target.value) || 5) * 1000 } : x)) })} className="w-16" aria-label="Seconds" trailing={<span className="pr-1 text-xs">s</span>} />
                        <Button size="icon-sm" variant="ghost" aria-label="Remove slide" onClick={() => setEdit({ ...edit, items: slides.filter((_, j) => j !== i) })}><X strokeWidth={1.5} /></Button>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
            <MediaPicker open={addItem} onOpenChange={setAddItem} multiple kinds={['IMAGE', 'VIDEO']} purpose="story" onPick={(m) => setEdit({ ...edit, items: [...slides, ...m.map((x) => ({ media: x, caption: null, durationMs: x.durationMs ?? 5000, link: null }))] })} />
          </div>
        )}
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------ banners */
function Banners() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['banners'], queryFn: () => api<{ items: Banner[] }>('/admin/banners') });
  const [edit, setEdit] = useState<Partial<Banner> | null>(null);
  const save = async () => {
    if (!edit) return;
    try {
      await api(edit.id ? `/admin/banners/${edit.id}` : '/admin/banners', { method: edit.id ? 'PATCH' : 'POST', body: { title: edit.title, subtitle: edit.subtitle, eyebrow: edit.eyebrow, mediaId: edit.media?.id, link: edit.link, ctaLabel: edit.ctaLabel, theme: edit.theme ?? 'light', isActive: edit.isActive ?? true, startsAt: edit.startsAt ?? null, endsAt: edit.endsAt ?? null } });
      toast.success('Banner saved');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['banners'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  if (q.isPending) return <RowsSkeleton />;
  const items = q.data?.items ?? [];
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <p className="text-[13px] text-muted">Editorial banners for the hero carousel and banner sections. Text is set in the app — never on the image.</p>
        <Button size="sm" icon={<Plus strokeWidth={1.5} />} onClick={() => setEdit({ theme: 'light', isActive: true })}>New banner</Button>
      </div>
      {items.length === 0 ? <EmptyState icon={<GalleryHorizontal />} title="No banners" /> : (
        <div className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((b, i) => (
            <Rise key={b.id} i={i}>
              <button type="button" onClick={() => setEdit(b)} className={cn('group relative block w-full overflow-hidden rounded-sm text-left', !b.isActive && 'opacity-50')}>
                <div className="transition-transform duration-500 group-hover:scale-[1.03]"><MediaImage media={b.media} ratio="4 / 5" sizes="300px" rounded="none" /></div>
                <div className={cn('absolute inset-x-0 bottom-0 p-4', b.theme === 'light' ? 'bg-gradient-to-t from-black/65 text-white' : 'bg-gradient-to-t from-white/75 text-black')}>
                  {b.eyebrow && <div className="text-[10px] uppercase tracking-[0.1em]">{b.eyebrow}</div>}
                  <div className="font-display text-xl leading-6">{b.title}</div>
                  {b.ctaLabel && <div className="mt-2 inline-block border-b border-current text-[12px]">{b.ctaLabel}</div>}
                </div>
              </button>
            </Rise>
          ))}
        </div>
      )}
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} size="lg" title={edit?.id ? 'Edit banner' : 'New banner'}
        footer={<>{edit?.id && <ActionButton variant="danger" className="mr-auto" icon={<Trash2 strokeWidth={1.5} />} onAction={async () => { await api(`/admin/banners/${edit.id}`, { method: 'DELETE' }); setEdit(null); void qc.invalidateQueries({ queryKey: ['banners'] }); }}>Delete</ActionButton>}<Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><ActionButton disabled={!edit?.title?.trim() || !edit?.media || !edit?.link?.type} onAction={save}>Save</ActionButton></>}>
        {edit && (
          <div className="grid gap-5 md:grid-cols-[200px_1fr]">
            <MediaSlot media={edit.media ?? null} onChange={(m) => m && setEdit({ ...edit, media: m })} kinds={['IMAGE', 'VIDEO']} label="Image or video" purpose="collection" />
            <div className="grid content-start gap-4">
              <Field label="Eyebrow" optional>{(id) => <Input id={id} value={edit.eyebrow ?? ''} onChange={(e) => setEdit({ ...edit, eyebrow: e.target.value })} placeholder="New season" />}</Field>
              <Field label="Title">{(id) => <Input id={id} value={edit.title ?? ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} placeholder="The Coastal Edit" />}</Field>
              <Field label="Subtitle" optional>{(id) => <Input id={id} value={edit.subtitle ?? ''} onChange={(e) => setEdit({ ...edit, subtitle: e.target.value })} />}</Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Button label" optional>{(id) => <Input id={id} value={edit.ctaLabel ?? ''} onChange={(e) => setEdit({ ...edit, ctaLabel: e.target.value })} placeholder="Shop the edit" />}</Field>
                <Field label="Text colour">{(id) => <Select id={id} value={edit.theme ?? 'light'} onChange={(e) => setEdit({ ...edit, theme: e.target.value as Banner['theme'] })}><option value="light">Light text (dark photo)</option><option value="dark">Dark text (light photo)</option></Select>}</Field>
              </div>
              <Field label="Links to">{() => <LinkField value={edit.link ?? null} onChange={(l) => setEdit({ ...edit, link: l ?? undefined })} />}</Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Show from" optional>{(id) => <Input id={id} type="datetime-local" value={toLocalInput(edit.startsAt)} onChange={(e) => setEdit({ ...edit, startsAt: fromLocalInput(e.target.value) })} />}</Field>
                <Field label="Until" optional>{(id) => <Input id={id} type="datetime-local" value={toLocalInput(edit.endsAt)} onChange={(e) => setEdit({ ...edit, endsAt: fromLocalInput(e.target.value) })} />}</Field>
              </div>
              <label className="flex items-center gap-2 text-[13px]"><Switch checked={edit.isActive ?? true} onCheckedChange={(v) => setEdit({ ...edit, isActive: v })} label="Active" /> Active</label>
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
