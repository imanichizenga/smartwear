'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, Ruler, SlidersHorizontal, Tag, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Rise, RowsSkeleton, Tabs } from '@/components/ui/kit';
import { Card, Chip, EmptyState, PageHeader, Switch, type Tone } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { useAttributes, useBadges, useBrands, useCategories, useSizeCharts, type AttrOption, type Attribute, type Badge, type SizeChart } from '@/lib/catalog';
import { fmtNum, titleCase } from '@/lib/format';

type TabKey = 'attributes' | 'sizes' | 'badges';

export function AttributesWorkspace() {
  const [tab, setTab] = useState<TabKey>('attributes');
  return (
    <>
      <PageHeader title="Attributes & sizes" description="The vocabulary of the catalogue: filterable attributes, reusable size guides and the badge labels shown on product cards." />
      <Card className="overflow-hidden">
        <div className="border-b border-hairline px-3"><Tabs id="attr" value={tab} onChange={setTab} tabs={[{ key: 'attributes', label: 'Attributes' }, { key: 'sizes', label: 'Size guides' }, { key: 'badges', label: 'Badges' }]} /></div>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {tab === 'attributes' ? <Attributes /> : tab === 'sizes' ? <SizeCharts /> : <Badges />}
          </motion.div>
        </AnimatePresence>
      </Card>
    </>
  );
}

