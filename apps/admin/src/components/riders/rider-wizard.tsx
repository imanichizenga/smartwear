'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, ArrowRight, Bike, Camera, Car, Check, FileUp, Footprints, ImageUp, MessageSquareText, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import { toast } from 'sonner';
import { LoaderA } from '@/components/brand/LoaderA';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton, Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Card, Switch } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { MediaOut } from '@/lib/types';
import type { RiderAdmin, Zone } from '@/lib/ops';
import { uploadFile } from '@/lib/upload';

const STEPS = ['Identity', 'Documents', 'Vehicle', 'Assignment'] as const;
const VEHICLE_CARDS = [
  { key: 'MOTORBIKE', label: 'Motorbike', icon: Bike, hint: 'Bodaboda — fastest in traffic' },
  { key: 'BICYCLE', label: 'Bicycle', icon: Bike, hint: 'Short hops, no plate' },
  { key: 'CAR', label: 'Car', icon: Car, hint: 'Bulky or wholesale orders' },
  { key: 'ON_FOOT', label: 'On foot', icon: Footprints, hint: 'Malls and markets' },
] as const;
const DOC_KINDS = [
  { key: 'national_id', label: 'National ID (NIDA)' },
  { key: 'licence', label: 'Driving licence' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'vehicle_registration', label: 'Vehicle registration' },
] as const;

interface Doc {
  kind: string;
  media: MediaOut;
  number: string;
  expiresAt: string;
}
const EMPTY: Form = {
  phone: '', name: '', photo: null, nationalId: '', licenceNumber: '', documents: [],
  vehicle: { type: 'MOTORBIKE', plate: '', color: '', make: '' }, zoneId: '', homeStoreId: '',
  payout: { method: 'mobile_money', provider: 'mpesa', account: '', name: '' }, approve: true, sendInvite: true,
};
interface Form {
  phone: string;
  name: string;
  photo: MediaOut | null;
  nationalId: string;
  licenceNumber: string;
  documents: Doc[];
  vehicle: { type: string; plate: string; color: string; make: string };
  zoneId: string;
  homeStoreId: string;
  payout: { method: string; provider: string; account: string; name: string };
  approve: boolean;
  sendInvite: boolean;
}

