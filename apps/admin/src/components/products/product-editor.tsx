'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle, ArrowLeft, Bold, Check, CircleAlert, Copy, History, Info, Italic, LayoutTemplate, List, Redo2, Save, Sparkles, Undo2, Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Section } from '@/components/ui/kit';
import { ProductPicker } from '@/components/ui/pickers';
import { Card, Chip, Switch } from '@/components/ui/primitives';
import { LoaderA } from '@/components/brand/LoaderA';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { STATUS_TONE, useAttributes, useBadges, useBrands, useCategories, useCollections, useSizeCharts, useStores, type ProductRow } from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { fmtAgo, fmtDateTime, titleCase } from '@/lib/format';
import { fromLocalInput, toLocalInput } from '@/components/ui/kit';
import { ProductMediaManager } from './product-media';
import { ProductPreview } from './product-preview';
import { generateVariants, OptionTypesEditor, VariantsTable } from './product-variants';
import { emptyProduct, fromApi, toApi, type ProductForm } from './types';

const SECTIONS = [
  ['basics', 'Basics'], ['media', 'Media'], ['variants', 'Variants & pricing'], ['details', 'Details'], ['merch', 'Merchandising'], ['publish', 'Publishing & SEO'],
] as const;

/* ------------------------------------------------------------ undo-able form state */
function useHistory<T>(initial: T) {
  const [state, setState] = useState({ past: [] as T[], present: initial, future: [] as T[] });
  const last = useRef(0);
  const set = useCallback((up: T | ((p: T) => T)) => {
    setState((s) => {
      const next = typeof up === 'function' ? (up as (p: T) => T)(s.present) : up;
      if (next === s.present) return s;
      const now = Date.now();
      // Coalesce keystrokes within 600ms into one undo step.
      const past = now - last.current < 600 ? s.past : [...s.past, s.present].slice(-60);
      last.current = now;
      return { past, present: next, future: [] };
    });
  }, []);
  const reset = useCallback((v: T) => setState({ past: [], present: v, future: [] }), []);
  const undo = useCallback(() => setState((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1] as T, future: [s.present, ...s.future] } : s)), []);
  const redo = useCallback(() => setState((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0] as T, future: s.future.slice(1) } : s)), []);
  return { value: state.present, set, reset, undo, redo, canUndo: state.past.length > 0, canRedo: state.future.length > 0 };
}

const draftKey = (id?: string) => `sw:product-draft:${id ?? 'new'}`;

