'use client';

import { useEffect, useState } from 'react';
import { Avatar, ProfileRow, RowGroup } from '@/components/profile/kit';
import { SwButton, SwIconButton } from '@/components/ui/button';
import { Ic, Icon } from '@/components/ui/icons';
import { Reveal, SwChip } from '@/components/ui/kit';
import { ChoiceList, confirmSw, openSheet } from '@/components/ui/overlay';
import { SwImage } from '@/components/ui/sw-image';
import { api, APP_VERSION } from '@/lib/api';
import { useLoyalty, useReducedMotion, useT } from '@/lib/hooks';
import { flag, int, obj, str, strN, type Json } from '@/lib/json';
import { useAppNav } from '@/lib/nav';
import { isRider, setLocale, setTheme, signOut, usePrefs, useSession, type Locale, type ThemeMode } from '@/lib/session';

export function ProfileScreen() {
  const t = useT();
  const s = useSession();
  const { locale, theme } = usePrefs();
  const nav = useAppNav();
  const u = s.user;
  const go = (p: string) => () => nav.router.push(p);

  const language = () =>
    openSheet((close) => (
      <ChoiceList
        options={[['en', 'English'], ['sw', 'Kiswahili']]}
        selected={locale}
        onSelect={(v) => {
          setLocale(v as Locale);
          if (s.signedIn) void api.patch('/me', { locale: v }).catch(() => undefined);
          close();
        }}
      />
    ), { title: t('profile.language') });
  const themeSheet = () =>
    openSheet((close) => (
      <ChoiceList
        options={[['system', t('profile.theme.system')], ['light', t('profile.theme.light')], ['dark', t('profile.theme.dark')]]}
        selected={theme}
        onSelect={(v) => {
          setTheme(v as ThemeMode);
          close();
        }}
      />
    ), { title: t('profile.theme') });
  const doSignOut = async () => {
    if (await confirmSw({ title: t('profile.signOutConfirm'), confirm: t('auth.signOut') })) await signOut();
  };

  return (
    <main className="pb-tabbar min-h-dvh">
      <Header user={u} />
      <div className="sw-container">
        <div className="md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-8 lg:gap-12">
          <div>
            {u && <Loyalty />}
            {!u && s.ready && (
              <div className="px-5 pt-6 md:px-0">
                <p className="t-body-m text-muted">{t('profile.signInCta')}</p>
                <div className="mt-4 md:max-w-sm">
                  <SwButton label={t('auth.loginRequired')} icon={Ic.user} expand large onPress={() => nav.router.push(nav.signInHref('/profile'))} />
                </div>
              </div>
            )}
            {u && (
              <Reveal index={1} className="px-5 pt-6 md:px-0">
                <RowGroup>
                  <ProfileRow icon={Ic.user} label={t('profile.edit')} href="/profile/edit" />
                  <ProfileRow icon={Ic.receipt} label={t('profile.orders')} href="/orders" />
                  <ProfileRow icon={Ic.heart} label={t('profile.wishlist')} href="/wishlist" />
                  <ProfileRow icon={Ic.shirt} label={t('profile.styleProfile')} href="/auth/quiz" />
                  <ProfileRow icon={Ic.mapPin} label={t('profile.savedPlaces')} href="/places" />
                  <ProfileRow icon={Ic.wallet} label={t('profile.payments')} href="/payments" />
                  <ProfileRow icon={Ic.briefcase} label={t('profile.wholesale')} href="/wholesale" trailing={flag(u, 'wholesaleApproved') ? <SwChip label={t('product.wholesale')} tone="accent" /> : undefined} />
                </RowGroup>
              </Reveal>
            )}
          </div>
          <div>
            <Reveal index={2} className="px-5 pt-6 md:px-0">
              <RowGroup>
                <ProfileRow icon={Ic.bell} label={t('profile.notifications')} onPress={go('/notifications')} />
                <ProfileRow icon={Ic.globe} label={t('profile.language')} trailing={<span className="t-body-s text-muted">{locale === 'sw' ? 'Kiswahili' : 'English'}</span>} onPress={language} />
                <ProfileRow icon={Ic.sunMoon} label={t('profile.theme')} trailing={<span className="t-body-s text-muted">{t(`profile.theme.${theme}`)}</span>} onPress={themeSheet} />
                <ProfileRow icon={Ic.messageCircle} label={t('profile.help')} onPress={go('/support')} />
                {u && <ProfileRow icon={Ic.shield} label={t('profile.privacy')} onPress={go('/privacy')} />}
                {isRider(u) && <ProfileRow icon={Ic.bike} label={t('profile.riderMode')} onPress={go('/rider')} />}
              </RowGroup>
            </Reveal>
            {u && (
              <div className="px-5 pt-6 md:px-0">
                <RowGroup>
                  <ProfileRow icon={Ic.logOut} label={t('auth.signOut')} chevron={false} onPress={doSignOut} />
                </RowGroup>
              </div>
            )}
          </div>
        </div>
        <p className="t-caption py-8 text-center text-subtle">{t('profile.version', { version: `${APP_VERSION} · web` })}</p>
      </div>
    </main>
  );
}

