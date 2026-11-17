'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3, BellRing, Eye, Inbox, Megaphone, MessageSquareText, MousePointerClick, Plus, Send, Smartphone, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { LoaderA } from '@/components/brand/LoaderA';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { fromLocalInput, Rise, RowsSkeleton, toLocalInput } from '@/components/ui/kit';
import { MediaImage } from '@/components/ui/media-image';
import { MediaSlot, ProductPicker, useDebounced } from '@/components/ui/pickers';
import { Card, Chip, EmptyState, PageHeader, type Tone } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCategories, useCollections, type ProductRow } from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtNum, titleCase } from '@/lib/format';
import type { MediaOut } from '@/lib/types';

interface Audience { customerTypes?: string[]; departments?: string[]; hasOrdered?: boolean; lastSeenDays?: number; categoryIds?: string[]; locale?: string }
interface Stats {
  audience?: number;
  recipients?: number;
  delivered?: number;
  failed?: number;
  opened?: number;
  openedFromPush?: number;
  openedFromInbox?: number;
  totalOpens?: number;
  openRate?: number;
  anonymousOpens?: number;
  error?: string;
}
interface CampaignProduct { id: string; title: string; slug: string; status: string; cover: MediaOut | null }
interface Campaign {
  id: string;
  channel: 'push' | 'sms';
  name: string;
  title: string | null;
  body: string;
  bodySw: string | null;
  link: { type?: string; id?: string };
  audience: Audience;
  scheduledAt: string | null;
  status: string;
  sentAt: string | null;
  createdAt: string;
  stats: Stats;
  productIds: string[];
  products?: CampaignProduct[];
  image: MediaOut | null;
  route: string | null;
}
interface Draft extends Partial<Omit<Campaign, 'products'>> {
  picked?: { id: string; title: string }[];
  imageMedia?: MediaOut | null;
}
interface Report {
  campaign: Campaign;
  timeline: { at: string; opens: number }[];
  latestOpens: { name: string; phone: string | null; openedAt: string; source: string; platform: string; opens: number }[];
  deliveryErrors: { error: string; count: number }[];
}

const tone = (s: string): Tone => (s === 'SENT' ? 'success' : s === 'SENDING' ? 'ink' : s === 'SCHEDULED' ? 'accent' : s === 'CANCELLED' || s === 'FAILED' ? 'neutral' : 'warning');
const smsParts = (s: string) => (s.length <= 160 ? 1 : Math.ceil(s.length / 153));
const pct = (n = 0) => `${n.toFixed(n >= 10 || n === 0 ? 0 : 1)}%`;

