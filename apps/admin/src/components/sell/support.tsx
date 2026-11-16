'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, CheckCheck, CircleAlert, Clock, Inbox, MapPin, MessageCircle, Package, Search, SendHorizonal, Smile, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton, Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { RowsSkeleton, Tabs } from '@/components/ui/kit';
import { MediaImage } from '@/components/ui/media-image';
import { useDebounced } from '@/components/ui/pickers';
import { Card, Chip, EmptyState, PageHeader } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtAgo, fmtDate, fmtMoney } from '@/lib/format';
import { orderTone } from '@/lib/ops';
import { useRealtime, type RealtimeEmit } from '@/lib/realtime';
import type { MediaOut } from '@/lib/types';

interface Msg { id: number | null; clientId?: string | null; sender: 'customer' | 'rider' | 'staff' | 'system'; name: string; body: string; media: MediaOut | null; at: string; state?: 'pending' | 'failed' }
interface OrderCtx {
  id: string; number: string; status: string; statusLabel: string; placedAt: string; total: number; currency: string; itemCount: number; thumbnail: MediaOut | null;
  items?: { title: string; options: string; qty: number; lineTotal: number }[];
  deliveryAddress?: string | null; area?: string | null; landmark?: string | null;
  location?: { mode: 'automatic' | 'manual'; details: string | null; notes: string | null };
  paymentMethod?: string; paymentStatus?: string;
}
interface Presence { online: boolean; lastSeenAt: string | null }
interface Thread {
  id: string; kind: string; status: 'open' | 'pending' | 'closed'; subject: string | null; orderId: string | null; orderNumber: string | null; order: OrderCtx | null;
  customer: { id: string; name: string; phone: string | null } | null; assignedTo: string | null; lastMessage: Msg | null; lastMessageAt: string | null; unread: number;
  otherReadAt: string | null; presence: Presence | null; canReply: boolean;
}

const QUICK = ['Thanks for reaching out — let me check that for you.', 'Your rider is on the way; you can follow them live in the app.', 'We’ve arranged a free exchange. A rider will collect the piece.', 'Is there anything else I can help with?'];

