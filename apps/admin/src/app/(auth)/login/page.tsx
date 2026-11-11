'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import QRCode from 'qrcode';
import { ArrowRight, Copy, KeyRound, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { LoaderBlock } from '@/components/brand/LoaderA';
import { Button } from '@/components/ui/button';
import { CodeInput } from '@/components/ui/code-input';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';
import { usePendingAction } from '@/lib/use-pending';

type Step = 'loading' | 'bootstrap' | 'password' | 'mfa-setup' | 'mfa-verify' | 'recovery-codes';
interface LoginRes {
  mfa: 'setup' | 'verify';
}

export default function LoginPage() {
  return (
    <Suspense fallback={<LoaderBlock />}>
      <Login />
    </Suspense>
  );
}

function Login() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [step, setStep] = useState<Step>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const me = await api<{ mfaPassed: boolean; admin: { mfaEnabled: boolean } }>('/admin/auth/me');
        if (me.mfaPassed) return router.replace(next);
        return setStep(me.admin.mfaEnabled ? 'mfa-verify' : 'mfa-setup');
      } catch {
        /* not signed in */
      }
      try {
        const b = await api<{ needsBootstrap: boolean }>('/admin/auth/bootstrap');
        setStep(b.needsBootstrap ? 'bootstrap' : 'password');
      } catch {
        setStep('password');
      }
    })();
  }, [next, router]);

  const done = () => {
    router.replace(next);
    router.refresh();
  };

  return (
    <div>
      {step === 'loading' && <LoaderBlock className="min-h-64" />}
      {step === 'bootstrap' && <Bootstrap onDone={() => setStep('mfa-setup')} />}
      {step === 'password' && <Password error={error} setError={setError} onDone={(r) => setStep(r.mfa === 'setup' ? 'mfa-setup' : 'mfa-verify')} />}
      {step === 'mfa-setup' && <MfaSetup onDone={() => setStep('recovery-codes')} />}
      {step === 'mfa-verify' && <MfaVerify onDone={done} />}
      {step === 'recovery-codes' && <RecoveryCodes onDone={done} />}
    </div>
  );
}

function safeNext(n: string | null): string {
  return n && n.startsWith('/') && !n.startsWith('//') ? n : '/';
}

function Heading({ eyebrow, title, body }: { eyebrow: string; title: string; body?: string }) {
  return (
    <div className="mb-8">
      <p className="label-caps mb-3 text-muted">{eyebrow}</p>
      <h1 className="text-4xl leading-[44px]">{title}</h1>
      {body && <p className="mt-3 text-sm leading-6 text-muted">{body}</p>}
    </div>
  );
}

function Password({ onDone, error, setError }: { onDone: (r: LoginRes) => void; error: string | null; setError: (e: string | null) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submit, pending] = usePendingAction(async () => {
    setError(null);
    try {
      onDone(await api<LoginRes>('/admin/auth/login', { body: { email, password } }));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach SmartWear. Check your connection.');
    }
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Heading eyebrow="SmartWear Admin" title="Welcome back" body="Sign in with your work email. You'll confirm with your authenticator next." />
      <div className="flex flex-col gap-5">
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}</Field>
        <Field label="Password" error={error}>
          {(id, d) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={d} aria-invalid={!!error || undefined} />}
        </Field>
        <Button type="submit" size="lg" pending={pending} iconRight={<ArrowRight strokeWidth={1.5} />} className="mt-2 w-full">
          Continue
        </Button>
      </div>
    </form>
  );
}

