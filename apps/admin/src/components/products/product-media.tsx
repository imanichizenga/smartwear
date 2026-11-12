'use client';

import { useEffect, useRef, useState, type DragEvent } from 'react';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { AnimatePresence, motion } from 'motion/react';
import { Crosshair, GripVertical, ImagePlus, Library, Mic, Pause, Play, RotateCw, Square, Star, Trash2, Upload, Video, Wand2 } from 'lucide-react';
import { toast } from 'sonner';
import { LoaderA } from '@/components/brand/LoaderA';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { MediaImage } from '@/components/ui/media-image';
import { MediaPicker } from '@/components/ui/pickers';
import { Chip, Switch, Tooltip } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { MediaOut } from '@/lib/types';
import { uploadFile } from '@/lib/upload';
import type { OptionTypeIn, ProductMediaIn } from './types';

/** Polls media that is still being processed by the worker and swaps in the READY record. */
export function useMediaProcessing(media: ProductMediaIn[], onUpdate: (m: MediaOut) => void) {
  const pending = media.filter((m) => m.media.status === 'PROCESSING' || m.media.status === 'UPLOADED').map((m) => m.mediaId).join(',');
  const cb = useRef(onUpdate);
  useEffect(() => {
    cb.current = onUpdate;
  });
  useEffect(() => {
    if (!pending) return;
    const ids = pending.split(',');
    const t = setInterval(async () => {
      for (const id of ids) {
        try {
          const m = await api<MediaOut>(`/media/${id}`);
          if (m.status === 'READY' || m.status === 'FAILED') cb.current(m);
        } catch {
          /* keep polling */
        }
      }
    }, 2500);
    return () => clearInterval(t);
  }, [pending]);
}

interface Uploading { key: string; name: string; pct: number; kind: string }

