'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { markCompleting } from '@/app/providers';
import { SwButton, SwIconButton } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Ic, Icon } from '@/components/ui/icons';
import { ChoiceChip, TextField } from '@/components/ui/kit';
import { OtpInput } from '@/components/ui/otp';
import { toast } from '@/components/ui/overlay';
import { SwImage } from '@/components/ui/sw-image';
import { ALoader } from '@/components/ui/aloader';
import { api, ApiException, errorMessage } from '@/lib/api';
import { feature, useConfig, useHome, useT } from '@/lib/hooks';
import { int, list, obj, str } from '@/lib/json';
import { useBack } from '@/lib/nav';
import { googleSignIn, queryClient, requestOtp, verifyOtp } from '@/lib/session';

/** Carries the sign-in context through Welcome → Phone → OTP (`from`, and `return=1` when started by a gated action). */
function useAuthFlow() {
  const sp = useSearchParams();
  const from = sp.get('from');
  const returning = sp.get('return') === '1';
  const qs = [returning ? 'return=1' : '', from ? `from=${encodeURIComponent(from)}` : ''].filter(Boolean).join('&');
  return { from, returning, qs };
}

/** After a successful sign-in, navigate explicitly: back to where the shopper was, the quiz for new shoppers, or Home. */
function useFinishSignIn() {
  const router = useRouter();
  const { from } = useAuthFlow();
  const cfg = useConfig().data;
  return useCallback(
    (isNew: boolean) => {
      markCompleting();
      const safe = from && from.startsWith('/') && !from.startsWith('//') && !from.startsWith('/auth') && !from.startsWith('/welcome') ? from : null;
      if (safe) router.replace(safe);
      else if (isNew && feature(cfg, 'styleQuiz')) router.replace('/auth/quiz');
      else router.replace('/');
    },
    [from, router, cfg],
  );
}

/* ================================================================ Welcome */

