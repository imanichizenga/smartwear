'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppBar } from '@/components/shell/app-shell';
import { SwButton, SwIconButton } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Ic, Icon } from '@/components/ui/icons';
import { CountUpMoney, EmptyState, LoadError, Reveal, SectionHeader, Skeleton, SkeletonLine, SwChip, TextField } from '@/components/ui/kit';
import { toast } from '@/components/ui/overlay';
import { SwImage } from '@/components/ui/sw-image';
import { errorMessage } from '@/lib/api';
import { cartApi, setCartQty, useCart, useT } from '@/lib/hooks';
import { int, list, obj, str, strN, type Json } from '@/lib/json';
import { formatAmount, formatMoney } from '@/lib/money';
import { useAppNav } from '@/lib/nav';
import { useSession } from '@/lib/session';

/** The bag shows exactly what the server priced: unit price applied, tier, savings, totals. */
export function BagScreen() {
  const t = useT();
  const cart = useCart();
  const { signedIn, ready } = useSession();
  const nav = useAppNav();
  const c = cart.data;
  const items = list(c, 'items');
  const saved = list(c, 'savedForLater');
  const cur = str(c, 'currency', 'TZS');

  let body: React.ReactNode;
  if (!ready || (cart.isPending && !c)) body = <BagSkeleton />;
  else if (cart.isError && !c) body = <div className="flex min-h-[60vh] items-center justify-center"><LoadError error={cart.error} onRetry={() => void cart.refetch()} /></div>;
  else if (!items.length && !saved.length)
    body = (
      <div className="flex min-h-[65vh] items-center justify-center">
        <EmptyState
          title={t('bag.empty.title')}
          body={t('bag.empty.body')}
          icon={Ic.shoppingBag}
          action={
            <div className="flex flex-col items-center gap-3">
              <SwButton label={t('bag.empty.cta')} onPress={() => nav.router.push('/')} />
              {!signedIn && (
                <Link href={nav.signInHref('/bag')} className="t-title-s link-accent">
                  {t('auth.loginRequired')}
                </Link>
              )}
            </div>
          }
        />
      </div>
    );
  else
    body = (
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_380px] md:items-start md:gap-10 lg:gap-16">
        <div className="px-5 pb-[calc(260px+env(safe-area-inset-bottom))] md:px-0 md:pb-0">
          {list(c, 'problems').length > 0 && <Problems problems={list(c, 'problems')} />}
          {items.map((i, k) => (
            <Reveal key={String(i.id)} index={k}>
              <Line item={i} currency={cur} />
            </Reveal>
          ))}
          <div className="mt-6 md:hidden">
            <Promo applied={obj(c, 'promo')} />
          </div>
          {saved.length > 0 && (
            <>
              <SectionHeader title={t('bag.savedForLater')} className="!px-0 !pb-4 !pt-10" />
              {saved.map((i) => (
                <Line key={String(i.id)} item={i} currency={cur} saved />
              ))}
            </>
          )}
        </div>
        <Summary cart={c!} />
      </div>
    );

  return (
    <main className="min-h-dvh md:pb-16">
      <div className="sw-container">
        <AppBar title={t('bag.title')} titleClass="t-display-s md:t-display-l" />
        <div className="md:pt-6">{body}</div>
      </div>
    </main>
  );
}