export function ProductEditor({ productId, currency }: { productId?: string; currency: string }) {
  const router = useRouter();
  const qc = useQueryClient();
  const canManage = useCan('products.manage');
  const canPublish = useCan('products.publish');
  const loaded = useQuery({
    queryKey: ['product', productId],
    enabled: !!productId,
    queryFn: () => api<Parameters<typeof fromApi>[0]>(`/admin/products/${productId}`),
    staleTime: Infinity,
  });
  const cats = useCategories();
  const brands = useBrands();
  const badges = useBadges();
  const charts = useSizeCharts();
  const collections = useCollections();
  const attrs = useAttributes();
  const stores = useStores();

  const h = useHistory<ProductForm>(emptyProduct());
  const f = h.value;
  const [saved, setSaved] = useState<string>(JSON.stringify(toApi(emptyProduct())));
  const [saving, setSaving] = useState<'idle' | 'saving' | 'autosaving'>('idle');
  const [autoErr, setAutoErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<{ field?: string; message: string } | null>(null);
  const [restore, setRestore] = useState<ProductForm | null>(null);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [rel, setRel] = useState<Record<string, { id: string; title: string }[]>>({ relatedProductIds: [], completeTheLookIds: [], pairsWellWithIds: [] });
  const [section, setSection] = useState<string>('basics');
  const dirty = JSON.stringify(toApi(f)) !== saved;

  // load: sync the server copy into the form during render (once per fetched object)
  const [loadedFrom, setLoadedFrom] = useState<unknown>(null);
  if (loaded.data && loadedFrom !== loaded.data) {
    setLoadedFrom(loaded.data);
    const form = fromApi(loaded.data);
    h.reset(form);
    setSaved(JSON.stringify(toApi(form)));
  }
  // related-product titles for the pickers
  useEffect(() => {
    if (!loaded.data) return;
    const form = loaded.data;
    const ids = [...new Set([...form.relatedProductIds, ...form.completeTheLookIds, ...form.pairsWellWithIds])];
    if (!ids.length) return;
    void api<{ items: ProductRow[] }>('/admin/products', { query: { ids: ids.join(','), limit: 200 } }).then((r) => {
      const t = new Map(r.items.map((p) => [p.id, p.title]));
      const map = (l: string[]) => l.filter((i) => t.has(i)).map((i) => ({ id: i, title: t.get(i)! }));
      setRel({ relatedProductIds: map(form.relatedProductIds), completeTheLookIds: map(form.completeTheLookIds), pairsWellWithIds: map(form.pairsWellWithIds) });
    });
  }, [loaded.data]);
  // unsaved edits left on this device (localStorage is external state, read after mount)
  useEffect(() => {
    if (productId && !loaded.data) return;
    try {
      const d = localStorage.getItem(draftKey(productId));
      if (!d) return;
      const parsed = JSON.parse(d) as { at: string; form: ProductForm };
      const server = loaded.data ? fromApi(loaded.data) : null;
      if (!server || (new Date(parsed.at) > new Date(server.updatedAt ?? 0) && JSON.stringify(toApi(parsed.form)) !== JSON.stringify(toApi(server)))) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- reading browser storage after hydration
        setRestore(parsed.form);
      }
    } catch { /* storage unavailable */ }
  }, [productId, loaded.data]);

  // local backup of unsaved edits
  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => {
      try { localStorage.setItem(draftKey(productId), JSON.stringify({ at: new Date().toISOString(), form: f })); } catch { /* ignore */ }
    }, 800);
    return () => clearTimeout(t);
  }, [f, dirty, productId]);

  const set = <K extends keyof ProductForm>(k: K, v: ProductForm[K]) => h.set((p) => ({ ...p, [k]: v }));
  const primary = cats.data?.find((c) => c.id === f.primaryCategoryId);
  const isBeauty = primary?.kind === 'beauty';

  const save = useCallback(async (opts: { auto?: boolean; status?: ProductForm['status']; note?: string } = {}) => {
    const body = { ...toApi(f), ...(opts.status ? { status: opts.status } : {}), note: opts.note ?? (opts.auto ? 'Autosave' : '') };
    setSaving(opts.auto ? 'autosaving' : 'saving');
    setFieldErr(null);
    const snapshot = JSON.stringify(toApi(f));
    try {
      const res = productId
        ? await api<Parameters<typeof fromApi>[0]>(`/admin/products/${productId}`, { method: 'PUT', body })
        : await api<Parameters<typeof fromApi>[0]>('/admin/products', { body });
      try { localStorage.removeItem(draftKey(productId)); } catch { /* ignore */ }
      setAutoErr(null);
      void qc.invalidateQueries({ queryKey: ['products'] });
      if (!productId) {
        toast.success('Product created');
        router.replace(`/products/${res.id}`);
        return;
      }
      const form = fromApi(res);
      if (opts.auto) {
        // Don't overwrite what the admin typed while the request was in flight.
        h.set((p) => ({ ...p, version: form.version, qualityHints: form.qualityHints, updatedAt: form.updatedAt }));
        setSaved(snapshot);
      } else {
        h.reset(form);
        setSaved(JSON.stringify(toApi(form)));
        qc.setQueryData(['product', productId], res);
        toast.success(opts.status && opts.status !== f.status ? `Saved · ${titleCase(opts.status)}` : 'Saved');
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Could not save';
      if (opts.auto) setAutoErr(msg);
      else {
        toast.error(msg);
        const field = e instanceof ApiError ? (e.details as { field?: string } | undefined)?.field : undefined;
        setFieldErr({ field, message: msg });
        if (field) jumpTo(fieldSection(field));
      }
    } finally {
      setSaving('idle');
    }
  }, [f, productId, qc, router, h]);

  // server autosave for drafts
  useEffect(() => {
    if (!productId || !dirty || f.status !== 'DRAFT' || saving !== 'idle' || !canManage) return;
    const t = setTimeout(() => void save({ auto: true }), 4000);
    return () => clearTimeout(t);
  }, [f, dirty, productId, saving, save, canManage]);

  // keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      if (e.key === 's') { e.preventDefault(); if (canManage) void save(); }
      const typing = (e.target as HTMLElement)?.closest('input,textarea,[contenteditable=true]');
      if (!typing && e.key === 'z') { e.preventDefault(); if (e.shiftKey) h.redo(); else h.undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, h, canManage]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // scroll-spy for the section nav
  useEffect(() => {
    const els = SECTIONS.map(([id]) => document.getElementById(`sec-${id}`)).filter(Boolean) as HTMLElement[];
    const io = new IntersectionObserver((es) => { const v = es.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]; if (v) setSection(v.target.id.slice(4)); }, { rootMargin: '-20% 0px -70% 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [loaded.data]);

  const hints = useMemo(() => clientHints(f, isBeauty), [f, isBeauty]);
  const serverHints = (f.qualityHints ?? []).filter((x) => !hints.some((c) => c.code === x.code));
  const allHints = [...hints, ...serverHints];
  const blocking = allHints.filter((x) => x.level === 'error');

  if (productId && loaded.isPending) return <div className="flex h-[60vh] items-center justify-center"><LoaderA size="lg" /></div>;
  if (productId && loaded.isError) return <div className="py-24 text-center"><p className="font-display text-2xl">We couldn’t load this product</p><AppLink href="/products" className="mt-4 text-sm underline">Back to products</AppLink></div>;

  const catAttrs = (attrs.data ?? []).filter((a) => primary?.attributeKeys.includes(a.key));

  return (
    <div className="pb-24">
      {/* header */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b border-hairline bg-canvas/90 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <AppLink href="/products" icon={<ArrowLeft strokeWidth={1.5} />} className="size-9 justify-center rounded-full hover:bg-ink/5" aria-label="Back to products" />
          <div className="min-w-0 flex-1 basis-[calc(100%-52px)] sm:basis-64">
            <div className="flex items-center gap-2">
              <h1 className="truncate font-display text-2xl leading-8">{f.title || 'New product'}</h1>
              <Chip tone={STATUS_TONE[f.status]}>{titleCase(f.status)}</Chip>
            </div>
            <SaveState dirty={dirty} saving={saving} autoErr={autoErr} updatedAt={f.updatedAt} version={f.version} />
          </div>
          <div className="flex items-center gap-1 max-sm:ml-11">
            <Button size="icon-sm" variant="ghost" disabled={!h.canUndo} onClick={h.undo} aria-label="Undo (⌘Z)"><Undo2 strokeWidth={1.5} /></Button>
            <Button size="icon-sm" variant="ghost" disabled={!h.canRedo} onClick={h.redo} aria-label="Redo (⇧⌘Z)"><Redo2 strokeWidth={1.5} /></Button>
            {productId && <Button size="icon-sm" variant="ghost" onClick={() => setVersionsOpen(true)} aria-label="Version history"><History strokeWidth={1.5} /></Button>}
            {productId && canManage && <ActionButton size="icon-sm" variant="ghost" aria-label="Duplicate" icon={<Copy strokeWidth={1.5} />} onAction={async () => { const d = await api<{ id: string }>(`/admin/products/${productId}/duplicate`, { method: 'POST' }); toast.success('Duplicated as a draft'); router.push(`/products/${d.id}`); }} />}
          </div>
          {canManage && (
            <div className="flex items-center gap-2 max-sm:ml-auto">
              <Button variant="secondary" icon={<Save strokeWidth={1.5} />} pending={saving === 'saving'} disabled={!dirty && !!productId} onClick={() => void save()}>Save</Button>
              {canPublish && f.status !== 'PUBLISHED' && (
                <Button icon={<Sparkles strokeWidth={1.5} />} disabled={blocking.length > 0} pending={saving === 'saving'} onClick={() => void save({ status: f.publishAt && new Date(f.publishAt) > new Date() ? 'SCHEDULED' : 'PUBLISHED' })}>
                  {f.publishAt && new Date(f.publishAt) > new Date() ? 'Schedule' : 'Publish'}
                </Button>
              )}
            </div>
          )}
        </div>
        <nav className="scrollbar-none -mb-3 mt-2 flex gap-1 overflow-x-auto" aria-label="Editor sections">
          {SECTIONS.map(([id, label]) => (
            <button key={id} type="button" onClick={() => jumpTo(id)} className={cn('relative h-9 shrink-0 px-2.5 text-[13px] font-semibold transition-colors', section === id ? 'text-ink' : 'text-muted hover:text-ink')}>
              {label}
              {section === id && <motion.span layoutId="editor-sec" className="absolute inset-x-2 bottom-0 h-0.5 bg-ink" />}
            </button>
          ))}
        </nav>
      </div>

      <AnimatePresence>
        {restore && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
            <Card className="mb-4 flex flex-wrap items-center gap-3 border-accent/40 bg-accent-soft/40 px-5 py-3">
              <Info className="size-4" strokeWidth={1.5} />
              <span className="flex-1 text-[13px]">You have unsaved changes from an earlier session on this device.</span>
              <Button size="sm" variant="ghost" onClick={() => { try { localStorage.removeItem(draftKey(productId)); } catch { /* ignore */ } setRestore(null); }}>Discard</Button>
              <Button size="sm" onClick={() => { h.set(restore); setRestore(null); }}>Restore</Button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {!productId && <TemplateBar onApply={(d) => h.set((p) => ({ ...p, ...d }))} />}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 content-start gap-6 [&>*]:min-w-0">
          {/* BASICS */}
          <Card id="sec-basics" className="scroll-mt-36">
            <Section title="Basics" description="What it is and where it lives in the catalogue.">
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Title" error={fieldErr?.field === 'title' ? fieldErr.message : null} className="md:col-span-2">
                  {(id) => <Input id={id} value={f.title} onChange={(e) => set('title', e.target.value)} placeholder="Linen wrap midi dress" maxLength={140} aria-invalid={fieldErr?.field === 'title' || undefined} />}
                </Field>
                <Field label="Swahili title" optional>{(id) => <Input id={id} value={f.titleSw ?? ''} onChange={(e) => set('titleSw', e.target.value || null)} placeholder="Gauni la kitani" />}</Field>
                <Field label="Brand" optional>
                  {(id) => (
                    <Select id={id} value={f.brandId ?? ''} onChange={(e) => set('brandId', e.target.value || null)}>
                      <option value="">No brand</option>
                      {brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Tagline" optional help="One line under the title, e.g. “Cut on the bias for an easy drape”." className="md:col-span-2">
                  {(id) => <Input id={id} value={f.tagline ?? ''} maxLength={120} onChange={(e) => set('tagline', e.target.value || null)} />}
                </Field>
                <Field label="Category" error={fieldErr?.field === 'categoryIds' ? fieldErr.message : null} help={primary ? `${primary.kind === 'beauty' ? 'Beauty' : 'Fashion'} · ${primary.label}` : 'Pick the most specific category.'}>
                  {(id) => (
                    <Select id={id} value={f.primaryCategoryId ?? ''} aria-invalid={fieldErr?.field === 'categoryIds' || undefined} onChange={(e) => {
                      const c = cats.data?.find((x) => x.id === e.target.value);
                      h.set((p) => ({ ...p, primaryCategoryId: e.target.value || null, categoryIds: e.target.value ? [e.target.value, ...p.categoryIds.filter((x) => x !== e.target.value && x !== p.primaryCategoryId)] : [], sizeChartId: p.sizeChartId ?? c?.defaultSizeChartId ?? null, beauty: c?.kind === 'beauty' ? p.beauty ?? {} : null }));
                    }}>
                      <option value="">Choose…</option>
                      {cats.data?.filter((c) => c.depth > 0).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Also show in" optional help="Extra categories (e.g. a Wedding guest edit).">
                  {(id) => (
                    <Select id={id} value="" onChange={(e) => e.target.value && set('categoryIds', [...new Set([...f.categoryIds, e.target.value])])}>
                      <option value="">Add a category…</option>
                      {cats.data?.filter((c) => c.depth > 0 && !f.categoryIds.includes(c.id)).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </Select>
                  )}
                </Field>
                {f.categoryIds.length > 1 && (
                  <div className="flex flex-wrap gap-1.5 md:col-span-2">
                    {f.categoryIds.filter((c) => c !== f.primaryCategoryId).map((c) => (
                      <button key={c} type="button" onClick={() => set('categoryIds', f.categoryIds.filter((x) => x !== c))} className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-hairline bg-canvas px-2.5 text-[12px] hover:border-danger/50 hover:text-danger">
                        {cats.data?.find((x) => x.id === c)?.label ?? c} ×
                      </button>
                    ))}
                  </div>
                )}
                <Field label="Department" optional>
                  {(id) => (
                    <Select id={id} value={f.department ?? ''} onChange={(e) => set('department', e.target.value || null)}>
                      <option value="">From category</option>
                      <option value="women">Women</option><option value="men">Men</option><option value="kids">Kids</option><option value="unisex">Unisex</option>
                    </Select>
                  )}
                </Field>
                <Field label="Season / collection" optional>{(id) => <Input id={id} value={f.season ?? ''} onChange={(e) => set('season', e.target.value || null)} placeholder="Resort 2026" />}</Field>
                <Field label="Tags" optional help="Comma-separated; used by search and rule-based collections." className="md:col-span-2">
                  {(id) => <TagInput id={id} value={f.tags} onChange={(t) => set('tags', t)} />}
                </Field>
              </div>
            </Section>
            <Section title="Description">
              <RichText value={f.descriptionHtml ?? ''} onChange={(v) => set('descriptionHtml', v || null)} />
              <div className="mt-4 grid gap-4 md:grid-cols-2">
                <Field label="Story / designer note" optional className="md:col-span-2">{(id) => <Textarea id={id} rows={3} value={f.story ?? ''} onChange={(e) => set('story', e.target.value || null)} placeholder="Hand-finished in Zanzibar from deadstock linen…" />}</Field>
                <Field label="Materials" optional>{(id) => <Input id={id} value={f.materials ?? ''} onChange={(e) => set('materials', e.target.value || null)} placeholder="100% linen" />}</Field>
                <Field label="Country of origin" optional>{(id) => <Input id={id} value={f.countryOfOrigin ?? ''} onChange={(e) => set('countryOfOrigin', e.target.value || null)} placeholder="Tanzania" />}</Field>
                <Field label="Care" optional className="md:col-span-2">{(id) => <Textarea id={id} rows={2} value={f.care ?? ''} onChange={(e) => set('care', e.target.value || null)} placeholder="Cold hand wash. Dry flat in the shade." />}</Field>
              </div>
            </Section>
          </Card>

          {/* MEDIA */}
          <Card id="sec-media" className="scroll-mt-36">
            <Section title="Media" description="Photos, video and a voice note. Uploaded straight to storage, optimised to AVIF/WebP and cropped to 4:5 around the focal point.">
              <ProductMediaManager media={f.media} onChange={(m) => set('media', m)} optionTypes={f.optionTypes} />
            </Section>
          </Card>

          {/* VARIANTS */}
          <Card id="sec-variants" className="scroll-mt-36">
            <Section title="Options" description={isBeauty ? 'Shades and sizes. Each shade gets its own swatch colour.' : 'Colours and sizes. Each colour can switch the gallery.'}
              actions={<Button size="sm" variant="secondary" icon={<Wand2 strokeWidth={1.5} />} disabled={!f.optionTypes.some((o) => o.values.length)} onClick={() => set('variants', generateVariants(f.title, f.optionTypes, f.variants))}>Generate variants</Button>}>
              <OptionTypesEditor value={f.optionTypes} isBeauty={isBeauty} onChange={(o) => set('optionTypes', o)} />
            </Section>
            <Section title="Variants & pricing" description="Retail price per piece, optional compare-at (real discounts only), cost for margins, and wholesale tiers.">
              {fieldErr?.field?.startsWith('variants') && <p className="mb-3 flex items-center gap-2 text-[13px] text-danger"><CircleAlert className="size-4" strokeWidth={1.5} /> {fieldErr.message}</p>}
              <VariantsTable variants={f.variants} onChange={(v) => set('variants', v)} optionTypes={f.optionTypes} stores={stores.data ?? []} currency={currency} />
            </Section>
          </Card>

          {/* DETAILS */}
          <Card id="sec-details" className="scroll-mt-36">
            {catAttrs.length > 0 && (
              <Section title="Attributes" description={`Filters shoppers use for ${primary?.name ?? 'this category'}.`}>
                <div className="grid gap-4 md:grid-cols-2">
                  {catAttrs.map((a) => (
                    <Field key={a.key} label={a.label} optional>
                      {(id) => a.type === 'multiselect' ? (
                        <div className="flex flex-wrap gap-1.5" id={id}>
                          {a.options.map((o) => {
                            const cur = (f.attributes[a.key] as string[] | undefined) ?? [];
                            const on = cur.includes(o.value);
                            return (
                              <button key={o.value} type="button" aria-pressed={on} onClick={() => set('attributes', { ...f.attributes, [a.key]: on ? cur.filter((x) => x !== o.value) : [...cur, o.value] })}
                                className={cn('inline-flex h-8 items-center gap-1.5 rounded-sm border px-2.5 text-[13px] transition-colors', on ? 'border-ink bg-ink text-on-ink' : 'border-hairline hover:border-ink/40')}>
                                {o.hex && <span className="size-3 rounded-full ring-1 ring-ink/15" style={{ background: o.hex }} />}{o.label}
                              </button>
                            );
                          })}
                        </div>
                      ) : a.type === 'boolean' ? (
                        <Switch id={id} checked={!!f.attributes[a.key]} onCheckedChange={(v) => set('attributes', { ...f.attributes, [a.key]: v })} label={a.label} />
                      ) : a.type === 'text' ? (
                        <Input id={id} value={(f.attributes[a.key] as string) ?? ''} onChange={(e) => set('attributes', { ...f.attributes, [a.key]: e.target.value })} />
                      ) : (
                        <Select id={id} value={(f.attributes[a.key] as string) ?? ''} onChange={(e) => { const n = { ...f.attributes }; if (e.target.value) n[a.key] = e.target.value; else delete n[a.key]; set('attributes', n); }}>
                          <option value="">—</option>
                          {a.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </Select>
                      )}
                    </Field>
                  ))}
                </div>
              </Section>
            )}
            {isBeauty && (
              <Section title="Beauty details" description="Shown on the product page and used by shade and skin-type filters.">
                <div className="grid gap-4 md:grid-cols-3">
                  <Field label="Finish" optional>{(id) => <Select id={id} value={f.beauty?.finish ?? ''} onChange={(e) => set('beauty', { ...f.beauty, finish: e.target.value || undefined })}><option value="">—</option>{['matte', 'satin', 'dewy', 'glossy', 'shimmer', 'natural'].map((x) => <option key={x} value={x}>{titleCase(x)}</option>)}</Select>}</Field>
                  <Field label="Volume / size" optional>{(id) => <Input id={id} value={f.beauty?.volume ?? ''} onChange={(e) => set('beauty', { ...f.beauty, volume: e.target.value })} placeholder="30 ml" />}</Field>
                  <Field label="After opening (PAO)" optional>{(id) => <Input id={id} inputMode="numeric" value={f.beauty?.paoMonths ?? ''} onChange={(e) => set('beauty', { ...f.beauty, paoMonths: e.target.value ? +e.target.value.replace(/\D/g, '') : null })} trailing={<span className="pr-1 text-xs">months</span>} />}</Field>
                  <Field label="Skin types" optional className="md:col-span-3">
                    {() => (
                      <div className="flex flex-wrap gap-1.5">
                        {['normal', 'dry', 'oily', 'combination', 'sensitive', 'mature'].map((s) => {
                          const cur = f.beauty?.skinTypes ?? [];
                          const on = cur.includes(s);
                          return <button key={s} type="button" aria-pressed={on} onClick={() => set('beauty', { ...f.beauty, skinTypes: on ? cur.filter((x) => x !== s) : [...cur, s] })} className={cn('h-8 rounded-sm border px-2.5 text-[13px] transition-colors', on ? 'border-ink bg-ink text-on-ink' : 'border-hairline hover:border-ink/40')}>{titleCase(s)}</button>;
                        })}
                      </div>
                    )}
                  </Field>
                  <Field label="Ingredients (INCI)" optional className="md:col-span-3">{(id) => <Textarea id={id} rows={3} value={f.beauty?.ingredients ?? ''} onChange={(e) => set('beauty', { ...f.beauty, ingredients: e.target.value })} />}</Field>
                  <label className="flex items-center gap-2 text-[13px]"><Switch checked={!!f.beauty?.vegan} onCheckedChange={(v) => set('beauty', { ...f.beauty, vegan: v })} label="Vegan" /> Vegan</label>
                  <label className="flex items-center gap-2 text-[13px]"><Switch checked={!!f.beauty?.crueltyFree} onCheckedChange={(v) => set('beauty', { ...f.beauty, crueltyFree: v })} label="Cruelty-free" /> Cruelty-free</label>
                </div>
              </Section>
            )}
            {!isBeauty && (
              <Section title="Size & fit">
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label="Size guide" optional help={primary?.defaultSizeChartId ? 'Defaults to the category’s chart.' : undefined}>
                    {(id) => <Select id={id} value={f.sizeChartId ?? ''} onChange={(e) => set('sizeChartId', e.target.value || null)}><option value="">None</option>{charts.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
                  </Field>
                  <Field label="Fit note" optional>
                    {(id) => <Select id={id} value={f.fitNote ?? ''} onChange={(e) => set('fitNote', e.target.value || null)}><option value="">No note</option><option value="runs_small">Runs small</option><option value="true_to_size">True to size</option><option value="runs_large">Runs large</option></Select>}
                  </Field>
                </div>
              </Section>
            )}
          </Card>

          {/* MERCH */}
          <Card id="sec-merch" className="scroll-mt-36">
            <Section title="Merchandising" description="Badges are tasteful UI labels — they are never printed onto the photo.">
              <div className="grid gap-5">
                <label className="flex items-center justify-between gap-3 text-[13px]"><span><b className="font-semibold">Featured</b><span className="block text-xs text-muted">Eligible for Home rails and the For You feed boost.</span></span><Switch checked={f.featured} onCheckedChange={(v) => set('featured', v)} label="Featured" /></label>
                <Field label="Badges" optional>
                  {() => (
                    <div className="flex flex-wrap gap-1.5">
                      {badges.data?.map((b) => {
                        const on = f.badgeIds.includes(b.id);
                        return <button key={b.id} type="button" aria-pressed={on} onClick={() => set('badgeIds', on ? f.badgeIds.filter((x) => x !== b.id) : [...f.badgeIds, b.id])} className={cn('label-caps h-7 rounded-xs border px-2 text-[11px] transition-colors', on ? 'border-ink bg-ink text-on-ink' : 'border-hairline text-muted hover:border-ink/40')}>{b.label}</button>;
                      })}
                    </div>
                  )}
                </Field>
                <Field label="Collections" optional>
                  {() => (
                    <div className="flex flex-wrap gap-1.5">
                      {collections.data?.filter((c) => !c.rule).map((c) => {
                        const on = f.collectionIds.includes(c.id);
                        return <button key={c.id} type="button" aria-pressed={on} onClick={() => set('collectionIds', on ? f.collectionIds.filter((x) => x !== c.id) : [...f.collectionIds, c.id])} className={cn('h-8 rounded-sm border px-2.5 text-[13px] transition-colors', on ? 'border-ink bg-ink text-on-ink' : 'border-hairline hover:border-ink/40')}>{c.title}{c.isDrop && ' · Drop'}</button>;
                      })}
                    </div>
                  )}
                </Field>
                {([['completeTheLookIds', 'Complete the look', 'Pieces styled with this one.'], ['pairsWellWithIds', 'Pairs well with', 'Accessories and beauty that go with it.'], ['relatedProductIds', 'Related', 'Similar alternatives.']] as const).map(([k, label, help]) => (
                  <Field key={k} label={label} optional help={help}>
                    {() => <ProductPicker value={rel[k] ?? []} exclude={productId ? [productId] : []} onChange={(v) => { setRel((r) => ({ ...r, [k]: v })); set(k, v.map((x) => x.id)); }} />}
                  </Field>
                ))}
              </div>
            </Section>
          </Card>

          {/* PUBLISH */}
          <Card id="sec-publish" className="scroll-mt-36">
            <Section title="Publishing">
              <div className="grid gap-4 md:grid-cols-3">
                <Field label="Status">
                  {(id) => (
                    <Select id={id} value={f.status} onChange={(e) => set('status', e.target.value as ProductForm['status'])}>
                      <option value="DRAFT">Draft</option>
                      <option value="SCHEDULED" disabled={!canPublish}>Scheduled</option>
                      <option value="PUBLISHED" disabled={!canPublish}>Published</option>
                      <option value="ARCHIVED">Archived</option>
                    </Select>
                  )}
                </Field>
                <Field label="Publish at" optional error={fieldErr?.field === 'publishAt' ? fieldErr.message : null}>{(id) => <Input id={id} type="datetime-local" value={toLocalInput(f.publishAt)} onChange={(e) => set('publishAt', fromLocalInput(e.target.value))} />}</Field>
                <Field label="Unpublish at" optional>{(id) => <Input id={id} type="datetime-local" value={toLocalInput(f.unpublishAt)} onChange={(e) => set('unpublishAt', fromLocalInput(e.target.value))} />}</Field>
              </div>
            </Section>
            <Section title="Search & sharing">
              <div className="grid gap-4">
                <Field label="URL handle" help={`/p/${f.slug || 'generated-from-title'}`} error={fieldErr?.field === 'slug' ? fieldErr.message : null}>{(id) => <Input id={id} value={f.slug} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, '-'))} placeholder="Generated from the title" />}</Field>
                <Field label="SEO title" optional aside={<span className="text-xs text-muted tabular">{(f.seoTitle ?? f.title).length}/60</span>}>{(id) => <Input id={id} value={f.seoTitle ?? ''} onChange={(e) => set('seoTitle', e.target.value || null)} placeholder={f.title} />}</Field>
                <Field label="SEO description" optional aside={<span className="text-xs text-muted tabular">{(f.seoDescription ?? '').length}/160</span>}>{(id) => <Textarea id={id} rows={2} value={f.seoDescription ?? ''} onChange={(e) => set('seoDescription', e.target.value || null)} />}</Field>
                <div className="rounded-sm bg-canvas p-4">
                  <div className="text-xs text-muted">smartwear.africa › p › {f.slug || '…'}</div>
                  <div className="mt-0.5 text-[15px] text-info">{(f.seoTitle || f.title || 'Product title').slice(0, 60)} · SmartWear</div>
                  <div className="mt-0.5 line-clamp-2 text-[13px] text-muted">{f.seoDescription || f.tagline || stripHtml(f.descriptionHtml ?? '').slice(0, 160) || 'Add a description to control the search snippet.'}</div>
                </div>
              </div>
            </Section>
          </Card>
        </div>

        {/* RIGHT RAIL */}
        <aside className="grid content-start gap-4 xl:sticky xl:top-36 xl:max-h-[calc(100vh-10rem)] xl:overflow-y-auto">
          <ProductPreview form={f} brands={brands.data ?? []} badges={badges.data ?? []} currency={currency} />
          <Card className="p-4">
            <div className="mb-2 flex items-center justify-between"><div className="text-[13px] font-semibold">Quality check</div>{allHints.length === 0 && <Chip tone="success">Ready</Chip>}</div>
            <ul className="grid gap-2">
              <AnimatePresence initial={false}>
                {allHints.map((x) => (
                  <motion.li key={x.code + x.message} layout initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, height: 0 }} className="flex gap-2 text-[12.5px] leading-5">
                    {x.level === 'error' ? <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-danger" strokeWidth={2} /> : x.level === 'warning' ? <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-warning" strokeWidth={2} /> : <Info className="mt-0.5 size-3.5 shrink-0 text-muted" strokeWidth={2} />}
                    <span className={cn(x.level === 'error' ? 'text-danger' : 'text-muted')}>{x.message}</span>
                  </motion.li>
                ))}
              </AnimatePresence>
              {allHints.length === 0 && <li className="flex gap-2 text-[12.5px] text-success"><Check className="size-3.5" strokeWidth={2} /> Photos, sizes, pricing and copy look complete.</li>}
            </ul>
          </Card>
          <p className="text-center text-[11px] text-subtle">⌘S save · ⌘Z undo · drafts autosave</p>
        </aside>
      </div>
      {productId && <VersionsDialog open={versionsOpen} onOpenChange={setVersionsOpen} productId={productId} current={f.version} onReverted={(d) => { const form = fromApi(d); h.reset(form); setSaved(JSON.stringify(toApi(form))); }} />}
    </div>
  );
}

function jumpTo(id: string) {
  document.getElementById(`sec-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
const fieldSection = (field: string) => (field.startsWith('variants') || field.startsWith('optionTypes') ? 'variants' : field.startsWith('media') ? 'media' : field === 'slug' || field === 'publishAt' ? 'publish' : field === 'beauty' ? 'details' : 'basics');
const stripHtml = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function clientHints(f: ProductForm, isBeauty: boolean) {
  const out: { level: 'error' | 'warning' | 'info'; code: string; message: string }[] = [];
  if (!f.title.trim()) out.push({ level: 'error', code: 'title', message: 'Give it a title.' });
  if (!f.primaryCategoryId) out.push({ level: 'error', code: 'category', message: 'Choose a category.' });
  if (!f.media.some((m) => m.media.type === 'IMAGE')) out.push({ level: 'error', code: 'no_images', message: 'Add at least one photo — products without images can’t be published.' });
  if (f.variants.some((v) => !v.retailPrice)) out.push({ level: 'error', code: 'price', message: 'Every active variant needs a retail price.' });
  if (f.variants.some((v) => !v.sku.trim())) out.push({ level: 'error', code: 'sku', message: 'Every variant needs a SKU.' });
  if (f.variants.some((v) => v.compareAtPrice != null && v.compareAtPrice <= v.retailPrice)) out.push({ level: 'error', code: 'compare', message: 'Compare-at prices must be higher than the price.' });
  if (f.media.some((m) => m.media.type === 'IMAGE' && !m.alt)) out.push({ level: 'info', code: 'missing_alt', message: 'Some photos have no alt text.' });
  if (!isBeauty && f.primaryCategoryId && !f.optionTypes.some((o) => o.kind === 'size')) out.push({ level: 'warning', code: 'missing_sizes', message: 'No sizes yet — add a Size option.' });
  if (f.variants.every((v) => !v.wholesaleTiers.length)) out.push({ level: 'info', code: 'missing_wholesale', message: 'No wholesale tiers — bulk buyers will only see retail.' });
  if (!stripHtml(f.descriptionHtml ?? '')) out.push({ level: 'info', code: 'missing_description', message: 'Add a description.' });
  return out;
}

function SaveState({ dirty, saving, autoErr, updatedAt, version }: { dirty: boolean; saving: string; autoErr: string | null; updatedAt?: string; version?: number }) {
  const label = saving === 'autosaving' ? 'Autosaving…' : saving === 'saving' ? 'Saving…' : autoErr ? `Autosave paused — ${autoErr}` : dirty ? 'Unsaved changes' : updatedAt ? `Saved ${fmtAgo(updatedAt)}${version ? ` · v${version}` : ''}` : 'Not saved yet';
  return (
    <AnimatePresence mode="wait">
      <motion.div key={label} initial={{ opacity: 0, y: 2 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn('flex items-center gap-1.5 text-xs', autoErr ? 'text-warning' : 'text-muted')}>
        {saving !== 'idle' ? <LoaderA size="xs" /> : <span className={cn('size-1.5 rounded-full', dirty ? 'bg-warning' : 'bg-success')} />}
        <span className="truncate">{label}</span>
      </motion.div>
    </AnimatePresence>
  );
}

function TagInput({ id, value, onChange }: { id: string; value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const commit = () => { const t = draft.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean); if (t.length) onChange([...new Set([...value, ...t])].slice(0, 30)); setDraft(''); };
  return (
    <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-sm border border-hairline bg-surface px-2 py-1.5 focus-within:border-ink">
      {value.map((t) => <button key={t} type="button" onClick={() => onChange(value.filter((x) => x !== t))} className="inline-flex h-6 items-center rounded-xs bg-ink/5 px-2 text-[12px] hover:bg-danger-soft hover:text-danger">{t} ×</button>)}
      <input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); commit(); } if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1)); }} className="h-6 min-w-24 flex-1 bg-transparent text-sm outline-none" placeholder={value.length ? '' : 'linen, wedding guest, resort'} />
    </div>
  );
}

function RichBtn({ onCmd, icon, label }: { onCmd: () => void; icon: ReactNode; label: string }) {
  return <button type="button" onMouseDown={(e) => { e.preventDefault(); onCmd(); }} aria-label={label} className="flex size-8 items-center justify-center rounded-xs text-muted hover:bg-ink/5 hover:text-ink [&>svg]:size-4">{icon}</button>;
}

/** Small, safe rich-text editor (bold, italic, lists). The API sanitises the HTML again. */
function RichText({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== value && document.activeElement !== ref.current) ref.current.innerHTML = value;
  }, [value]);
  const cmd = (c: string) => { document.execCommand(c); ref.current?.focus(); onChange(ref.current?.innerHTML ?? ''); };
  return (
    <div className="rounded-sm border border-hairline bg-surface focus-within:border-ink">
      <div className="flex gap-0.5 border-b border-hairline p-1">
        <RichBtn onCmd={() => cmd('bold')} icon={<Bold strokeWidth={1.75} />} label="Bold" />
        <RichBtn onCmd={() => cmd('italic')} icon={<Italic strokeWidth={1.75} />} label="Italic" />
        <RichBtn onCmd={() => cmd('insertUnorderedList')} icon={<List strokeWidth={1.75} />} label="Bulleted list" />
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning role="textbox" aria-multiline aria-label="Description" onInput={(e) => onChange(e.currentTarget.innerHTML)}
        className="min-h-32 px-3 py-2.5 text-sm leading-6 outline-none [&_ul]:list-disc [&_ul]:pl-5 empty:before:text-subtle empty:before:content-['Fabric,_fit,_how_it_feels_and_how_to_wear_it…']" />
    </div>
  );
}

function TemplateBar({ onApply }: { onApply: (d: Partial<ProductForm>) => void }) {
  const t = useQuery({ queryKey: ['product-templates'], queryFn: () => api<{ items: { id: string; name: string; data: Partial<ProductForm> }[] }>('/admin/products/templates') });
  if (!t.data?.items.length) return null;
  return (
    <Card className="mb-6 flex flex-wrap items-center gap-3 px-5 py-3">
      <LayoutTemplate className="size-4 text-muted" strokeWidth={1.5} />
      <span className="text-[13px] font-semibold">Start from a template</span>
      <div className="flex flex-wrap gap-1.5">
        {t.data.items.map((x) => <Button key={x.id} size="sm" variant="secondary" onClick={() => { onApply({ ...x.data, primaryCategoryId: x.data.categoryIds?.[0] ?? null }); toast.success(`Applied “${x.name}”`); }}>{x.name}</Button>)}
      </div>
    </Card>
  );
}

function VersionsDialog({ open, onOpenChange, productId, current, onReverted }: { open: boolean; onOpenChange: (v: boolean) => void; productId: string; current?: number; onReverted: (d: Parameters<typeof fromApi>[0]) => void }) {
  const q = useQuery({ queryKey: ['versions', productId], enabled: open, queryFn: () => api<{ items: { version: number; note: string; by: string | null; createdAt: string; title: string; status: string }[] }>(`/admin/products/${productId}/versions`) });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} side title="Version history" description="Every save keeps a snapshot. Reverting creates a new version, so nothing is lost.">
      {q.isPending ? <div className="flex justify-center py-12"><LoaderA size="lg" /></div> : (
        <ol className="relative grid gap-0 border-l border-hairline pl-5">
          {q.data?.items.map((v) => (
            <li key={v.version} className="relative pb-5">
              <span className={cn('absolute -left-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-surface', v.version === current ? 'bg-ink' : 'bg-hairline')} />
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-[13px] font-semibold">v{v.version} · {v.note || 'Saved'}</div>
                  <div className="text-xs text-muted">{fmtDateTime(v.createdAt)} · {v.by ?? 'System'} · {titleCase(v.status ?? '')}</div>
                </div>
                {v.version !== current && <ActionButton size="sm" variant="secondary" onAction={async () => { const d = await api<Parameters<typeof fromApi>[0]>(`/admin/products/${productId}/versions`, { body: { version: v.version } }); onReverted(d); toast.success(`Reverted to v${v.version}`); onOpenChange(false); }}>Revert</ActionButton>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </Dialog>
  );
}
