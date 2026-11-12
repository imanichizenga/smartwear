'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, ExternalLink, HandCoins, RefreshCw, Send, Settings2, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { Card, CardHeader, Chip, EmptyState, PageHeader, Skeleton, Stat, type Tone } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { cn } from '@/lib/cn';
import { fmtAgo, fmtDateTime, fmtMoney, fmtNum, titleCase } from '@/lib/format';

interface Balance {
  rider: { id: string; name: string; phone: string | null; status: string; payoutMethod: string | null; payoutAccount: string | null };
  earned: number;
  jobs: number;
  paid: number;
  pending: number;
  unpaid: number;
  lastDeliveryAt: string | null;
  lastPayoutAt: string | null;
}
interface Payout {
  id: string;
  riderId: string;
  riderName: string | null;
  method: 'snippe' | 'manual';
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
  amount: number;
  fee: number;
  currency: string;
  reference: string;
  providerRef: string | null;
  externalRef: string | null;
  network: string | null;
  recipient: string | null;
  note: string | null;
  failureReason: string | null;
  createdAt: string;
  completedAt: string | null;
  createdBy: string | null;
}
interface PayoutsData {
  balances: Balance[];
  items: Payout[];
  config: { provider: 'manual' | 'snippe'; snippeReady: boolean; minimum: number; currency: string };
}

const tone = (s: Payout['status']): Tone => (s === 'COMPLETED' ? 'success' : s === 'PENDING' ? 'warning' : 'danger');
const NETWORK: Record<string, string> = { airtel: 'Airtel Money', mpesa: 'M-Pesa', vodacom: 'M-Pesa', tigo: 'Mixx by Yas', mixx: 'Mixx by Yas', halotel: 'HaloPesa', halopesa: 'HaloPesa' };