function Bootstrap({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);
  const [submit, pending] = usePendingAction(async () => {
    setError(null);
    try {
      await api('/admin/auth/bootstrap', { body: form });
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <Heading eyebrow="First run" title="Open the atelier" body="Create the Super Admin account. You'll set up two-factor authentication straight after." />
      <div className="flex flex-col gap-5">
        <Field label="Your name">{(id) => <Input id={id} required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />}</Field>
        <Field label="Work email">{(id) => <Input id={id} type="email" required autoComplete="username" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}</Field>
        <Field label="Password" help="At least 12 characters." error={error}>
          {(id, d) => <Input id={id} type="password" minLength={12} required autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-describedby={d} />}
        </Field>
        <Button type="submit" size="lg" pending={pending} className="mt-2 w-full">
          Create Super Admin
        </Button>
      </div>
    </form>
  );
}

function MfaSetup({ onDone }: { onDone: () => void }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ secret: string; otpauthUrl: string }>('/admin/auth/mfa/setup', { method: 'POST' }).then(async (r) => {
      setSecret(r.secret);
      setQr(await QRCode.toString(r.otpauthUrl, { type: 'svg', margin: 0, color: { dark: '#0B0B0C', light: '#FFFFFF' } }));
    }, (e) => setError(e instanceof ApiError ? e.message : 'Could not start setup'));
  }, []);
  const [confirm, pending] = usePendingAction(async (c: string) => {
    setError(null);
    try {
      const r = await api<{ recoveryCodes: string[] }>('/admin/auth/mfa/confirm', { body: { code: c } });
      sessionStorage.setItem('sw_recovery', JSON.stringify(r.recoveryCodes));
      onDone();
    } catch (e) {
      setCode('');
      setError(e instanceof ApiError ? e.message : 'That code did not work');
    }
  });
  return (
    <div>
      <Heading eyebrow="Two-factor · required" title="Secure your account" body="Scan the code with Google Authenticator, 1Password or Authy, then enter the 6-digit code it shows." />
      <div className="mb-6 flex items-center gap-5 rounded-md border border-hairline bg-surface p-5">
        <div className="size-32 shrink-0 rounded-sm bg-surface p-1 [&>svg]:size-full" aria-label="Authenticator QR code" role="img" dangerouslySetInnerHTML={qr ? { __html: qr } : undefined}>
          {qr ? undefined : <div className="sw-skeleton size-full" />}
        </div>
        <div className="min-w-0 text-[13px]">
          <p className="text-muted">Can&apos;t scan? Enter this key:</p>
          <button
            type="button"
            className="mt-1.5 inline-flex max-w-full items-center gap-1.5 break-all text-left font-mono text-xs text-ink hover:text-accent"
            onClick={() => secret && navigator.clipboard.writeText(secret).then(() => toast.success('Key copied'))}
          >
            {secret ?? '…'} <Copy className="size-3.5 shrink-0" strokeWidth={1.5} />
          </button>
        </div>
      </div>
      <CodeInput value={code} onChange={setCode} onComplete={(c) => void confirm(c)} disabled={pending || !secret} invalid={!!error} autoFocus />
      {error && <p className="mt-3 text-xs text-danger">{error}</p>}
      <Button size="lg" className="mt-6 w-full" pending={pending} disabled={code.length < 6} icon={<ShieldCheck strokeWidth={1.5} />} onClick={() => void confirm(code)}>
        Turn on two-factor
      </Button>
    </div>
  );
}

function MfaVerify({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verify, pending] = usePendingAction(async (c?: string) => {
    setError(null);
    try {
      await api('/admin/auth/mfa/verify', { body: recovery !== null ? { recoveryCode: recovery } : { code: c ?? code } });
      onDone();
    } catch (e) {
      setCode('');
      setError(e instanceof ApiError ? e.message : 'That code did not work');
    }
  });
  return (
    <div>
      <Heading eyebrow="Two-factor" title="Confirm it's you" body={recovery === null ? 'Enter the 6-digit code from your authenticator app.' : 'Enter one of the recovery codes you saved when you set up two-factor.'} />
      {recovery === null ? (
        <CodeInput value={code} onChange={setCode} onComplete={(c) => void verify(c)} disabled={pending} invalid={!!error} autoFocus />
      ) : (
        <Field label="Recovery code" error={error}>
          {(id) => <Input id={id} value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="xxxx-xxxx" autoFocus className="font-mono" />}
        </Field>
      )}
      {error && recovery === null && <p className="mt-3 text-xs text-danger">{error}</p>}
      <Button size="lg" className="mt-6 w-full" pending={pending} disabled={recovery === null ? code.length < 6 : recovery.length < 6} onClick={() => void verify()}>
        Verify
      </Button>
      <Button variant="link" size="sm" icon={<KeyRound strokeWidth={1.5} />} className="mt-4" onClick={() => { setError(null); setRecovery(recovery === null ? '' : null); }}>
        {recovery === null ? 'Use a recovery code instead' : 'Use the authenticator app'}
      </Button>
    </div>
  );
}

function RecoveryCodes({ onDone }: { onDone: () => void }) {
  const [codes] = useState<string[]>(() => {
    try {
      return JSON.parse(sessionStorage.getItem('sw_recovery') || '[]');
    } catch {
      return [];
    }
  });
  const finish = () => {
    sessionStorage.removeItem('sw_recovery');
    onDone();
  };
  return (
    <div>
      <Heading eyebrow="Two-factor is on" title="Save your recovery codes" body="Each code works once if you lose your phone. Store them somewhere safe — they won't be shown again." />
      <div className="grid grid-cols-2 gap-2 rounded-md border border-hairline bg-surface p-5 font-mono text-sm tabular">
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="mt-6 flex gap-2">
        <Button variant="secondary" size="lg" className="flex-1" icon={<Copy strokeWidth={1.5} />} onClick={() => navigator.clipboard.writeText(codes.join('\n')).then(() => toast.success('Recovery codes copied'))}>
          Copy
        </Button>
        <Button size="lg" className="flex-1" onClick={finish}>
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}
