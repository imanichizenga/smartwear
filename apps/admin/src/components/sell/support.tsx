'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, CheckCheck, Inbox, MessageCircle, Package, SendHorizonal, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { LoaderA } from '@/components/brand/LoaderA';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton, Button } from '@/components/ui/button';
import { Tabs } from '@/components/ui/kit';
import { MediaImage } from '@/components/ui/media-image';
import { Card, Chip, EmptyState, PageHeader } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtAgo } from '@/lib/format';
import { useRealtime } from '@/lib/realtime';
import type { MediaOut } from '@/lib/types';

interface Msg { id: number; sender: 'customer' | 'rider' | 'staff' | 'system'; name: string; body: string; media: MediaOut | null; at: string }
interface Thread { id: string; kind: string; status: 'open' | 'pending' | 'closed'; subject: string | null; orderId: string | null; orderNumber: string | null; customer: { id: string; name: string } | null; assignedTo: string | null; lastMessage: Msg | null; lastMessageAt: string | null; unread: number }

const QUICK = ['Thanks for reaching out — let me check that for you.', 'Your rider is on the way; you can follow them live in the app.', 'We’ve arranged a free exchange. A rider will collect the piece.', 'Is there anything else I can help with?'];

export function SupportInbox() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | 'open' | 'pending' | 'closed'>('open');
  const [mine, setMine] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const list = useQuery({ queryKey: ['support', status, mine], queryFn: () => api<{ items: Thread[] }>('/admin/support', { query: { status, mine: mine ? 1 : undefined } }), refetchInterval: 10_000 });
  const threads = list.data?.items ?? [];
  const current = threads.find((t) => t.id === active) ?? null;
  return (
    <>
      <PageHeader title="Support inbox" description="Conversations from the app’s Help & chat. Replies arrive on the customer’s phone instantly, with a push if the app is closed." />
      <Card className="grid h-[calc(100vh-15rem)] min-h-[520px] overflow-hidden md:grid-cols-[340px_1fr]">
        <div className={cn('flex min-h-0 flex-col border-r border-hairline', active && 'hidden md:flex')}>
          <div className="flex items-center gap-2 border-b border-hairline px-3">
            <Tabs id="support" value={status} onChange={setStatus} tabs={[{ key: 'open', label: 'Open' }, { key: 'pending', label: 'Waiting' }, { key: 'closed', label: 'Closed' }, { key: '', label: 'All' }]} />
          </div>
          <label className="flex items-center gap-2 border-b border-hairline px-4 py-2 text-xs text-muted"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-[var(--sw-ink)]" /> Assigned to me</label>
          <ul className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
            {list.isPending ? <li className="flex justify-center py-12"><LoaderA size="lg" /></li> : threads.length === 0 ? (
              <li><EmptyState icon={<Inbox />} title="Inbox zero" body="No conversations in this view." /></li>
            ) : threads.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => { setActive(t.id); void qc.invalidateQueries({ queryKey: ['support'] }); }} className={cn('flex w-full gap-3 px-4 py-3 text-left transition-colors', active === t.id ? 'bg-accent-soft/50' : 'hover:bg-ink/[0.025]')}>
                  <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-blush font-display text-sm">
                    {(t.customer?.name ?? '?').slice(0, 1)}
                    {t.unread > 0 && <span className="absolute -right-0.5 -top-0.5 flex size-4 items-center justify-center rounded-full bg-ink text-[9px] font-bold text-on-ink">{t.unread}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2"><span className={cn('truncate text-[13px]', t.unread ? 'font-bold' : 'font-semibold')}>{t.customer?.name ?? 'Customer'}</span><span className="shrink-0 text-[11px] text-muted">{fmtAgo(t.lastMessageAt)}</span></span>
                    <span className="block truncate text-xs text-muted">{t.subject ?? (t.orderNumber ? `Order ${t.orderNumber}` : 'General question')}</span>
                    <span className={cn('mt-0.5 block truncate text-[12.5px]', t.unread ? 'text-ink' : 'text-muted')}>{t.lastMessage ? `${t.lastMessage.sender === 'staff' ? 'You: ' : ''}${t.lastMessage.body || 'Photo'}` : 'No messages yet'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className={cn('min-h-0', !active && 'hidden md:block')}>
          {current ? <Conversation key={current.id} thread={current} onBack={() => setActive(null)} /> : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <span className="mb-4 flex size-14 items-center justify-center rounded-full bg-accent-soft"><MessageCircle className="size-6" strokeWidth={1.5} /></span>
              <p className="font-display text-2xl">Pick a conversation</p>
              <p className="mt-1 text-sm text-muted">Replies are sent as SmartWear with your first name.</p>
            </div>
          )}
        </div>
      </Card>
    </>
  );
}