export function ProductMediaManager({ media, onChange, optionTypes }: { media: ProductMediaIn[]; onChange: (m: ProductMediaIn[]) => void; optionTypes: OptionTypeIn[] }) {
  const visual = media.filter((m) => m.media.type !== 'AUDIO');
  const audio = media.filter((m) => m.media.type === 'AUDIO');
  const [uploads, setUploads] = useState<Uploading[]>([]);
  const [drag, setDrag] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [recorder, setRecorder] = useState<'audio' | 'video' | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(media);
  useEffect(() => {
    latest.current = media;
  });
  const colourType = optionTypes.find((o) => o.kind === 'color' || o.kind === 'shade');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  useMediaProcessing(media, (m) => onChange(latest.current.map((x) => (x.mediaId === m.id ? { ...x, media: m } : x))));

  const add = (list: MediaOut[], role?: string) => {
    const existing = new Set(latest.current.map((m) => m.mediaId));
    const next = list.filter((m) => !existing.has(m.id)).map((m, i) => ({ mediaId: m.id, media: m, sortOrder: latest.current.length + i, alt: m.alt, optionValueId: null, role: role ?? (m.type === 'VIDEO' ? 'video' : m.type === 'AUDIO' ? 'designer_note' : 'gallery') }));
    onChange([...latest.current, ...next]);
  };
  const upload = async (files: File[], role?: string) => {
    for (const f of files) {
      const key = `${f.name}-${f.size}-${Date.now()}`;
      setUploads((u) => [...u, { key, name: f.name, pct: 0, kind: f.type.split('/')[0] ?? 'file' }]);
      try {
        const trim = (f as File & { trim?: [number, number] }).trim;
        const m = await uploadFile(f, 'product', (pct) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, pct } : x))), trim ? { trim: { startMs: trim[0], endMs: trim[1] } } : undefined);
        add([m], role);
      } catch (e) {
        toast.error(`${f.name}: ${e instanceof Error ? e.message : 'upload failed'}`);
      } finally {
        setUploads((u) => u.filter((x) => x.key !== key));
      }
    }
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void upload(Array.from(e.dataTransfer.files).filter((f) => /^(image|video|audio)\//.test(f.type)));
  };
  const onSort = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const from = visual.findIndex((m) => m.mediaId === active.id);
    const to = visual.findIndex((m) => m.mediaId === over.id);
    onChange([...arrayMove(visual, from, to), ...audio]);
  };
  const patch = (id: string, p: Partial<ProductMediaIn>) => onChange(media.map((m) => (m.mediaId === id ? { ...m, ...p } : m)));
  const remove = (id: string) => onChange(media.filter((m) => m.mediaId !== id));
  const makeCover = (id: string) => {
    const item = visual.find((m) => m.mediaId === id)!;
    onChange([{ ...item, role: 'gallery' }, ...visual.filter((m) => m.mediaId !== id), ...audio]);
  };
  const edit = media.find((m) => m.mediaId === editing) ?? null;

  return (
    <div className="grid gap-6">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn('rounded-md transition-colors', drag && 'bg-accent-soft/50 outline-2 outline-dashed outline-accent')}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onSort}>
          <SortableContext items={visual.map((m) => m.mediaId)} strategy={rectSortingStrategy}>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 xl:grid-cols-5">
              {visual.map((m, i) => (
                <MediaTile key={m.mediaId} item={m} cover={i === 0} onEdit={() => setEditing(m.mediaId)} onCover={() => makeCover(m.mediaId)} onRemove={() => remove(m.mediaId)} />
              ))}
              {uploads.filter((u) => u.kind !== 'audio').map((u) => (
                <div key={u.key} className="relative flex aspect-[4/5] flex-col items-center justify-center gap-3 overflow-hidden rounded-sm bg-hairline">
                  <LoaderA size="md" />
                  <span className="max-w-[85%] truncate text-[11px] text-muted">{u.name}</span>
                  <motion.span className="absolute inset-x-0 bottom-0 h-1 bg-ink" initial={{ width: 0 }} animate={{ width: `${u.pct}%` }} />
                </div>
              ))}
              <button type="button" onClick={() => input.current?.click()} className="flex aspect-[4/5] flex-col items-center justify-center gap-2 rounded-sm border border-dashed border-ink/20 px-2 text-center text-[12px] text-muted transition-colors hover:border-ink/45 hover:text-ink">
                <ImagePlus className="size-6" strokeWidth={1.25} />
                Drop photos & videos
                <span className="text-[11px] text-subtle">or click to browse</span>
              </button>
            </div>
          </SortableContext>
        </DndContext>
        <input ref={input} type="file" hidden multiple accept="image/*,video/mp4,video/quicktime,video/webm" onChange={(e) => { void upload(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" icon={<Library strokeWidth={1.5} />} onClick={() => setLibOpen(true)}>From library</Button>
        <Button size="sm" variant="secondary" icon={<Video strokeWidth={1.5} />} onClick={() => setRecorder('video')}>Record video</Button>
        <span className="ml-auto self-center text-xs text-muted">Drag to reorder · first image is the cover · 4:5 portrait looks best</span>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-[13px] font-semibold">Designer’s note & product story</div>
            <p className="text-xs text-muted">A short voice note plays on the product page. Recorded with noise suppression and normalised loudness.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="premium" icon={<Mic strokeWidth={1.5} />} onClick={() => setRecorder('audio')}>Record</Button>
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-sm border border-ink/18 bg-surface px-3 text-[13px] font-semibold hover:border-ink/40">
              <Upload className="size-4" strokeWidth={1.5} /> Upload
              <input type="file" hidden accept="audio/*" onChange={(e) => { void upload(Array.from(e.target.files ?? []), 'designer_note'); e.target.value = ''; }} />
            </label>
          </div>
        </div>
        <div className="grid gap-2">
          <AnimatePresence initial={false}>
            {audio.map((a) => (
              <motion.div key={a.mediaId} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
                <AudioRow item={a} onRole={(role) => patch(a.mediaId, { role })} onRemove={() => remove(a.mediaId)} />
              </motion.div>
            ))}
          </AnimatePresence>
          {uploads.filter((u) => u.kind === 'audio').map((u) => (
            <div key={u.key} className="flex items-center gap-3 rounded-sm border border-hairline px-3 py-3 text-[13px] text-muted"><LoaderA size="sm" /> Uploading {u.name} · {Math.round(u.pct)}%</div>
          ))}
          {audio.length === 0 && !uploads.some((u) => u.kind === 'audio') && <p className="rounded-sm bg-canvas px-4 py-3 text-[13px] text-muted">No voice note yet. Thirty seconds about the fabric or the inspiration goes a long way.</p>}
        </div>
      </div>

      <MediaPicker open={libOpen} onOpenChange={setLibOpen} kinds={['IMAGE', 'VIDEO', 'AUDIO']} multiple purpose="product" onPick={(m) => add(m)} />
      {edit && <MediaEditDialog item={edit} colourType={colourType} onClose={() => setEditing(null)} onChange={(p) => patch(edit.mediaId, p)} />}
      <Recorder mode={recorder} onClose={() => setRecorder(null)} onDone={(f, role) => void upload([f], role)} />
    </div>
  );
}

function MediaTile({ item, cover, onEdit, onCover, onRemove }: { item: ProductMediaIn; cover: boolean; onEdit: () => void; onCover: () => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.mediaId });
  const m = item.media;
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn('group relative', isDragging && 'z-10 scale-[1.03] opacity-90 shadow-floating')}>
      <button type="button" onClick={onEdit} className="block w-full" aria-label="Edit media details">
        {m.type === 'IMAGE' ? (
          <MediaImage media={m} sizes="180px" />
        ) : (
          <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-sm bg-ink">
            {m.posterUrl && <img src={m.posterUrl} alt="" className="absolute inset-0 size-full object-cover" />}
            {m.status !== 'READY' ? <LoaderA size="md" /> : <Play className="relative size-7 text-white drop-shadow" strokeWidth={1.25} />}
          </div>
        )}
      </button>
      {m.status === 'PROCESSING' && <span className="absolute inset-x-2 top-2 rounded-xs bg-surface/90 px-1.5 py-0.5 text-center text-[11px] font-semibold text-muted backdrop-blur">Optimising…</span>}
      {m.status === 'FAILED' && <span className="absolute inset-x-2 top-2 rounded-xs bg-danger px-1.5 py-0.5 text-center text-[11px] font-semibold text-white">Processing failed</span>}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-1 p-1.5">
        {cover ? <Chip tone="ink" className="pointer-events-auto">Cover</Chip> : item.role === 'hover' ? <Chip tone="neutral" className="bg-surface/90">Hover</Chip> : <span />}
        {!item.alt && m.type === 'IMAGE' && <span className="size-2 rounded-full bg-warning ring-2 ring-surface" title="Missing alt text" />}
      </div>
      <div className="absolute right-1.5 top-1.5 flex flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        <button type="button" {...attributes} {...listeners} aria-label="Drag to reorder" className="flex size-7 cursor-grab items-center justify-center rounded-full bg-surface/95 shadow-sm active:cursor-grabbing"><GripVertical className="size-3.5" strokeWidth={1.5} /></button>
        {!cover && m.type === 'IMAGE' && <Tooltip content="Make cover" side="left"><button type="button" onClick={onCover} aria-label="Make cover" className="flex size-7 items-center justify-center rounded-full bg-surface/95 shadow-sm"><Star className="size-3.5" strokeWidth={1.5} /></button></Tooltip>}
        <button type="button" onClick={onRemove} aria-label="Remove" className="flex size-7 items-center justify-center rounded-full bg-surface/95 text-danger shadow-sm"><Trash2 className="size-3.5" strokeWidth={1.5} /></button>
      </div>
    </div>
  );
}

