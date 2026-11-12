'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { ArrowRight, PackageCheck, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Rise, RowsSkeleton, Tabs } from '@/components/ui/kit';
import { MediaImage } from '@/components/ui/media-image';
import { Card, Chip, EmptyState, PageHeader, type Tone } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { cn } from '@/lib/cn';
import { fmtAgo, fmtMoney, fmtNum, titleCase } from '@/lib/format';
import type { MediaOut } from '@/lib/types';

interface Ret { id: string; kind: 'RETURN' | 'EXCHANGE'; status: string; reason: string; comment: string | null; media: MediaOut[]; order: { id: string; number: string }; customer: string; items: { title: string; options: string; qty: number; unitPrice: number }[]; refundAmount: number | null; resolutionNote: string | null; createdAt: string }

const STEPS = ['REQUESTED', 'APPROVED', 'RECEIVED', 'DONE'] as const;
const FLOW: Record<string, { to: string; label: string; variant?: 'primary' | 'secondary' | 'danger' }[]> = {
  REQUESTED: [{ to: 'REJECTED', label: 'Reject', variant: 'danger' }, { to: 'APPROVED', label: 'Approve' }],
  APPROVED: [{ to: 'CANCELLED', label: 'Cancel', variant: 'secondary' }, { to: 'RECEIVED', label: 'Mark received' }],
  RECEIVED: [{ to: 'EXCHANGED', label: 'Exchange sent', variant: 'secondary' }, { to: 'REFUNDED', label: 'Refund' }],
};
const tone = (s: string): Tone => (s === 'REQUESTED' ? 'warning' : s === 'APPROVED' || s === 'RECEIVED' ? 'ink' : s === 'REFUNDED' || s === 'EXCHANGED' ? 'success' : 'neutral');
const stepOf = (s: string) => (s === 'REQUESTED' ? 0 : s === 'APPROVED' ? 1 : s === 'RECEIVED' ? 2 : 3);