/** A small, dependency-free emoji set: the ones support actually uses. */
const EMOJI: { label: string; items: string[] }[] = [
  { label: 'Smileys', items: ['😀', '😊', '🙂', '😉', '😍', '🥰', '😘', '😅', '😂', '🤗', '🤔', '😌', '😎', '🥳', '😇', '🙃', '😔', '😢', '😮', '🙏'] },
  { label: 'Gestures', items: ['👍', '👌', '👏', '🙌', '🤝', '✌️', '👋', '💪', '👀', '☝️', '🤞', '✋'] },
  { label: 'Hearts', items: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🤍', '🖤', '💕', '💖', '✨', '⭐'] },
  { label: 'Shopping', items: ['🛍️', '👗', '👚', '👕', '👖', '👠', '👟', '👜', '💄', '💅', '🧴', '⚽', '🏀', '📦', '🚚', '🛵', '📍', '⏰', '✅', '🎁'] },
];

const isEmojiOnly = (s: string) => /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(s.trim()) && !/[0-9#*]/.test(s) && [...s.trim()].length <= 6;
const newClientId = () => `a-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function presenceText(p: Presence | null | undefined) {
  if (!p) return null;
  if (p.online) return 'Online';
  return p.lastSeenAt ? `Last seen ${fmtAgo(p.lastSeenAt)}` : 'Offline';
}

export function SupportInbox({ initialThread = null }: { initialThread?: string | null }) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<'' | 'open' | 'pending' | 'closed'>(initialThread ? '' : 'open');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [active, setActive] = useState<string | null>(initialThread);
  const list = useQuery({ queryKey: ['support', status, mine, dq], queryFn: () => api<{ items: Thread[]; unread: number }>('/admin/support', { query: { status, mine: mine ? 1 : undefined, q: dq || undefined } }) });
  // New messages anywhere refresh the list (and the polling fallback covers a dropped socket).
  useRealtime(['support'], (e) => { if (e.type === 'support.thread') void qc.invalidateQueries({ queryKey: ['support'] }); }, { onPoll: () => void list.refetch(), pollMs: 10_000 });
  const threads = list.data?.items ?? [];
  const current = threads.find((t) => t.id === active) ?? null;
  // Opened from an order page: the thread may not be in the filtered list — load it directly.
  const direct = useQuery({
    queryKey: ['thread-head', active],
    enabled: !!active && !current && !list.isPending,
    queryFn: () => api<{ thread: Thread }>(`/chat/threads/${active}/messages`, { query: { limit: 1 } }).then((r) => r.thread),
  });
  const shown = current ?? direct.data ?? null;
  return (
    <>
      <PageHeader title="Support inbox" description="Every conversation belongs to an order. Replies arrive on the customer’s phone instantly, with a push if they’re not in the chat." />
      <Card className="grid h-[calc(100vh-15rem)] min-h-[520px] overflow-hidden md:grid-cols-[360px_1fr]">
        <div className={cn('flex min-h-0 flex-col border-r border-hairline', active && 'hidden md:flex')}>
          <div className="flex items-center gap-2 border-b border-hairline px-3">
            <Tabs id="support" value={status} onChange={setStatus} tabs={[{ key: 'open', label: 'Open' }, { key: 'pending', label: 'Waiting' }, { key: 'closed', label: 'Closed' }, { key: '', label: 'All' }]} />
          </div>
          <div className="grid gap-2 border-b border-hairline px-3 py-2.5">
            <Input leading={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order number or customer" aria-label="Filter by order number or customer" />
            <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} className="accent-[var(--sw-ink)]" /> Assigned to me</label>
          </div>
          <ul className="min-h-0 flex-1 divide-y divide-hairline overflow-y-auto">
            {list.isPending ? <li><RowsSkeleton rows={7} avatar /></li> : threads.length === 0 ? (
              <li><EmptyState icon={<Inbox />} title={dq ? 'No match' : 'Inbox zero'} body={dq ? `No conversation for “${dq}”.` : 'No conversations in this view.'} /></li>
            ) : threads.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setActive(t.id)} className={cn('flex w-full gap-3 px-4 py-3 text-left transition-colors', active === t.id ? 'bg-accent-soft/50' : 'hover:bg-ink/[0.025]')}>
                  <span className="relative size-11 shrink-0 overflow-hidden rounded-xs bg-blush">
                    {t.order?.thumbnail ? <MediaImage media={t.order.thumbnail} className="size-full object-cover" sizes="44px" /> : <Package className="m-3 size-5 text-muted" strokeWidth={1.5} />}
                    {t.unread > 0 && <span className="absolute right-0.5 top-0.5 flex size-4 items-center justify-center rounded-full bg-ink text-[9px] font-bold text-on-ink">{t.unread}</span>}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className={cn('truncate text-[13px] tabular', t.unread ? 'font-bold' : 'font-semibold')}>{t.orderNumber ?? 'No order'}</span>
                      <span className="shrink-0 text-[11px] text-muted">{fmtAgo(t.lastMessageAt)}</span>
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted">
                      <span className={cn('size-1.5 shrink-0 rounded-full', t.presence?.online ? 'bg-success' : 'bg-ink/20')} aria-label={t.presence?.online ? 'Online' : 'Offline'} />
                      <span className="truncate">{t.customer?.name ?? 'Customer'}</span>
                      {t.order && <Chip tone={orderTone(t.order.status)} className="ml-auto shrink-0">{t.order.statusLabel}</Chip>}
                    </span>
                    <span className={cn('mt-0.5 block truncate text-[12.5px]', t.unread ? 'text-ink' : 'text-muted')}>{t.lastMessage ? `${t.lastMessage.sender === 'staff' ? 'You: ' : ''}${t.lastMessage.body || 'Photo'}` : 'No messages yet'}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
        <div className={cn('min-h-0', !active && 'hidden md:block')}>
          {shown ? <Conversation key={shown.id} thread={shown} onBack={() => setActive(null)} /> : active && direct.isPending ? <div className="p-6"><RowsSkeleton rows={6} /></div> : (
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

function OrderContextCard({ order }: { order: OrderCtx }) {
  return (
    <div className="grid gap-2 border-b border-hairline bg-surface px-4 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <AppLink href={`/orders/${order.id}`} icon={<Package strokeWidth={1.5} />} className="font-semibold tabular hover:underline">{order.number}</AppLink>
        <Chip tone={orderTone(order.status)}>{order.statusLabel}</Chip>
        <span className="text-muted">{fmtDate(order.placedAt)}</span>
        <span className="ml-auto font-semibold tabular">{fmtMoney(order.total, order.currency)}</span>
      </div>
      {order.items && order.items.length > 0 && (
        <ul className="text-muted">
          {order.items.map((i, k) => <li key={k} className="truncate">{i.qty}× {i.title}{i.options ? ` · ${i.options}` : ''}</li>)}
        </ul>
      )}
      {(order.deliveryAddress || order.location?.details) && (
        <div className="flex gap-2 text-muted">
          <MapPin className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.5} />
          <div className="min-w-0">
            <div className="text-ink">{order.location?.mode === 'manual' && order.location.details ? order.location.details : order.deliveryAddress}</div>
            {order.landmark && <div>“{order.landmark}”</div>}
            {order.location?.notes && <div className="mt-0.5 rounded-xs bg-canvas px-2 py-1">{order.location.notes}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function EmojiPicker({ onPick }: { onPick: (e: string) => void }) {
  return (
    <div role="dialog" aria-label="Emoji" className="absolute bottom-full left-0 z-30 mb-2 w-[320px] rounded-md border border-hairline bg-surface p-3 shadow-sticky">
      {EMOJI.map((g) => (
        <div key={g.label} className="mb-2 last:mb-0">
          <div className="label-caps mb-1 text-muted">{g.label}</div>
          <div className="grid grid-cols-10 gap-0.5">
            {g.items.map((e) => <button key={e} type="button" onClick={() => onPick(e)} className="flex size-7 items-center justify-center rounded-xs text-lg hover:bg-ink/5" aria-label={e}>{e}</button>)}
          </div>
        </div>
      ))}
    </div>
  );
}

function Ticks({ m, readAt }: { m: Msg; readAt: string | null }) {
  if (m.state === 'pending') return <Clock className="size-3 text-subtle" strokeWidth={2} aria-label="Sending" />;
  if (m.state === 'failed') return <CircleAlert className="size-3 text-danger" strokeWidth={2} aria-label="Not sent" />;
  const read = readAt != null && m.id != null && new Date(m.at) <= new Date(readAt);
  return read ? <CheckCheck className="size-3.5 text-accent" strokeWidth={2} aria-label="Read" /> : <Check className="size-3.5 text-subtle" strokeWidth={2} aria-label="Sent" />;
}

function Conversation({ thread, onBack }: { thread: Thread; onBack: () => void }) {
  const qc = useQueryClient();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const [readAt, setReadAt] = useState<string | null>(thread.otherReadAt);
  const [presence, setPresence] = useState<Presence | null>(thread.presence);
  const [typingUntil, setTypingUntil] = useState(0);
  const [, tick] = useState(0);
  const lastTyping = useRef(0);
  const emitter = useRef<RealtimeEmit | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const q = useQuery({ queryKey: ['thread', thread.id], queryFn: () => api<{ thread: Thread; items: Msg[] }>(`/chat/threads/${thread.id}/messages`, { query: { limit: 80 } }) });
  const [syncedFrom, setSyncedFrom] = useState<unknown>(null);
  if (q.data && syncedFrom !== q.data) {
    setSyncedFrom(q.data);
    setMsgs((cur) => merge(cur.filter((m) => m.id == null), q.data!.items));
    setReadAt(q.data.thread.otherReadAt);
    setPresence(q.data.thread.presence);
  }
  const live = useRealtime([`thread.${thread.id}`], (e) => {
    if (e.type === 'chat.message') {
      const m = e.message as Msg;
      setMsgs((l) => merge(l, [m]));
      if (m.sender === 'customer') {
        setTypingUntil(0);
        void api(`/chat/threads/${thread.id}/read`, { body: {} }).catch(() => {});
        void qc.invalidateQueries({ queryKey: ['support'] });
      }
    } else if (e.type === 'chat.read' && e.by === 'customer') {
      setReadAt(String(e.at));
    } else if (e.type === 'chat.typing' && e.by === 'customer') {
      setTypingUntil(Date.now() + 4000);
    } else if (e.type === 'presence.changed' && e.who === 'customer') {
      setPresence({ online: Boolean(e.online), lastSeenAt: (e.lastSeenAt as string | null) ?? null });
    }
  }, { onPoll: () => void q.refetch(), pollMs: 6000, emitter });
  useEffect(() => {
    if (!typingUntil) return;
    const t = setTimeout(() => tick((n) => n + 1), Math.max(0, typingUntil - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [typingUntil]);
  useEffect(() => end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [msgs.length]);
  const typing = typingUntil > Date.now();

  const send = async (body: string, retry?: Msg) => {
    const clean = body.trim();
    if (!clean || !thread.canReply) return;
    const clientId = retry?.clientId ?? newClientId();
    const local: Msg = { id: null, clientId, sender: 'staff', name: 'You', body: clean, media: null, at: new Date().toISOString(), state: 'pending' };
    setMsgs((l) => [...l.filter((m) => m.clientId !== clientId || m.id != null), local]);
    if (!retry) setText('');
    setEmoji(false);
    try {
      const m = await api<Msg>(`/chat/threads/${thread.id}/messages`, { body: { body: clean, clientId } });
      setMsgs((l) => merge(l.filter((x) => !(x.id == null && x.clientId === clientId)), [m]));
      void qc.invalidateQueries({ queryKey: ['support'] });
    } catch (e) {
      setMsgs((l) => l.map((x) => (x.id == null && x.clientId === clientId ? { ...x, state: 'failed' } : x)));
      toast.error(e instanceof ApiError ? e.message : 'Message not sent');
    }
  };
  const onType = (v: string) => {
    setText(v);
    if (v.trim() && Date.now() - lastTyping.current > 2000) {
      lastTyping.current = Date.now();
      emitter.current?.({ type: 'chat.typing', threadId: thread.id });
    }
  };
  const patch = async (body: Record<string, unknown>, msg: string) => {
    await api(`/admin/support/${thread.id}`, { method: 'PATCH', body });
    toast.success(msg);
    void qc.invalidateQueries({ queryKey: ['support'] });
  };
  const pres = presenceText(presence);
  const days = useMemo(() => msgs.map((m, i) => i === 0 || new Date(msgs[i - 1]!.at).toDateString() !== new Date(m.at).toDateString()), [msgs]);
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <Button size="icon-sm" variant="ghost" className="md:hidden" aria-label="Back" onClick={onBack}><ArrowLeft strokeWidth={1.5} /></Button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm font-semibold">
            {thread.customer?.name}
            <span className={cn('size-1.5 rounded-full', presence?.online ? 'bg-success' : 'bg-ink/25')} />
            <span className="text-xs font-normal text-muted">{typing ? <span className="text-accent">typing…</span> : pres}</span>
          </div>
          <div className="text-xs text-muted">
            {thread.customer?.phone && <a href={`tel:${thread.customer.phone}`} className="tabular hover:text-ink">{thread.customer.phone}</a>}
            {thread.assignedTo ? ` · ${thread.assignedTo}` : ' · Unassigned'}
            <span className={cn('ml-2 inline-block size-1.5 rounded-full align-middle', live === 'live' ? 'bg-success' : 'bg-warning')} title={live === 'live' ? 'Live' : 'Refreshing'} />
          </div>
        </div>
        {!thread.assignedTo && <ActionButton size="sm" variant="secondary" icon={<UserCheck strokeWidth={1.5} />} onAction={() => patch({ assignToMe: true }, 'Assigned to you')}>Take</ActionButton>}
        {thread.status !== 'closed' ? <ActionButton size="sm" variant="secondary" icon={<CheckCheck strokeWidth={1.5} />} onAction={() => patch({ status: 'closed' }, 'Closed')}>Close</ActionButton>
          : <ActionButton size="sm" variant="secondary" onAction={() => patch({ status: 'open' }, 'Reopened')}>Reopen</ActionButton>}
      </div>
      {thread.order && <OrderContextCard order={(q.data?.thread.order ?? thread.order)} />}
      <div className="min-h-0 flex-1 overflow-y-auto bg-canvas px-4 py-4">
        {q.isPending ? <RowsSkeleton rows={5} /> : (
          <div className="mx-auto grid max-w-2xl gap-1.5">
            {msgs.length === 0 && <p className="py-10 text-center text-sm text-muted">No messages yet — say hello.</p>}
            <AnimatePresence initial={false}>
              {msgs.map((m, i) => {
                const mine = m.sender === 'staff';
                const showName = days[i] || msgs[i - 1]?.sender !== m.sender;
                const big = isEmojiOnly(m.body);
                return (
                  <motion.div key={m.id ?? m.clientId ?? i} layout initial={{ opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 420, damping: 32 }} className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                    {days[i] && <div className="label-caps my-3 self-center text-subtle">{fmtDate(m.at)}</div>}
                    {showName && <span className="mb-0.5 mt-1 px-1 text-[11px] text-muted">{m.name}</span>}
                    {big ? <div className="text-4xl leading-tight">{m.body}</div> : (
                      <div className={cn('max-w-[78%] whitespace-pre-wrap rounded-lg px-3.5 py-2 text-sm leading-6', mine ? 'rounded-br-xs bg-ink text-on-ink' : 'rounded-bl-xs bg-surface shadow-[0_1px_0_var(--sw-hairline)]', m.state === 'pending' && 'opacity-70')}>
                        {m.media && <MediaImage media={m.media} className="mb-1.5 w-48" sizes="192px" />}
                        {m.body}
                      </div>
                    )}
                    <span className="mt-0.5 flex items-center gap-1 px-1 text-[10px] text-subtle">
                      {fmtAgo(m.at)}
                      {mine && <Ticks m={m} readAt={readAt} />}
                      {m.state === 'failed' && <button type="button" className="font-semibold text-danger underline" onClick={() => void send(m.body, m)}>Retry</button>}
                    </span>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {typing && <div className="mt-1 w-fit rounded-lg rounded-bl-xs bg-surface px-3.5 py-2 text-sm text-muted shadow-[0_1px_0_var(--sw-hairline)]" aria-live="polite">typing…</div>}
            <div ref={end} />
          </div>
        )}
      </div>
      {thread.canReply ? (
        <div className="border-t border-hairline p-3">
          <div className="scrollbar-none mb-2 flex gap-1.5 overflow-x-auto">
            {QUICK.map((s) => <button key={s} type="button" onClick={() => setText(s)} className="h-7 shrink-0 rounded-full border border-hairline px-3 text-[12px] text-muted hover:border-ink/40 hover:text-ink">{s.length > 42 ? `${s.slice(0, 40)}…` : s}</button>)}
          </div>
          <form className="relative flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
            {emoji && <EmojiPicker onPick={(e) => { setText((t) => t + e); input.current?.focus(); }} />}
            <Button type="button" size="icon" variant="ghost" aria-label="Emoji" aria-expanded={emoji} onClick={() => setEmoji((v) => !v)} icon={<Smile strokeWidth={1.5} />} />
            <textarea ref={input} value={text} onChange={(e) => onType(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setEmoji(false); if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(text); } }} rows={1} placeholder="Write a reply…" aria-label="Reply"
              className="max-h-40 min-h-10 flex-1 resize-none rounded-sm border border-hairline bg-surface px-3 py-2 text-sm outline-none focus:border-ink" />
            <Button type="submit" size="icon" aria-label="Send" disabled={!text.trim()} icon={<SendHorizonal strokeWidth={1.5} />} />
          </form>
        </div>
      ) : (
        <p className="border-t border-hairline p-4 text-center text-sm text-muted">This older conversation isn’t linked to an order, so it can’t receive replies.</p>
      )}
    </div>
  );
}

/** Server messages replace optimistic ones (same clientId); keeps time order; unsent ones stay. */
function merge(current: Msg[], incoming: Msg[]): Msg[] {
  const server = new Map<number, Msg>();
  const delivered = new Set<string>();
  for (const m of [...current, ...incoming]) {
    if (m.id == null) continue;
    server.set(m.id, m);
    if (m.clientId) delivered.add(m.clientId);
  }
  const locals = current.filter((m) => m.id == null && !(m.clientId && delivered.has(m.clientId)));
  return [...server.values(), ...locals].sort((a, b) => a.at.localeCompare(b.at));
}
