'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { BellRing, Megaphone, MessageSquareText, Plus, Send, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { LoaderA } from '@/components/brand/LoaderA';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { fromLocalInput, Rise, RowsSkeleton, toLocalInput } from '@/components/ui/kit';
import { useDebounced } from '@/components/ui/pickers';
import { Card, Chip, EmptyState, PageHeader, type Tone } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCategories, useCollections } from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtNum, titleCase } from '@/lib/format';

interface Audience { customerTypes?: string[]; departments?: string[]; hasOrdered?: boolean; lastSeenDays?: number; categoryIds?: string[]; locale?: string }
interface Campaign { id: string; channel: 'push' | 'sms'; name: string; title: string | null; body: string; bodySw: string | null; link: { type?: string; id?: string }; audience: Audience; scheduledAt: string | null; status: string; sentAt: string | null; stats: { audience?: number; sent?: number; failed?: number; opened?: number } }

const tone = (s: string): Tone => (s === 'SENT' ? 'success' : s === 'SENDING' ? 'ink' : s === 'SCHEDULED' ? 'accent' : s === 'CANCELLED' || s === 'FAILED' ? 'neutral' : 'warning');
const smsParts = (s: string) => (s.length <= 160 ? 1 : Math.ceil(s.length / 153));

export function CampaignsWorkspace() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['campaigns'], queryFn: () => api<{ items: Campaign[] }>('/admin/campaigns'), refetchInterval: (query) => (query.state.data?.items.some((c) => c.status === 'SENDING') ? 3000 : false) });
  const [draft, setDraft] = useState<Partial<Campaign> | null>(null);
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
  return (
    <>
      <PageHeader title="Campaigns" description="Push notifications and Beem SMS to a chosen audience. Customers who turned marketing off are always excluded."
        actions={<Button icon={<Plus strokeWidth={1.5} />} onClick={() => setDraft({ channel: 'push', audience: {}, link: {} })}>New campaign</Button>} />
      <Card className="overflow-hidden">
        {q.isPending ? <RowsSkeleton /> : items.length === 0 ? <EmptyState icon={<Megaphone />} title="No campaigns yet" body="Announce a drop to everyone who bought from that category, or nudge lapsed shoppers." /> : (
          <ul className="divide-y divide-hairline">
            {items.map((c, i) => {
              const sent = c.stats.sent ?? 0;
              const total = c.stats.audience ?? 0;
              return (
                <Rise as="li" i={i} key={c.id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft">{c.channel === 'push' ? <BellRing className="size-4" strokeWidth={1.5} /> : <MessageSquareText className="size-4" strokeWidth={1.5} />}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-sm font-semibold">{c.name}<Chip tone={tone(c.status)} dot={c.status === 'SENDING'}>{titleCase(c.status)}</Chip></div>
                    <div className="truncate text-[13px] text-muted">{c.title ? `${c.title} — ` : ''}{c.body}</div>
                  </div>
                  <div className="w-40 text-right text-xs text-muted">
                    <div className="flex items-center justify-end gap-1 tabular"><Users className="size-3" strokeWidth={1.5} />{fmtNum(total)} people</div>
                    {c.status === 'SENDING' || c.status === 'SENT' ? (
                      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-ink/8"><motion.div className="h-full bg-ink" animate={{ width: `${total ? (sent / total) * 100 : 0}%` }} /></div>
                    ) : <div>{c.scheduledAt ? fmtDateTime(c.scheduledAt) : 'Send manually'}</div>}
                    {c.status === 'SENT' && <div className="mt-0.5 tabular">{fmtNum(sent)} delivered{c.stats.failed ? ` · ${c.stats.failed} failed` : ''}</div>}
                  </div>
                  <div className="flex gap-2">
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
    </>
  );
}

function Composer({ draft, setDraft, onCreated }: { draft: Partial<Campaign>; setDraft: (c: Partial<Campaign> | null) => void; onCreated: () => void }) {
  const cats = useCategories();
  const cols = useCollections();
  const aud = draft.audience ?? {};
  const setAud = (p: Partial<Audience>) => setDraft({ ...draft, audience: { ...aud, ...p } });
  const sms = draft.channel === 'sms';
  const reachKey = JSON.stringify([draft.channel, aud]);
  const debounced = useDebounced(reachKey, 400);
  const reach = useQuery({ queryKey: ['campaign-reach', debounced], queryFn: () => api<{ audience: number }>('/admin/campaigns/estimate', { body: { channel: draft.channel, audience: aud } }), placeholderData: (p) => p });
  const estimating = reach.isFetching || debounced !== reachKey;
  const create = async (sendNow: boolean) => {
    try {
      const c = await api<Campaign>('/admin/campaigns', { body: { ...draft, link: draft.link?.type ? draft.link : {} } });
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
    <Dialog open onOpenChange={(v) => !v && setDraft(null)} size="lg" title="New campaign" description="Reach updates as you pick the audience. Save as a draft, or send straight away."
      footer={<><Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button><ActionButton variant="secondary" disabled={!draft.body?.trim()} onAction={() => create(false)}>Save draft</ActionButton><ActionButton disabled={!draft.body?.trim()} icon={<Send strokeWidth={1.5} />} onAction={() => create(true)}>{draft.scheduledAt ? 'Schedule' : 'Send now'}</ActionButton></>}>
      <div className="grid gap-5 md:grid-cols-[1fr_260px]">
        <div className="grid content-start gap-4">
          <div className="grid grid-cols-2 gap-2">
            {(['push', 'sms'] as const).map((ch) => <button key={ch} type="button" onClick={() => setDraft({ ...draft, channel: ch })} className={cn('flex items-center justify-center gap-2 rounded-sm border py-2.5 text-[13px] font-semibold', draft.channel === ch ? 'border-ink bg-ink text-on-ink' : 'border-hairline')}>{ch === 'push' ? <BellRing className="size-4" strokeWidth={1.5} /> : <MessageSquareText className="size-4" strokeWidth={1.5} />}{ch === 'push' ? 'Push' : 'SMS (Beem)'}</button>)}
          </div>
          <Field label="Name" help="For your team only.">{(id) => <Input id={id} value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Kilimanjaro drop — launch" />}</Field>
          {!sms && <Field label="Title">{(id) => <Input id={id} maxLength={80} value={draft.title ?? ''} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="It’s here" />}</Field>}
          <Field label="Message" aside={sms && <span className={cn('text-xs tabular', (draft.body?.length ?? 0) > 459 ? 'text-danger' : 'text-muted')}>{draft.body?.length ?? 0}/459 · {smsParts(draft.body ?? '')} SMS</span>}>{(id) => <Textarea id={id} rows={3} value={draft.body ?? ''} onChange={(e) => setDraft({ ...draft, body: e.target.value })} placeholder="Tanzanite and soft leather, in a strictly limited run. Shop now before it’s gone." />}</Field>
          <Field label="Swahili message" optional help="Sent to customers using the app in Swahili.">{(id) => <Textarea id={id} rows={2} value={draft.bodySw ?? ''} onChange={(e) => setDraft({ ...draft, bodySw: e.target.value })} />}</Field>
          {!sms && (
            <Field label="Opens" optional>
              {(id) => (
                <Select id={id} value={draft.link?.id ? `collection:${draft.link.id}` : ''} onChange={(e) => { const [type, lid] = e.target.value.split(':'); setDraft({ ...draft, link: type ? { type, id: lid } : {} }); }}>
                  <option value="">The app’s Home</option>
                  {cols.data?.map((c) => <option key={c.id} value={`collection:${c.id}`}>{c.title}</option>)}
                </Select>
              )}
            </Field>
          )}
          <Field label="Send at" optional help="Leave empty to send when you press Send.">{(id) => <Input id={id} type="datetime-local" value={toLocalInput(draft.scheduledAt)} onChange={(e) => setDraft({ ...draft, scheduledAt: fromLocalInput(e.target.value) })} />}</Field>
          <div>
            <div className="label-caps mb-2 text-muted">Audience</div>
            <div className="grid gap-3">
              <div className="flex flex-wrap gap-1.5">
                {(['RETAIL', 'WHOLESALE'] as const).map((t) => { const on = !!aud.customerTypes?.includes(t); return <button key={t} type="button" className={chip(on)} onClick={() => setAud({ customerTypes: on ? aud.customerTypes!.filter((x) => x !== t) : [...(aud.customerTypes ?? []), t] })}>{t === 'RETAIL' ? 'Retail' : 'Wholesale'}</button>; })}
                {['women', 'men', 'kids'].map((d) => { const on = !!aud.departments?.includes(d); return <button key={d} type="button" className={cn(chip(on), 'capitalize')} onClick={() => setAud({ departments: on ? aud.departments!.filter((x) => x !== d) : [...(aud.departments ?? []), d] })}>{d}</button>; })}
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
              <motion.div key={(draft.title ?? '') + (draft.body ?? '')} initial={{ y: -8, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 28 }} className="rounded-md bg-surface/90 p-3 shadow-floating backdrop-blur">
                <div className="flex items-center gap-2 text-[10.5px] text-muted"><span className="flex size-4 items-center justify-center rounded-xs bg-ink font-display text-[9px] text-on-ink">A</span> SMARTWEAR · now</div>
                <div className="mt-1 text-[13px] font-semibold">{draft.title || 'Title'}</div>
                <div className="line-clamp-3 text-[12.5px] leading-5 text-ink/85">{draft.body || 'Your message'}</div>
              </motion.div>
            </div>
          )}
          <div className="mt-3 flex items-center gap-2 text-[12px] text-muted">{estimating ? <LoaderA size="xs" /> : <Users className="size-3.5" strokeWidth={1.5} />}{reach.data ? <><b className="font-semibold text-ink tabular">{fmtNum(reach.data.audience)}</b> people will receive this</> : 'Calculating reach…'}</div>
        </div>
      </div>
    </Dialog>
  );
}