export function WelcomeScreen() {
  const t = useT();
  const router = useRouter();
  const cfg = useConfig().data;
  const home = useHome().data;
  const { from, returning, qs } = useAuthFlow();
  const finish = useFinishSignIn();
  const hero = obj(list(list(home, 'sections').find((s) => str(s, 'type') === 'hero'), 'items')[0], 'media');
  const back = useBack('/');
  return (
    <main data-theme="dark" className="relative min-h-dvh bg-canvas lg:grid lg:grid-cols-[1.25fr_1fr]">
      <div className="absolute inset-0 lg:relative lg:min-h-dvh">
        {hero && <SwImage media={hero} aspect={null} rounded="" sizes="(min-width:1024px) 56vw, 100vw" priority dark />}
        <div className="absolute inset-0" style={{ background: 'linear-gradient(to bottom, rgba(14,14,16,.2), rgba(14,14,16,.1) 35%, rgba(14,14,16,.92))' }} />
        <div className="absolute inset-0 hidden lg:block" style={{ background: 'linear-gradient(to right, rgba(14,14,16,0) 60%, rgba(14,14,16,.6))' }} />
      </div>
      <div className="relative flex min-h-dvh flex-col px-6 pb-6 pt-[calc(env(safe-area-inset-top)+16px)] md:mx-auto md:max-w-[520px] md:px-10 md:pb-12 lg:max-w-none lg:justify-center lg:px-16">
        <div className="flex items-center lg:absolute lg:inset-x-16 lg:top-10">
          <Link href="/" className="t-wordmark text-ink">
            SmartWear
          </Link>
          <span className="flex-1" />
          {(returning || from) && <SwIconButton icon={Ic.x} color="var(--sw-ink)" label={t('common.close')} onPress={back} />}
        </div>
        <div className="flex-1 lg:hidden" />
        <div className="lg:max-w-[460px]">
          <h1 className="t-display-xl text-ink lg:text-[64px] lg:leading-[70px]">{t('auth.welcome.title')}</h1>
          <p className="t-body-l mt-3" style={{ color: 'rgba(245,242,236,.8)' }}>
            {t('auth.welcome.subtitle')}
          </p>
          <div className="mt-8 flex flex-col gap-3">
            <GoogleButton clientId={str(obj(cfg, 'auth'), 'googleWebClientId')} onToken={async (tok) => finish(await googleSignIn(tok))} />
            <div data-theme="light">
              <SwButton label={t('auth.phone')} icon={Ic.smartphone} large expand variant="secondary" onPress={() => router.push(`/auth/phone${qs ? `?${qs}` : ''}`)} />
            </div>
            {!returning && !from && feature(cfg, 'guestBrowsing') && (
              <button
                type="button"
                className="t-title-s mx-auto p-4 text-ink underline decoration-accent underline-offset-4"
                onClick={() => {
                  try {
                    localStorage.setItem('sw.welcomed', '1');
                  } catch {
                    /* ignore */
                  }
                  router.replace('/');
                }}
              >
                {t('auth.guest')}
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}

declare global {
  interface Window {
    google?: { accounts: { id: { initialize: (o: Record<string, unknown>) => void; renderButton: (el: HTMLElement, o: Record<string, unknown>) => void; prompt: () => void } } };
  }
}
let gisLoading: Promise<void> | null = null;
function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve();
  return (gisLoading ??= new Promise<void>((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => res();
    s.onerror = () => {
      gisLoading = null;
      rej(new Error('gis'));
    };
    document.head.appendChild(s);
  }));
}

/**
 * "Continue with Google" in SmartWear's style. Google Identity Services renders its own (invisible) button over
 * ours so the click opens Google's account picker; the returned ID token goes to `POST /auth/google`.
 * The web client ID comes from the API at runtime (Admin → Settings → Sign-in), like the app.
 */
function GoogleButton({ clientId, onToken }: { clientId: string; onToken: (idToken: string) => Promise<void> }) {
  const t = useT();
  const overlay = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const cb = useRef(onToken);
  cb.current = onToken;

  useEffect(() => {
    if (!clientId) return;
    let dead = false;
    loadGis()
      .then(() => {
        if (dead || !overlay.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: clientId,
          ux_mode: 'popup',
          callback: async (r: { credential?: string }) => {
            if (!r.credential) return;
            setBusy(true);
            try {
              await cb.current(r.credential);
            } catch (e) {
              toast(errorMessage(e, t), { error: true });
            } finally {
              setBusy(false);
            }
          },
        });
        const w = overlay.current.clientWidth || 360;
        window.google.accounts.id.renderButton(overlay.current, { type: 'standard', theme: 'outline', size: 'large', width: Math.min(400, Math.max(200, w)), text: 'continue_with', shape: 'rectangular' });
        setReady(true);
      })
      .catch(() => setReady(false));
    return () => {
      dead = true;
    };
  }, [clientId, t]);

  return (
    <div className="relative">
      <SwButton label={t('auth.google')} icon={Ic.globe} large expand pending={busy} onPress={!clientId ? () => toast(t('common.notConfigured'), { error: true }) : ready ? () => undefined : () => toast(t('common.loading'))} />
      {clientId && <div ref={overlay} aria-hidden={!ready} className="absolute inset-0 flex items-center justify-center overflow-hidden opacity-[0.011] [&_iframe]:!w-full" style={{ pointerEvents: ready && !busy ? 'auto' : 'none' }} />}
    </div>
  );
}

/* ================================================================ Phone */

const formatTz = (d: string) => d.replace(/\D/g, '').slice(0, 9).replace(/^(\d{3})(\d{0,3})(\d{0,3}).*$/, (_, a, b, c) => [a, b, c].filter(Boolean).join(' '));

export function PhoneScreen() {
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const { qs } = useAuthFlow();
  const cfg = useConfig().data;
  const dial = str(obj(cfg, 'auth'), 'defaultDialCode', '+255');
  const initial = (sp.get('phone') ?? '').replace(/\D/g, '');
  const [value, setValue] = useState(formatTz(initial.length > 9 ? initial.slice(-9) : initial));
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const back = useBack('/welcome');
  const digits = value.replace(/\D/g, '').replace(/^0/, '');
  const valid = digits.length === 9;

  const send = async () => {
    if (sending) return;
    if (!valid) return setError(t('auth.phone.invalid'));
    const phone = `${dial}${digits}`;
    setSending(true);
    try {
      await requestOtp(phone);
      router.push(`/auth/otp?phone=${encodeURIComponent(phone)}${qs ? `&${qs}` : ''}`);
    } catch (e) {
      setError(errorMessage(e, t));
    } finally {
      setSending(false);
    }
  };

  return (
    <AuthFrame onBack={back}>
      <h1 className="t-display-l">{t('auth.phone.title')}</h1>
      <p className="t-body-m mt-2 text-muted">{t('auth.phone.subtitle')}</p>
      <form className="mt-8 flex flex-1 flex-col" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <TextField
          autoFocus
          value={value}
          onChange={(e) => {
            const raw = e.target.value.replace(/\D/g, '');
            setValue(formatTz(raw.startsWith('0') ? raw.slice(1) : raw));
            setError(null);
          }}
          placeholder={t('auth.phone.placeholder')}
          inputMode="tel"
          type="tel"
          autoComplete="tel-national"
          enterKeyHint="send"
          aria-label={t('auth.phone.title')}
          prefix={<span className="t-body-m ml-4 shrink-0 font-semibold">TZ&nbsp;&nbsp;{dial}</span>}
          error={error}
        />
        <div className="flex-1" />
        <div className="mt-8">
          <SwButton type="submit" label={t('auth.phone.send')} large expand pending={sending} onPress={valid && !sending ? send : null} />
        </div>
      </form>
    </AuthFrame>
  );
}

/** Auth step chrome: back arrow on phones; a centred card from tablet up. */
function AuthFrame({ onBack, children, actions }: { onBack?: () => void; children: React.ReactNode; actions?: React.ReactNode }) {
  const t = useT();
  return (
    <main className="flex min-h-dvh flex-col bg-canvas md:items-center md:justify-center md:bg-[color-mix(in_srgb,var(--sw-canvas)_70%,var(--sw-blush))] md:p-8">
      <div className="flex min-h-dvh w-full flex-1 flex-col md:min-h-0 md:max-w-[480px] md:flex-none md:rounded-lg md:border md:border-hairline md:bg-surface md:p-10 md:shadow-[0_30px_80px_rgba(0,0,0,.08)]">
        <div className="flex h-14 items-center px-1 pt-[env(safe-area-inset-top)] md:-ml-3 md:-mt-4 md:mb-2 md:h-11 md:px-0 md:pt-0">
          {onBack && <SwIconButton icon={Ic.arrowLeft} label={t('common.back')} onPress={onBack} />}
          <span className="flex-1" />
          {actions}
        </div>
        <div className="flex flex-1 flex-col px-6 pb-6 pt-4 md:px-0 md:pb-0 md:pt-2">{children}</div>
      </div>
      <Link href="/" className="t-wordmark mt-8 hidden text-muted md:block">
        SmartWear
      </Link>
    </main>
  );
}

/* ================================================================ OTP */

export function OtpScreen() {
  const t = useT();
  const router = useRouter();
  const sp = useSearchParams();
  const phone = sp.get('phone') ?? '';
  const { qs } = useAuthFlow();
  const cfg = useConfig().data;
  const len = int(obj(cfg, 'auth'), 'otpLength', 6);
  const cooldown = int(obj(cfg, 'auth'), 'otpResendCooldownSeconds', 30);
  const finish = useFinishSignIn();
  const [code, setCode] = useState('');
  const [left, setLeft] = useState(cooldown);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);

  useEffect(() => {
    if (!phone) router.replace(`/auth/phone${qs ? `?${qs}` : ''}`);
  }, [phone, qs, router]);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((x) => x - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);

  const verify = useCallback(
    async (c: string) => {
      if (busy || success) return;
      setBusy(true);
      setError(null);
      try {
        const isNew = await verifyOtp(phone, c);
        setBusy(false);
        setSuccess(true);
        markCompleting();
        await new Promise((r) => setTimeout(r, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 120 : 420));
        finish(isNew);
      } catch (e) {
        setBusy(false);
        setCode('');
        const code2 = e instanceof ApiException ? e.code : '';
        setError(
          code2 === 'otp_expired' ? t('auth.otp.expired') : code2 === 'otp_too_many' || code2 === 'rate_limited' ? t('auth.otp.tooMany') : code2 === 'account_blocked' ? t('auth.signedOut.blocked') : e instanceof ApiException && e.isNetwork ? t('common.offlineAction') : t('auth.otp.invalid'),
        );
      }
    },
    [busy, success, phone, finish, t],
  );

  const resend = async () => {
    if (resending || left > 0) return;
    setResending(true);
    try {
      await requestOtp(phone);
      setCode('');
      setError(null);
      setLeft(cooldown);
      toast(t('auth.otp.resent'));
    } catch (e) {
      toast(errorMessage(e, t), { error: true });
    } finally {
      setResending(false);
    }
  };
  const change = () => router.replace(`/auth/phone?phone=${encodeURIComponent(phone)}${qs ? `&${qs}` : ''}`);

  return (
    <AuthFrame onBack={change}>
      <h1 className="t-display-l">{t('auth.otp.title')}</h1>
      <p className="t-body-m mt-2 text-muted">{t('auth.otp.subtitle', { phone })}</p>
      <div className="mt-8">
        <OtpInput value={code} onChange={(v) => { setCode(v); if (error) setError(null); }} onComplete={verify} length={len} error={!!error} success={success} enabled={!busy && !success} />
      </div>
      <div className="mt-4 min-h-6">
        {success ? (
          <p className="t-caption flex items-center gap-2 text-success">
            <Icon icon={Ic.check} size={18} />
            {t('auth.otp.verified')}
          </p>
        ) : busy ? (
          <p className="t-caption flex items-center gap-2">
            <ALoader size="sm" />
            {t('common.loading')}
          </p>
        ) : error ? (
          <p className="t-caption text-danger" role="alert">
            {error}
          </p>
        ) : (
          <p className="t-caption text-subtle">{t('auth.otp.pasteHint')}</p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <SwButton label={left > 0 ? t('auth.otp.resendIn', { seconds: left }) : t('auth.otp.resend')} variant="ghost" onPress={left > 0 || resending || success ? null : resend} />
        <SwButton label={t('auth.otp.change')} variant="ghost" onPress={success ? null : change} />
      </div>
    </AuthFrame>
  );
}

/* ================================================================ Style quiz */

const STYLES = ['Minimal', 'Classic', 'Bold prints', 'Streetwear', 'Modest', 'Occasion', 'Kitenge', 'Clean beauty'];

export function QuizScreen() {
  const t = useT();
  const router = useRouter();
  const [i, setI] = useState(0);
  const [deps, setDeps] = useState<string[]>([]);
  const [styles, setStyles] = useState<string[]>([]);
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const toggle = (l: string[], v: string) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]);
  const done = async (skipped = false) => {
    try {
      await api.put('/me/style-profile', skipped ? { quizCompleted: true } : { departments: deps, styles, sizes, quizCompleted: true });
    } catch {
      /* optional — never block the shopper */
    }
    queryClient.invalidateQueries({ queryKey: ['home'] });
    router.replace('/');
  };
  const cards: [string, React.ReactNode][] = [
    [
      t('auth.quiz.department'),
      <div key="d" className="flex flex-wrap gap-2">
        {(
          [
            ['women', 'Women'],
            ['men', 'Men'],
            ['kids', 'Kids'],
            ['unisex', 'Beauty'],
          ] as const
        ).map(([k, l]) => (
          <ChoiceChip key={k} label={l} selected={deps.includes(k)} onPress={() => setDeps((d) => toggle(d, k))} />
        ))}
      </div>,
    ],
    [
      t('auth.quiz.styles'),
      <div key="s" className="flex flex-wrap gap-2">
        {STYLES.map((s) => (
          <ChoiceChip key={s} label={s} selected={styles.includes(s)} onPress={() => setStyles((d) => toggle(d, s))} />
        ))}
      </div>,
    ],
    [
      t('auth.quiz.sizes'),
      <div key="z">
        {(
          [
            ['tops', ['XS', 'S', 'M', 'L', 'XL']],
            ['shoes', ['37', '38', '39', '40', '41', '42', '43']],
          ] as const
        ).map(([k, opts]) => (
          <div key={k} className="mb-5">
            <p className="t-label-s mb-2 text-muted">{k}</p>
            <div className="flex flex-wrap gap-2">
              {opts.map((o) => (
                <ChoiceChip key={o} label={o} selected={sizes[k] === o} onPress={() => setSizes((z) => ({ ...z, [k]: o }))} />
              ))}
            </div>
          </div>
        ))}
      </div>,
    ],
  ];
  return (
    <AuthFrame
      actions={
        <>
          <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1.5 md:static md:mr-auto md:translate-x-0">
            {[0, 1, 2].map((k) => (
              <span key={k} className="h-0.5 transition-[width,background-color] duration-[240ms]" style={{ width: k === i ? 20 : 6, background: k <= i ? 'var(--sw-ink)' : 'var(--sw-hairline)' }} />
            ))}
          </div>
          <SwButton label={t('common.skip')} variant="ghost" onPress={() => done(true)} />
        </>
      }
    >
      <h1 className="t-display-l">{t('auth.quiz.title')}</h1>
      <p className="t-body-s mt-2 text-muted">{t('auth.quiz.subtitle')}</p>
      <div className="relative mt-6 flex-1 overflow-hidden">
        <div className="flex transition-transform duration-[400ms] ease-[var(--sw-ease-atelier)]" style={{ transform: `translateX(-${i * 100}%)` }}>
          {cards.map(([title, body], k) => (
            <section key={k} className={cn('w-full shrink-0 py-4', k !== i && 'pointer-events-none')} aria-hidden={k !== i}>
              <h2 className="t-display-s">{title}</h2>
              <div className="mt-5">{body}</div>
            </section>
          ))}
        </div>
      </div>
      <div className="mt-6">
        <SwButton label={i < 2 ? t('common.next') : t('auth.quiz.finish')} large expand onPress={() => (i < 2 ? setI(i + 1) : done())} />
      </div>
    </AuthFrame>
  );
}
