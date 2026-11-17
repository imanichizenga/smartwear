'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { SubPage } from '@/components/profile/kit';
import { ALoader } from '@/components/ui/aloader';
import { SwButton, SwIconButton } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Ic, Icon } from '@/components/ui/icons';
import { EmptyState, Hairline, LoadError, Skeleton, SwChip } from '@/components/ui/kit';
import { toast } from '@/components/ui/overlay';
import { PLink } from '@/components/ui/plink';
import { SwImage } from '@/components/ui/sw-image';
import { api, ApiException, errorMessage } from '@/lib/api';
import { useConfig, useT } from '@/lib/hooks';
import { int, list, obj, str, strN, type Json } from '@/lib/json';
import { formatMoney } from '@/lib/money';
import { useBack } from '@/lib/nav';
import { realtime } from '@/lib/realtime';
import { usePrefs } from '@/lib/session';
import { OrderCardSkeletonList, orderTone } from './orders';

type T = (k: string, v?: Record<string, string | number>) => string;
type Router = ReturnType<typeof useRouter>;

/** Opens (or creates) the support conversation of an order, then shows it. */
export async function openSupportChat(router: Router, orderId: string, t: T) {
  try {
    const th = await api.post<Json>('/chat/threads', { orderId });
    router.push(`/chat/${str(th, 'id')}`);
  } catch (e) {
    toast(errorMessage(e, t), { error: true });
  }
}
/** Opens (or reuses) the customer ↔ rider thread for an active delivery. */
export async function openOrderChat(router: Router, orderId: string, t: T) {
  try {
    const th = await api.post<Json>('/chat/threads', { kind: 'order', orderId });
    router.push(`/chat/${str(th, 'id')}?title=${encodeURIComponent(str(th, 'subject') || str(th, 'orderNumber'))}`);
  } catch (e) {
    toast(errorMessage(e, t), { error: true });
  }
}

export function presenceLabel(t: T, p: Json | null) {
  if (!p) return '';
  if (p.online === true) return t('chat.online');
  const at = Date.parse(str(p, 'lastSeenAt'));
  if (!at) return t('chat.replyTime');
  const m = Math.floor((Date.now() - at) / 60000);
  if (m < 1) return t('chat.seenNow');
  if (m < 60) return t('chat.seenMinutes', { count: m });
  if (m < 1440) return t('chat.seenHours', { count: Math.floor(m / 60) });
  const d = new Date(at);
  return t('chat.seenDate', { date: `${d.getDate()}/${d.getMonth() + 1}` });
}

const emojiOnly = (s: string) => {
  const x = s.trim();
  return !!x && [...x].length <= 6 && /^(?:\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(x) && !/[0-9#*]/.test(x);
};
const cid = () => `w-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

/* ================================================================== support hub */

export function SupportScreen() {
  const t = useT();
  const router = useRouter();
  const hub = useQuery({ queryKey: ['me', 'support'], queryFn: () => api.get<Json>('/chat/support') });
  const branding = obj(useConfig().data, 'branding');
  const wa = str(branding, 'supportWhatsApp').replace(/\D/g, '');
  const { locale } = usePrefs();
  const items = list(hub.data, 'items');
  return (
    <SubPage title={t('profile.help')}>
      {hub.isPending ? (
        <OrderCardSkeletonList />
      ) : hub.isError && !hub.data ? (
        <LoadError error={hub.error} onRetry={() => void hub.refetch()} />
      ) : !items.length ? (
        <EmptyState title={t('support.empty.title')} body={t('support.empty.body')} icon={Ic.messageCircle} className="min-h-[55vh] justify-center" action={wa ? <a href={`https://wa.me/${wa}`} target="_blank" rel="noopener noreferrer"><SwButton label={t('support.whatsapp')} icon={Ic.phone} variant="secondary" onPress={() => undefined} /></a> : undefined} />
      ) : (
        <div>
          <div className="flex items-center gap-3 rounded-md border border-hairline bg-surface p-4">
            <span className="flex size-10 items-center justify-center rounded-full bg-ink text-on-ink">
              <Icon icon={Ic.messageCircle} size={18} />
            </span>
            <span>
              <span className="t-title-s block">{t('chat.supportTitle')}</span>
              <span className="t-caption flex items-center gap-1.5 text-muted">
                <span className="block size-[7px] rounded-full" style={{ background: obj(hub.data, 'presence')?.online ? 'var(--sw-success)' : 'var(--sw-subtle)' }} />
                {presenceLabel(t, obj(hub.data, 'presence'))}
              </span>
            </span>
          </div>
          <p className="t-label mb-3 mt-4 text-muted">{t('support.pickOrder')}</p>
          {items.map((it, i) => {
            const o = obj(it, 'order') ?? {};
            const th = obj(it, 'thread');
            const last = obj(th, 'lastMessage');
            const unread = int(th, 'unread');
            return (
              <PLink
                key={i}
                href={th ? `/chat/${str(th, 'id')}` : '#'}
                onNavigate={th ? undefined : () => openSupportChat(router, str(o, 'id'), t)}
                className="mb-3 flex items-center gap-4 rounded-md border bg-surface p-4"
                style={{ borderColor: unread ? 'color-mix(in srgb, var(--sw-ink) 60%, transparent)' : 'var(--sw-hairline)' }}
              >
                <span className="w-12 shrink-0">
                  <SwImage media={obj(o, 'thumbnail')} sizes="48px" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="t-title-s truncate">{str(o, 'number')}</span>
                    <SwChip label={(locale === 'sw' && str(o, 'statusLabelSw')) || str(o, 'statusLabel')} tone={orderTone(str(o, 'status'))} />
                  </span>
                  <span className={cn('t-caption mt-1 block truncate', unread ? 'font-semibold text-ink' : 'text-muted')}>
                    {last ? `${str(last, 'sender') === 'customer' ? `${t('chat.you')}: ` : ''}${str(last, 'body')}` : `${formatMoney(int(o, 'total'), str(o, 'currency', 'TZS'))} · ${t('support.ask')}`}
                  </span>
                </span>
                {unread ? <span className="flex h-5 min-w-5 items-center justify-center rounded-[10px] bg-accent px-1.5 text-[11px] font-bold text-on-accent">{unread}</span> : <Icon icon={Ic.chevronRight} size={18} className="text-subtle" />}
              </PLink>
            );
          })}
        </div>
      )}
    </SubPage>
  );
}