export function PayoutsWorkspace() {
  const qc = useQueryClient();
  const canPay = useCan('payouts.manage');
  const { data, isPending } = useQuery({ queryKey: ['payouts'], queryFn: () => api<PayoutsData>('/admin/payouts'), refetchInterval: 30_000 });
  const [paying, setPaying] = useState<Balance | null>(null);
  const cfg = data?.config;
  const cur = cfg?.currency ?? 'TZS';
  const owed = data?.balances.reduce((a, b) => a + b.unpaid, 0) ?? 0;
  const inFlight = data?.items.filter((p) => p.status === 'PENDING').reduce((a, p) => a + p.amount, 0) ?? 0;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).getTime();
  const paidMonth = data?.items.filter((p) => p.status === 'COMPLETED' && new Date(p.completedAt ?? p.createdAt).getTime() >= monthStart).reduce((a, p) => a + p.amount, 0) ?? 0;

  const sync = async (p: Payout) => {
    try {
      const r = await api<Payout>(`/admin/payouts/${p.id}/sync`, { method: 'POST' });
      toast.success(r.status === 'COMPLETED' ? `${fmtMoney(r.amount, r.currency)} reached ${r.riderName}` : r.status === 'PENDING' ? 'Snippe is still processing it' : `Payout ${r.status.toLowerCase()}`);
      await qc.invalidateQueries({ queryKey: ['payouts'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not reach Snippe');
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Delivery"
        title="Rider payouts"
        description="What each rider has earned from completed deliveries, and what has been paid. Snippe sends earnings straight to the rider's mobile-money wallet; failed payouts return to the balance automatically."
        actions={
          <>
            {cfg?.provider === 'snippe' && (
              <a href="https://snippe.sh/dashboard" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-sm px-3 text-[13px] font-semibold text-muted hover:bg-ink/5 hover:text-ink">
                Snippe dashboard <ExternalLink className="size-3.5" strokeWidth={1.5} />
              </a>
            )}
            <AppLink href="/settings/payments" icon={<Settings2 strokeWidth={1.5} />} className="h-10 rounded-sm border border-ink/18 bg-surface px-4 text-sm font-semibold hover:border-ink/40">Payout settings</AppLink>
          </>
        }
      />
      {cfg && !cfg.snippeReady && (
        <Card className="mb-4 flex flex-wrap items-center gap-4 border-accent/40 bg-accent-soft/40 px-5 py-4">
          <span className="flex size-10 items-center justify-center rounded-full bg-surface"><Smartphone className="size-5" strokeWidth={1.5} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Payouts are recorded by hand</div>
            <p className="text-[13px] text-muted">Turn on Snippe payouts to send earnings to M-Pesa, Airtel Money, Mixx by Yas or HaloPesa in one click. Until then, record cash or bank payments here.</p>
          </div>
          <AppLink href="/settings/payments" className="h-10 rounded-sm bg-ink px-4 text-sm font-semibold text-on-ink">Set up Snippe payouts</AppLink>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat label="Owed to riders" value={data ? fmtMoney(owed, cur) : '—'} hint={data ? (() => { const n = data.balances.filter((b) => b.unpaid > 0).length; return `${fmtNum(n)} ${n === 1 ? 'rider' : 'riders'} with unpaid earnings`; })() : undefined} tone={owed > 0 ? 'warning' : undefined} />
        <Stat label="In flight" value={data ? fmtMoney(inFlight, cur) : '—'} hint="Sent, waiting for the network" />
        <Stat label="Paid this month" value={data ? fmtMoney(paidMonth, cur) : '—'} hint="Completed payouts" tone={paidMonth > 0 ? 'success' : undefined} />
        <Stat label="Smallest payout" value={cfg ? fmtMoney(cfg.minimum, cur) : '—'} hint={cfg?.provider === 'snippe' ? 'Snippe mobile money' : 'Manual records'} />
      </div>

      <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <Card className="overflow-hidden">
          <CardHeader title="Balances" description="Most owed first." />
          {isPending ? (
            <div className="divide-y divide-hairline">{Array.from({ length: 5 }, (_, i) => <div key={i} className="flex gap-4 px-5 py-4"><Skeleton className="w-40" /><Skeleton className="ml-auto w-24" /></div>)}</div>
          ) : !data?.balances.length ? (
            <EmptyState icon={<HandCoins />} title="Nothing owed yet" body="Riders' earnings appear here as they complete deliveries." />
          ) : (
            <ul className="divide-y divide-hairline">
              {data.balances.map((b) => {
                const share = b.earned ? Math.min(1, b.paid / b.earned) : 0;
                return (
                  <li key={b.rider.id} className="flex items-center gap-4 px-5 py-3.5">
                    <div className="min-w-0 flex-1">
                      <AppLink href={`/riders/${b.rider.id}`} className="text-sm font-semibold hover:underline">{b.rider.name || b.rider.phone}</AppLink>
                      <div className="text-xs text-muted">
                        {fmtNum(b.jobs)} {b.jobs === 1 ? 'delivery' : 'deliveries'} · {b.rider.payoutAccount ? `Wallet ${b.rider.payoutAccount}` : 'No payout number'}
                        {b.lastPayoutAt && ` · paid ${fmtAgo(b.lastPayoutAt)}`}
                      </div>
                      <div className="mt-2 h-1 w-full max-w-56 overflow-hidden rounded-full bg-ink/8" aria-hidden>
                        <div className="h-full rounded-full bg-accent transition-[width] duration-700 ease-atelier" style={{ width: `${share * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={cn('font-display text-lg tabular', b.unpaid === 0 && 'text-muted')}>{fmtMoney(b.unpaid, cur)}</div>
                      <div className="text-xs text-subtle tabular">of {fmtMoney(b.earned, cur)}{b.pending > 0 ? ` · ${fmtMoney(b.pending, cur)} sending` : ''}</div>
                    </div>
                    {canPay && (
                      <Button size="sm" variant={b.unpaid > 0 ? 'primary' : 'ghost'} disabled={b.unpaid <= 0} icon={<Send strokeWidth={1.5} />} onClick={() => setPaying(b)}>
                        Pay
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title="Recent payouts" description="Snippe results arrive by signed webhook; Check now asks Snippe directly." />
          {!data?.items.length ? (
            <EmptyState icon={<Banknote />} title="No payouts yet" />
          ) : (
            <ul className="divide-y divide-hairline">
              {data.items.map((p) => (
                <li key={p.id} className="flex items-start gap-3 px-5 py-3.5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{p.riderName}</span>
                      <Chip tone={tone(p.status)} dot={p.status === 'PENDING'}>{titleCase(p.status)}</Chip>
                    </div>
                    <div className="mt-0.5 text-xs text-muted">
                      {p.method === 'snippe' ? `${(p.network && NETWORK[p.network]) || 'Mobile money'}${p.recipient ? ` ${p.recipient}` : ''}` : 'Recorded manually'}
                      {' · '}
                      {fmtDateTime(p.createdAt)}
                      {p.createdBy && ` · by ${p.createdBy}`}
                    </div>
                    {(p.failureReason || p.note) && <div className={cn('mt-1 text-xs', p.failureReason ? 'text-danger' : 'text-muted')}>{p.failureReason ?? `“${p.note}”`}</div>}
                    <div className="mt-1 font-mono text-[11px] text-subtle">{p.externalRef ?? p.providerRef ?? p.reference}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular">{fmtMoney(p.amount, p.currency)}</div>
                    {p.fee > 0 && <div className="text-xs text-subtle tabular">+ {fmtMoney(p.fee, p.currency)} fee</div>}
                    {p.method === 'snippe' && p.status === 'PENDING' && canPay && (
                      <ActionButton className="mt-1.5" size="sm" variant="secondary" icon={<RefreshCw strokeWidth={1.5} />} onAction={() => sync(p)}>Check now</ActionButton>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {paying && cfg && <PayDialog b={paying} cfg={cfg} onClose={() => setPaying(null)} onDone={() => qc.invalidateQueries({ queryKey: ['payouts'] })} />}
    </>
  );
}

function PayDialog({ b, cfg, onClose, onDone }: { b: Balance; cfg: PayoutsData['config']; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState<'snippe' | 'manual'>(cfg.snippeReady && b.rider.payoutAccount ? 'snippe' : 'manual');
  const [amount, setAmount] = useState(String(b.unpaid));
  const [note, setNote] = useState('');
  const [fee, setFee] = useState<number | null>(null);
  const value = Math.round(Number(amount.replace(/[^\d]/g, '')) || 0);
  const tooSmall = method === 'snippe' && value < cfg.minimum;
  const tooBig = value > b.unpaid;

  useEffect(() => {
    if (method !== 'snippe' || value <= 0) return;
    const t = setTimeout(() => {
      api<{ fee: number | null }>('/admin/payouts/fee', { query: { amount: value } }).then((r) => setFee(r.fee)).catch(() => setFee(null));
    }, 350);
    return () => clearTimeout(t);
  }, [method, value]);

  const submit = async () => {
    try {
      const p = await api<Payout>('/admin/payouts', { body: { riderId: b.rider.id, amount: value, method, note } });
      toast.success(p.method === 'snippe' ? `${fmtMoney(p.amount, p.currency)} sent to ${b.rider.name} — confirming with the network` : `${fmtMoney(p.amount, p.currency)} recorded for ${b.rider.name}`);
      onDone();
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Payout failed');
      onDone();
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={`Pay ${b.rider.name || b.rider.phone}`}
      description={`Owed ${fmtMoney(b.unpaid, cfg.currency)} for ${fmtNum(b.jobs)} completed ${b.jobs === 1 ? 'delivery' : 'deliveries'}.`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <ActionButton icon={method === 'snippe' ? <Send strokeWidth={1.5} /> : <Banknote strokeWidth={1.5} />} onAction={submit} disabled={value <= 0 || tooBig || tooSmall}>
            {method === 'snippe' ? `Send ${fmtMoney(value, cfg.currency)}` : 'Record payment'}
          </ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="How to pay">
          {([
            ['snippe', 'Mobile money', cfg.snippeReady ? (b.rider.payoutAccount ? `Snippe → ${b.rider.payoutAccount}` : 'Add a wallet number first') : 'Set up in Settings', !cfg.snippeReady || !b.rider.payoutAccount],
            ['manual', 'Already paid', 'Cash or bank transfer', false],
          ] as const).map(([k, title, sub, disabled]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={method === k}
              disabled={disabled}
              onClick={() => setMethod(k)}
              className={cn('rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50', method === k ? 'border-ink bg-ink/[0.03]' : 'border-hairline hover:border-ink/30')}
            >
              <div className="text-sm font-semibold">{title}</div>
              <div className="text-xs text-muted">{sub}</div>
            </button>
          ))}
        </div>
        <Field label="Amount" error={tooBig ? `More than the ${fmtMoney(b.unpaid, cfg.currency)} owed` : tooSmall ? `Snippe payouts start at ${fmtMoney(cfg.minimum, cfg.currency)}` : null} help={method === 'snippe' && value > 0 && fee != null ? `Snippe fee ${fmtMoney(fee, cfg.currency)}, taken from your wallet — the rider receives the full amount.` : undefined}>
          {(id, d) => <Input id={id} aria-describedby={d} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} trailing={<span className="text-xs">{cfg.currency}</span>} aria-invalid={tooBig || tooSmall} />}
        </Field>
        <Field label="Note" optional>{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder={method === 'manual' ? 'Paid in cash at Masaki store' : 'Week 46 earnings'} maxLength={240} />}</Field>
      </div>
    </Dialog>
  );
}