function Header({ user }: { user: Json | null }) {
  const t = useT();
  const nav = useAppNav();
  const name = str(user, 'displayName') || str(user, 'name');
  return (
    <div className="md:sw-container md:pt-8">
      <div className="relative h-[calc(196px+env(safe-area-inset-top))] md:h-[260px]">
        <div className="absolute inset-x-0 bottom-14 top-0 overflow-hidden md:rounded-md">
          {obj(user, 'cover') ? <SwImage media={obj(user, 'cover')} aspect={null} rounded="" sizes="100vw" /> : <div className="h-full w-full" style={{ background: 'linear-gradient(135deg, var(--sw-blush), var(--sw-accent-soft))' }} />}
        </div>
        <div className="absolute inset-x-5 bottom-0 flex items-end gap-4 md:inset-x-8">
          <Avatar user={user} />
          <div className="min-w-0 flex-1 pb-2">
            <p className="t-display-m truncate">{user ? name : t('profile.guest')}</p>
            {strN(user, 'phone') && <p className="t-body-s text-muted">{str(user, 'phone')}</p>}
          </div>
          {user && (
            <div className="pb-2">
              <SwIconButton icon={Ic.pencil} filled label={t('profile.edit')} onPress={() => nav.router.push('/profile/edit')} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Loyalty() {
  const t = useT();
  const q = useLoyalty();
  const reduce = useReducedMotion();
  const [p, setP] = useState(reduce ? 1 : 0);
  const l = q.data;
  useEffect(() => {
    if (!l || reduce) return setP(1);
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const x = Math.min(1, (now - t0) / 1100);
      setP(1 - Math.pow(1 - x, 3));
      if (x < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [l, reduce]);
  if (!l) return <div className="h-6" />;
  const points = int(l, 'points', int(l, 'balance'));
  const tier = obj(l, 'tier');
  const next = obj(l, 'nextTier');
  const progress = next ? Math.min(1, points / Math.max(1, int(next, 'minPoints', 1))) : 1;
  return (
    <div className="px-5 pt-6 md:px-0">
      <div data-theme="dark" className="sw-sheen rounded-md bg-canvas p-5">
        <p className="t-label-s flex items-center gap-2 text-accent">
          <Icon icon={Ic.crown} size={16} />
          {t('profile.tier', { tier: str(tier, 'name', 'Atelier') })}
        </p>
        <p className="t-display-m mt-3 text-ink" aria-label={t('profile.points', { points })}>
          {t('profile.points', { points: Math.round(points * p) })}
        </p>
        <div className="mt-4 h-[3px] overflow-hidden rounded-sm bg-hairline">
          <div className="h-full bg-accent" style={{ width: `${progress * p * 100}%` }} />
        </div>
        {next && <p className="t-caption mt-2 text-muted">{t('profile.toNextTier', { points: int(next, 'minPoints') - points, tier: str(next, 'name') })}</p>}
      </div>
    </div>
  );
}
