'use client';

import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, Heart, Minus, Moon, Pause, Play, Plus, ShoppingBag, Sun } from 'lucide-react';
import { MediaImage } from '@/components/ui/media-image';
import type { Badge, Brand } from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { fmtMoney, fmtNum } from '@/lib/format';
import type { ProductForm } from './types';

/**
 * Live phone preview straight from the editor state (no save needed): the product card and the top of
 * the product page, as a retail or a wholesale customer sees them, in light or dark.
 */
export function ProductPreview({ form, brands, badges, currency }: { form: ProductForm; brands: Brand[]; badges: Badge[]; currency: string }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [who, setWho] = useState<'retail' | 'wholesale'>('retail');
  const [view, setView] = useState<'card' | 'page'>('page');
  const [qty, setQty] = useState(1);
  const [imgAt, setImgAt] = useState({ key: '', i: 0 });
  const [sel, setSel] = useState<string | null>(null);

  const colour = form.optionTypes.find((o) => o.kind === 'color' || o.kind === 'shade');
  const size = form.optionTypes.find((o) => o.kind === 'size' || o.kind === 'volume');
  const gallery = useMemo(() => {
    const all = form.media.filter((m) => m.media.type === 'IMAGE' && m.role !== 'hover');
    const linked = sel ? all.filter((m) => m.optionValueId === sel) : [];
    return linked.length ? [...linked, ...all.filter((m) => !m.optionValueId)] : all;
  }, [form.media, sel]);
  // The dot index resets whenever the colour (and so the gallery) changes.
  const galleryKey = `${sel}:${gallery.length}`;
  const img = imgAt.key === galleryKey ? imgAt.i : 0;
  const setImg = (i: number) => setImgAt({ key: galleryKey, i });
  const audio = form.media.find((m) => m.media.type === 'AUDIO');
  const v = form.variants.find((x) => x.isActive && (!sel || x.optionValueIds.includes(sel))) ?? form.variants[0];
  const retail = v?.retailPrice ?? 0;
  const tiers = [...(v?.wholesaleTiers ?? [])].sort((a, b) => a.minQty - b.minQty);
  const ladder = [{ minQty: 1, unitPrice: retail }, ...tiers];
  const showTiers = tiers.length > 0;
  const active = [...ladder].reverse().find((t) => qty >= t.minQty) ?? ladder[0]!;
  const next = ladder.find((t) => t.minQty > qty);
  const unit = who === 'wholesale' ? active.unitPrice : retail;
  const brand = brands.find((b) => b.id === form.brandId)?.name;
  const chosenBadges = badges.filter((b) => form.badgeIds.includes(b.id));
  const minBulk = tiers.length ? Math.min(...tiers.map((t) => t.unitPrice)) : null;
  const sizes = size?.values ?? [];

  return (
    <div className="flex flex-col items-center">
      <div className="mb-3 flex w-full items-center justify-between gap-2">
        <Seg value={view} onChange={setView} options={[['page', 'Page'], ['card', 'Card']]} />
        <Seg value={who} onChange={setWho} options={[['retail', 'Retail'], ['wholesale', 'Wholesale']]} />
        <button type="button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label="Toggle preview theme" className="flex size-8 items-center justify-center rounded-full border border-hairline text-muted hover:text-ink">
          {theme === 'light' ? <Moon className="size-4" strokeWidth={1.5} /> : <Sun className="size-4" strokeWidth={1.5} />}
        </button>
      </div>
      <div data-theme={theme} className="relative w-[300px] overflow-hidden rounded-[40px] border-[6px] border-black bg-canvas text-ink shadow-floating" style={{ height: 600 }}>
        <div className="absolute left-1/2 top-2 z-20 h-5 w-24 -translate-x-1/2 rounded-full bg-black" />
        <AnimatePresence mode="wait">
          {view === 'card' ? (
            <motion.div key="card" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-full overflow-hidden px-4 pt-12">
              <div className="font-display text-[22px] leading-7">New in</div>
              <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-5">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className={cn(i > 0 && 'opacity-30 grayscale')}>
                    <div className="relative">
                      <MediaImage media={i === 0 ? gallery[0]?.media : null} sizes="130px" rounded="xs" />
                      {i === 0 && <span className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-full bg-surface/85 backdrop-blur"><Heart className="size-3.5" strokeWidth={1.5} /></span>}
                    </div>
                    {i === 0 ? (
                      <>
                        {chosenBadges[0] && <span className="label-caps mt-2 inline-block text-[10px] text-accent">{chosenBadges[0].label}</span>}
                        <div className="mt-1 text-[10px] uppercase tracking-[0.08em] text-muted">{brand ?? 'Brand'}</div>
                        <div className="line-clamp-1 text-[13px]">{form.title || 'Product title'}</div>
                        <div className="mt-0.5 font-display text-[15px] tabular">{fmtMoney(who === 'wholesale' && minBulk ? minBulk : retail, currency)}</div>
                        {who === 'retail' && minBulk && <div className="text-[10px] text-muted">From {fmtMoney(minBulk, currency)} in bulk</div>}
                        {colour && colour.values.length > 0 && (
                          <div className="mt-1.5 flex gap-1">{colour.values.slice(0, 5).map((c) => <span key={c.value} className="size-2.5 rounded-full ring-1 ring-ink/15" style={{ background: c.swatchHex ?? '#ccc' }} />)}</div>
                        )}
                      </>
                    ) : (
                      <div className="mt-2 space-y-1"><div className="h-2 w-12 rounded bg-hairline" /><div className="h-2.5 w-20 rounded bg-hairline" /></div>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div key="page" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="scrollbar-none h-full overflow-y-auto pb-20">
              <div className="relative">
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div key={gallery[img]?.mediaId ?? 'none'} initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.35 }}>
                    <MediaImage media={gallery[img]?.media} sizes="300px" rounded="none" priority />
                  </motion.div>
                </AnimatePresence>
                <span className="absolute left-3 top-9 flex size-8 items-center justify-center rounded-full bg-surface/85 backdrop-blur"><ChevronLeft className="size-4" strokeWidth={1.5} /></span>
                <span className="absolute right-3 top-9 flex size-8 items-center justify-center rounded-full bg-surface/85 backdrop-blur"><Heart className="size-4" strokeWidth={1.5} /></span>
                {gallery.length > 1 && (
                  <div className="absolute inset-x-0 bottom-3 flex justify-center gap-1.5">
                    {gallery.map((g, i) => (
                      <button key={g.mediaId} type="button" onClick={() => setImg(i)} aria-label={`Image ${i + 1}`} className={cn('h-1 rounded-full bg-white/90 transition-all duration-300', i === img ? 'w-5' : 'w-1.5 opacity-60')} />
                    ))}
                  </div>
                )}
              </div>
              <div className="px-4 pt-4">
                <div className="flex flex-wrap items-center gap-1.5">
                  {chosenBadges.map((b) => <span key={b.id} className="label-caps rounded-xs border border-hairline px-1.5 py-0.5 text-[9px]">{b.label}</span>)}
                  {who === 'wholesale' && <span className="label-caps rounded-xs bg-accent px-1.5 py-0.5 text-[9px] text-on-accent">Wholesale</span>}
                </div>
                <div className="mt-2 text-[10px] uppercase tracking-[0.1em] text-muted">{brand ?? 'Brand'}</div>
                <div className="mt-1 font-display text-[22px] leading-7">{form.title || 'Product title'}</div>
                {form.tagline && <div className="mt-1 text-[12px] text-muted">{form.tagline}</div>}
                <div className="mt-3 flex items-baseline gap-2">
                  <motion.span key={unit} initial={{ opacity: 0.4, y: 3 }} animate={{ opacity: 1, y: 0 }} className="font-display text-[22px] tabular">{fmtMoney(unit, currency)}</motion.span>
                  {v?.compareAtPrice && v.compareAtPrice > retail && <span className="text-[12px] text-muted line-through tabular">{fmtNum(v.compareAtPrice)}</span>}
                </div>
                {showTiers && (
                  <div className="mt-3 rounded-md border border-hairline bg-surface p-2.5">
                    <div className="flex flex-wrap gap-x-1 gap-y-1 text-[10.5px] tabular">
                      {ladder.map((t, i) => (
                        <span key={t.minQty} className={cn('rounded-xs px-1.5 py-0.5 transition-colors duration-300', active === t ? 'bg-ink text-on-ink' : 'text-muted')}>
                          {t.minQty}{ladder[i + 1] ? `–${ladder[i + 1]!.minQty - 1}` : '+'}: {fmtNum(t.unitPrice)}
                        </span>
                      ))}
                    </div>
                    <AnimatePresence mode="wait">
                      <motion.div key={next?.minQty ?? 'top'} initial={{ opacity: 0, y: 3 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-1.5 text-[10.5px] text-accent">
                        {next ? `Add ${next.minQty - qty} more to unlock ${fmtNum(next.unitPrice)} each` : 'Best bulk price unlocked'}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                )}
                {colour && colour.values.length > 0 && (
                  <div className="mt-4">
                    <div className="text-[11px] text-muted">{colour.name}: <span className="text-ink">{colour.values.find((c) => c.id === sel)?.value ?? colour.values[0]?.value}</span></div>
                    <div className="mt-2 flex gap-2">
                      {colour.values.map((c, i) => {
                        const on = sel ? c.id === sel : i === 0;
                        return <button key={c.value} type="button" onClick={() => setSel(c.id ?? null)} aria-label={c.value} className={cn('size-7 rounded-full ring-offset-2 ring-offset-canvas transition', on ? 'ring-1 ring-ink' : '')} style={{ background: c.swatchHex ?? '#ccc' }} />;
                      })}
                    </div>
                  </div>
                )}
                {sizes.length > 0 && (
                  <div className="mt-4">
                    <div className="flex justify-between text-[11px] text-muted"><span>{size!.name}</span>{form.sizeChartId && <span className="underline">Size guide</span>}</div>
                    <div className="mt-2 flex flex-wrap gap-1.5">{sizes.map((s, i) => <span key={s.value} className={cn('flex h-8 min-w-9 items-center justify-center rounded-xs border px-2 text-[11px]', i === 1 ? 'border-ink' : 'border-hairline')}>{s.value}</span>)}</div>
                    {form.fitNote && <div className="mt-1.5 text-[10.5px] text-muted">Fit: {({ runs_small: 'Runs small — size up', true_to_size: 'True to size', runs_large: 'Runs large — size down' } as Record<string, string>)[form.fitNote] ?? form.fitNote}</div>}
                  </div>
                )}
                {audio && <AudioPill durationMs={audio.media.durationMs} peaks={audio.media.waveform} />}
                {form.descriptionHtml && <div className="prose-preview mt-4 line-clamp-4 text-[12px] leading-5 text-muted" dangerouslySetInnerHTML={{ __html: form.descriptionHtml }} />}
              </div>
              <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 border-t border-hairline bg-surface/90 px-3 py-2.5 backdrop-blur">
                <div className="flex h-10 items-center rounded-full border border-hairline">
                  <button type="button" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Less" className="flex size-9 items-center justify-center"><Minus className="size-3.5" strokeWidth={1.5} /></button>
                  <span className="w-5 text-center text-[13px] tabular">{qty}</span>
                  <button type="button" onClick={() => setQty(qty + 1)} aria-label="More" className="flex size-9 items-center justify-center"><Plus className="size-3.5" strokeWidth={1.5} /></button>
                </div>
                <span className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-ink text-[13px] font-semibold text-on-ink"><ShoppingBag className="size-4" strokeWidth={1.5} /> Add to bag · {fmtNum(unit * qty)}</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function AudioPill({ durationMs, peaks }: { durationMs: number | null; peaks: number[] | null }) {
  const [on, setOn] = useState(false);
  const bars = (peaks?.length ? peaks.filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 28)) === 0) : Array.from({ length: 28 }, (_, i) => 0.3 + 0.5 * Math.abs(Math.sin(i * 0.7)))).slice(0, 28);
  return (
    <button type="button" onClick={() => setOn(!on)} className="mt-4 flex w-full items-center gap-2.5 rounded-full border border-hairline bg-surface px-2 py-1.5 text-left">
      <span className="flex size-7 items-center justify-center rounded-full bg-ink text-on-ink">{on ? <Pause className="size-3" strokeWidth={1.5} /> : <Play className="ml-0.5 size-3" strokeWidth={1.5} />}</span>
      <span className="flex flex-1 items-center gap-[2px]">
        {bars.map((p, i) => <motion.span key={i} className="w-[2px] rounded-full bg-ink/60" animate={on ? { height: [`${p * 16}px`, `${(1 - p) * 16 + 3}px`, `${p * 16}px`] } : { height: `${Math.max(3, p * 16)}px` }} transition={on ? { duration: 0.9, repeat: Infinity, delay: i * 0.03 } : { duration: 0.2 }} />)}
      </span>
      <span className="pr-2 text-[10px] text-muted">Designer’s note · {durationMs ? `${Math.round(durationMs / 1000)}s` : '—'}</span>
    </button>
  );
}

function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <div className="relative flex rounded-full border border-hairline p-0.5 text-[12px] font-semibold">
      {options.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)} className={cn('relative z-10 rounded-full px-2.5 py-1 transition-colors', value === k ? 'text-on-ink' : 'text-muted hover:text-ink')}>
          {value === k && <motion.span layoutId={`seg-${options.map((o) => o[0]).join()}`} className="absolute inset-0 -z-10 rounded-full bg-ink" transition={{ type: 'spring', stiffness: 500, damping: 38 }} />}
          {l}
        </button>
      ))}
    </div>
  );
}