function BagSkeleton() {
  return (
    <div className="flex flex-col gap-8 px-5 py-6 md:px-0">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex gap-4">
          <div className="w-[92px] shrink-0">
            <Skeleton aspect={4 / 5} />
          </div>
          <div className="flex flex-1 flex-col gap-2">
            <SkeletonLine w={64} h={10} />
            <SkeletonLine h={14} />
            <SkeletonLine w={120} h={14} />
            <SkeletonLine w={88} h={16} />
            <Skeleton w={108} h={40} r={999} className="mt-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function Problems({ problems }: { problems: Json[] }) {
  const t = useT();
  return (
    <div className="my-2 flex gap-3 rounded-sm bg-warning-soft p-4">
      <Icon icon={Ic.circleAlert} size={18} className="shrink-0 text-warning" />
      <div>
        <p className="t-title-s">{t('bag.problems.title')}</p>
        {problems.map((p, i) => (
          <p key={i} className="t-caption mt-1 text-ink">
            {str(p, 'message')}
          </p>
        ))}
      </div>
    </div>
  );
}

function Line({ item, currency, saved = false }: { item: Json; currency: string; saved?: boolean }) {
  const t = useT();
  const id = int(item, 'id');
  const [pending, setPending] = useState<number | null>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dx, setDx] = useState(0);
  const touch = useRef<{ x: number; y: number; lock?: 'h' | 'v' } | null>(null);
  const qty = pending ?? int(item, 'qty');
  const next = obj(item, 'nextTier');

  const remove = async () => {
    if (debounce.current) clearTimeout(debounce.current);
    try {
      await setCartQty(id, 0);
      toast(t('bag.removed'), { icon: Ic.trash2, action: { label: t('common.undo'), onPress: () => void cartApi.add(str(item, 'variantId'), int(item, 'qty', 1)).catch(() => undefined) } });
    } catch (e) {
      setDx(0);
      toast(errorMessage(e, t), { error: true });
    }
  };
  const setQty = (q: number) => {
    if (q <= 0) return void remove();
    setPending(q);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      try {
        await setCartQty(id, q);
      } catch (e) {
        toast(errorMessage(e, t), { error: true });
      } finally {
        setPending(null);
      }
    }, 350);
  };

  return (
    <div className="relative overflow-hidden">
      <div className="absolute inset-0 flex items-center justify-end bg-danger-soft pr-6 text-danger" aria-hidden style={{ opacity: dx < 0 ? 1 : 0 }}>
        <Icon icon={Ic.trash2} size={22} />
      </div>
      <div
        className="relative flex gap-4 bg-canvas py-4 md:border-b md:border-hairline md:py-6"
        style={{ transform: `translateX(${dx}px)`, transition: touch.current ? 'none' : 'transform 240ms var(--sw-ease-atelier)' }}
        onTouchStart={(e) => (touch.current = { x: e.touches[0]!.clientX, y: e.touches[0]!.clientY })}
        onTouchMove={(e) => {
          const s = touch.current;
          if (!s) return;
          const mx = e.touches[0]!.clientX - s.x;
          const my = e.touches[0]!.clientY - s.y;
          if (!s.lock) s.lock = Math.abs(mx) > Math.abs(my) + 4 ? 'h' : Math.abs(my) > 8 ? 'v' : undefined;
          if (s.lock === 'h') setDx(Math.min(0, mx));
        }}
        onTouchEnd={(e) => {
          const w = (e.currentTarget as HTMLElement).clientWidth;
          const far = dx < -w * 0.35;
          touch.current = null;
          if (far) {
            setDx(-w);
            void remove();
          } else setDx(0);
        }}
      >
        <Link href={`/p/${encodeURIComponent(str(item, 'slug'))}`} className="press w-[92px] shrink-0 md:w-[120px]">
          <SwImage media={obj(item, 'image')} sizes="120px" />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="t-label-s text-muted">{str(item, 'brand')}</p>
          <p className="t-body-m mt-0.5 line-clamp-2">{str(item, 'title')}</p>
          {str(item, 'options') && <p className="t-caption text-muted">{str(item, 'options')}</p>}
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
            <CountUpMoney amount={int(item, 'lineTotal')} currency={currency} className="t-price-s" />
            {qty > 1 && <span className="t-caption text-muted">{`${formatMoney(int(item, 'unitPrice'), currency)} ${t('product.tierEach', { price: '' }).trim()}`}</span>}
            {strN(item, 'tier') && <SwChip label={t('bag.tier', { label: str(item, 'tier') })} tone="accent" />}
            {int(item, 'savings') > 0 && <span className="t-caption text-success">{t('bag.savings', { amount: formatMoney(int(item, 'savings'), currency) })}</span>}
          </div>
          {next && <p className="t-caption mt-1 text-ink">{t('product.tierNudge', { count: int(next, 'minQty') - qty, price: formatAmount(int(next, 'unitPrice'), currency) })}</p>}
          <div className="mt-3 flex items-center">
            {!saved && (
              <div className="flex h-11 items-center rounded-full border border-hairline">
                <SwIconButton icon={qty > 1 ? Ic.minus : Ic.trash2} size={44} iconSize={18} label={t('bag.decrease')} onPress={() => setQty(qty - 1)} />
                <span className="t-title-s w-6 text-center tabular">{qty}</span>
                <SwIconButton icon={Ic.plus} size={44} iconSize={18} label={t('bag.increase')} onPress={() => setQty(qty + 1)} />
              </div>
            )}
            <span className="flex-1" />
            <button type="button" onClick={() => void cartApi.saveForLater(id, !saved).catch((e) => toast(errorMessage(e, t), { error: true }))} className="t-caption min-h-11 px-2 text-ink underline">
              {saved ? t('bag.moveToBag') : t('bag.saveForLater')}
            </button>
            <button type="button" onClick={() => void remove()} className="t-caption ml-1 hidden min-h-11 px-2 text-muted underline hover:text-danger md:block">
              {t('common.remove')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Promo({ applied }: { applied: Json | null }) {
  const t = useT();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (applied)
    return (
      <p className="flex items-center gap-2">
        <Icon icon={Ic.tag} size={16} className="text-success" />
        <span className="t-title-s">{str(applied, 'code')}</span>
      </p>
    );
  const apply = async () => {
    if (busy || !code.trim()) return;
    setBusy(true);
    try {
      await cartApi.applyPromo(code.trim());
      setError(null);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="flex items-start gap-2" onSubmit={(e) => { e.preventDefault(); void apply(); }}>
      <TextField className="flex-1" value={code} onChange={(e) => { setCode(e.target.value); setError(null); }} placeholder={t('bag.promo')} leadingIcon={Ic.tag} error={error} enterKeyHint="done" autoCapitalize="characters" />
      <SwButton label={t('bag.promo.apply')} variant="secondary" pending={busy} onPress={busy ? null : apply} className="!h-[52px]" />
    </form>
  );
}

/** Totals and Checkout: flush above the tab bar on phones, a sticky card beside the lines from tablet up. */
function Summary({ cart }: { cart: Json }) {
  const t = useT();
  const router = useRouter();
  const cur = str(cart, 'currency', 'TZS');
  const row = (k: string, v: React.ReactNode, cls?: string) => (
    <div className="flex items-center py-0.5">
      <span className="t-body-s flex-1 text-muted">{k}</span>
      <span className={cn('t-body-s', cls)}>{v}</span>
    </div>
  );
  return (
    <div className={cn('fixed inset-x-0 bottom-[calc(76px+env(safe-area-inset-bottom))] z-20 border-t border-hairline bg-surface px-5 pb-3 pt-4', 'md:sticky md:top-24 md:bottom-auto md:z-0 md:rounded-md md:border md:p-6')}>
      <div className="hidden md:mb-5 md:block">
        <p className="t-label mb-3 text-muted">{t('checkout.summary')}</p>
        <Promo applied={obj(cart, 'promo')} />
      </div>
      {row(t('bag.subtotal'), <CountUpMoney amount={int(cart, 'subtotal')} currency={cur} />)}
      {int(cart, 'discount') > 0 && row(t('bag.discount'), `−${formatMoney(int(cart, 'discount'), cur)}`, 'text-success')}
      {int(cart, 'savings') > 0 && row(t('bag.savings', { amount: '' }).trim(), formatMoney(int(cart, 'savings'), cur), 'text-success')}
      {int(cart, 'tax') > 0 && row(t('bag.tax'), formatMoney(int(cart, 'tax'), cur))}
      <div className="mt-1 flex items-center md:mt-3 md:border-t md:border-hairline md:pt-3">
        <span className="t-title-m flex-1">{t('bag.total')}</span>
        <CountUpMoney amount={int(cart, 'total')} currency={cur} className="t-price-m" />
      </div>
      <div className="mt-3">
        <SwButton label={t('bag.checkout')} icon={Ic.arrowRight} large expand onPress={list(cart, 'items').length ? () => router.push('/checkout') : null} />
      </div>
    </div>
  );
}