/* ================================================================== chat */

const EMOJI = '😀😂😍🥰😊😉😎🤩🙏👍👌👏🙌💪🔥✨💯❤️🧡💛💚💙💜🖤🤍🎉🎁🛍️👗👠👜💄💅🧴🌸🌺☀️🌙⭐📦🚚🏍️⏰✅❌🤔😅😢😡🥳😴🤝👋'.match(/\p{Extended_Pictographic}️?/gu) ?? [];

export function ChatScreen({ threadId }: { threadId: string }) {
  const t = useT();
  const back = useBack('/support');
  const sp = useSearchParams();
  const { locale } = usePrefs();
  const [items, setItems] = useState<Json[]>([]);
  const [thread, setThread] = useState<Json | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [me, setMe] = useState('customer');
  const [otherReadAt, setOtherReadAt] = useState<number | null>(null);
  const [presence, setPresence] = useState<Json | null>(null);
  const [loading, setLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [typingUntil, setTypingUntil] = useState(0);
  const [newBelow, setNewBelow] = useState(0);
  const [text, setText] = useState('');
  const [emoji, setEmoji] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const support = str(thread, 'kind') === 'support';

  const atBottom = () => {
    const el = scroller.current;
    return !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };
  const toBottom = (smooth = true) => requestAnimationFrame(() => scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }));

  const merge = useCallback((incoming: Json[], current: Json[]) => {
    const server = new Map<string, Json>();
    const delivered = new Set<string>();
    for (const m of [...current, ...incoming]) {
      if (m.id == null) continue;
      server.set(String(m.id), m);
      if (m.clientId) delivered.add(String(m.clientId));
    }
    const locals = current.filter((m) => m.id == null && !delivered.has(String(m.clientId)));
    return [...server.values(), ...locals].sort((a, b) => str(a, 'at').localeCompare(str(b, 'at')));
  }, []);

  const load = useCallback(
    async (quiet = false) => {
      try {
        const r = await api.get<Json>(`/chat/threads/${threadId}/messages`);
        const th = obj(r, 'thread');
        setThread((prev) => {
          if (!prev) setCursor(strN(r, 'nextCursor'));
          return th;
        });
        setMe(obj(th, 'customer') ? 'rider' : 'customer');
        setOtherReadAt(Date.parse(str(th, 'otherReadAt')) || null);
        setPresence((p) => obj(th, 'presence') ?? p);
        setItems((cur) => merge(list(r, 'items'), cur));
        setLoading(false);
        setError(null);
      } catch (e) {
        if (!quiet) {
          setLoading(false);
          setError(e);
        }
      }
    },
    [threadId, merge],
  );

  useEffect(() => {
    void load().then(() => toBottom(false));
    const unsubs = [realtime.subscribe(`thread.${threadId}`)];
    let poll: ReturnType<typeof setInterval> | null = null;
    const sync = (up: boolean) => {
      if (poll) clearInterval(poll);
      poll = up ? null : setInterval(() => void load(true), 8000);
      if (up) void load(true);
    };
    sync(realtime.up);
    const offConn = realtime.onConnected(sync);
    const off = realtime.onEvent((e) => {
      if (e.type === 'presence.changed' && e.who === 'staff') return setPresence({ online: e.online === true, lastSeenAt: e.lastSeenAt });
      if (e.threadId !== threadId) return;
      if (e.type === 'chat.message') {
        const m = e.message as Json;
        const mine = str(m, 'sender') === me;
        const bottom = atBottom();
        setItems((cur) => merge([m], cur));
        if (!mine) {
          setTypingUntil(0);
          if (!bottom) setNewBelow((n) => n + 1);
          else toBottom();
          if (readTimer.current) clearTimeout(readTimer.current);
          readTimer.current = setTimeout(() => !document.hidden && void api.post(`/chat/threads/${threadId}/read`).catch(() => undefined), 600);
        }
      } else if (e.type === 'chat.read' && e.by !== me) setOtherReadAt(Date.parse(String(e.at)) || Date.now());
      else if (e.type === 'chat.typing' && e.by !== me) setTypingUntil(Date.now() + 4000);
    });
    void api.post(`/chat/threads/${threadId}/read`).catch(() => undefined);
    return () => {
      unsubs.forEach((u) => u());
      off();
      offConn();
      if (poll) clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  useEffect(() => {
    if (support) return realtime.subscribe('support.presence');
  }, [support]);
  useEffect(() => {
    if (!typingUntil) return;
    const id = setTimeout(() => setTypingUntil(0), Math.max(0, typingUntil - Date.now()));
    return () => clearTimeout(id);
  }, [typingUntil]);

  const loadOlder = async () => {
    if (olderLoading || !cursor) return;
    setOlderLoading(true);
    const el = scroller.current;
    const before = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      const r = await api.get<Json>(`/chat/threads/${threadId}/messages`, { cursor });
      setCursor(strN(r, 'nextCursor'));
      setItems((cur) => merge(list(r, 'items'), cur));
      requestAnimationFrame(() => el && (el.scrollTop = el.scrollHeight - before));
    } catch {
      /* next scroll */
    } finally {
      setOlderLoading(false);
    }
  };

  const send = async (retry?: Json) => {
    const body = retry ? str(retry, 'body') : text.trim();
    if (!body) return;
    const clientId = retry ? str(retry, 'clientId') : cid();
    if (!retry) setText('');
    const local: Json = { clientId, sender: me, body, at: new Date().toISOString(), _state: 'pending' };
    setItems((cur) => [...cur.filter((m) => !(m.clientId === clientId && m.id == null)), local]);
    setNewBelow(0);
    toBottom();
    try {
      const m = await api.post<Json>(`/chat/threads/${threadId}/messages`, { body, clientId });
      setItems((cur) => merge([m], cur).filter((x) => !(x.id == null && x.clientId === clientId)));
    } catch (e) {
      setItems((cur) => cur.map((x) => (x.clientId === clientId && x.id == null ? { ...x, _state: 'failed' } : x)));
      if (e instanceof ApiException && e.code === 'thread_closed') toast(e.message, { error: true });
    }
  };

  const typing = typingUntil > Date.now();
  const title = support ? t('chat.supportTitle') : sp.get('title') || t('track.chat');
  const status = typing ? t('chat.typing') : support ? presenceLabel(t, presence) : null;
  const canReply = !thread || thread.canReply !== false;
  const order = obj(thread, 'order');

  return (
    <main className="flex h-dvh flex-col bg-canvas md:h-[calc(100dvh-65px)]">
      <div className="sw-narrow flex h-full min-h-0 flex-col md:border-x md:border-hairline md:!px-0">
        <header className="flex h-14 shrink-0 items-center gap-1 border-b border-hairline bg-canvas pt-[env(safe-area-inset-top)] md:h-16 md:px-2">
          <SwIconButton icon={Ic.arrowLeft} label={t('common.back')} onPress={back} />
          <div className="min-w-0 flex-1">
            <h1 className="t-title-m truncate">{title}</h1>
            {status && (
              <p className="t-caption flex items-center gap-1.5 truncate" style={{ color: typing ? 'var(--sw-accent)' : 'var(--sw-muted)' }}>
                {support && !typing && <span className="block size-[7px] rounded-full" style={{ background: presence?.online ? 'var(--sw-success)' : 'var(--sw-subtle)' }} />}
                {status}
              </p>
            )}
          </div>
        </header>
        {order && (
          <PLink href={`/orders/${str(order, 'id')}/track`} overlay={false} scale={false} className="flex shrink-0 items-center gap-3 border-b border-hairline bg-surface py-3 pl-4 pr-3">
            <span className="w-10 shrink-0">
              <SwImage media={obj(order, 'thumbnail')} sizes="40px" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="t-title-s truncate">{str(order, 'number')}</span>
                <SwChip label={(locale === 'sw' && str(order, 'statusLabelSw')) || str(order, 'statusLabel')} tone={orderTone(str(order, 'status'))} />
              </span>
              <span className="t-caption mt-0.5 block truncate text-muted">{[t('checkout.items', { count: int(order, 'itemCount') }), formatMoney(int(order, 'total'), str(order, 'currency', 'TZS'))].join(' · ')}</span>
            </span>
            <Icon icon={Ic.chevronRight} size={18} className="text-subtle" />
          </PLink>
        )}
        <div className="relative min-h-0 flex-1">
          {loading ? (
            <ChatSkeleton />
          ) : error ? (
            <div className="flex h-full items-center justify-center">
              <LoadError error={error} onRetry={() => void load()} />
            </div>
          ) : (
            <div
              ref={scroller}
              className="h-full overflow-y-auto overscroll-contain px-4 py-3"
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop < 300) void loadOlder();
                if (atBottom() && newBelow) setNewBelow(0);
              }}
              onClick={() => setEmoji(false)}
            >
              {olderLoading && <div className="flex justify-center p-4"><ALoader size="xs" /></div>}
              {!items.length ? (
                <div className="flex h-full items-center justify-center">
                  <EmptyState title={t('chat.empty.title')} body={t('chat.empty.body')} icon={Ic.messageCircle} />
                </div>
              ) : (
                <Messages items={items} me={me} otherReadAt={otherReadAt} onRetry={(m) => void send(m)} />
              )}
              {typing && (
                <div className="mt-2 flex">
                  <span className="sw-typing flex gap-1 rounded-2xl border border-hairline bg-surface px-4 py-3" aria-label={t('chat.typing')}>
                    {[0, 1, 2].map((i) => <i key={i} className="block size-1.5 rounded-full bg-muted" />)}
                  </span>
                </div>
              )}
            </div>
          )}
          {newBelow > 0 && (
            <button type="button" onClick={() => { setNewBelow(0); toBottom(); }} className="t-caption absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-ink px-4 py-2 font-semibold text-on-ink">
              <Icon icon={Ic.chevronDown} size={16} />
              {t('chat.newMessages', { count: newBelow })}
            </button>
          )}
        </div>
        {!canReply ? (
          <p className="t-body-s shrink-0 bg-surface px-5 py-4 pb-[calc(16px+env(safe-area-inset-bottom))] text-center text-muted">{t('chat.readOnly')}</p>
        ) : (
          <>
            <form
              className="flex shrink-0 items-end gap-2 border-t border-hairline bg-surface py-2 pl-2 pr-3"
              style={{ paddingBottom: emoji ? 8 : 'calc(8px + env(safe-area-inset-bottom))' }}
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <SwIconButton icon={emoji ? Ic.keyboard : Ic.smile} color="var(--sw-muted)" label={emoji ? t('chat.keyboard') : t('chat.emoji')} onPress={() => { setEmoji(!emoji); if (emoji) input.current?.focus(); }} />
              <textarea
                ref={input}
                rows={1}
                value={text}
                maxLength={4000}
                onFocus={() => setEmoji(false)}
                onChange={(e) => {
                  setText(e.target.value);
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
                  if (e.target.value.trim() && Date.now() - lastTyping.current > 2000) {
                    lastTyping.current = Date.now();
                    realtime.emit({ type: 'chat.typing', threadId });
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder={t('chat.placeholder')}
                aria-label={t('chat.placeholder')}
                className="t-body-m max-h-[140px] min-h-11 flex-1 resize-none rounded-[22px] border border-hairline bg-canvas px-4 py-2.5 outline-none focus:border-ink"
              />
              <SwIconButton icon={Ic.send} filled label={t('chat.send')} onPress={text.trim() ? () => send() : null} />
            </form>
            {emoji && (
              <div className="grid shrink-0 grid-cols-8 gap-1 border-t border-hairline bg-canvas p-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:grid-cols-12">
                {EMOJI.map((e, i) => (
                  <button key={i} type="button" className="flex h-11 items-center justify-center rounded-md text-[26px] hover:bg-surface" onClick={() => setText((x) => x + e)}>
                    {e}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Messages({ items, me, otherReadAt, onRetry }: { items: Json[]; me: string; otherReadAt: number | null; onRetry: (m: Json) => void }) {
  const t = useT();
  return (
    <div>
      {items.map((m, i) => {
        const at = new Date(str(m, 'at'));
        const prev = items[i - 1];
        const next = items[i + 1];
        const pAt = prev ? new Date(str(prev, 'at')) : null;
        const nAt = next ? new Date(str(next, 'at')) : null;
        const newDay = !pAt || !sameDay(pAt, at);
        const groupedPrev = !newDay && prev && str(prev, 'sender') === str(m, 'sender') && at.getTime() - pAt!.getTime() < 300000;
        const groupedNext = next && str(next, 'sender') === str(m, 'sender') && sameDay(nAt!, at) && nAt!.getTime() - at.getTime() < 300000;
        const mine = str(m, 'sender') === me;
        const state = strN(m, '_state');
        const body = str(m, 'body');
        const emoji = emojiOnly(body);
        const read = otherReadAt != null && m.id != null && at.getTime() <= otherReadAt;
        const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
        const today = new Date();
        const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(at.toDateString()).getTime()) / 86400000);
        const meta = (
          <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: mine && !emoji ? 'color-mix(in srgb, var(--sw-on-ink) 70%, transparent)' : 'var(--sw-subtle)' }}>
            {time}
            {mine && (state === 'failed' ? <Icon icon={Ic.circleAlert} size={13} className="text-danger" /> : state === 'pending' ? <Icon icon={Ic.clock} size={12} /> : <Ticks read={read} />)}
          </span>
        );
        const radius = { borderTopLeftRadius: 16, borderTopRightRadius: 16, borderBottomLeftRadius: mine || !groupedNext ? 16 : 4, borderBottomRightRadius: !mine || !groupedNext ? 16 : 4 };
        return (
          <div key={String(m.id ?? m.clientId)}>
            {newDay && (
              <div className="my-4 flex items-center gap-3">
                <Hairline className="flex-1" />
                <span className="t-label-s text-subtle">{diff === 0 ? t('chat.today') : diff === 1 ? t('chat.yesterday') : `${at.getDate()}/${at.getMonth() + 1}/${at.getFullYear()}`}</span>
                <Hairline className="flex-1" />
              </div>
            )}
            <div className={cn('flex', mine ? 'justify-end' : 'justify-start', groupedPrev ? 'mt-0.5' : 'mt-2')} style={{ opacity: state === 'pending' ? 0.75 : 1 }}>
              <button type="button" disabled={state !== 'failed'} onClick={() => onRetry(m)} className="flex max-w-[76%] flex-col items-end text-left disabled:cursor-text md:max-w-[70%]">
                {emoji ? (
                  <span className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
                    <span className="text-[40px] leading-[1.15]">{body}</span>
                    {meta}
                  </span>
                ) : (
                  <span className={cn('block px-4 py-2 pr-3', mine ? 'bg-ink text-on-ink' : 'border border-hairline bg-surface text-ink', state === 'failed' && 'opacity-70')} style={radius}>
                    {!mine && !groupedPrev && <span className="t-label-s mb-0.5 block text-muted">{str(m, 'name')}</span>}
                    <span className="flex flex-wrap items-end justify-end gap-x-2">
                      <span className="t-body-m whitespace-pre-wrap break-words" style={{ color: 'inherit' }}>{body}</span>
                      <span className="pt-1">{meta}</span>
                    </span>
                  </span>
                )}
                {state === 'failed' && <span className="t-caption mt-0.5 text-danger">{t('chat.failedTapRetry')}</span>}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Ticks({ read }: { read: boolean }) {
  return (
    <span className="relative inline-block h-3" style={{ width: read ? 18 : 12, color: read ? 'var(--sw-accent)' : undefined }}>
      <Icon icon={Ic.check} size={12} className="absolute left-0" />
      {read && <Icon icon={Ic.check} size={12} className="absolute left-1.5" />}
    </span>
  );
}

function ChatSkeleton() {
  const w = [180, 120, 220, 90, 160, 200];
  return (
    <div className="flex flex-col gap-3 p-4" role="status" aria-label="Loading">
      {w.map((x, i) => (
        <div key={i} className={cn('flex', i % 2 ? 'justify-end' : 'justify-start')}>
          <Skeleton w={x} h={i % 3 === 2 ? 56 : 40} r={16} />
        </div>
      ))}
    </div>
  );
}