/* ------------------------------------------------------------ attributes */
function Attributes() {
  const qc = useQueryClient();
  const canManage = useCan('catalog.manage');
  const q = useAttributes();
  const [edit, setEdit] = useState<(Partial<Attribute> & { isNew?: boolean }) | null>(null);
  const [draft, setDraft] = useState('');
  const save = async () => {
    if (!edit) return;
    try {
      if (edit.isNew) await api('/admin/attributes', { body: { label: edit.label, labelSw: edit.labelSw, type: edit.type ?? 'select', options: edit.options ?? [], filterable: edit.filterable ?? true } });
      else await api(`/admin/attributes/${edit.key}`, { method: 'PATCH', body: { label: edit.label, labelSw: edit.labelSw, options: edit.options, filterable: edit.filterable } });
      toast.success('Attribute saved');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['attributes'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  const addOpts = () => {
    if (!edit) return;
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean);
    const have = new Set((edit.options ?? []).map((o) => o.label.toLowerCase()));
    setEdit({ ...edit, options: [...(edit.options ?? []), ...parts.filter((p) => !have.has(p.toLowerCase())).map((label): AttrOption => ({ value: '', label }))] });
    setDraft('');
  };
  if (q.isPending) return <RowsSkeleton />;
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <p className="text-[13px] text-muted">Categories choose which attributes apply. Options in use can’t be removed.</p>
        {canManage && <Button size="sm" icon={<Plus strokeWidth={1.5} />} onClick={() => setEdit({ isNew: true, type: 'select', options: [], filterable: true })}>Attribute</Button>}
      </div>
      <ul className="divide-y divide-hairline">
        {(q.data ?? []).map((a, i) => (
          <Rise as="li" i={i} key={a.key}>
            <button type="button" disabled={!canManage} onClick={() => setEdit(a)} className="flex w-full items-start gap-4 px-5 py-3.5 text-left hover:bg-ink/[0.025]">
              <SlidersHorizontal className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-semibold">{a.label}<span className="font-mono text-[11px] font-normal text-subtle">{a.key}</span>{a.filterable && <Chip tone="neutral">Filter</Chip>}</div>
                <div className="mt-1 flex flex-wrap gap-1">{a.options.slice(0, 10).map((o) => <span key={o.value} className="inline-flex items-center gap-1 rounded-xs bg-ink/5 px-1.5 py-0.5 text-[11.5px]">{o.hex && <span className="size-2.5 rounded-full" style={{ background: o.hex }} />}{o.label}</span>)}{a.options.length > 10 && <span className="text-[11.5px] text-muted">+{a.options.length - 10}</span>}</div>
              </div>
              <div className="hidden max-w-60 truncate text-right text-xs text-muted md:block">{a.usedBy.length ? a.usedBy.slice(0, 3).join(', ') + (a.usedBy.length > 3 ? '…' : '') : 'Not used yet'}</div>
            </button>
          </Rise>
        ))}
      </ul>
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} title={edit?.isNew ? 'New attribute' : edit?.label ?? ''}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><ActionButton disabled={!edit?.label?.trim()} onAction={save}>Save</ActionButton></>}>
        {edit && (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Label">{(id) => <Input id={id} value={edit.label ?? ''} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder="Neckline" />}</Field>
              <Field label="Swahili label" optional>{(id) => <Input id={id} value={edit.labelSw ?? ''} onChange={(e) => setEdit({ ...edit, labelSw: e.target.value })} />}</Field>
              <Field label="Type">{(id) => <Select id={id} value={edit.type ?? 'select'} disabled={!edit.isNew} onChange={(e) => setEdit({ ...edit, type: e.target.value as Attribute['type'] })}><option value="select">Single choice</option><option value="multiselect">Multiple choice</option><option value="text">Free text</option><option value="boolean">Yes / no</option></Select>}</Field>
              <label className="flex items-end gap-2 pb-2 text-[13px]"><Switch checked={edit.filterable ?? true} onCheckedChange={(v) => setEdit({ ...edit, filterable: v })} label="Filterable" /> Show as a search filter</label>
            </div>
            {(edit.type === 'select' || edit.type === 'multiselect') && (
              <Field label="Options">
                {(id) => (
                  <div>
                    <div className="mb-2 flex flex-wrap gap-1.5">
                      {(edit.options ?? []).map((o, i) => (
                        <span key={`${o.value}-${i}`} className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-hairline bg-canvas pl-2 pr-1 text-[13px]">
                          <label className="relative size-4 cursor-pointer overflow-hidden rounded-full ring-1 ring-ink/15" style={{ background: o.hex ?? 'transparent' }} title="Optional swatch">
                            <input type="color" value={o.hex ?? '#ffffff'} onChange={(e) => setEdit({ ...edit, options: edit.options!.map((x, j) => (j === i ? { ...x, hex: e.target.value.toUpperCase() } : x)) })} className="absolute inset-0 opacity-0" aria-label={`Swatch for ${o.label}`} />
                          </label>
                          {o.label}
                          <button type="button" aria-label={`Remove ${o.label}`} onClick={() => setEdit({ ...edit, options: edit.options!.filter((_, j) => j !== i) })} className="inline-flex size-5 items-center justify-center rounded-full text-muted hover:bg-ink/8"><X className="size-3" strokeWidth={2} /></button>
                        </span>
                      ))}
                    </div>
                    <Input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOpts(); } }} onBlur={addOpts} placeholder="V-neck, Crew, Square — comma-separated" />
                  </div>
                )}
              </Field>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------ size charts */
function SizeCharts() {
  const qc = useQueryClient();
  const canManage = useCan('catalog.manage');
  const q = useSizeCharts();
  const brands = useBrands();
  const cats = useCategories();
  const [edit, setEdit] = useState<Partial<SizeChart> | null>(null);
  const cols = edit?.columns ?? [];
  const rows = edit?.rows ?? [];
  const save = async () => {
    if (!edit) return;
    try {
      await api(edit.id ? `/admin/size-charts/${edit.id}` : '/admin/size-charts', { method: edit.id ? 'PATCH' : 'POST', body: { name: edit.name, unit: edit.unit ?? 'cm', columns: cols, rows, note: edit.note, brandId: edit.brandId ?? null, categoryId: edit.categoryId ?? null } });
      toast.success('Size guide saved');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['size-charts'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  const remove = async () => {
    if (!edit?.id) return;
    try {
      await api(`/admin/size-charts/${edit.id}`, { method: 'DELETE' });
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['size-charts'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not delete');
    }
  };
  if (q.isPending) return <RowsSkeleton />;
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <p className="text-[13px] text-muted">Shown in the product page’s size guide sheet. Attach per product, or as a category default.</p>
        {canManage && <Button size="sm" icon={<Plus strokeWidth={1.5} />} onClick={() => setEdit({ name: '', unit: 'cm', columns: ['Size', 'Bust', 'Waist', 'Hips'], rows: [{ label: 'S', values: ['S', '', '', ''] }] })}>Size guide</Button>}
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {(q.data ?? []).map((c, i) => (
          <Rise key={c.id} i={i}>
            <button type="button" disabled={!canManage} onClick={() => setEdit(c)} className="block w-full text-left">
              <Card className="p-4 transition-colors hover:border-ink/25">
                <div className="flex items-center justify-between"><div className="flex items-center gap-2 font-semibold"><Ruler className="size-4 text-muted" strokeWidth={1.5} />{c.name}</div><Chip>{c.unit}</Chip></div>
                <div className="mt-3 overflow-hidden rounded-xs border border-hairline">
                  <table className="w-full text-[11.5px] tabular">
                    <thead className="bg-canvas"><tr>{c.columns.slice(0, 5).map((h) => <th key={h} className="px-2 py-1 text-left font-semibold">{h}</th>)}</tr></thead>
                    <tbody>{c.rows.slice(0, 3).map((r) => <tr key={r.label} className="border-t border-hairline">{r.values.slice(0, 5).map((v, j) => <td key={j} className="px-2 py-1">{v}</td>)}</tr>)}</tbody>
                  </table>
                </div>
                <div className="mt-2 text-xs text-muted">{fmtNum(c.rows.length)} sizes</div>
              </Card>
            </button>
          </Rise>
        ))}
      </div>
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} size="lg" title={edit?.id ? edit.name ?? 'Size guide' : 'New size guide'}
        footer={<>{edit?.id && <ActionButton variant="danger" className="mr-auto" icon={<Trash2 strokeWidth={1.5} />} onAction={remove}>Delete</ActionButton>}<Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><ActionButton disabled={!edit?.name?.trim()} onAction={save}>Save</ActionButton></>}>
        {edit && (
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-4">
              <Field label="Name" className="sm:col-span-2">{(id) => <Input id={id} value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Women’s dresses" />}</Field>
              <Field label="Unit">{(id) => <Select id={id} value={edit.unit ?? 'cm'} onChange={(e) => setEdit({ ...edit, unit: e.target.value })}><option value="cm">cm</option><option value="in">inches</option><option value="eu">EU</option><option value="uk">UK</option></Select>}</Field>
              <Field label="Brand" optional>{(id) => <Select id={id} value={edit.brandId ?? ''} onChange={(e) => setEdit({ ...edit, brandId: e.target.value || null })}><option value="">Any</option>{brands.data?.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select>}</Field>
            </div>
            <Field label="Category default" optional>{(id) => <Select id={id} value={edit.categoryId ?? ''} onChange={(e) => setEdit({ ...edit, categoryId: e.target.value || null })}><option value="">None</option>{cats.data?.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>}</Field>
            <div className="-mx-6 overflow-x-auto px-6">
              <table className="text-[13px]">
                <thead>
                  <tr>
                    {cols.map((c, ci) => (
                      <th key={ci} className="p-1"><Input value={c} onChange={(e) => setEdit({ ...edit, columns: cols.map((x, j) => (j === ci ? e.target.value : x)) })} className="h-9 w-28 font-semibold [&_input]:h-9" aria-label={`Column ${ci + 1}`} /></th>
                    ))}
                    <th className="p-1"><Button size="icon-sm" variant="ghost" aria-label="Add column" onClick={() => setEdit({ ...edit, columns: [...cols, 'New'], rows: rows.map((r) => ({ ...r, values: [...r.values, ''] })) })}><Plus strokeWidth={1.5} /></Button></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, ri) => (
                    <tr key={ri}>
                      {cols.map((_, ci) => (
                        <td key={ci} className="p-1"><Input value={r.values[ci] ?? ''} onChange={(e) => setEdit({ ...edit, rows: rows.map((x, j) => (j === ri ? { label: ci === 0 ? e.target.value : x.label, values: cols.map((__, k) => (k === ci ? e.target.value : x.values[k] ?? '')) } : x)) })} className="h-9 w-28 tabular [&_input]:h-9" aria-label={`Row ${ri + 1} ${cols[ci]}`} /></td>
                      ))}
                      <td className="p-1"><Button size="icon-sm" variant="ghost" aria-label="Remove row" onClick={() => setEdit({ ...edit, rows: rows.filter((_, j) => j !== ri) })}><X strokeWidth={1.5} /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Button size="sm" variant="secondary" className="mt-2" icon={<Plus strokeWidth={1.5} />} onClick={() => setEdit({ ...edit, rows: [...rows, { label: '', values: cols.map(() => '') }] })}>Add size</Button>
            </div>
            <Field label="Note" optional>{(id) => <Input id={id} value={edit.note ?? ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder="Measurements are of the body, not the garment." />}</Field>
          </div>
        )}
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------ badges */
const BADGE_TONE: Record<string, Tone> = { ink: 'ink', accent: 'accent', blush: 'blush', muted: 'neutral' };

function Badges() {
  const qc = useQueryClient();
  const canManage = useCan('catalog.manage');
  const q = useBadges();
  const [edit, setEdit] = useState<Partial<Badge> | null>(null);
  const save = async () => {
    if (!edit) return;
    try {
      await api('/admin/badges', { body: { key: edit.key, label: edit.label, labelSw: edit.labelSw, tone: edit.tone ?? 'ink', sortOrder: edit.sortOrder ?? 0 } });
      toast.success('Badge saved');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['badges'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  if (q.isPending) return <RowsSkeleton />;
  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <p className="text-[13px] text-muted">Badges are small UI labels beside the product — never burned into photos.</p>
        {canManage && <Button size="sm" icon={<Plus strokeWidth={1.5} />} onClick={() => setEdit({ tone: 'ink' })}>Badge</Button>}
      </div>
      {(q.data ?? []).length === 0 ? <EmptyState icon={<Tag />} title="No badges" /> : (
        <ul className="divide-y divide-hairline">
          {(q.data ?? []).map((b, i) => (
            <Rise as="li" i={i} key={b.id} className="flex items-center gap-4 px-5 py-3">
              <Chip tone={BADGE_TONE[b.tone] ?? 'ink'}>{b.label}</Chip>
              <span className="text-[13px] text-muted">{b.labelSw ?? '—'}</span>
              <span className="ml-auto text-xs text-muted tabular">{fmtNum(b.productCount)} products</span>
              {canManage && <Button size="sm" variant="ghost" onClick={() => setEdit(b)}>Edit</Button>}
              {canManage && <ActionButton size="icon-sm" variant="ghost" aria-label={`Delete ${b.label}`} icon={<Trash2 strokeWidth={1.5} />} onAction={async () => { await api(`/admin/badges/${b.id}`, { method: 'DELETE' }); void qc.invalidateQueries({ queryKey: ['badges'] }); }} />}
            </Rise>
          ))}
        </ul>
      )}
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} size="sm" title={edit?.id ? 'Edit badge' : 'New badge'}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><ActionButton disabled={!edit?.label?.trim()} onAction={save}>Save</ActionButton></>}>
        {edit && (
          <div className="grid gap-4">
            <Field label="Label" help="Up to 24 characters.">{(id) => <Input id={id} maxLength={24} value={edit.label ?? ''} onChange={(e) => setEdit({ ...edit, label: e.target.value })} placeholder="Limited" />}</Field>
            <Field label="Swahili label" optional>{(id) => <Input id={id} maxLength={24} value={edit.labelSw ?? ''} onChange={(e) => setEdit({ ...edit, labelSw: e.target.value })} placeholder="Toleo maalum" />}</Field>
            <Field label="Tone">
              {() => (
                <div className="flex gap-2">
                  {Object.keys(BADGE_TONE).map((t) => <button key={t} type="button" onClick={() => setEdit({ ...edit, tone: t })} className={`rounded-sm p-1 ${edit.tone === t ? 'ring-1 ring-ink' : ''}`}><Chip tone={BADGE_TONE[t]!}>{edit.label || titleCase(t)}</Chip></button>)}
                </div>
              )}
            </Field>
          </div>
        )}
      </Dialog>
    </>
  );
}