export function ReturnsWorkspace({ currency }: { currency: string }) {
  const qc = useQueryClient();
  const canRefund = useCan('orders.refund');
  const [status, setStatus] = useState('');
  const q = useQuery({ queryKey: ['returns', status], queryFn: () => api<{ items: Ret[] }>('/admin/returns', { query: { status } }) });
  const [act, setAct] = useState<{ r: Ret; to: string; label: string } | null>(null);
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const items = q.data?.items ?? [];
  const run = async () => {
    if (!act) return;
    try {
      await api(`/admin/returns/${act.r.id}`, { body: { status: act.to, note, amount: act.to === 'REFUNDED' && amount ? Number(amount.replace(/\D/g, '')) : undefined } });
      toast.success(act.to === 'RECEIVED' ? 'Received — stock added back' : act.to === 'REFUNDED' ? 'Refund issued' : `Return ${act.to.toLowerCase()}`);
      setAct(null);
      void qc.invalidateQueries({ queryKey: ['returns'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not update');
    }
  };
  const due = act ? act.r.items.reduce((a, i) => a + i.unitPrice * i.qty, 0) : 0;
  return (
    <>
      <PageHeader title="Returns & exchanges" description="Approve, receive back into stock, then refund or send the exchange. Each step notifies the customer." />
      <Card className="overflow-hidden">
        <div className="border-b border-hairline px-3">
          <Tabs id="returns" value={status} onChange={setStatus} tabs={[{ key: '', label: 'All' }, { key: 'REQUESTED', label: 'New' }, { key: 'APPROVED', label: 'Awaiting item' }, { key: 'RECEIVED', label: 'To resolve' }, { key: 'REFUNDED', label: 'Refunded' }, { key: 'REJECTED', label: 'Rejected' }]} />
        </div>
        {q.isPending ? <RowsSkeleton /> : items.length === 0 ? (
          <EmptyState icon={<RotateCcw />} title="No returns" body="When a customer asks to return or exchange a piece, it lands here." />
        ) : (
          <ul className="divide-y divide-hairline">
            {items.map((r, i) => (
              <Rise as="li" i={i} key={r.id} className="grid gap-4 px-5 py-4 lg:grid-cols-[1fr_auto]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip tone={r.kind === 'EXCHANGE' ? 'accent' : 'neutral'}>{titleCase(r.kind)}</Chip>
                    <Chip tone={tone(r.status)} dot={r.status === 'REQUESTED'}>{titleCase(r.status)}</Chip>
                    <AppLink href={`/orders/${r.order.id}`} className="text-sm font-semibold tabular hover:underline">{r.order.number}</AppLink>
                    <span className="text-xs text-muted">{r.customer} · {fmtAgo(r.createdAt)}</span>
                  </div>
                  <div className="mt-2 text-sm"><span className="text-muted">Reason:</span> {titleCase(r.reason)}{r.comment && <span className="text-muted"> — “{r.comment}”</span>}</div>
                  <ul className="mt-2 grid gap-0.5 text-[13px]">
                    {r.items.map((it, j) => <li key={j} className="flex gap-2"><span className="tabular text-muted">{it.qty}×</span><span>{it.title}{it.options && <span className="text-muted"> · {it.options}</span>}</span><span className="ml-auto tabular">{fmtMoney(it.unitPrice * it.qty, currency)}</span></li>)}
                  </ul>
                  {r.media.length > 0 && <div className="mt-3 flex gap-2">{r.media.map((m) => <MediaImage key={m.id} media={m} className="w-14" sizes="56px" rounded="xs" />)}</div>}
                  {r.refundAmount != null && <div className="mt-2 text-[13px] text-success">Refunded {fmtMoney(r.refundAmount, currency)}</div>}
                  {r.resolutionNote && <div className="mt-1 text-xs text-muted">Note: {r.resolutionNote}</div>}
                </div>
                <div className="flex flex-col items-start gap-3 lg:items-end">
                  <Progress status={r.status} />
                  <div className="flex gap-2">
                    {(FLOW[r.status] ?? []).filter((a) => a.to !== 'REFUNDED' || canRefund).map((a) => (
                      <Button key={a.to} size="sm" variant={a.variant ?? 'primary'} onClick={() => { setAct({ r, ...a }); setNote(''); setAmount(''); }} icon={a.to === 'RECEIVED' ? <PackageCheck strokeWidth={1.5} /> : a.variant ? undefined : <ArrowRight strokeWidth={1.5} />}>{a.label}</Button>
                    ))}
                  </div>
                </div>
              </Rise>
            ))}
          </ul>
        )}
      </Card>
      <Dialog open={!!act} onOpenChange={(v) => !v && setAct(null)} size="sm" title={act?.label ?? ''} description={act?.to === 'RECEIVED' ? 'The returned pieces are added back to the order’s store stock.' : act?.to === 'REFUNDED' ? 'Refunds mobile money through the original provider; cash orders are recorded for manual payout.' : undefined}
        footer={<><Button variant="ghost" onClick={() => setAct(null)}>Cancel</Button><ActionButton variant={act?.to === 'REJECTED' ? 'danger' : 'primary'} onAction={run}>{act?.label}</ActionButton></>}>
        <div className="grid gap-4">
          {act?.to === 'REFUNDED' && <Field label="Amount" help={`Items total ${fmtMoney(due, currency)}`}>{(id) => <Input id={id} inputMode="numeric" value={amount} placeholder={fmtNum(due)} onChange={(e) => setAmount(e.target.value)} />}</Field>}
          <Field label="Note to customer" optional={act?.to !== 'REJECTED'}>{(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        </div>
      </Dialog>
    </>
  );
}

function Progress({ status }: { status: string }) {
  const at = stepOf(status);
  const stopped = status === 'REJECTED' || status === 'CANCELLED';
  return (
    <div className="flex items-center gap-1" aria-label={`Step ${at + 1} of 4`}>
      {STEPS.map((s, i) => (
        <span key={s} className="relative h-1 w-10 overflow-hidden rounded-full bg-ink/10">
          {i <= at && <motion.span className={cn('absolute inset-0 rounded-full', stopped ? 'bg-ink/30' : 'bg-ink')} initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} style={{ originX: 0 }} transition={{ delay: i * 0.08, duration: 0.3 }} />}
        </span>
      ))}
    </div>
  );
}
