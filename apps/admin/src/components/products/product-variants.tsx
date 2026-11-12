'use client';

import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Boxes, Layers, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Chip, Switch, Tooltip } from '@/components/ui/primitives';
import type { StoreLite } from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { fmtMoney, fmtNum } from '@/lib/format';
import { emptyVariant, newKey, skuPart, skuStem, type OptionTypeIn, type Tier, type VariantIn } from './types';

const KIND_LABEL = { color: 'Colour', size: 'Size', shade: 'Shade', volume: 'Volume', other: 'Other' } as const;
const num = (v: string) => (v.trim() === '' ? null : Math.max(0, Math.round(Number(v.replace(/[^\d.]/g, '')) || 0)));

/* ------------------------------------------------------------ option types */
export function OptionTypesEditor({ value, onChange, isBeauty }: { value: OptionTypeIn[]; onChange: (v: OptionTypeIn[]) => void; isBeauty: boolean }) {
  const [draft, setDraft] = useState<Record<number, string>>({});
  const kinds = (isBeauty ? ['shade', 'volume', 'size', 'other'] : ['color', 'size', 'other']) as OptionTypeIn['kind'][];
  const set = (i: number, p: Partial<OptionTypeIn>) => onChange(value.map((o, j) => (j === i ? { ...o, ...p } : o)));
  const addValue = (i: number) => {
    const parts = (draft[i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const o = value[i];
    if (!o) return;
    const seen = new Set(o.values.map((v) => v.value.toLowerCase()));
    set(i, { values: [...o.values, ...parts.filter((p) => !seen.has(p.toLowerCase())).map((p) => ({ id: `new:${newKey()}`, value: p, label: null, swatchHex: o.kind === 'color' || o.kind === 'shade' ? '#C9B8A6' : null }))] });
    setDraft((d) => ({ ...d, [i]: '' }));
  };
  return (
    <div className="grid gap-3">
      <AnimatePresence initial={false}>
        {value.map((o, i) => (
          <motion.div key={o.id ?? i} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} className="rounded-sm border border-hairline p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Select value={o.kind} onChange={(e) => set(i, { kind: e.target.value as OptionTypeIn['kind'], name: KIND_LABEL[e.target.value as OptionTypeIn['kind']] })} className="w-32" aria-label="Option kind">
                {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </Select>
              <Input value={o.name} onChange={(e) => set(i, { name: e.target.value })} className="w-40" aria-label="Option name" />
              <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label="Remove option" onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 strokeWidth={1.5} /></Button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {o.values.map((v, vi) => (
                <span key={v.id ?? vi} className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-hairline bg-canvas pl-1.5 pr-1 text-[13px]">
                  {(o.kind === 'color' || o.kind === 'shade') && (
                    <label className="relative size-5 cursor-pointer overflow-hidden rounded-full ring-1 ring-ink/15" style={{ background: v.swatchHex ?? '#ccc' }}>
                      <input type="color" value={v.swatchHex ?? '#cccccc'} onChange={(e) => set(i, { values: o.values.map((x, xi) => (xi === vi ? { ...x, swatchHex: e.target.value.toUpperCase() } : x)) })} className="absolute inset-0 cursor-pointer opacity-0" aria-label={`Swatch for ${v.value}`} />
                    </label>
                  )}
                  <span className={cn(o.kind !== 'color' && o.kind !== 'shade' && 'pl-1')}>{v.value}</span>
                  <button type="button" aria-label={`Remove ${v.value}`} onClick={() => set(i, { values: o.values.filter((_, xi) => xi !== vi) })} className="inline-flex size-5 items-center justify-center rounded-full text-muted hover:bg-ink/8"><X className="size-3" strokeWidth={2} /></button>
                </span>
              ))}
              <Input value={draft[i] ?? ''} onChange={(e) => setDraft((d) => ({ ...d, [i]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addValue(i); } }} onBlur={() => addValue(i)} placeholder={o.kind === 'size' ? 'XS, S, M, L' : o.kind === 'volume' ? '30 ml, 50 ml' : 'Add values, comma-separated'} className="h-8 w-52 [&_input]:h-8" aria-label={`Add ${o.name} values`} />
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
      {value.length < 3 && (
        <div className="flex flex-wrap gap-2">
          {kinds.filter((k) => !value.some((o) => o.kind === k) || k === 'other').slice(0, 3).map((k) => (
            <Button key={k} size="sm" variant="secondary" icon={<Plus strokeWidth={1.5} />} onClick={() => onChange([...value, { id: undefined, name: KIND_LABEL[k], kind: k, values: [] }])}>{KIND_LABEL[k]}</Button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Every combination of the option values (Colour × Size …). Existing variants keep their prices and stock. */
export function generateVariants(title: string, types: OptionTypeIn[], existing: VariantIn[]): VariantIn[] {
  const lists = types.filter((t) => t.values.length).map((t) => t.values.map((v) => ({ id: v.id ?? `new:${v.value}`, value: v.value })));
  if (!lists.length) return existing.length ? existing : [emptyVariant(skuStem(title))];
  const combos = lists.reduce<{ id: string; value: string }[][]>((acc, l) => acc.flatMap((c) => l.map((v) => [...c, v])), [[]]);
  const base = existing[0];
  const byKey = new Map(existing.map((v) => [[...v.optionValueIds].sort().join('|'), v]));
  return combos.map((c) => {
    const ids = c.map((v) => v.id);
    const hit = byKey.get([...ids].sort().join('|'));
    if (hit) return hit;
    return {
      ...emptyVariant(),
      sku: [skuStem(title), ...c.map((v) => skuPart(v.value))].join('-').slice(0, 60),
      optionValueIds: ids,
      retailPrice: base?.retailPrice ?? 0,
      compareAtPrice: base?.compareAtPrice ?? null,
      costPrice: base?.costPrice ?? null,
      wholesaleTiers: base?.wholesaleTiers ?? [],
      wholesaleMoq: base?.wholesaleMoq ?? null,
      weightGrams: base?.weightGrams ?? null,
    };
  });
}

/* ------------------------------------------------------------ variants table */
export function VariantsTable({ variants, onChange, optionTypes, stores, currency }: { variants: VariantIn[]; onChange: (v: VariantIn[]) => void; optionTypes: OptionTypeIn[]; stores: StoreLite[]; currency: string }) {
  const [tiersFor, setTiersFor] = useState<string | null>(null);
  const [stockFor, setStockFor] = useState<string | null>(null);
  const labels = new Map(optionTypes.flatMap((o) => o.values.map((v) => [v.id ?? `new:${v.value}`, { label: v.label || v.value, hex: v.swatchHex }] as const)));
  const set = (k: string, p: Partial<VariantIn>) => onChange(variants.map((v) => (v._k === k ? { ...v, ...p } : v)));
  const total = (v: VariantIn) => v.stock.reduce((a, s) => a + (s.quantity || 0), 0);
  const tv = variants.find((v) => v._k === tiersFor);
  const sv = variants.find((v) => v._k === stockFor);

  return (
    <>
      <div className="-mx-5 overflow-x-auto">
        <table className="w-full min-w-[860px] text-[13px]">
          <thead>
            <tr className="label-caps border-y border-hairline bg-canvas text-left text-muted">
              <th className="py-2.5 pl-5 pr-2 font-semibold">Variant</th>
              <th className="px-2 py-2.5 font-semibold">SKU</th>
              <th className="px-2 py-2.5 font-semibold">Retail</th>
              <th className="px-2 py-2.5 font-semibold">Compare at</th>
              <th className="px-2 py-2.5 font-semibold">Cost</th>
              <th className="px-2 py-2.5 font-semibold">Wholesale</th>
              <th className="px-2 py-2.5 text-right font-semibold">Stock</th>
              <th className="px-2 py-2.5 font-semibold">Active</th>
              <th className="w-10 pr-5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            <AnimatePresence initial={false}>
              {variants.map((v) => {
                const opts = v.optionValueIds.map((id) => labels.get(id)).filter(Boolean) as { label: string; hex: string | null | undefined }[];
                const badCompare = v.compareAtPrice != null && v.compareAtPrice <= v.retailPrice;
                const margin = v.costPrice && v.retailPrice ? Math.round(((v.retailPrice - v.costPrice) / v.retailPrice) * 100) : null;
                return (
                  <motion.tr key={v._k} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={cn(!v.isActive && 'opacity-55')}>
                    <td className="py-2 pl-5 pr-2">
                      <div className="flex items-center gap-2">
                        {opts.find((o) => o.hex) && <span className="size-4 shrink-0 rounded-full ring-1 ring-ink/15" style={{ background: opts.find((o) => o.hex)!.hex! }} />}
                        <span className="font-semibold">{opts.length ? opts.map((o) => o.label).join(' · ') : 'Default'}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2"><Input value={v.sku} onChange={(e) => set(v._k, { sku: e.target.value.toUpperCase().replace(/\s/g, '-') })} className="h-9 w-44 font-mono text-[12px] [&_input]:h-9" aria-label="SKU" /></td>
                    <td className="px-2 py-2"><Input inputMode="numeric" value={v.retailPrice ? fmtNum(v.retailPrice) : ''} onChange={(e) => set(v._k, { retailPrice: num(e.target.value) ?? 0 })} className="h-9 w-28 tabular" aria-label="Retail price" aria-invalid={!v.retailPrice || undefined} /></td>
                    <td className="px-2 py-2">
                      <Input inputMode="numeric" value={v.compareAtPrice != null ? fmtNum(v.compareAtPrice) : ''} onChange={(e) => set(v._k, { compareAtPrice: num(e.target.value) })} placeholder="—" className="h-9 w-28 tabular" aria-label="Compare-at price" aria-invalid={badCompare || undefined} />
                      {badCompare && <div className="mt-0.5 text-[11px] text-danger">Must be above retail</div>}
                    </td>
                    <td className="px-2 py-2">
                      <Input inputMode="numeric" value={v.costPrice != null ? fmtNum(v.costPrice) : ''} onChange={(e) => set(v._k, { costPrice: num(e.target.value) })} placeholder="—" className="h-9 w-24 tabular" aria-label="Cost price" />
                      {margin != null && <div className={cn('mt-0.5 text-[11px]', margin < 20 ? 'text-warning' : 'text-muted')}>{margin}% margin</div>}
                    </td>
                    <td className="px-2 py-2">
                      <button type="button" onClick={() => setTiersFor(v._k)} className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-sm border border-hairline px-2.5 hover:border-ink/40">
                        <Layers className="size-3.5" strokeWidth={1.5} />
                        {v.wholesaleTiers.length ? `${v.wholesaleTiers.length} tiers · from ${fmtNum(Math.min(...v.wholesaleTiers.map((t) => t.unitPrice)))}` : 'Add tiers'}
                      </button>
                    </td>
                    <td className="px-2 py-2 text-right">
                      <button type="button" onClick={() => setStockFor(v._k)} className={cn('inline-flex h-9 items-center gap-1.5 rounded-sm border border-hairline px-2.5 tabular hover:border-ink/40', total(v) === 0 && 'text-danger')}>
                        <Boxes className="size-3.5" strokeWidth={1.5} /> {fmtNum(total(v))}
                      </button>
                    </td>
                    <td className="px-2 py-2"><Switch checked={v.isActive} onCheckedChange={(on) => set(v._k, { isActive: on })} label="Active" /></td>
                    <td className="pr-5">{variants.length > 1 && <Button size="icon-sm" variant="ghost" aria-label="Remove variant" onClick={() => onChange(variants.filter((x) => x._k !== v._k))}><Trash2 strokeWidth={1.5} /></Button>}</td>
                  </motion.tr>
                );
              })}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
      {tv && <TierDialog variant={tv} currency={currency} onClose={() => setTiersFor(null)} onSave={(tiers, moq, all) => onChange(variants.map((v) => (v._k === tv._k || all ? { ...v, wholesaleTiers: tiers, wholesaleMoq: moq } : v)))} multi={variants.length > 1} />}
      {sv && <StockDialog variant={sv} stores={stores} onClose={() => setStockFor(null)} onSave={(stock) => set(sv._k, { stock })} />}
    </>
  );
}

function TierDialog({ variant, currency, onClose, onSave, multi }: { variant: VariantIn; currency: string; onClose: () => void; onSave: (t: Tier[], moq: number | null, all: boolean) => void; multi: boolean }) {
  const [tiers, setTiers] = useState<Tier[]>(variant.wholesaleTiers.length ? variant.wholesaleTiers : [{ minQty: 6, unitPrice: Math.round((variant.retailPrice * 0.88) / 100) * 100 }]);
  const [moq, setMoq] = useState(variant.wholesaleMoq);
  const [all, setAll] = useState(false);
  const [qty, setQty] = useState(1);
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  const errors = sorted.map((t, i) => (t.minQty < 2 ? 'Start at 2 or more' : t.unitPrice >= variant.retailPrice ? 'Must be below retail' : i > 0 && t.unitPrice >= sorted[i - 1]!.unitPrice ? 'Must drop as quantity grows' : i > 0 && t.minQty === sorted[i - 1]!.minQty ? 'Duplicate quantity' : null));
  const ladder = [{ minQty: 1, unitPrice: variant.retailPrice }, ...sorted];
  const active = [...ladder].reverse().find((t) => qty >= t.minQty) ?? ladder[0]!;
  const next = ladder.find((t) => t.minQty > qty);
  const margin = (p: number) => (variant.costPrice ? Math.round(((p - variant.costPrice) / p) * 100) : null);
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title="Wholesale tiers" description={`Retail ${fmtMoney(variant.retailPrice, currency)} per piece. Tiers apply by quantity; the server re-prices every cart.`} size="lg"
      footer={<>
        {multi && <label className="mr-auto flex items-center gap-2 text-[13px]"><Switch checked={all} onCheckedChange={setAll} label="Apply to all variants" /> Apply to all variants</label>}
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={errors.some(Boolean)} onClick={() => { onSave(sorted, moq, all); onClose(); }}>Save tiers</Button>
      </>}>
      <div className="grid gap-6 md:grid-cols-[1fr_260px]">
        <div className="grid content-start gap-2">
          <div className="label-caps grid grid-cols-[1fr_1fr_70px_36px] gap-2 text-muted"><span>From qty</span><span>Unit price</span><span>Margin</span><span /></div>
          <AnimatePresence initial={false}>
            {tiers.map((t, i) => {
              const err = errors[sorted.indexOf(t)];
              const m = margin(t.unitPrice);
              return (
                <motion.div key={i} layout initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                  <div className="grid grid-cols-[1fr_1fr_70px_36px] items-center gap-2">
                    <Input inputMode="numeric" value={t.minQty || ''} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, minQty: num(e.target.value) ?? 0 } : x)))} aria-label="Minimum quantity" aria-invalid={!!err || undefined} trailing={<span className="pr-1 text-xs">+</span>} />
                    <Input inputMode="numeric" value={t.unitPrice ? fmtNum(t.unitPrice) : ''} onChange={(e) => setTiers(tiers.map((x, j) => (j === i ? { ...x, unitPrice: num(e.target.value) ?? 0 } : x)))} aria-label="Unit price" aria-invalid={!!err || undefined} />
                    <span className={cn('text-[13px] tabular', m != null && m < 15 ? 'text-warning' : 'text-muted')}>{m != null ? `${m}%` : '—'}</span>
                    <Button size="icon-sm" variant="ghost" aria-label="Remove tier" onClick={() => setTiers(tiers.filter((_, j) => j !== i))}><X strokeWidth={1.5} /></Button>
                  </div>
                  {err && <div className="mt-1 text-xs text-danger">{err}</div>}
                </motion.div>
              );
            })}
          </AnimatePresence>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" icon={<Plus strokeWidth={1.5} />} disabled={tiers.length >= 5} onClick={() => { const last = sorted.at(-1); setTiers([...tiers, { minQty: (last?.minQty ?? 1) * 4 || 6, unitPrice: Math.round(((last?.unitPrice ?? variant.retailPrice) * 0.9) / 100) * 100 }]); }}>Add tier</Button>
            <Tooltip content="6+ at −12%, 24+ at −22%"><Button size="sm" variant="ghost" icon={<Sparkles strokeWidth={1.5} />} onClick={() => setTiers([{ minQty: 6, unitPrice: Math.round((variant.retailPrice * 0.88) / 100) * 100 }, { minQty: 24, unitPrice: Math.round((variant.retailPrice * 0.78) / 100) * 100 }])}>Suggest</Button></Tooltip>
          </div>
          <Field label="Minimum wholesale order" optional help="Wholesale accounts must buy at least this many." className="mt-3 max-w-60">
            {(id) => <Input id={id} inputMode="numeric" value={moq ?? ''} onChange={(e) => setMoq(num(e.target.value))} placeholder="No minimum" />}
          </Field>
        </div>
        <div className="rounded-md bg-canvas p-4">
          <div className="label-caps text-muted">What the customer sees</div>
          <div className="mt-3 flex flex-wrap gap-x-2 gap-y-1 text-[13px]">
            {ladder.map((t, i) => (
              <span key={t.minQty} className={cn('rounded-xs px-1.5 py-0.5 tabular transition-colors', active === t ? 'bg-ink text-on-ink' : 'text-muted')}>
                {t.minQty}{ladder[i + 1] ? `–${ladder[i + 1]!.minQty - 1}` : '+'}: {fmtNum(t.unitPrice)}
              </span>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-2">
            <span className="text-xs text-muted">Quantity</span>
            <input type="range" min={1} max={Math.max(48, (sorted.at(-1)?.minQty ?? 24) + 12)} value={qty} onChange={(e) => setQty(+e.target.value)} className="flex-1 accent-[var(--sw-ink)]" aria-label="Preview quantity" />
            <span className="w-8 text-right text-sm font-semibold tabular">{qty}</span>
          </div>
          <div className="mt-3 font-display text-2xl tabular">{fmtMoney(active.unitPrice, currency)} <span className="font-sans text-xs text-muted">each</span></div>
          <AnimatePresence mode="wait">
            <motion.p key={next?.minQty ?? 'top'} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1 text-[13px] text-accent">
              {next ? `Add ${next.minQty - qty} more to unlock ${fmtNum(next.unitPrice)} each` : sorted.length ? 'Best price unlocked' : ''}
            </motion.p>
          </AnimatePresence>
        </div>
      </div>
    </Dialog>
  );
}

function StockDialog({ variant, stores, onClose, onSave }: { variant: VariantIn; stores: StoreLite[]; onClose: () => void; onSave: (s: VariantIn['stock']) => void }) {
  const [rows, setRows] = useState(stores.filter((s) => s.isActive).map((s) => {
    const cur = variant.stock.find((x) => x.storeId === s.id);
    return { storeId: s.id, name: s.name, quantity: cur?.quantity ?? 0, reserved: cur?.reserved ?? 0, lowStockThreshold: (cur?.lowStockThreshold ?? 3) as number | null };
  }));
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={`Stock · ${variant.sku || 'new variant'}`} description="Counted stock per location. Saved as a stock count in the inventory history." size="md"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => { onSave(rows.map(({ name, reserved, ...r }) => r)); onClose(); }}>Save stock</Button></>}>
      <div className="grid gap-2">
        <div className="label-caps grid grid-cols-[1fr_90px_90px] gap-2 text-muted"><span>Location</span><span>On hand</span><span>Alert at</span></div>
        {rows.map((r, i) => (
          <div key={r.storeId} className="grid grid-cols-[1fr_90px_90px] items-center gap-2">
            <span className="text-[13px] font-semibold">{r.name}{r.reserved > 0 && <Chip tone="neutral" className="ml-2">{r.reserved} reserved</Chip>}</span>
            <Input inputMode="numeric" value={r.quantity} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, quantity: num(e.target.value) ?? 0 } : x)))} aria-label={`On hand at ${r.name}`} />
            <Input inputMode="numeric" value={r.lowStockThreshold ?? ''} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, lowStockThreshold: num(e.target.value) } : x)))} aria-label={`Low stock alert at ${r.name}`} />
          </div>
        ))}
      </div>
    </Dialog>
  );
}
