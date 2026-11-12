'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, Search, Settings2, Smartphone, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { Card, Chip, EmptyState, PageHeader, Skeleton, Stat } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { fmtAgo, fmtDateTime, fmtMoney, fmtNum, titleCase } from '@/lib/format';
import { PAYMENT_LABEL, paymentTone, PROVIDER_LABEL } from '@/lib/ops';

interface PaymentRow {
  id: string;
  reference: string;
  providerRef: string | null;
  provider: string;
  method: string;
  status: 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';
  amount: number;
  currency: string;
  refunded: number;
  msisdn: string | null;
  createdAt: string;
  paidAt: string | null;
  order: { id: string; number: string; status: string };
  customer: { id: string; name: string };
  failure: string | null;
}
interface Ledger {
  items: PaymentRow[];
  nextCursor: string | null;
  summary: { collectedToday: number; paidCount: number; pendingCount: number; cashToCollect: number; failedToday: number; refundedToday: number; byProvider: Record<string, number> };
}

export function PaymentsLedger({ currency, provider: activeProvider }: { currency: string; provider: string }) {
  const qc = useQueryClient();
  const canManage = useCan('orders.manage');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [provider, setProvider] = useState('');
  const query = useInfiniteQuery({
    queryKey: ['payments', search, status, provider],
    queryFn: ({ pageParam }) => api<Ledger>('/admin/payments', { query: { q: search, status, provider, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
    refetchInterval: 20_000,
  });
  const s = query.data?.pages[0]?.summary;
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];

  const sync = async (p: PaymentRow) => {
    try {
      const r = await api<PaymentRow>(`/admin/payments/${p.id}/sync`, { method: 'POST' });
      toast.success(r.status === 'PAID' ? `${p.order.number} is paid` : r.status === 'PENDING' ? 'Still waiting for approval' : `Payment ${r.status.toLowerCase()}`);
      await qc.invalidateQueries({ queryKey: ['payments'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not reach Snippe');
    }
  };

  return (
    <>
      <PageHeader
        title="Payments"
        description="Every collection attempt — cash on delivery and mobile money by USSD push. Orders confirm themselves the moment a payment lands."
        actions={
          <>
            {activeProvider === 'snippe' && (
              <a href="https://snippe.sh/dashboard/payments/transactions" target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-sm px-3 text-[13px] font-semibold text-muted hover:bg-ink/5 hover:text-ink">
                Snippe dashboard <ExternalLink className="size-3.5" strokeWidth={1.5} />
              </a>
            )}
            <AppLink href="/settings/payments" icon={<Settings2 strokeWidth={1.5} />} className="h-10 rounded-sm border border-ink/18 bg-surface px-4 text-sm font-semibold hover:border-ink/40">Payment settings</AppLink>
          </>
        }
      />
      {activeProvider === 'none' && (
        <Card className="mb-4 flex flex-wrap items-center gap-4 border-accent/40 bg-accent-soft/40 px-5 py-4">
          <span className="flex size-10 items-center justify-center rounded-full bg-surface"><Smartphone className="size-5" strokeWidth={1.5} /></span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Mobile money is off</div>
            <p className="text-[13px] text-muted">Connect Snippe to take M-Pesa, Airtel Money, Mixx by Yas and Halotel payments by USSD push at checkout.</p>
          </div>
          <AppLink href="/settings/payments" className="h-10 rounded-sm bg-ink px-4 text-sm font-semibold text-on-ink">Connect Snippe</AppLink>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat label="Collected today" value={s ? fmtMoney(s.collectedToday, currency) : '—'} hint={s ? [`${fmtNum(s.paidCount)} ${s.paidCount === 1 ? 'payment' : 'payments'}`, ...Object.entries(s.byProvider).map(([k, v]) => `${PROVIDER_LABEL[k] ?? k} ${fmtMoney(v, currency)}`)].join(' · ') : undefined} />
        <Stat label="Awaiting approval" value={s ? fmtNum(s.pendingCount) : '—'} hint="USSD prompts open (≤ 4 h)" tone={s && s.pendingCount > 0 ? 'warning' : undefined} />
        <Stat label="Failed today" value={s ? fmtNum(s.failedToday) : '—'} hint="Declined, expired or cancelled" tone={s && s.failedToday > 0 ? 'danger' : undefined} />
        <Stat label="Cash to collect" value={s ? fmtMoney(s.cashToCollect, currency) : '—'} hint={s ? (s.refundedToday ? `${fmtMoney(s.refundedToday, currency)} refunded today` : 'Riders collect on delivery') : undefined} />
      </div>
      <Card className="mt-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline p-3">
          <form className="min-w-0 flex-1 sm:max-w-sm" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
            <Input leading={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Reference, order, phone or customer" aria-label="Search payments" />
          </form>
          <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40" aria-label="Status">
            <option value="">Any status</option>
            <option value="PAID">Paid</option>
            <option value="PENDING">Pending</option>
            <option value="FAILED">Failed</option>
            <option value="REFUNDED">Refunded</option>
          </Select>
          <Select value={provider} onChange={(e) => setProvider(e.target.value)} className="w-44" aria-label="Provider">
            <option value="">All providers</option>
            <option value="snippe">Snippe</option>
            <option value="cash">Cash</option>
            <option value="beem_checkout">Beem Checkout</option>
          </Select>
        </div>
        {query.isPending ? (
          <div className="divide-y divide-hairline">{Array.from({ length: 6 }, (_, i) => <div key={i} className="flex gap-4 px-5 py-4"><Skeleton className="w-28" /><Skeleton className="w-48" /><Skeleton className="ml-auto w-20" /></div>)}</div>
        ) : rows.length === 0 ? (
          <EmptyState icon={<Wallet />} title="No payments yet" body="Collections appear here as shoppers check out." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead>
                <tr className="label-caps border-b border-hairline text-left text-muted">
                  <th className="px-5 py-3 font-semibold">Payment</th>
                  <th className="px-3 py-3 font-semibold">Order</th>
                  <th className="px-3 py-3 font-semibold">Method</th>
                  <th className="px-3 py-3 font-semibold">Status</th>
                  <th className="px-3 py-3 text-right font-semibold">Amount</th>
                  <th className="w-36 px-5 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {rows.map((p) => (
                  <tr key={p.id} className="hover:bg-ink/[0.025]">
                    <td className="px-5 py-3.5">
                      <div className="font-mono text-[12.5px]">{p.providerRef ?? p.reference}</div>
                      <div className="text-xs text-subtle">{fmtDateTime(p.createdAt)}</div>
                    </td>
                    <td className="px-3 py-3.5">
                      <AppLink href={`/orders/${p.order.id}`} className="font-semibold tabular hover:underline">{p.order.number}</AppLink>
                      <div className="text-xs text-muted">{p.customer.name}</div>
                    </td>
                    <td className="px-3 py-3.5 text-[13px]">
                      <div>{PAYMENT_LABEL[p.method] ?? p.method}</div>
                      <div className="text-xs text-muted">{PROVIDER_LABEL[p.provider] ?? p.provider}{p.msisdn ? ` · ${p.msisdn}` : ''}</div>
                    </td>
                    <td className="px-3 py-3.5">
                      <Chip tone={paymentTone(p.status)} dot={p.status === 'PENDING'}>{titleCase(p.status)}</Chip>
                      <div className="mt-1 text-xs text-muted">{p.paidAt ? `Paid ${fmtAgo(p.paidAt)}` : p.failure ?? (p.status === 'PENDING' ? (p.method === 'CASH_ON_DELIVERY' ? 'Collect on delivery' : `USSD prompt sent ${fmtAgo(p.createdAt)}`) : '')}</div>
                    </td>
                    <td className="px-3 py-3.5 text-right">
                      <div className="font-semibold tabular">{fmtMoney(p.amount, p.currency)}</div>
                      {p.refunded > 0 && <div className="text-xs text-warning tabular">− {fmtMoney(p.refunded, p.currency)}</div>}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      {p.provider === 'snippe' && p.status === 'PENDING' && canManage && (
                        <ActionButton size="sm" variant="secondary" icon={<RefreshCw strokeWidth={1.5} />} onAction={() => sync(p)}>Check now</ActionButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {query.hasNextPage && (
          <div className="flex justify-center border-t border-hairline p-3">
            <ActionButton variant="ghost" onAction={() => query.fetchNextPage()}>Load more</ActionButton>
          </div>
        )}
      </Card>
    </>
  );
}