export function RiderWizard() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<(RiderAdmin & { invite: { sent: boolean; reason?: string | null; message?: string } }) | null>(null);
  const [f, setF] = useState<Form>(EMPTY);
  const zones = useQuery({ queryKey: ['zones'], queryFn: () => api<{ items: Zone[] }>('/admin/zones') });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api<{ items: { id: string; name: string; area: string | null }[] }>('/admin/stores') });
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((x) => ({ ...x, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  const validate = (s: number) => {
    const e: Record<string, string> = {};
    if (s === 0) {
      if (f.phone.replace(/\D/g, '').length < 9) e.phone = 'Enter the rider’s mobile number';
      if (!f.name.trim()) e.name = 'Enter their full name';
    }
    if (s === 1 && f.nationalId && f.nationalId.replace(/\D/g, '').length !== 20) e.nationalId = 'NIDA numbers have 20 digits';
    if (s === 2 && ['MOTORBIKE', 'CAR'].includes(f.vehicle.type) && !f.vehicle.plate.trim()) e['vehicle.plate'] = 'Plate number is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };
  const go = (to: number) => {
    if (to > step && !validate(step)) return;
    setDir(to > step ? 1 : -1);
    setStep(to);
  };
  const submit = async () => {
    if (!validate(step)) return;
    try {
      const phone = f.phone.trim().startsWith('+') ? f.phone : `+255${f.phone.replace(/\D/g, '').replace(/^0/, '')}`;
      const r = await api<RiderAdmin & { invite: { sent: boolean; reason?: string | null; message?: string } }>('/admin/riders', {
        body: {
          phone, name: f.name.trim(), photoMediaId: f.photo?.id, nationalId: f.nationalId, licenceNumber: f.licenceNumber,
          documents: f.documents.map((d) => ({ kind: d.kind, mediaId: d.media.id, number: d.number, expiresAt: d.expiresAt || null })),
          vehicle: f.vehicle, zoneId: f.zoneId || null, homeStoreId: f.homeStoreId || null,
          payout: f.payout.account ? f.payout : null, approve: f.approve, sendInvite: f.sendInvite,
        },
      });
      setDone(r);
    } catch (e) {
      if (e instanceof ApiError) {
        const field = e.field;
        const s = typeof e.details.step === 'number' ? e.details.step - 1 : null;
        if (field) setErrors({ [field]: e.message });
        if (s != null && s !== step) {
          setDir(-1);
          setStep(s);
        }
        toast.error(e.message);
      } else toast.error('Could not register the rider');
    }
  };

  if (done) return <Done r={done} onAnother={() => { setDone(null); setF(EMPTY); setStep(0); router.refresh(); }} />;

  return (
    <div className="mx-auto max-w-3xl">
      <AppLink href="/riders" icon={<ArrowLeft strokeWidth={1.5} />} className="mb-5 text-[13px] font-semibold text-muted hover:text-ink">Riders</AppLink>
      <h1 className="text-[32px] leading-10 md:text-4xl md:leading-[44px]">Register a rider</h1>
      <p className="mt-2 text-sm text-muted">Four short steps. When you finish, the rider gets an SMS with the app link and signs in with this phone number.</p>

      <ol className="mt-8 grid grid-cols-4 gap-2" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" onClick={() => i < step && go(i)} disabled={i > step} className="group flex w-full flex-col gap-2 text-left disabled:cursor-default">
              <span className="h-1 overflow-hidden rounded-full bg-hairline">
                <motion.span className="block h-full bg-ink" initial={false} animate={{ width: i <= step ? '100%' : '0%' }} transition={{ duration: 0.45, ease: [0.22, 0.61, 0.36, 1] }} />
              </span>
              <span className={cn('flex items-center gap-1.5 text-[12.5px] font-semibold', i === step ? 'text-ink' : i < step ? 'text-muted group-hover:text-ink' : 'text-subtle')}>
                {i < step ? <Check className="size-3.5" strokeWidth={2.5} /> : <span className="tabular">{i + 1}</span>} {s}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <Card className="mt-6 overflow-hidden">
        <AnimatePresence mode="wait" custom={dir} initial={false}>
          <motion.div key={step} custom={dir} initial={{ opacity: 0, x: dir * 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: dir * -28 }} transition={{ type: 'spring', damping: 30, stiffness: 320 }} className="p-6">
            {step === 0 && (
              <div className="grid gap-6 md:grid-cols-[180px_1fr]">
                <PhotoCapture value={f.photo} onChange={(m) => set('photo', m)} />
                <div className="flex flex-col gap-5">
                  <Field label="Mobile number" error={errors.phone} help="Used to sign in to Rider Mode and for the SMS invite.">
                    {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.phone} inputMode="tel" autoComplete="off" leading={<span className="text-[13px] font-semibold text-ink">+255</span>} className="[&_input]:pl-14" placeholder="712 345 678" value={f.phone} onChange={(e) => set('phone', e.target.value)} autoFocus />}
                  </Field>
                  <Field label="Full name" error={errors.name} help="As on their ID — customers see the first name.">
                    {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.name} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="Juma Mwinyi" />}
                  </Field>
                </div>
              </div>
            )}
            {step === 1 && (
              <div className="flex flex-col gap-5">
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="NIDA number" optional error={errors.nationalId} help="Stored encrypted; only the last 4 digits are shown afterwards.">
                    {(id, d) => <Input id={id} aria-describedby={d} aria-invalid={!!errors.nationalId} inputMode="numeric" value={f.nationalId} onChange={(e) => set('nationalId', e.target.value.replace(/[^\d-]/g, ''))} placeholder="19900101-12345-00001-23" />}
                  </Field>
                  <Field label="Driving licence number" optional>{(id) => <Input id={id} value={f.licenceNumber} onChange={(e) => set('licenceNumber', e.target.value)} />}</Field>
                </div>
                <div>
                  <div className="mb-2 text-[13px] font-semibold">Documents</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {DOC_KINDS.map((k) => (
                      <DocSlot key={k.key} label={k.label} doc={f.documents.find((d) => d.kind === k.key)} onChange={(d) => set('documents', [...f.documents.filter((x) => x.kind !== k.key), ...(d ? [{ ...d, kind: k.key }] : [])])} />
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted">Photos or scans. Documents with an expiry date raise an alert 30 days before they lapse.</p>
                </div>
              </div>
            )}
            {step === 2 && (
              <div className="flex flex-col gap-5">
                <div role="radiogroup" aria-label="Vehicle type" className="grid grid-cols-2 gap-3 md:grid-cols-4">
                  {VEHICLE_CARDS.map((v) => {
                    const on = f.vehicle.type === v.key;
                    return (
                      <button key={v.key} type="button" role="radio" aria-checked={on} onClick={() => set('vehicle', { ...f.vehicle, type: v.key })} className={cn('relative flex flex-col items-start gap-3 rounded-md border p-4 text-left transition-all duration-200', on ? 'border-ink bg-ink text-on-ink shadow-floating' : 'border-hairline hover:border-ink/30')}>
                        <v.icon className="size-6" strokeWidth={1.25} />
                        <span>
                          <span className="block text-sm font-semibold">{v.label}</span>
                          <span className={cn('block text-xs', on ? 'text-on-ink/70' : 'text-muted')}>{v.hint}</span>
                        </span>
                        {on && <motion.span layoutId="veh-check" className="absolute right-3 top-3 flex size-5 items-center justify-center rounded-full bg-accent text-on-accent"><Check className="size-3" strokeWidth={3} /></motion.span>}
                      </button>
                    );
                  })}
                </div>
                <div className="grid gap-5 md:grid-cols-3">
                  <Field label="Plate" optional={!['MOTORBIKE', 'CAR'].includes(f.vehicle.type)} error={errors['vehicle.plate']}>
                    {(id) => <Input id={id} aria-invalid={!!errors['vehicle.plate']} value={f.vehicle.plate} onChange={(e) => set('vehicle', { ...f.vehicle, plate: e.target.value.toUpperCase() })} placeholder="MC 123 ABC" className="uppercase" />}
                  </Field>
                  <Field label="Colour" optional help="Customers use it to spot the rider.">{(id) => <Input id={id} value={f.vehicle.color} onChange={(e) => set('vehicle', { ...f.vehicle, color: e.target.value })} placeholder="Red" />}</Field>
                  <Field label="Make" optional>{(id) => <Input id={id} value={f.vehicle.make} onChange={(e) => set('vehicle', { ...f.vehicle, make: e.target.value })} placeholder="Boxer" />}</Field>
                </div>
              </div>
            )}
            {step === 3 && (
              <div className="flex flex-col gap-6">
                <div className="grid gap-5 md:grid-cols-2">
                  <Field label="Zone" optional help="Dispatch prefers riders in the order’s zone.">
                    {(id) => (
                      <Select id={id} value={f.zoneId} onChange={(e) => set('zoneId', e.target.value)}>
                        <option value="">Any zone</option>
                        {zones.data?.items.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                      </Select>
                    )}
                  </Field>
                  <Field label="Home store" optional help="Where they usually wait for jobs.">
                    {(id) => (
                      <Select id={id} value={f.homeStoreId} onChange={(e) => set('homeStoreId', e.target.value)}>
                        <option value="">None</option>
                        {stores.data?.items.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </Select>
                    )}
                  </Field>
                </div>
                <div>
                  <div className="mb-2 text-[13px] font-semibold">Payouts <span className="font-normal text-subtle">Optional</span></div>
                  <div className="grid gap-5 md:grid-cols-3">
                    <Field label="Method">
                      {(id) => (
                        <Select id={id} value={f.payout.method} onChange={(e) => set('payout', { ...f.payout, method: e.target.value })}>
                          <option value="mobile_money">Mobile money</option>
                          <option value="bank">Bank transfer</option>
                        </Select>
                      )}
                    </Field>
                    {f.payout.method === 'mobile_money' ? (
                      <Field label="Network">
                        {(id) => (
                          <Select id={id} value={f.payout.provider} onChange={(e) => set('payout', { ...f.payout, provider: e.target.value })}>
                            <option value="mpesa">M-Pesa</option>
                            <option value="airtel">Airtel Money</option>
                            <option value="mixx">Mixx by Yas</option>
                            <option value="halotel">Halopesa</option>
                          </Select>
                        )}
                      </Field>
                    ) : (
                      <Field label="Bank">{(id) => <Input id={id} value={f.payout.provider} onChange={(e) => set('payout', { ...f.payout, provider: e.target.value })} placeholder="CRDB" />}</Field>
                    )}
                    <Field label={f.payout.method === 'bank' ? 'Account number' : 'Wallet number'}>{(id) => <Input id={id} value={f.payout.account} onChange={(e) => set('payout', { ...f.payout, account: e.target.value })} inputMode="numeric" />}</Field>
                  </div>
                </div>
                <div className="flex flex-col divide-y divide-hairline rounded-md border border-hairline">
                  <label className="flex items-center gap-4 px-4 py-3.5">
                    <Sparkles className="size-5 shrink-0 text-accent" strokeWidth={1.5} />
                    <span className="flex-1"><span className="block text-sm font-semibold">Approve now</span><span className="text-xs text-muted">They can go online as soon as they sign in.</span></span>
                    <Switch checked={f.approve} onCheckedChange={(v) => set('approve', v)} label="Approve now" />
                  </label>
                  <label className="flex items-center gap-4 px-4 py-3.5">
                    <MessageSquareText className="size-5 shrink-0 text-accent" strokeWidth={1.5} />
                    <span className="flex-1"><span className="block text-sm font-semibold">Send SMS invite</span><span className="text-xs text-muted">Via Beem, with the app download link.</span></span>
                    <Switch checked={f.sendInvite} onCheckedChange={(v) => set('sendInvite', v)} label="Send SMS invite" />
                  </label>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
        <div className="flex items-center justify-between gap-3 border-t border-hairline bg-canvas/50 px-6 py-4">
          <Button variant="ghost" icon={<ArrowLeft strokeWidth={1.5} />} onClick={() => go(step - 1)} disabled={step === 0}>Back</Button>
          <span className="text-xs text-subtle tabular">Step {step + 1} of {STEPS.length}</span>
          {step < STEPS.length - 1 ? (
            <Button iconRight={<ArrowRight strokeWidth={1.5} />} onClick={() => go(step + 1)}>Continue</Button>
          ) : (
            <ActionButton icon={<Send strokeWidth={1.5} />} onAction={submit}>Register {f.sendInvite ? '& invite' : 'rider'}</ActionButton>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------------ photo: webcam or upload */
function PhotoCapture({ value, onChange }: { value: MediaOut | null; onChange: (m: MediaOut | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);
  useEffect(() => {
    if (video.current && stream) video.current.srcObject = stream;
  }, [stream]);

  const upload = async (blob: Blob) => {
    setBusy(true);
    setPreview(URL.createObjectURL(blob));
    try {
      onChange(await uploadFile(Object.assign(blob, { name: 'rider.jpg' }), 'rider_photo'));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  const open = async () => {
    try {
      setStream(await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 720, height: 900 } }));
    } catch {
      toast.error('Camera unavailable — upload a photo instead');
    }
  };
  const snap = () => {
    const v = video.current!;
    const c = document.createElement('canvas');
    const w = v.videoHeight * 0.8;
    c.width = 720;
    c.height = 900;
    c.getContext('2d')!.drawImage(v, (v.videoWidth - w) / 2, 0, w, v.videoHeight, 0, 0, 720, 900);
    stream?.getTracks().forEach((t) => t.stop());
    setStream(null);
    c.toBlob((b) => b && void upload(b), 'image/jpeg', 0.9);
  };
  const src = preview ?? value?.url;

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-md bg-canvas" style={{ aspectRatio: '4 / 5' }}>
        {stream ? (
          <video ref={video} autoPlay playsInline muted className="size-full -scale-x-100 object-cover" />
        ) : src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt="Rider photo" className="size-full object-cover" />
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-2 text-subtle"><Camera className="size-7" strokeWidth={1.25} /><span className="text-xs">Rider photo</span></div>
        )}
        {busy && <div className="absolute inset-0 flex items-center justify-center bg-scrim backdrop-blur-sm"><LoaderA size="lg" label="Uploading" /></div>}
        {stream && <div className="pointer-events-none absolute inset-6 rounded-[50%] border-2 border-dashed border-white/70" />}
      </div>
      {stream ? (
        <div className="flex gap-2">
          <Button className="flex-1" icon={<Camera strokeWidth={1.5} />} onClick={snap}>Capture</Button>
          <Button variant="ghost" size="icon" aria-label="Close camera" icon={<X strokeWidth={1.5} />} onClick={() => { stream.getTracks().forEach((t) => t.stop()); setStream(null); }} />
        </div>
      ) : (
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" className="flex-1" icon={src ? <RotateCcw strokeWidth={1.5} /> : <Camera strokeWidth={1.5} />} onClick={() => void open()}>{src ? 'Retake' : 'Camera'}</Button>
          <Button variant="secondary" size="sm" className="flex-1" icon={<ImageUp strokeWidth={1.5} />} onClick={() => fileRef.current?.click()}>Upload</Button>
        </div>
      )}
      <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/heic" hidden onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
    </div>
  );
}

function DocSlot({ label, doc, onChange }: { label: string; doc: Omit<Doc, 'kind'> | undefined; onChange: (d: Omit<Doc, 'kind'> | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [pct, setPct] = useState<number | null>(null);
  const pick = async (file: File) => {
    setPct(0);
    try {
      const media = await uploadFile(file, 'rider_document', setPct);
      onChange({ media, number: '', expiresAt: '' });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setPct(null);
    }
  };
  return (
    <div className={cn('rounded-md border p-3 transition-colors', doc ? 'border-success/40 bg-success-soft/30' : 'border-dashed border-hairline')}>
      <div className="flex items-center gap-3">
        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-sm', doc ? 'bg-success text-white' : 'bg-ink/5 text-muted')}>
          {pct != null ? <LoaderA size="sm" /> : doc ? <Check className="size-4" strokeWidth={2.5} /> : <FileUp className="size-4" strokeWidth={1.5} />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{label}</div>
          <div className="text-xs text-muted">{pct != null ? `Uploading ${Math.round(pct)}%` : doc ? 'Uploaded' : 'JPG, PNG or HEIC'}</div>
        </div>
        {doc ? <Button variant="ghost" size="icon-sm" aria-label={`Remove ${label}`} icon={<X strokeWidth={1.5} />} onClick={() => onChange(null)} /> : <Button variant="secondary" size="sm" onClick={() => ref.current?.click()}>Add</Button>}
      </div>
      {doc && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Input aria-label={`${label} number`} placeholder="Number" value={doc.number} onChange={(e) => onChange({ ...doc, number: e.target.value })} className="[&]:h-9" />
          <Input aria-label={`${label} expiry`} type="date" value={doc.expiresAt} onChange={(e) => onChange({ ...doc, expiresAt: e.target.value })} className="[&]:h-9" />
        </div>
      )}
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && void pick(e.target.files[0])} />
    </div>
  );
}

function Done({ r, onAnother }: { r: RiderAdmin & { invite: { sent: boolean; reason?: string | null; message?: string } }; onAnother: () => void }) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', damping: 26, stiffness: 260 }} className="mx-auto flex max-w-lg flex-col items-center py-12 text-center">
      <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', damping: 14, stiffness: 260, delay: 0.1 }} className="flex size-16 items-center justify-center rounded-full bg-ink text-on-ink">
        <Check className="size-7" strokeWidth={2} />
      </motion.span>
      <h1 className="mt-6 text-[32px] leading-10">{r.name.split(' ')[0]} is on the team</h1>
      <p className="mt-2 text-sm text-muted">
        {r.invite.sent ? `We texted ${r.phone} the app link. They sign in with that number and can go online right away.` : r.invite.reason ?? 'No invite was sent.'}
      </p>
      {!r.invite.sent && r.invite.message && (
        <div className="mt-4 w-full rounded-md border border-hairline bg-surface p-4 text-left text-[13px]">
          <div className="label-caps mb-1 text-muted">Share this message</div>
          {r.invite.message}
        </div>
      )}
      <div className="mt-8 flex gap-2">
        <AppLink href={`/riders/${r.id}`} className="h-10 rounded-sm bg-ink px-4 text-sm font-semibold text-on-ink">View profile</AppLink>
        <Button variant="secondary" onClick={onAnother}>Register another</Button>
      </div>
    </motion.div>
  );
}
