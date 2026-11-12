'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { LoaderBlock } from '@/components/brand/LoaderA';
import { ActionButton } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { api, ApiError } from '@/lib/api';

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<LoaderBlock />}>
      <Accept />
    </Suspense>
  );
}

function Accept() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';
  const [invite, setInvite] = useState<{ email: string; name: string; role: string } | null | 'invalid'>(null);
  const [name, setName] = useState('');
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<{ email: string; name: string; role: string }>('/admin/auth/accept-invite', { query: { token } }).then(
      (i) => { setInvite(i); setName(i.name); },
      () => setInvite('invalid'),
    );
  }, [token]);
  if (invite === null) return <LoaderBlock className="min-h-64" />;
  if (invite === 'invalid') return (
    <div>
      <h1 className="text-4xl leading-[44px]">This invite has expired</h1>
      <p className="mt-3 text-sm text-muted">Invites last 7 days and work once. Ask a team admin to send a new one.</p>
    </div>
  );
  const strong = pw.length >= 12;
  return (
    <form onSubmit={(e) => e.preventDefault()}>
      <p className="label-caps text-muted">Joining as {invite.role}</p>
      <h1 className="mt-2 text-4xl leading-[44px]">Welcome to the atelier</h1>
      <p className="mt-3 text-sm text-muted">{invite.email} · choose a password, then set up two-factor sign-in.</p>
      <div className="mt-8 grid gap-4">
        <Field label="Your name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}</Field>
        <Field label="Password" help={strong ? 'Strong enough.' : 'At least 12 characters — a short sentence works well.'} error={error}>
          {(id, d) => <Input id={id} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" aria-describedby={d} />}
        </Field>
        <ActionButton size="lg" iconRight={<ArrowRight strokeWidth={1.5} />} disabled={!strong || !name.trim()} onAction={async () => {
          try {
            await api('/admin/auth/accept-invite', { body: { token, name, password: pw } });
            router.replace('/login');
          } catch (e) {
            setError(e instanceof ApiError ? e.message : 'Could not create your account');
          }
        }}>Create account</ActionButton>
      </div>
    </form>
  );
}