function Conversation({ thread, onBack }: { thread: Thread; onBack: () => void }) {
  const qc = useQueryClient();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const q = useQuery({ queryKey: ['thread', thread.id], queryFn: () => api<{ thread: Thread; items: Msg[] }>(`/chat/threads/${thread.id}/messages`, { query: { limit: 80 } }) });
  const [syncedFrom, setSyncedFrom] = useState<unknown>(null);
  if (q.data && syncedFrom !== q.data) {
    setSyncedFrom(q.data);
    setMsgs(q.data.items);
  }
  const live = useRealtime([`thread.${thread.id}`], (e) => {
    if (e.type === 'chat.message') {
      const m = e.message as Msg;
      setMsgs((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
    }
  }, { onPoll: () => void q.refetch(), pollMs: 6000 });
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [msgs.length]);
  const send = async (body: string) => {
    if (!body.trim()) return;
    setSending(true);
    try {
      const m = await api<Msg>(`/chat/threads/${thread.id}/messages`, { body: { body } });
      setMsgs((l) => (l.some((x) => x.id === m.id) ? l : [...l, m]));
      setText('');
      void qc.invalidateQueries({ queryKey: ['support'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Message not sent');
    } finally {
      setSending(false);
    }
  };
  const patch = async (body: Record<string, unknown>, msg: string) => {
    await api(`/admin/support/${thread.id}`, { method: 'PATCH', body });
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: ['support'] });
  };
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <Button size="icon-sm" variant="ghost" className="md:hidden" aria-label="Back" onClick={onBack}><ArrowLeft strokeWidth={1.5} /></Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold">{thread.customer?.name}<span className={cn('size-1.5 rounded-full', live === 'live' ? 'bg-success' : 'bg-warning')} title={live === 'live' ? 'Live' : 'Refreshing'} /></div>
          <div className="text-xs text-muted">{thread.subject ?? 'Support'}{thread.assignedTo ? ` · ${thread.assignedTo}` : ' · Unassigned'}</div>
        </div>
        {thread.orderId && <AppLink href={`/orders/${thread.orderId}`} icon={<Package strokeWidth={1.5} />} className="h-8 rounded-sm border border-ink/18 px-3 text-[13px] font-semibold hover:border-ink/40">{thread.orderNumber}</AppLink>}
        {!thread.assignedTo && <ActionButton size="sm" variant="secondary" icon={<UserCheck strokeWidth={1.5} />} onAction={() => patch({ assignToMe: true }, 'Assigned to you')}>Take</ActionButton>}
        {thread.status !== 'closed' ? <ActionButton size="sm" variant="secondary" icon={<CheckCheck strokeWidth={1.5} />} onAction={() => patch({ status: 'closed' }, 'Closed')}>Close</ActionButton>
          : <ActionButton size="sm" variant="secondary" onAction={() => patch({ status: 'open' }, 'Reopened')}>Reopen</ActionButton>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-4 py-4">
        {q.isPending ? <div className="flex justify-center py-12"><LoaderA size="lg" /></div> : (
          <div className="mx-auto grid max-w-2xl gap-2">
            <AnimatePresence initial={false}>
              {msgs.map((m, i) => {
                const mine = m.sender === 'staff';
                const showName = i === 0 || msgs[i - 1]?.sender !== m.sender;
                return (
                  <motion.div key={m.id} layout initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                    {showName && <span className="mb-0.5 px-1 text-[11px] text-muted">{m.name}</span>}
                    <div className={cn('max-w-[78%] rounded-lg px-3.5 py-2 text-sm leading-6', mine ? 'rounded-br-xs bg-ink text-on-ink' : 'rounded-bl-xs bg-surface shadow-[0_1px_0_var(--sw-hairline)]')}>
                      {m.media && <MediaImage media={m.media} className="mb-1.5 w-48" sizes="192px" />}
                      {m.body}
                    </div>
                    <span className="mt-0.5 px-1 text-[10px] text-subtle">{fmtAgo(m.at)}</span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            <div ref={end} />
          </div>
        )}
      </div>
      <div className="border-t border-hairline p-3">
        <div className="scrollbar-none mb-2 flex gap-1.5 overflow-x-auto">
          {QUICK.map((s) => <button key={s} type="button" onClick={() => setText(s)} className="h-7 shrink-0 rounded-full border border-hairline px-3 text-[12px] text-muted hover:border-ink/40 hover:text-ink">{s.length > 42 ? `${s.slice(0, 40)}…` : s}</button>)}
        </div>
        <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }} rows={1} placeholder="Write a reply…" aria-label="Reply"
            className="max-h-40 min-h-10 flex-1 resize-none rounded-sm border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:border-ink" />
          <Button type="submit" size="icon" aria-label="Send" pending={sending} disabled={!text.trim()} icon={<SendHorizonal strokeWidth={1.5} />} />
        </form>
      </div>
    </div>
  );
}
