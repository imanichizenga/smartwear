'use client';

import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ImagePlus, Music, Plus, Search, Upload, Video, X } from 'lucide-react';
import { toast } from 'sonner';
import { LoaderA } from '@/components/brand/LoaderA';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/field';
import { MediaImage } from '@/components/ui/media-image';
import { api } from '@/lib/api';
import { searchProducts, type ProductRow } from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { fmtMoney } from '@/lib/format';
import type { MediaOut } from '@/lib/types';
import { uploadFile } from '@/lib/upload';

export function useDebounced<T>(v: T, ms = 250): T {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/** Search-as-you-type product combobox. Selected products show as removable chips (order is kept). */
export function ProductPicker({ value, onChange, max = 24, placeholder = 'Search products to add', exclude = [] }: {
  value: { id: string; title: string }[];
  onChange: (v: { id: string; title: string }[]) => void;
  max?: number;
  placeholder?: string;
  exclude?: string[];
}) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounced(q);
  const res = useQuery({ queryKey: ['product-search', dq], queryFn: () => searchProducts(dq), enabled: open, staleTime: 30_000 });
  const taken = new Set([...value.map((v) => v.id), ...exclude]);
  const add = (p: ProductRow) => {
    if (value.length >= max) return toast.error(`Up to ${max} products`);
    onChange([...value, { id: p.id, title: p.title }]);
    setQ('');
  };
  return (
    <div className="relative">
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <AnimatePresence initial={false}>
            {value.map((p) => (
              <motion.span key={p.id} layout initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }} className="inline-flex h-7 items-center gap-1 rounded-sm border border-hairline bg-canvas pl-2.5 pr-1 text-[13px]">
                <span className="max-w-56 truncate">{p.title}</span>
                <button type="button" aria-label={`Remove ${p.title}`} onClick={() => onChange(value.filter((x) => x.id !== p.id))} className="inline-flex size-5 items-center justify-center rounded-full text-muted hover:bg-ink/8 hover:text-ink">
                  <X className="size-3" strokeWidth={2} />
                </button>
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      )}
      <Input leading={<Search />} value={q} placeholder={placeholder} aria-label={placeholder} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => setQ(e.target.value)} trailing={res.isFetching ? <LoaderA size="xs" /> : undefined} />
      <AnimatePresence>
        {open && (
          <motion.ul initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }} className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-sm border border-hairline bg-surface p-1 shadow-floating">
            {(res.data ?? []).filter((p) => !taken.has(p.id)).map((p) => (
              <li key={p.id}>
                <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => add(p)} className="flex w-full items-center gap-3 rounded-xs px-2 py-1.5 text-left hover:bg-ink/5">
                  <MediaImage media={p.cover} className="w-8 shrink-0" sizes="32px" rounded="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">{p.title}</span>
                    <span className="block truncate text-xs text-muted">{p.brand ?? 'No brand'} · {fmtMoney(p.minPrice, p.currency)}</span>
                  </span>
                  <Plus className="size-4 text-muted" strokeWidth={1.5} />
                </button>
              </li>
            ))}
            {res.data && res.data.filter((p) => !taken.has(p.id)).length === 0 && <li className="px-3 py-4 text-center text-[13px] text-muted">No products match</li>}
            {!res.data && <li className="flex justify-center py-4"><LoaderA size="sm" /></li>}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

type Kind = 'IMAGE' | 'VIDEO' | 'AUDIO';
const ACCEPT: Record<Kind, string> = { IMAGE: 'image/jpeg,image/png,image/webp,image/avif,image/heic', VIDEO: 'video/mp4,video/quicktime,video/webm', AUDIO: 'audio/*' };