function MediaEditDialog({ item, colourType, onClose, onChange }: { item: ProductMediaIn; colourType?: OptionTypeIn; onClose: () => void; onChange: (p: Partial<ProductMediaIn>) => void }) {
  const m = item.media;
  const [alt, setAlt] = useState(item.alt ?? '');
  const [focal, setFocal] = useState({ x: m.focalX, y: m.focalY });
  const [poster, setPoster] = useState(0);
  const [cleanup, setCleanup] = useState(false);
  const [enhance, setEnhance] = useState<string | null>(null);
  const [rotate, setRotate] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    api<{ options?: { rotate?: number; backgroundCleanup?: boolean } }>(`/media/${m.id}`).then((d) => { setRotate(d.options?.rotate ?? 0); setCleanup(!!d.options?.backgroundCleanup); }).catch(() => undefined);
  }, [m.id]);
  const save = async (body: Record<string, unknown>, msg: string) => {
    try {
      const next = await api<MediaOut>(`/media/${m.id}`, { method: 'PATCH', body });
      onChange({ media: next });
      toast.success(msg);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not update');
    }
  };
  const previewEnhance = async () => {
    try {
      const r = await api<{ before: string; after: string }>(`/media/${m.id}/enhance-preview`, { method: 'POST' });
      setEnhance(r.after);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Enhance preview unavailable');
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={m.type === 'VIDEO' ? 'Video' : 'Photo'} description={m.width ? `${m.width}×${m.height}${m.durationMs ? ` · ${(m.durationMs / 1000).toFixed(1)}s` : ''}` : undefined} size="lg"
      footer={<><Button variant="ghost" onClick={onClose}>Close</Button><Button onClick={() => { onChange({ alt: alt || null }); onClose(); }}>Done</Button></>}>
      <div className="grid gap-6 sm:grid-cols-[minmax(0,260px)_1fr]">
        <div>
          {m.type === 'IMAGE' ? (
            <div
              className="relative cursor-crosshair"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setFocal({ x: +((e.clientX - r.left) / r.width).toFixed(3), y: +((e.clientY - r.top) / r.height).toFixed(3) });
              }}
            >
              {enhance ? <img src={enhance} alt="Enhanced preview" className="aspect-[4/5] w-full rounded-sm object-cover" /> : <MediaImage media={m} ratio={`${m.width ?? 4} / ${m.height ?? 5}`} sizes="260px" priority />}
              <motion.span className="pointer-events-none absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" animate={{ left: `${focal.x * 100}%`, top: `${focal.y * 100}%` }} transition={{ type: 'spring', stiffness: 500, damping: 35 }} />
            </div>
          ) : (
            <video ref={video} src={m.sources?.mp4?.[0]?.url ?? m.url} poster={m.posterUrl ?? undefined} controls muted className="aspect-[4/5] w-full rounded-sm bg-ink object-cover" onTimeUpdate={(e) => setPoster(Math.round(e.currentTarget.currentTime * 1000))} />
          )}
          {m.type === 'IMAGE' && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted"><Crosshair className="size-3.5" strokeWidth={1.5} /> Click the subject to set the focal point for 4:5 crops.</p>}
        </div>
        <div className="grid content-start gap-4">
          <Field label="Alt text" help="Describe the piece for screen readers: colour, cut, how it’s worn.">
            {(id) => <Input id={id} value={alt} maxLength={200} onChange={(e) => setAlt(e.target.value)} placeholder="Ivory linen wrap dress, worn with flat sandals" />}
          </Field>
          {m.type === 'IMAGE' && (
            <Field label="Use as">
              {(id) => (
                <Select id={id} value={item.role} onChange={(e) => onChange({ role: e.target.value })}>
                  <option value="gallery">Gallery image</option>
                  <option value="hover">Hover image (shown when a card is pressed)</option>
                </Select>
              )}
            </Field>
          )}
          {colourType && (
            <Field label={`Show for ${colourType.name.toLowerCase()}`} help="Selecting this option in the app switches the gallery to its photos.">
              {(id) => (
                <Select id={id} value={item.optionValueId ?? ''} onChange={(e) => onChange({ optionValueId: e.target.value || null })}>
                  <option value="">Every {colourType.name.toLowerCase()}</option>
                  {colourType.values.filter((v) => v.id).map((v) => <option key={v.id} value={v.id}>{v.label || v.value}</option>)}
                </Select>
              )}
            </Field>
          )}
          <div className="flex flex-wrap gap-2">
            {m.type === 'IMAGE' && (
              <>
                <ActionButton size="sm" variant="secondary" icon={<Crosshair strokeWidth={1.5} />} disabled={focal.x === m.focalX && focal.y === m.focalY} onAction={() => save({ focalX: focal.x, focalY: focal.y }, 'Focal point saved — re-cropping')}>Save focal point</ActionButton>
                <ActionButton size="sm" variant="secondary" icon={<RotateCw strokeWidth={1.5} />} onAction={async () => { const r = (rotate + 90) % 360; await save({ rotate: r }, 'Rotating'); setRotate(r); }}>Rotate 90°</ActionButton>
                <ActionButton size="sm" variant="secondary" icon={<Wand2 strokeWidth={1.5} />} onAction={previewEnhance}>Preview auto-enhance</ActionButton>
                {enhance && <ActionButton size="sm" onAction={async () => { await save({ autoEnhance: true }, 'Enhancing'); setEnhance(null); }}>Apply enhance</ActionButton>}
              </>
            )}
            {m.type === 'VIDEO' && <ActionButton size="sm" variant="secondary" onAction={() => save({ posterAtMs: poster }, 'Poster frame updated')}>Use current frame as poster ({(poster / 1000).toFixed(1)}s)</ActionButton>}
          </div>
          {m.type === 'IMAGE' && (
            <label className="flex items-center justify-between gap-3 rounded-sm border border-hairline px-3 py-2.5 text-[13px]">
              <span><b className="font-semibold">Studio background</b><span className="block text-xs text-muted">Removes the background and places the piece on a clean studio backdrop (uses the clean-up provider in Settings → Media).</span></span>
              <Switch checked={cleanup} onCheckedChange={(v) => { setCleanup(v); void save({ backgroundCleanup: v }, v ? 'Cleaning background' : 'Restoring original'); }} label="Studio background" />
            </label>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function Waveform({ peaks, progress = 0, className }: { peaks: number[]; progress?: number; className?: string }) {
  const bars = peaks.length ? peaks : Array.from({ length: 48 }, () => 0.15);
  return (
    <div className={cn('flex h-8 items-center gap-[2px]', className)} aria-hidden>
      {bars.map((p, i) => (
        <span key={i} className={cn('w-[3px] rounded-full transition-colors', i / bars.length <= progress ? 'bg-ink' : 'bg-ink/20')} style={{ height: `${Math.max(10, Math.min(100, p * 100))}%` }} />
      ))}
    </div>
  );
}

function AudioRow({ item, onRole, onRemove }: { item: ProductMediaIn; onRole: (r: string) => void; onRemove: () => void }) {
  const el = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const m = item.media;
  const src = m.sources?.mp4?.[0]?.url ?? m.url;
  const peaks = (m.waveform ?? []).filter((_, i, a) => i % Math.max(1, Math.ceil(a.length / 64)) === 0);
  return (
    <div className="flex items-center gap-3 rounded-sm border border-hairline bg-surface px-3 py-2.5">
      <button type="button" disabled={m.status !== 'READY'} onClick={() => (playing ? el.current?.pause() : void el.current?.play())} aria-label={playing ? 'Pause' : 'Play'} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-ink text-on-ink disabled:bg-ink/30">
        {m.status !== 'READY' ? <LoaderA size="xs" /> : playing ? <Pause className="size-4" strokeWidth={1.5} /> : <Play className="ml-0.5 size-4" strokeWidth={1.5} />}
      </button>
      <div className="min-w-0 flex-1">
        <Waveform peaks={peaks} progress={m.durationMs ? t / m.durationMs : 0} />
        <div className="mt-0.5 text-[11px] text-muted tabular">{m.status === 'READY' ? `${fmtSecs(t)} / ${fmtSecs(m.durationMs ?? 0)}` : 'Normalising loudness…'}</div>
      </div>
      <Select value={item.role} onChange={(e) => onRole(e.target.value)} className="w-40" aria-label="Audio role">
        <option value="designer_note">Designer’s note</option>
        <option value="story">Product story</option>
      </Select>
      <Button size="icon-sm" variant="ghost" aria-label="Remove audio" onClick={onRemove}><Trash2 strokeWidth={1.5} /></Button>
      <audio ref={el} src={src} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setT(0); }} onTimeUpdate={(e) => setT(e.currentTarget.currentTime * 1000)} />
    </div>
  );
}

const fmtSecs = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;

/**
 * In-browser recorder. Audio: noise suppression, echo cancellation and auto gain, live level meter,
 * playback and trim before upload (the trim is applied server-side by ffmpeg). Video: webcam capture.
 */
function Recorder({ mode, onClose: close, onDone }: { mode: 'audio' | 'video' | null; onClose: () => void; onDone: (f: File, role?: string) => void }) {
  const [state, setState] = useState<'idle' | 'recording' | 'review' | 'denied'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [trim, setTrim] = useState<[number, number]>([0, 0]);
  const [role, setRole] = useState('designer_note');
  const stream = useRef<MediaStream | null>(null);
  const rec = useRef<MediaRecorder | null>(null);
  const live = useRef<HTMLVideoElement>(null);
  const raf = useRef<number>(0);
  const started = useRef(0);
  const url = blob ? URL.createObjectURL(blob) : null;

  const stopAll = () => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  const onClose = () => {
    if (rec.current?.state === 'recording') { rec.current.onstop = null; rec.current.stop(); }
    stopAll();
    setState('idle'); setBlob(null); setLevels([]); setElapsed(0);
    close();
  };
  useEffect(() => () => stopAll(), []);
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  const start = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: true, echoCancellation: true, autoGainControl: true, channelCount: 1 },
        video: mode === 'video' ? { width: { ideal: 1080 }, height: { ideal: 1350 }, facingMode: 'user' } : false,
      });
      stream.current = s;
      if (mode === 'video' && live.current) { live.current.srcObject = s; void live.current.play(); }
      const mime = mode === 'video'
        ? ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t))
        : ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t));
      const r = new MediaRecorder(s, mime ? { mimeType: mime, audioBitsPerSecond: 128_000 } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      r.onstop = () => {
        const b = new Blob(chunks, { type: r.mimeType || (mode === 'video' ? 'video/webm' : 'audio/webm') });
        setBlob(b);
        const dur = Date.now() - started.current;
        setTrim([0, dur]);
        setState('review');
        stopAll();
      };
      // Level meter
      const ctx = new AudioContext();
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      ctx.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.fftSize);
      let last = 0;
      const tick = (ts: number) => {
        an.getByteTimeDomainData(buf);
        let peak = 0;
        for (const v of buf) peak = Math.max(peak, Math.abs(v - 128) / 128);
        if (ts - last > 80) {
          last = ts;
          setLevels((l) => [...l.slice(-63), Math.min(1, peak * 1.6)]);
          setElapsed(Date.now() - started.current);
        }
        raf.current = requestAnimationFrame(tick);
      };
      started.current = Date.now();
      r.start(250);
      rec.current = r;
      setState('recording');
      raf.current = requestAnimationFrame(tick);
    } catch {
      setState('denied');
    }
  };
  const stop = () => rec.current?.state === 'recording' && rec.current.stop();
  const attach = () => {
    if (!blob) return;
    const ext = blob.type.includes('mp4') ? (mode === 'video' ? 'mp4' : 'm4a') : 'webm';
    const f = new File([blob], `${mode === 'video' ? 'video' : 'designer-note'}-${Date.now()}.${ext}`, { type: blob.type.split(';')[0] });
    // Only send a trim when the admin actually moved the handles.
    if (trim[0] > 0 || trim[1] < elapsed - 200) (f as File & { trim?: [number, number] }).trim = trim;
    onDone(f, mode === 'audio' ? role : undefined);
    onClose();
  };
  const dur = trim[1] || elapsed;

  return (
    <Dialog open={!!mode} onOpenChange={(v) => !v && onClose()} title={mode === 'video' ? 'Record video' : 'Record a designer’s note'} description={mode === 'video' ? 'Hold the phone or camera portrait. Short loops autoplay muted in the feed.' : 'Speak close to the mic. Background noise is reduced and loudness normalised automatically.'}
      footer={state === 'review' ? (
        <><Button variant="ghost" onClick={() => { setBlob(null); setState('idle'); setLevels([]); }}>Re-record</Button><Button icon={<Upload strokeWidth={1.5} />} onClick={attach}>Attach to product</Button></>
      ) : <Button variant="ghost" onClick={onClose}>Cancel</Button>}>
      <div className="flex flex-col items-center gap-5 py-2">
        {mode === 'video' && state !== 'review' && <video ref={live} muted playsInline className="aspect-[4/5] w-56 rounded-sm bg-ink object-cover" />}
        {state === 'review' && url && (mode === 'video' ? <video src={url} controls className="aspect-[4/5] w-56 rounded-sm bg-ink object-cover" /> : <audio src={url} controls className="w-full" />)}
        {mode === 'audio' && state !== 'review' && (
          <div className="flex h-20 w-full items-center justify-center gap-[3px] rounded-md bg-canvas px-4">
            {(levels.length ? levels : Array.from({ length: 64 }, () => 0.05)).map((l, i) => (
              <motion.span key={i} className="w-[3px] rounded-full bg-ink" animate={{ height: `${Math.max(6, l * 100)}%`, opacity: state === 'recording' ? 1 : 0.25 }} transition={{ duration: 0.08 }} />
            ))}
          </div>
        )}
        {state !== 'review' && <div className="font-display text-4xl tabular">{fmtSecs(elapsed)}</div>}
        {state === 'idle' && (
          <button type="button" onClick={() => void start()} aria-label="Start recording" className="relative flex size-16 items-center justify-center rounded-full bg-danger text-white shadow-floating transition-transform hover:scale-105">
            {mode === 'video' ? <Video className="size-6" strokeWidth={1.5} /> : <Mic className="size-6" strokeWidth={1.5} />}
          </button>
        )}
        {state === 'recording' && (
          <button type="button" onClick={stop} aria-label="Stop recording" className="relative flex size-16 items-center justify-center rounded-full bg-ink text-on-ink">
            <motion.span className="absolute inset-0 rounded-full border-2 border-danger" animate={{ scale: [1, 1.25], opacity: [0.8, 0] }} transition={{ duration: 1.2, repeat: Infinity }} />
            <Square className="size-5 fill-current" strokeWidth={0} />
          </button>
        )}
        {state === 'denied' && <p className="text-center text-sm text-danger">The browser blocked the {mode === 'video' ? 'camera' : 'microphone'}. Allow access in the address bar and try again.</p>}
        {state === 'review' && (
          <div className="grid w-full gap-4">
            <Field label={`Trim · keeps ${fmtSecs(trim[0])} – ${fmtSecs(trim[1])}`} help="Cut silence at the start and end. Applied when the file is processed.">
              {() => (
                <div className="grid grid-cols-2 gap-3">
                  <input type="range" min={0} max={dur} step={100} value={trim[0]} onChange={(e) => setTrim([Math.min(+e.target.value, trim[1] - 500), trim[1]])} aria-label="Trim start" className="accent-[var(--sw-ink)]" />
                  <input type="range" min={0} max={dur} step={100} value={trim[1]} onChange={(e) => setTrim([trim[0], Math.max(+e.target.value, trim[0] + 500)])} aria-label="Trim end" className="accent-[var(--sw-ink)]" />
                </div>
              )}
            </Field>
            {mode === 'audio' && (
              <Field label="Plays as">
                {(id) => (
                  <Select id={id} value={role} onChange={(e) => setRole(e.target.value)}>
                    <option value="designer_note">Designer’s note</option>
                    <option value="story">Product story</option>
                  </Select>
                )}
              </Field>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