export function CampaignsWorkspace() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['campaigns'], queryFn: () => api<{ items: Campaign[] }>('/admin/campaigns'), refetchInterval: (query) => (query.state.data?.items.some((c) => c.status === 'SENDING') ? 3000 : 30_000) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [report, setReport] = useState<string | null>(null);
  const items = q.data?.items ?? [];
  const act = async (c: Campaign, action: 'send' | 'cancel') => {
    try {
      await api(`/admin/campaigns/${c.id}/${action}`, { method: 'POST' });
      toast.success(action === 'send' ? (c.scheduledAt && new Date(c.scheduledAt) > new Date() ? `Scheduled for ${fmtDateTime(c.scheduledAt)}` : 'Sending now') : 'Cancelled');
      void qc.invalidateQueries({ queryKey: ['campaigns'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not update');
    }
  };
  const sent = items.filter((c) => c.channel === 'push' && c.status === 'SENT');
  const totals = sent.reduce((a, c) => ({ delivered: a.delivered + (c.stats.delivered ?? 0), opened: a.opened + (c.stats.opened ?? 0) }), { delivered: 0, opened: 0 });
  return (
    <>
      <PageHeader
        title="Campaigns"
        description="Push notifications (with products) and Beem SMS to a chosen audience. Customers who turned marketing off are always excluded."
        actions={<Button icon={<Plus strokeWidth={1.5} />} onClick={() => setDraft({ channel: 'push', audience: {}, link: {}, picked: [] })}>New campaign</Button>}
      />
      {sent.length > 0 && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <MiniStat icon={<BellRing />} label="Push campaigns sent" value={fmtNum(sent.length)} />
          <MiniStat icon={<Smartphone />} label="People reached" value={fmtNum(totals.delivered)} />
          <MiniStat icon={<MousePointerClick />} label="Average open rate" value={pct(totals.delivered ? (100 * totals.opened) / totals.delivered : 0)} />
        </div>
      )}
      <Card className="overflow-hidden">
        {q.isPending ? (
          <RowsSkeleton avatar />
        ) : items.length === 0 ? (
          <EmptyState icon={<Megaphone />} title="No campaigns yet" body="Push a new drop with its products to everyone who bought from that category, or nudge lapsed shoppers." />
        ) : (
          <ul className="divide-y divide-hairline">
            {items.map((c, i) => {
              const people = c.stats.recipients ?? c.stats.audience ?? 0;
              const live = c.status === 'SENDING' || c.status === 'SENT';
              const cover = c.image ?? c.products?.[0]?.cover ?? null;
              return (
                <Rise as="li" i={i} key={c.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  {c.channel === 'push' && cover ? (
                    <MediaImage media={cover} className="w-10 shrink-0" sizes="40px" rounded="xs" />
                  ) : (
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft">{c.channel === 'push' ? <BellRing className="size-4" strokeWidth={1.5} /> : <MessageSquareText className="size-4" strokeWidth={1.5} />}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                      {c.name}
                      <Chip tone={tone(c.status)} dot={c.status === 'SENDING'}>{titleCase(c.status)}</Chip>
                      {c.productIds.length > 0 && <Chip tone="neutral">{c.productIds.length} product{c.productIds.length === 1 ? '' : 's'}</Chip>}
                    </div>
                    <div className="truncate text-[13px] text-muted">{c.title ? `${c.title} — ` : ''}{c.body}</div>
                  </div>
                  {c.channel === 'push' && live ? (
                    <div className="grid grid-cols-3 gap-4 text-right text-xs">
                      <Metric label="Delivered" value={fmtNum(c.stats.delivered ?? 0)} sub={people ? `of ${fmtNum(people)}` : undefined} />
                      <Metric label="Opened" value={fmtNum(c.stats.opened ?? 0)} sub={c.stats.totalOpens ? `${fmtNum(c.stats.totalOpens)} opens` : undefined} />
                      <Metric label="Open rate" value={pct(c.stats.openRate ?? 0)} accent />
                    </div>
                  ) : (
                    <div className="w-40 text-right text-xs text-muted">
                      <div className="flex items-center justify-end gap-1 tabular"><Users className="size-3" strokeWidth={1.5} />{fmtNum(people)} people</div>
                      {live ? <div className="mt-0.5 tabular">{fmtNum(c.stats.delivered ?? 0)} delivered{c.stats.failed ? ` · ${c.stats.failed} failed` : ''}</div> : <div>{c.scheduledAt ? fmtDateTime(c.scheduledAt) : 'Send manually'}</div>}
                      {c.stats.error && <div className="text-danger">{c.stats.error}</div>}
                    </div>
                  )}
                  <div className="flex gap-2">
                    {c.channel === 'push' && live && <Button size="sm" variant="secondary" icon={<BarChart3 strokeWidth={1.5} />} onClick={() => setReport(c.id)}>Report</Button>}
                    {(c.status === 'DRAFT' || c.status === 'SCHEDULED') && <ActionButton size="sm" variant="ghost" icon={<X strokeWidth={1.5} />} onAction={() => act(c, 'cancel')}>Cancel</ActionButton>}
                    {c.status === 'DRAFT' && <ActionButton size="sm" icon={<Send strokeWidth={1.5} />} onAction={() => act(c, 'send')}>{c.scheduledAt && new Date(c.scheduledAt) > new Date() ? 'Schedule' : 'Send'}</ActionButton>}
                  </div>
                </Rise>
              );
            })}
          </ul>
        )}
      </Card>
      {draft && <Composer draft={draft} setDraft={setDraft} onCreated={() => void qc.invalidateQueries({ queryKey: ['campaigns'] })} />}
      {report && <ReportDialog id={report} onClose={() => setReport(null)} />}
    </>
  );
}

function MiniStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex size-9 items-center justify-center rounded-full bg-accent-soft [&>svg]:size-4 [&>svg]:stroke-[1.5]">{icon}</span>
      <div>
        <div className="label-caps text-muted">{label}</div>
        <div className="font-display text-xl tabular">{value}</div>
      </div>
    </Card>
  );
}

function Metric({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="min-w-16">
      <div className="label-caps text-[10px] text-muted">{label}</div>
      <div className={cn('font-display text-lg leading-6 tabular', accent && 'text-accent')}>{value}</div>
      {sub && <div className="text-[11px] text-muted tabular">{sub}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ composer */

function Composer({ draft, setDraft, onCreated }: { draft: Draft; setDraft: (c: Draft | null) => void; onCreated: () => void }) {
  const cats = useCategories();
  const cols = useCollections();
  const aud = draft.audience ?? {};
  const setAud = (p: Partial<Audience>) => setDraft({ ...draft, audience: { ...aud, ...p } });
  const sms = draft.channel === 'sms';
  const picked = draft.picked ?? [];
  const reachKey = JSON.stringify([draft.channel, aud]);
  const debounced = useDebounced(reachKey, 400);
  const reach = useQuery({ queryKey: ['campaign-reach', debounced], queryFn: () => api<{ audience: number }>('/admin/campaigns/estimate', { body: { channel: draft.channel, audience: aud } }), placeholderData: (p) => p });
  const estimating = reach.isFetching || debounced !== reachKey;
  // Covers of the picked products for the preview (the first one is the notification picture).
  const covers = useQuery({
    queryKey: ['campaign-covers', picked.map((p) => p.id).join(',')],
    enabled: picked.length > 0,
    queryFn: async () => Object.fromEntries((await api<{ items: ProductRow[] }>('/admin/products', { query: { ids: picked.map((p) => p.id).join(','), limit: 50 } })).items.map((p) => [p.id, p])),
    placeholderData: (p) => p,
  });
  const firstCover = draft.imageMedia ?? (picked[0] ? covers.data?.[picked[0].id]?.cover ?? null : null);
  const opensHint = picked.length === 1 ? 'Tapping opens this product.' : picked.length > 1 ? `Tapping opens a page with these ${picked.length} products.` : null;

  const create = async (sendNow: boolean) => {
    try {
      const body = {
        channel: draft.channel,
        name: draft.name,
        title: draft.title,
        body: draft.body,
        bodySw: draft.bodySw,
        link: !picked.length && draft.link?.type ? draft.link : {},
        audience: aud,
        scheduledAt: draft.scheduledAt,
        productIds: sms ? [] : picked.map((p) => p.id),
        imageMediaId: sms ? null : draft.imageMedia?.id ?? null,
      };
      const c = await api<Campaign>('/admin/campaigns', { body });
      if (sendNow) await api(`/admin/campaigns/${c.id}/send`, { method: 'POST' });
      toast.success(sendNow ? `${c.scheduledAt ? 'Scheduled' : 'Sending'} to ${fmtNum(c.stats.audience ?? 0)} people` : `Draft saved · reaches ${fmtNum(c.stats.audience ?? 0)} people`);
      onCreated();
      setDraft(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  const chip = (on: boolean) => cn('h-8 rounded-sm border px-2.5 text-[13px] transition-colors', on ? 'border-ink bg-ink text-on-ink' : 'border-hairline hover:border-ink/40');
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && setDraft(null)}
      size="lg"
      title="New campaign"
      description="Pick products to feature, write the message, choose who gets it. Reach updates as you go."
      footer={
        <>
          <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          <ActionButton variant="secondary" disabled={!draft.body?.trim()} onAction={() => create(false)}>Save draft</ActionButton>
          <ActionButton disabled={!draft.body?.trim()} icon={<Send strokeWidth={1.5} />} onAction={() => create(true)}>{draft.scheduledAt ? 'Schedule' : 'Send now'}</ActionButton>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[1fr_280px]">
        <div className="grid content-start gap-4">
          <div className="grid grid-cols-2 gap-2">
            {(['push', 'sms'] as const).map((ch) => (
              <button key={ch} type="button" onClick={() => setDraft({ ...draft, channel: ch })} className={cn('flex items-center justify-center gap-2 rounded-sm border py-2.5 text-[13px] font-semibold', draft.channel === ch ? 'border-ink bg-ink text-on-ink' : 'border-hairline')}>
                {ch === 'push' ? <BellRing className="size-4" strokeWidth={1.5} /> : <MessageSquareText className="size-4" strokeWidth={1.5} />}
                {ch === 'push' ? 'Push notification' : 'SMS (Beem)'}
              </button>
            ))}
          </div>
          {!sms && (
            <Field label="Products" optional help={opensHint ?? 'Feature one product (tap opens it) or several (tap opens a page with all of them). The first product’s photo becomes the notification picture.'}>
              {() => <ProductPicker value={picked} max={20} onChange={(v) => setDraft({ ...draft, picked: v, title: draft.title || (v.length === 1 ? v[0]!.title : draft.title) })} />}
            </Field>
          )}
          <Field label="Name" help="For your team only.">{(id) => <Input id={id} value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Kilimanjaro drop — launch" />}</Field>
          {!sms && <Field label="Title">{(id) => <Input id={id} maxLength={80} value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="It’s here" />}</Field>}
          <Field label="Message" aside={sms && <span className={cn('text-xs tabular', (draft.body?.length ?? 0) > 459 ? 'text-danger' : 'text-muted')}>{draft.body?.length ?? 0}/459 · {smsParts(draft.body ?? '')} SMS</span>}>
            {(id) => <Textarea id={id} rows={3} value={draft.body ?? ''} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Tanzanite and soft leather, in a strictly limited run. Shop now before it’s gone." />}
          </Field>
          <Field label="Swahili message" optional help="Sent to customers using the app in Swahili.">{(id) => <Textarea id={id} rows={2} value={draft.bodySw ?? ''} onChange={(e) => setDraft({ ...draft, bodySw: e.target.value })} />}</Field>
          {!sms && !picked.length && (
            <Field label="Opens" optional>
              {(id) => (
                <Select id={id} value={draft.link?.id ? `collection:${draft.link.id}` : ''} onChange={(e) => { const [type, lid] = e.target.value.split(':'); setDraft({ ...draft, link: type ? { type, id: lid } : {} }); }}>
                  <option value="">The app’s Home</option>
                  {cols.data?.map((c) => <option key={c.id} value={`collection:${c.id}`}>{c.title}</option>)}
                </Select>
              )}
            </Field>
          )}
          {!sms && (
            <Field label="Picture" optional help="Replaces the product photo in the notification.">
              {() => <MediaSlot media={draft.imageMedia ?? null} onChange={(m) => setDraft({ ...draft, imageMedia: m })} ratio="2 / 1" purpose="collection" label="Choose a picture" className="max-w-xs" />}
            </Field>
          )}
          <Field label="Send at" optional help="Leave empty to send when you press Send.">{(id) => <Input id={id} type="datetime-local" value={toLocalInput(draft.scheduledAt)} onChange={(e) => setDraft({ ...draft, scheduledAt: fromLocalInput(e.target.value) })} />}</Field>
          <div>
            <div className="label-caps mb-2 text-muted">Audience</div>
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-1.5">
                {(['RETAIL', 'WHOLESALE'] as const).map((t) => {
                  const on = !!aud.customerTypes?.includes(t);
                  return <button key={t} type="button" className={chip(on)} onClick={() => setAud({ customerTypes: on ? aud.customerTypes!.filter((x) => x !== t) : [...(aud.customerTypes ?? []), t] })}>{t === 'RETAIL' ? 'Retail' : 'Wholesale'}</button>;
                })}
                {['women', 'men', 'kids'].map((d) => {
                  const on = !!aud.departments?.includes(d);
                  return <button key={d} type="button" className={cn(chip(on), 'capitalize')} onClick={() => setAud({ departments: on ? aud.departments!.filter((x) => x !== d) : [...(aud.departments ?? []), d] })}>{d}</button>;
                })}
                {(['en', 'sw'] as const).map((l) => {
                  const on = aud.locale === l;
                  return <button key={l} type="button" className={chip(on)} onClick={() => setAud({ locale: on ? undefined : l })}>{l === 'en' ? 'English app' : 'Swahili app'}</button>;
                })}
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Select value={aud.hasOrdered === undefined ? '' : aud.hasOrdered ? '1' : '0'} onChange={(e) => setAud({ hasOrdered: e.target.value === '' ? undefined : e.target.value === '1' })} aria-label="Purchase history"><option value="">Any purchase history</option><option value="1">Has bought before</option><option value="0">Never bought</option></Select>
                <Select value={aud.lastSeenDays ?? ''} onChange={(e) => setAud({ lastSeenDays: e.target.value ? Number(e.target.value) : undefined })} aria-label="Active"><option value="">Any activity</option><option value="7">Active in 7 days</option><option value="30">Active in 30 days</option><option value="90">Active in 90 days</option></Select>
                <Select value={aud.categoryIds?.[0] ?? ''} onChange={(e) => setAud({ categoryIds: e.target.value ? [e.target.value] : undefined })} aria-label="Bought from"><option value="">Bought from any category</option>{cats.data?.filter((c) => c.depth <= 1).map((c) => <option key={c.id} value={c.id}>Bought {c.label}</option>)}</Select>
              </div>
            </div>
          </div>
        </div>
        <div>
          <div className="label-caps mb-2 text-muted">Preview</div>
          {sms ? (
            <div className="rounded-lg bg-canvas p-4">
              <div className="mb-2 text-center text-[11px] text-muted">SmartWear</div>
              <motion.div key={draft.body} initial={{ opacity: 0.6 }} animate={{ opacity: 1 }} className="max-w-[90%] whitespace-pre-wrap rounded-lg rounded-bl-xs bg-surface px-3 py-2 text-[13px] leading-5 shadow-[0_1px_0_var(--sw-hairline)]">{draft.body || 'Your message'}</motion.div>
            </div>
          ) : (
            <div className="rounded-lg bg-[linear-gradient(160deg,var(--sw-blush),var(--sw-accent-soft))] p-3">
              <motion.div key={(draft.title ?? '') + (draft.body ?? '') + (firstCover?.id ?? '')} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 28 }} className="overflow-hidden rounded-md bg-surface/90 shadow-floating backdrop-blur">
                <div className="p-3">
                  <div className="flex items-center gap-2 text-[10.5px] text-muted"><span className="flex size-4 items-center justify-center rounded-xs bg-ink font-display text-[9px] text-on-ink">A</span> SMARTWEAR · now</div>
                  <div className="mt-1 text-[13px] font-semibold">{draft.title || 'Title'}</div>
                  <div className="line-clamp-3 text-[12.5px] leading-5 text-ink/85">{draft.body || 'Your message'}</div>
                </div>
                {firstCover && <MediaImage media={firstCover} ratio="2 / 1" sizes="280px" rounded="none" />}
              </motion.div>
              {picked.length > 1 && (
                <div className="mt-2 flex gap-1.5 overflow-hidden">
                  {picked.slice(0, 5).map((p) => (covers.data?.[p.id]?.cover ? <MediaImage key={p.id} media={covers.data[p.id]!.cover!} className="w-10 shrink-0" sizes="40px" rounded="xs" /> : null))}
                  {picked.length > 5 && <span className="flex w-10 items-center justify-center text-xs text-muted">+{picked.length - 5}</span>}
                </div>
              )}
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">
            {estimating ? <LoaderA size="xs" /> : <Users className="size-3.5" strokeWidth={1.5} />}
            {reach.data ? <><b className="font-semibold tabular text-ink">{fmtNum(reach.data.audience)}</b>{sms ? ' people will receive this' : ' people with notifications on'}</> : 'Calculating reach…'}
          </div>
          {!sms && reach.data?.audience === 0 && !estimating && <p className="mt-2 text-[12px] text-warning">Nobody can receive push yet: customers need the latest app, signed in, with notifications allowed.</p>}
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ report */

function ReportDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const r = useQuery({ queryKey: ['campaign-report', id], queryFn: () => api<Report>(`/admin/campaigns/${id}/report`), refetchInterval: 15_000 });
  const [phone, setPhone] = useState('');
  const d = r.data;
  const s = d?.campaign.stats ?? {};
  const delivered = s.delivered ?? 0;
  const people = s.recipients ?? 0;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const test = async () => {
    try {
      const res = await api<{ devices: number; delivered: number; errors: string[] }>(`/admin/campaigns/${id}/test`, { body: { phone } });
      if (res.delivered) toast.success(`Test sent to ${res.delivered} device${res.delivered === 1 ? '' : 's'}`);
      else toast.error(res.errors[0] ?? 'Not delivered');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not send the test');
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} size="lg" title={d?.campaign.name ?? 'Campaign report'} description={d?.campaign.sentAt ? `Sent ${fmtDateTime(d.campaign.sentAt)} · updates live` : undefined}>
      {!d ? (
        <div className="flex justify-center py-16"><LoaderA size="lg" /></div>
      ) : (
        <div className="grid gap-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <ReportStat icon={<Users />} label="Recipients" value={fmtNum(people)} />
            <ReportStat icon={<Smartphone />} label="Delivered" value={fmtNum(delivered)} hint={s.failed ? `${fmtNum(s.failed)} not delivered` : undefined} />
            <ReportStat icon={<Eye />} label="Opened" value={fmtNum(s.opened ?? 0)} hint={`${fmtNum(s.totalOpens ?? 0)} total opens${s.anonymousOpens ? ` · ${s.anonymousOpens} signed-out` : ''}`} />
            <ReportStat icon={<MousePointerClick />} label="Open rate" value={pct(s.openRate ?? 0)} hint="opened ÷ delivered" accent />
          </div>
          <Card className="p-4">
            <div className="label-caps mb-3 text-muted">Funnel</div>
            {[
              ['Delivered', delivered, people],
              ['Opened from the notification', s.openedFromPush ?? 0, delivered],
              ['Opened from the in-app inbox', s.openedFromInbox ?? 0, delivered],
            ].map(([label, v, of]) => (
              <div key={label as string} className="mb-2.5 last:mb-0">
                <div className="mb-1 flex justify-between text-[13px]"><span>{label}</span><span className="tabular text-muted">{fmtNum(v as number)} · {pct(of ? (100 * (v as number)) / (of as number) : 0)}</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-ink/8"><motion.div className="h-full rounded-full bg-ink" initial={{ width: 0 }} animate={{ width: `${of ? (100 * (v as number)) / (of as number) : 0}%` }} transition={{ duration: 0.8, ease: [0.22, 0.61, 0.36, 1] }} /></div>
              </div>
            ))}
          </Card>
          <Card className="p-4">
            <div className="label-caps mb-3 text-muted">Opens over time</div>
            {d.timeline.length === 0 ? (
              <p className="py-8 text-center text-[13px] text-muted">No opens yet — they appear here as customers tap the notification.</p>
            ) : (
              <div className="h-48">
                <ResponsiveContainer>
                  <AreaChart data={d.timeline.map((x) => ({ ...x, label: new Date(x.at).toLocaleString(undefined, { day: 'numeric', hour: '2-digit', minute: '2-digit' }) }))} margin={{ left: -20, right: 8, top: 8 }}>
                    <defs>
                      <linearGradient id="opens" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--sw-accent)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--sw-accent)" stopOpacity={0} /></linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--sw-hairline)" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--sw-muted)' }} tickLine={false} axisLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--sw-muted)' }} tickLine={false} axisLine={false} />
                    <Tooltip contentStyle={{ background: 'var(--sw-surface)', border: '1px solid var(--sw-hairline)', borderRadius: 4, fontSize: 12 }} />
                    <Area type="monotone" dataKey="opens" stroke="var(--sw-accent)" strokeWidth={2} fill="url(#opens)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </Card>
          <div className="grid gap-5 md:grid-cols-[1fr_260px]">
            <Card className="overflow-hidden">
              <div className="label-caps px-4 pb-2 pt-4 text-muted">Latest opens</div>
              {d.latestOpens.length === 0 ? (
                <p className="px-4 pb-5 text-[13px] text-muted">Nobody has opened it yet.</p>
              ) : (
                <ul className="max-h-64 divide-y divide-hairline overflow-y-auto">
                  {d.latestOpens.map((o, i) => (
                    <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-[13px]">
                      <span className="flex size-7 items-center justify-center rounded-full bg-accent-soft">{o.source === 'inbox' ? <Inbox className="size-3.5" strokeWidth={1.5} /> : <BellRing className="size-3.5" strokeWidth={1.5} />}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">{o.name || o.phone || 'Customer'}</span>
                        <span className="block text-xs text-muted">{o.source === 'inbox' ? 'From the inbox' : 'From the notification'}{o.platform ? ` · ${o.platform}` : ''}{o.opens > 1 ? ` · ${o.opens}×` : ''}</span>
                      </span>
                      <span className="text-xs tabular text-muted">{ago(o.openedAt, now)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <div className="grid content-start gap-4">
              {d.deliveryErrors.length > 0 && (
                <Card className="p-4">
                  <div className="label-caps mb-2 text-muted">Not delivered</div>
                  {d.deliveryErrors.map((e) => <div key={e.error} className="flex justify-between text-[13px]"><span className="truncate">{e.error}</span><span className="tabular text-muted">{e.count}</span></div>)}
                </Card>
              )}
              <Card className="p-4">
                <div className="label-caps mb-2 text-muted">Send a test</div>
                <p className="mb-2 text-xs text-muted">To one customer’s phone (not counted in the report).</p>
                <div className="flex gap-2">
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0712 345 678" aria-label="Customer phone" />
                  <ActionButton size="sm" disabled={phone.replace(/\D/g, '').length < 9} onAction={test}>Send</ActionButton>
                </div>
              </Card>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}

function ReportStat({ icon, label, value, hint, accent }: { icon: React.ReactNode; label: string; value: string; hint?: string; accent?: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 text-muted [&>svg]:size-3.5 [&>svg]:stroke-[1.5]">{icon}<span className="label-caps">{label}</span></div>
      <div className={cn('mt-2 font-display text-2xl tabular', accent && 'text-accent')}>{value}</div>
      {hint && <div className="mt-1 text-[11.5px] text-muted">{hint}</div>}
    </Card>
  );
}

function ago(iso: string, now: number) {
  const m = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (m < 1) return 'now';
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.floor(m / 60)} h`;
  return fmtDateTime(iso);
}