/** Upload to S3 or pick from the media library. Resolves with the chosen media records. */
export function MediaPicker({ open, onOpenChange, onPick, kinds = ['IMAGE'], multiple = false, purpose = 'collection', title = 'Choose media' }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (m: MediaOut[]) => void;
  kinds?: Kind[];
  multiple?: boolean;
  purpose?: string;
  title?: string;
}) {
  const [sel, setSel] = useState<MediaOut[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const lib = useInfiniteQuery({
    queryKey: ['media-library', kinds.join(',')],
    enabled: open,
    queryFn: ({ pageParam }) => api<{ items: MediaOut[]; nextCursor: string | null }>('/admin/media', { query: { type: kinds.length === 1 ? kinds[0] : undefined, cursor: pageParam, limit: 40 } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const items = (lib.data?.pages.flatMap((p) => p.items) ?? []).filter((m) => kinds.includes(m.type));
  const toggle = (m: MediaOut) => setSel((s) => (s.some((x) => x.id === m.id) ? s.filter((x) => x.id !== m.id) : multiple ? [...s, m] : [m]));
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    const out: MediaOut[] = [];
    try {
      for (const [i, f] of Array.from(files).entries()) {
        out.push(await uploadFile(f, purpose, (p) => setProgress(((i + p / 100) / files.length) * 100)));
      }
      onPick(out);
      setSel([]);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setProgress(null);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => { if (!v) setSel([]); onOpenChange(v); }}
      title={title}
      description="Upload straight to storage, or reuse something from the library. Images are optimised automatically."
      size="lg"
      footer={
        <>
          <input ref={file} type="file" hidden multiple={multiple} accept={kinds.map((k) => ACCEPT[k]).join(',')} onChange={(e) => void upload(e.target.files)} />
          <Button variant="secondary" icon={<Upload strokeWidth={1.5} />} pending={progress !== null} onClick={() => file.current?.click()} className="mr-auto">
            {progress !== null ? `Uploading ${Math.round(progress)}%` : 'Upload new'}
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!sel.length} icon={<Check strokeWidth={1.5} />} onClick={() => { onPick(sel); setSel([]); onOpenChange(false); }}>
            {multiple && sel.length > 1 ? `Use ${sel.length}` : 'Use selected'}
          </Button>
        </>
      }
    >
      {lib.isPending ? (
        <div className="flex justify-center py-16"><LoaderA size="lg" /></div>
      ) : items.length === 0 ? (
        <button type="button" onClick={() => file.current?.click()} className="flex w-full flex-col items-center gap-3 rounded-md border border-dashed border-ink/20 py-16 text-muted hover:border-ink/40 hover:text-ink">
          <ImagePlus className="size-7" strokeWidth={1.25} />
          <span className="text-sm">Nothing in the library yet — upload the first file</span>
        </button>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {items.map((m) => {
              const on = sel.some((x) => x.id === m.id);
              return (
                <button key={m.id} type="button" onClick={() => toggle(m)} aria-pressed={on} className={cn('group relative overflow-hidden rounded-xs outline-offset-2 transition', on ? 'outline-2 outline-ink' : 'hover:opacity-90')}>
                  {m.type === 'IMAGE' ? (
                    <MediaImage media={m} sizes="120px" rounded="xs" />
                  ) : (
                    <div className="flex aspect-[4/5] flex-col items-center justify-center gap-2 bg-hairline text-muted">
                      {m.posterUrl ? <img src={m.posterUrl} alt="" className="absolute inset-0 size-full object-cover" /> : m.type === 'VIDEO' ? <Video className="size-6" strokeWidth={1.25} /> : <Music className="size-6" strokeWidth={1.25} />}
                      {m.durationMs && <span className="relative rounded-xs bg-surface/90 px-1.5 text-[11px] font-semibold tabular text-ink">{Math.round(m.durationMs / 1000)}s</span>}
                    </div>
                  )}
                  <AnimatePresence>
                    {on && (
                      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-ink text-on-ink">
                        <Check className="size-3.5" strokeWidth={2.5} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                </button>
              );
            })}
          </div>
          {lib.hasNextPage && (
            <div className="mt-4 flex justify-center">
              <Button variant="ghost" pending={lib.isFetchingNextPage} onClick={() => void lib.fetchNextPage()}>Load more</Button>
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}

/** A single media slot (cover/hero/banner) with replace + clear. */
export function MediaSlot({ media, onChange, kinds = ['IMAGE'], ratio = '4 / 5', label = 'Choose image', purpose, className }: {
  media: MediaOut | null;
  onChange: (m: MediaOut | null) => void;
  kinds?: Kind[];
  ratio?: string;
  label?: string;
  purpose?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn('relative', className)}>
      {media ? (
        <div className="group relative">
          {media.type === 'IMAGE' ? <MediaImage media={media} ratio={ratio} sizes="240px" /> : (
            <div className="relative flex items-center justify-center overflow-hidden rounded-sm bg-ink/90 text-on-ink" style={{ aspectRatio: ratio }}>
              {media.posterUrl && <img src={media.posterUrl} alt="" className="absolute inset-0 size-full object-cover opacity-80" />}
              <Video className="relative size-6" strokeWidth={1.25} />
            </div>
          )}
          <div className="absolute inset-x-2 bottom-2 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            <Button size="sm" variant="secondary" onClick={() => setOpen(true)} className="flex-1">Replace</Button>
            <Button size="icon-sm" variant="secondary" aria-label="Remove" onClick={() => onChange(null)}><X strokeWidth={1.5} /></Button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(true)} style={{ aspectRatio: ratio }} className="flex w-full flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-ink/20 text-[13px] text-muted transition-colors hover:border-ink/45 hover:text-ink">
          <ImagePlus className="size-5" strokeWidth={1.25} />
          {label}
        </button>
      )}
      <MediaPicker open={open} onOpenChange={setOpen} kinds={kinds} purpose={purpose} onPick={(m) => m[0] && onChange(m[0])} />
    </div>
  );
}
