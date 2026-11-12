'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Percent, Plus, Ticket, Truck, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { fromLocalInput, Meter, Rise, RowsSkeleton, toLocalInput } from '@/components/ui/kit';
import { Card, Chip, EmptyState, PageHeader, Switch } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCategories } from '@/lib/catalog';
import { cn } from '@/lib/cn';
import { fmtDate, fmtMoney, fmtNum } from '@/lib/format';

interface Promo { id: string; code: string; description: string | null; type: 'PERCENT' | 'FIXED' | 'FREE_DELIVERY'; value: number; minSubtotal: number | null; maxDiscount: number | null; startsAt: string | null; endsAt: string | null; usageLimit: number | null; usedCount: number; perCustomerLimit: number | null; customerTypes: string[]; categoryIds: string[]; firstOrderOnly: boolean; active: boolean }

const ICON = { PERCENT: Percent, FIXED: Wallet, FREE_DELIVERY: Truck };
const describe = (p: Partial<Promo>, cur: string) => (p.type === 'PERCENT' ? `${(p.value ?? 0) / 100}% off` : p.type === 'FIXED' ? `${fmtMoney(p.value ?? 0, cur)} off` : 'Free delivery');
const state = (p: Promo) => {
  const now = Date.now();
  if (!p.active) return { label: 'Paused', tone: 'neutral' as const };
  if (p.startsAt && new Date(p.startsAt).getTime() > now) return { label: 'Scheduled', tone: 'accent' as const };
  if (p.endsAt && new Date(p.endsAt).getTime() < now) return { label: 'Ended', tone: 'neutral' as const };
  if (p.usageLimit && p.usedCount >= p.usageLimit) return { label: 'Used up', tone: 'warning' as const };
  return { label: 'Live', tone: 'success' as const };
};

export function PromosWorkspace({ currency }: { currency: string }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['promos'], queryFn: () => api<{ items: Promo[] }>('/admin/promos') });
  const cats = useCategories();
  const [edit, setEdit] = useState<Partial<Promo> | null>(null);
  const save = async () => {
    if (!edit) return;
    try {
      const { id, usedCount, ...body } = edit;
      void usedCount;
      await api(id ? `/admin/promos/${id}` : '/admin/promos', { method: id ? 'PATCH' : 'POST', body });
      toast.success(`${edit.code?.toUpperCase()} saved`);
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['promos'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  const items = q.data?.items ?? [];
  const pct = edit?.type === 'PERCENT';
  return (
    <>
      <PageHeader title="Promo codes" description="Codes customers enter in the Bag. Discounts are validated on the server at checkout — limits and dates are enforced, never just displayed."
        actions={<Button icon={<Plus strokeWidth={1.5} />} onClick={() => setEdit({ type: 'PERCENT', value: 1000, active: true, customerTypes: [], categoryIds: [], firstOrderOnly: false })}>New code</Button>} />
      {q.isPending ? <Card><RowsSkeleton /></Card> : items.length === 0 ? (
        <Card><EmptyState icon={<Ticket />} title="No promo codes" body="Try a welcome code like KARIBU10 for first orders." /></Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((p, i) => {
            const Icon = ICON[p.type];
            const st = state(p);
            return (
              <Rise key={p.id} i={i}>
                <button type="button" onClick={() => setEdit(p)} className="group block w-full text-left">
                  <Card className="relative overflow-hidden p-5 transition-colors group-hover:border-ink/25">
                    <span className="absolute -right-3 top-1/2 size-6 -translate-y-1/2 rounded-full border border-hairline bg-canvas" />
                    <span className="absolute -left-3 top-1/2 size-6 -translate-y-1/2 rounded-full border border-hairline bg-canvas" />
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex size-10 items-center justify-center rounded-full bg-accent-soft"><Icon className="size-4" strokeWidth={1.5} /></span>
                      <Chip tone={st.tone} dot={st.label === 'Live'}>{st.label}</Chip>
                    </div>
                    <div className="mt-4 flex items-center gap-2">
                      <span className="font-mono text-lg font-semibold tracking-[0.08em]">{p.code}</span>
                      <span role="button" tabIndex={0} aria-label={`Copy ${p.code}`} onClick={(e) => { e.stopPropagation(); void navigator.clipboard.writeText(p.code); toast.success('Copied'); }} className="text-muted hover:text-ink"><Copy className="size-3.5" strokeWidth={1.5} /></span>
                    </div>
                    <div className="font-display text-xl">{describe(p, currency)}</div>
                    <p className="mt-1 line-clamp-1 text-[13px] text-muted">{[p.minSubtotal ? `Over ${fmtMoney(p.minSubtotal, currency)}` : null, p.firstOrderOnly ? 'First order' : null, p.customerTypes.length === 1 ? (p.customerTypes[0] === 'WHOLESALE' ? 'Wholesale only' : 'Retail only') : null, p.endsAt ? `Until ${fmtDate(p.endsAt)}` : null].filter(Boolean).join(' · ') || p.description || 'Any order'}</p>
                    <div className="mt-4 flex items-center gap-3 text-xs text-muted">
                      <span className="tabular">{fmtNum(p.usedCount)}{p.usageLimit ? ` / ${fmtNum(p.usageLimit)}` : ''} used</span>
                      {p.usageLimit ? <Meter value={p.usedCount} max={p.usageLimit} tone="accent" /> : null}
                    </div>
                  </Card>
                </button>
              </Rise>
            );
          })}
        </div>
      )}
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} title={edit?.id ? edit.code ?? 'Promo' : 'New promo code'}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><ActionButton disabled={(edit?.code ?? '').length < 3} onAction={save}>Save</ActionButton></>}>
        {edit && (
          <div className="grid gap-4">
            <div className="grid grid-cols-3 gap-2">
              {(['PERCENT', 'FIXED', 'FREE_DELIVERY'] as const).map((t) => {
                const Icon = ICON[t];
                return (
                  <button key={t} type="button" onClick={() => setEdit({ ...edit, type: t, value: t === 'PERCENT' ? 1000 : t === 'FIXED' ? 5000 : 0 })} className={cn('flex flex-col items-center gap-1.5 rounded-sm border px-2 py-3 text-[12.5px] font-semibold transition-colors', edit.type === t ? 'border-ink bg-ink text-on-ink' : 'border-hairline hover:border-ink/40')}>
                    <Icon className="size-4" strokeWidth={1.5} />{t === 'PERCENT' ? 'Percentage' : t === 'FIXED' ? 'Fixed amount' : 'Free delivery'}
                  </button>
                );
              })}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Code" help="Letters, numbers, - and _">{(id) => <Input id={id} value={edit.code ?? ''} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} className="font-mono tracking-[0.08em]" placeholder="KARIBU10" />}</Field>
              {edit.type !== 'FREE_DELIVERY' && (
                <Field label={pct ? 'Percent off' : 'Amount off'}>
                  {(id) => <Input id={id} inputMode="decimal" value={pct ? (edit.value ?? 0) / 100 : edit.value ?? 0} onChange={(e) => setEdit({ ...edit, value: pct ? Math.round(Number(e.target.value) * 100) || 0 : Number(e.target.value.replace(/\D/g, '')) || 0 })} trailing={<span className="pr-1 text-xs">{pct ? '%' : currency}</span>} />}
                </Field>
              )}
              <Field label="Minimum bag" optional>{(id) => <Input id={id} inputMode="numeric" value={edit.minSubtotal ?? ''} onChange={(e) => setEdit({ ...edit, minSubtotal: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} trailing={<span className="pr-1 text-xs">{currency}</span>} />}</Field>
              {pct && <Field label="Maximum discount" optional>{(id) => <Input id={id} inputMode="numeric" value={edit.maxDiscount ?? ''} onChange={(e) => setEdit({ ...edit, maxDiscount: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} trailing={<span className="pr-1 text-xs">{currency}</span>} />}</Field>}
              <Field label="Total uses" optional>{(id) => <Input id={id} inputMode="numeric" value={edit.usageLimit ?? ''} onChange={(e) => setEdit({ ...edit, usageLimit: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} placeholder="Unlimited" />}</Field>
              <Field label="Uses per customer" optional>{(id) => <Input id={id} inputMode="numeric" value={edit.perCustomerLimit ?? ''} onChange={(e) => setEdit({ ...edit, perCustomerLimit: e.target.value ? Number(e.target.value.replace(/\D/g, '')) : null })} placeholder="Unlimited" />}</Field>
              <Field label="Starts" optional>{(id) => <Input id={id} type="datetime-local" value={toLocalInput(edit.startsAt)} onChange={(e) => setEdit({ ...edit, startsAt: fromLocalInput(e.target.value) })} />}</Field>
              <Field label="Ends" optional>{(id) => <Input id={id} type="datetime-local" value={toLocalInput(edit.endsAt)} onChange={(e) => setEdit({ ...edit, endsAt: fromLocalInput(e.target.value) })} />}</Field>
              <Field label="Who can use it">{(id) => <Select id={id} value={edit.customerTypes?.length === 1 ? edit.customerTypes[0] : ''} onChange={(e) => setEdit({ ...edit, customerTypes: e.target.value ? [e.target.value] : [] })}><option value="">Everyone</option><option value="RETAIL">Retail customers</option><option value="WHOLESALE">Wholesale accounts</option></Select>}</Field>
              <Field label="Only for category" optional>{(id) => <Select id={id} value={edit.categoryIds?.[0] ?? ''} onChange={(e) => setEdit({ ...edit, categoryIds: e.target.value ? [e.target.value] : [] })}><option value="">Whole bag</option>{cats.data?.filter((c) => c.depth <= 1).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</Select>}</Field>
            </div>
            <Field label="Internal note" optional>{(id) => <Textarea id={id} rows={2} value={edit.description ?? ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />}</Field>
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-[13px]"><Switch checked={!!edit.firstOrderOnly} onCheckedChange={(v) => setEdit({ ...edit, firstOrderOnly: v })} label="First order only" /> First order only</label>
              <label className="flex items-center gap-2 text-[13px]"><Switch checked={edit.active ?? true} onCheckedChange={(v) => setEdit({ ...edit, active: v })} label="Active" /> Active</label>
            </div>
            <div className="rounded-sm bg-canvas px-4 py-3 text-[13px]"><span className="text-muted">Customers see:</span> <b className="font-semibold">{edit.code || 'CODE'}</b> — {describe(edit, currency)}{edit.minSubtotal ? ` on bags over ${fmtMoney(edit.minSubtotal, currency)}` : ''}</div>
          </div>
        )}
      </Dialog>
    </>
  );
}
