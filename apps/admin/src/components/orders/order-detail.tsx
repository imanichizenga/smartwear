'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import {
  ArrowLeft, Ban, Bike, Check, ChefHat, CircleDollarSign, FileText, KeyRound, MapPin, Phone, Printer, RefreshCw, RotateCcw, Search, Star, Tag, Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { LiveMap, type MapMarker, type MapRoute } from '@/components/maps/live-map';
import { RiderAvatar } from '@/components/dispatch/control-room';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/field';
import { MediaImage } from '@/components/ui/media-image';
import { Card, CardHeader, Chip } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { cn } from '@/lib/cn';
import { fmtDateTime, fmtMoney, titleCase } from '@/lib/format';
import { distanceMeters, fmtDistance, fmtEta } from '@/lib/geo';
import { jobLabel, jobTone, orderTone, PAYMENT_LABEL, paymentTone, PROVIDER_LABEL, VEHICLES, type DispatchBoard, type OrderDetail as Order } from '@/lib/ops';
import { useRealtime } from '@/lib/realtime';

const STEPS: { key: keyof NonNullable<Order['delivery']>['timeline'] | 'placed'; label: string }[] = [
  { key: 'placed', label: 'Placed' },
  { key: 'accepted', label: 'Rider assigned' },
  { key: 'at_store', label: 'At store' },
  { key: 'picked_up', label: 'Picked up' },
  { key: 'arrived', label: 'Arrived' },
  { key: 'completed', label: 'Delivered' },
];

export function OrderDetail({ initial }: { initial: Order }) {
  const qc = useQueryClient();
  const key = ['order', initial.id];
  const { data: o = initial, refetch } = useQuery({ queryKey: key, queryFn: () => api<Order>(`/admin/orders/${initial.id}`), initialData: initial });
  const canManage = useCan('orders.manage');
  const canRefund = useCan('orders.refund');
  const canAssign = useCan('dispatch.assign');
  const [dialog, setDialog] = useState<null | 'cancel' | 'refund' | 'assign'>(null);

  useRealtime(
    [`order.${o.id}`],
    (e) => {
      if (e.type === 'rider.location') {
        qc.setQueryData<Order>(key, (x) => x && x.delivery ? { ...x, delivery: { ...x.delivery, riderLocation: { lat: e.lat as number, lng: e.lng as number, heading: (e.heading as number) ?? null, at: e.at as string } } } : x);
      } else void refetch();
    },
    { onPoll: () => void refetch(), pollMs: 8000 },
  );

  const act = async (body: Record<string, unknown>, ok: string) => {
    try {
      qc.setQueryData(key, await api<Order>(`/admin/orders/${o.id}/actions`, { body }));
      toast.success(ok);
      setDialog(null);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'That did not work');
    }
  };

  const d = o.delivery;
  const markers: MapMarker[] = [{ id: 'store', kind: 'store', position: o.store.location, label: o.store.name }];
  if (o.destination) markers.push({ id: 'client', kind: 'client', position: o.destination.location, label: o.destination.area ?? 'Customer' });
  if (d?.riderLocation) markers.push({ id: 'rider', kind: 'rider', position: d.riderLocation, heading: d.riderLocation.heading, state: 'en_route', label: d.rider?.firstName });
  const routes: MapRoute[] = d?.route ? [{ id: 'r', path: d.route }] : o.destination ? [{ id: 'r', path: [o.store.location, o.destination.location], dashed: true }] : [];
  const can = (t: string) => o.allowedTransitions.includes(t as Order['status']);
  const waitingRider = d && ['SEARCHING', 'OFFERED', 'NO_RIDER'].includes(d.status);
  const pendingSnippe = o.payments.find((p) => p.provider === 'snippe' && p.status === 'PENDING');

  return (
    <>
      <AppLink href="/orders" icon={<ArrowLeft strokeWidth={1.5} />} className="mb-5 text-[13px] font-semibold text-muted hover:text-ink">Orders</AppLink>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[32px] leading-10 tabular md:text-4xl md:leading-[44px]">{o.number}</h1>
            <Chip tone={orderTone(o.status)}>{o.statusLabel}</Chip>
            {o.customer.customerType === 'WHOLESALE' && <Chip tone="accent">Wholesale</Chip>}
          </div>
          <p className="mt-2 text-sm text-muted">
            Placed {fmtDateTime(o.placedAt)} · {o.fulfilment === 'pickup' ? `Pickup at ${o.store.name}` : `${o.deliveryOption?.name ?? 'Standard'} delivery from ${o.store.name}`}
            {o.eta.promisedBy && ` · promised by ${fmtDateTime(o.eta.promisedBy)}`}
          </p>
          {o.sla.label && <p className={cn('mt-1 text-[13px] font-semibold', o.sla.level === 'danger' ? 'text-danger' : 'text-warning')}>{o.sla.label}</p>}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {can('PREPARING') && <ActionButton icon={<ChefHat strokeWidth={1.5} />} onAction={() => act({ action: 'status', to: 'PREPARING' }, 'Preparing')}>Start preparing</ActionButton>}
            {(o.status === 'PREPARING' || (o.status === 'CONFIRMED' && can('PREPARING'))) && <ActionButton variant={can('PREPARING') ? 'secondary' : 'primary'} icon={<Check strokeWidth={1.5} />} onAction={() => act({ action: 'ready' }, 'Marked ready for pickup')}>Mark ready</ActionButton>}
            {o.fulfilment === 'pickup' && o.status === 'READY_FOR_PICKUP' && <ActionButton icon={<Check strokeWidth={1.5} />} onAction={() => act({ action: 'delivered_pickup' }, 'Handed over')}>Handed to customer</ActionButton>}
            {canAssign && o.fulfilment === 'delivery' && d && ['SEARCHING', 'OFFERED', 'NO_RIDER', 'ACCEPTED', 'AT_STORE'].includes(d.status) && (
              <Button variant={waitingRider ? 'primary' : 'secondary'} icon={<Bike strokeWidth={1.5} />} onClick={() => setDialog('assign')}>{d.rider ? 'Reassign rider' : 'Assign rider'}</Button>
            )}
            <a href={`/api/v1/admin/orders/${o.id}/invoice.pdf`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink/18 bg-surface px-3 text-sm font-semibold hover:border-ink/40"><FileText className="size-4" strokeWidth={1.5} /> Invoice</a>
            <a href={`/api/v1/admin/orders/${o.id}/label.pdf`} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink/18 bg-surface px-3 text-sm font-semibold hover:border-ink/40"><Printer className="size-4" strokeWidth={1.5} /> Label</a>
            {can('CANCELLED') && <Button variant="danger" icon={<Ban strokeWidth={1.5} />} onClick={() => setDialog('cancel')}>Cancel</Button>}
            {canRefund && o.payment.status === 'PAID' && <Button variant="ghost" icon={<RotateCcw strokeWidth={1.5} />} onClick={() => setDialog('refund')}>Refund</Button>}
          </div>
        )}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-4">
          {o.fulfilment === 'delivery' && (
            <Card className="overflow-hidden">
              <LiveMap className="h-[340px]" markers={markers} routes={routes} fitKey={`${d?.status}`} />
              {d && <DeliveryStepper o={o} />}
            </Card>
          )}
          <Card>
            <CardHeader title={`Items · ${o.items.reduce((a, i) => a + i.qty, 0)}`} />
            <ul className="divide-y divide-hairline">
              {o.items.map((i) => (
                <li key={i.id} className="flex gap-4 px-5 py-4">
                  <div className="w-14 shrink-0 overflow-hidden rounded-xs bg-canvas" style={{ aspectRatio: '4 / 5' }}>{i.image && <MediaImage media={i.image} sizes="56px" className="size-full object-cover" />}</div>
                  <div className="min-w-0 flex-1">
                    {i.brand && <div className="label-caps text-muted">{i.brand}</div>}
                    {i.productId ? <AppLink href={`/products/${i.productId}`} className="text-sm font-semibold hover:underline">{i.title}</AppLink> : <div className="text-sm font-semibold">{i.title}</div>}
                    <div className="mt-0.5 text-xs text-muted">{i.options} · {i.sku}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                      <span className="tabular">{i.qty} × {fmtMoney(i.unitPrice, o.currency)}</span>
                      {i.basis !== 'retail' && <Chip tone="accent"><Tag className="size-3" strokeWidth={2} /> {i.basis === 'tier' && i.tier ? `${i.tier.minQty}+ tier` : titleCase(i.basis)}</Chip>}
                      {i.savings > 0 && <span className="text-success">Saved {fmtMoney(i.savings, o.currency)}</span>}
                    </div>
                  </div>
                  <div className="text-right text-sm font-semibold tabular">{fmtMoney(i.lineTotal, o.currency)}</div>
                </li>
              ))}
            </ul>
            <dl className="space-y-2 border-t border-hairline px-5 py-4 text-sm">
              <Row label="Subtotal" value={fmtMoney(o.subtotal, o.currency)} />
              {o.discount > 0 && <Row label={`Discount${o.promoCode ? ` · ${o.promoCode}` : ''}`} value={`− ${fmtMoney(o.discount, o.currency)}`} />}
              <Row label="Delivery" value={o.deliveryFee ? fmtMoney(o.deliveryFee, o.currency) : 'Free'} />
              {o.tax > 0 && <Row label="Tax (included)" value={fmtMoney(o.tax, o.currency)} />}
              <div className="flex items-baseline justify-between border-t border-hairline pt-3"><dt className="font-semibold">Total</dt><dd className="font-display text-2xl tabular">{fmtMoney(o.total, o.currency)}</dd></div>
            </dl>
          </Card>
          <Card>
            <CardHeader title="Timeline" description="Every change, who made it and when." />
            <ol className="relative px-5 py-4">
              {o.events.slice().reverse().map((e, idx) => (
                <li key={`${e.at}-${idx}`} className="relative flex gap-4 pb-5 last:pb-0">
                  <span className={cn('relative z-10 mt-1 size-2.5 shrink-0 rounded-full ring-4 ring-surface', idx === 0 ? 'bg-ink' : 'bg-hairline')} />
                  {idx < o.events.length - 1 && <span className="absolute left-[4.5px] top-4 h-full w-px bg-hairline" aria-hidden />}
                  <div className="min-w-0 flex-1 text-[13px]">
                    <div className="font-semibold">{eventLabel(e)}</div>
                    <div className="text-xs text-muted">{fmtDateTime(e.at)} · {titleCase(e.actor)}{typeof e.data?.reason === 'string' && e.data.reason ? ` · ${e.data.reason}` : ''}{typeof e.data?.note === 'string' ? ` · “${e.data.note}”` : ''}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {d && (
            <Card>
              <CardHeader title="Delivery" actions={<Chip tone={jobTone(d.status)}>{jobLabel(d.status)}</Chip>} />
              {d.rider ? (
                <div className="flex items-center gap-3 px-5 py-4">
                  <RiderAvatar r={{ name: d.rider.name, photo: d.rider.photo, presence: 'EN_ROUTE' }} size={48} />
                  <div className="min-w-0 flex-1">
                    <AppLink href={`/riders/${d.rider.id}`} className="font-semibold hover:underline">{d.rider.name}</AppLink>
                    <div className="text-xs text-muted">{d.rider.vehicle ? `${VEHICLES[d.rider.vehicle.type] ?? d.rider.vehicle.type}${d.rider.vehicle.plate ? ` · ${d.rider.vehicle.plate}` : ''}` : ''}</div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-muted"><Star className="size-3 fill-accent text-accent" strokeWidth={0} /> {d.rider.rating.toFixed(1)} · {d.rider.deliveries} {d.rider.deliveries === 1 ? "delivery" : "deliveries"}</div>
                  </div>
                  {d.rider.phone && <a href={`tel:${d.rider.phone}`} aria-label="Call rider" className="flex size-10 items-center justify-center rounded-full border border-hairline hover:bg-ink/5"><Phone className="size-4" strokeWidth={1.5} /></a>}
                </div>
              ) : (
                <div className="flex items-center gap-3 px-5 py-4 text-[13px] text-muted">
                  <span className="sw-rings relative flex size-10 shrink-0 items-center justify-center">
                    <span className="absolute inset-0 rounded-full border border-accent" /><span className="absolute inset-0 rounded-full border border-accent" /><span className="absolute inset-0 rounded-full border border-accent" />
                    <Search className="size-4 text-ink" strokeWidth={1.5} />
                  </span>
                  {d.status === 'NO_RIDER' ? 'No rider accepted yet. Assign one or search again.' : 'Looking for the nearest rider…'}
                  {d.status === 'NO_RIDER' && canAssign && <ActionButton size="sm" variant="secondary" className="ml-auto" icon={<RefreshCw strokeWidth={1.5} />} onAction={() => act({ action: 'keep_searching' }, 'Searching again')}>Retry</ActionButton>}
                </div>
              )}
              <dl className="grid grid-cols-3 gap-2 border-t border-hairline px-5 py-4 text-[13px]">
                {d.status === 'COMPLETED' || d.status === 'CANCELLED' ? (
                  <div><dt className="label-caps text-muted">{d.status === 'COMPLETED' ? 'Delivered' : 'Cancelled'}</dt><dd className="mt-1 font-semibold tabular">{d.status === 'COMPLETED' ? fmtDateTime(d.timeline.completed) : '—'}</dd></div>
                ) : (
                  <div><dt className="label-caps text-muted">ETA</dt><dd className="mt-1 font-semibold tabular">{fmtEta(o.eta.liveSeconds)}</dd></div>
                )}
                <div><dt className="label-caps text-muted">Distance</dt><dd className="mt-1 font-semibold tabular">{fmtDistance(d.distanceMeters)}</dd></div>
                <div><dt className="label-caps text-muted">PIN</dt><dd className="mt-1 flex items-center gap-1 font-semibold tabular tracking-[0.2em]"><KeyRound className="size-3.5" strokeWidth={1.5} /> {o.pin ?? '—'}</dd></div>
              </dl>
              {o.destination && (
                <div className="flex gap-2 border-t border-hairline px-5 py-4 text-[13px]">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-muted" strokeWidth={1.5} />
                  <div>
                    <div className="font-semibold">{o.destination.label}</div>
                    {o.destination.landmark && <div className="text-muted">“{o.destination.landmark}”</div>}
                  </div>
                </div>
              )}
            </Card>
          )}
          <Card>
            <CardHeader title="Customer" />
            <div className="px-5 py-4 text-[13px]">
              <AppLink href={`/customers/${o.customer.id}`} className="text-sm font-semibold hover:underline">{o.customer.name}</AppLink>
              <div className="mt-1 flex items-center gap-2 text-muted"><Phone className="size-3.5" strokeWidth={1.5} /> <a href={`tel:${o.contact.phone || o.customer.phone}`} className="tabular hover:text-ink">{o.contact.phone || o.customer.phone}</a></div>
              {o.contact.name && o.contact.name !== o.customer.name && <div className="mt-1 text-muted">Recipient: {o.contact.name}</div>}
              {Object.entries(o.extraFields ?? {}).map(([k, v]) => <div key={k} className="mt-1 text-muted">{titleCase(k)}: {v}</div>)}
            </div>
          </Card>
          <Card>
            <CardHeader title="Payment" actions={<Chip tone={paymentTone(o.payment.status)}>{titleCase(o.payment.status)}</Chip>} />
            <ul className="divide-y divide-hairline">
              {o.payments.map((p) => (
                <li key={p.id} className="px-5 py-3.5 text-[13px]">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{PAYMENT_LABEL[p.method] ?? p.method} · {PROVIDER_LABEL[p.provider] ?? p.provider}</span>
                    <span className="font-semibold tabular">{fmtMoney(p.amount, o.currency)}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                    <Chip tone={paymentTone(p.status)}>{titleCase(p.status)}</Chip>
                    <span className="font-mono">{p.providerRef || p.reference}</span>
                    {p.paidAt && <span>paid {fmtDateTime(p.paidAt)}</span>}
                    {p.refunded > 0 && <span className="text-warning">refunded {fmtMoney(p.refunded, o.currency)}</span>}
                  </div>
                </li>
              ))}
              {o.payments.length === 0 && <li className="px-5 py-4 text-[13px] text-muted">No payment recorded yet.</li>}
            </ul>
            {pendingSnippe && canManage && (
              <div className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-3 text-[13px] text-muted">
                Waiting for the shopper to approve the USSD prompt.
                <ActionButton size="sm" variant="secondary" icon={<RefreshCw strokeWidth={1.5} />} onAction={async () => { try { await api(`/admin/payments/${pendingSnippe.id}/sync`, { method: 'POST' }); await refetch(); toast.success('Checked with Snippe'); } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Could not reach Snippe'); } }}>Check now</ActionButton>
              </div>
            )}
          </Card>
          <NotesCard o={o} canManage={canManage} onSaved={(x) => qc.setQueryData(key, x)} />
        </div>
      </div>

      <CancelDialog open={dialog === 'cancel'} onOpenChange={(v) => !v && setDialog(null)} onConfirm={(reason) => act({ action: 'cancel', reason }, 'Order cancelled')} />
      <RefundDialog open={dialog === 'refund'} onOpenChange={(v) => !v && setDialog(null)} o={o} onConfirm={(amount, reason) => act({ action: 'refund', amount, reason }, 'Refund recorded')} />
      {dialog === 'assign' && <AssignDialog o={o} onOpenChange={(v) => !v && setDialog(null)} onAssign={(riderId) => act({ action: 'assign', riderId }, 'Rider assigned')} />}
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted"><dt>{label}</dt><dd className="tabular text-ink">{value}</dd></div>
  );
}

function eventLabel(e: Order['events'][number]) {
  if (e.type === 'status' && e.to) return titleCase(e.to);
  if (e.type === 'note') return 'Note added';
  if (e.type === 'ready') return 'Packed and ready';
  return titleCase(e.type.replace(/\./g, ' '));
}

function DeliveryStepper({ o }: { o: Order }) {
  const t = o.delivery!.timeline;
  const at = (k: (typeof STEPS)[number]['key']) => (k === 'placed' ? o.placedAt : t[k]);
  const lastDone = STEPS.reduce((acc, s, i) => (at(s.key) ? i : acc), 0);
  return (
    <ol className="grid grid-cols-6 border-t border-hairline px-3 py-4">
      {STEPS.map((s, i) => {
        const done = !!at(s.key);
        return (
          <li key={s.key} className="relative flex flex-col items-center text-center">
            {i > 0 && (
              <span className="absolute right-1/2 top-[7px] h-0.5 w-full bg-hairline" aria-hidden>
                <motion.span className="block h-full bg-ink" initial={{ width: 0 }} animate={{ width: i <= lastDone ? '100%' : '0%' }} transition={{ duration: 0.6, delay: i * 0.08, ease: [0.22, 0.61, 0.36, 1] }} />
              </span>
            )}
            <span className={cn('relative z-10 flex size-4 items-center justify-center rounded-full border-2 transition-colors duration-300', done ? 'border-ink bg-ink' : 'border-hairline bg-surface', i === lastDone + 1 && 'border-ink')}>
              {done && <Check className="size-2.5 text-on-ink" strokeWidth={3.5} />}
            </span>
            <span className={cn('mt-2 text-[11px] font-semibold leading-tight', done ? 'text-ink' : 'text-subtle')}>{s.label}</span>
            <span className="text-[10.5px] text-subtle tabular">{at(s.key) ? new Date(at(s.key)!).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
          </li>
        );
      })}
    </ol>
  );
}

function NotesCard({ o, canManage, onSaved }: { o: Order; canManage: boolean; onSaved: (o: Order) => void }) {
  const [v, setV] = useState(o.adminNotes);
  return (
    <Card>
      <CardHeader title="Team notes" description="Only visible to the team." />
      <div className="flex flex-col gap-2 p-5">
        <Textarea rows={3} value={v} onChange={(e) => setV(e.target.value)} disabled={!canManage} placeholder="e.g. Gift wrap, call before arriving" aria-label="Team notes" />
        {v !== o.adminNotes && (
          <ActionButton size="sm" className="self-end" onAction={async () => { onSaved(await api<Order>(`/admin/orders/${o.id}`, { method: 'PATCH', body: { adminNotes: v } })); toast.success('Note saved'); }}>Save note</ActionButton>
        )}
      </div>
    </Card>
  );
}

function CancelDialog({ open, onOpenChange, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; onConfirm: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Cancel this order?" description="Stock is released, the rider is stood down and the customer is told by SMS and push." size="sm"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Keep order</Button><ActionButton variant="danger" icon={<Ban strokeWidth={1.5} />} onAction={() => onConfirm(reason || 'Cancelled by SmartWear')}>Cancel order</ActionButton></>}>
      <Field label="Reason" optional help="Shown to the customer.">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Out of stock in this size" />}</Field>
    </Dialog>
  );
}

function RefundDialog({ open, onOpenChange, o, onConfirm }: { open: boolean; onOpenChange: (v: boolean) => void; o: Order; onConfirm: (amount: number, reason: string) => Promise<void> }) {
  const paid = o.payments.filter((p) => p.status === 'PAID').reduce((a, p) => a + p.amount - p.refunded, 0);
  const [amount, setAmount] = useState(String(paid));
  const [reason, setReason] = useState('');
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Record a refund" description="Mobile-money and cash refunds are paid out from your provider dashboard; this keeps SmartWear's ledger exact." size="sm"
      footer={<><Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button><ActionButton icon={<CircleDollarSign strokeWidth={1.5} />} onAction={() => onConfirm(parseInt(amount.replace(/\D/g, ''), 10) || 0, reason)}>Record refund</ActionButton></>}>
      <div className="flex flex-col gap-4">
        <Field label={`Amount (${o.currency})`} help={`Up to ${fmtMoney(paid, o.currency)}`}>{(id) => <Input id={id} inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        <Field label="Reason" optional>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </div>
    </Dialog>
  );
}

function AssignDialog({ o, onOpenChange, onAssign }: { o: Order; onOpenChange: (v: boolean) => void; onAssign: (riderId: string) => Promise<void> }) {
  const { data, isPending } = useQuery({ queryKey: ['dispatch'], queryFn: () => api<DispatchBoard>('/admin/dispatch') });
  const riders = (data?.riders ?? [])
    .filter((r) => r.location && r.presence !== 'OFFLINE')
    .map((r) => ({ r, d: distanceMeters(o.store.location, r.location!) }))
    .sort((a, b) => Number(b.r.presence === 'IDLE') - Number(a.r.presence === 'IDLE') || a.d - b.d);
  return (
    <Dialog open onOpenChange={onOpenChange} title="Assign a rider" description={`Closest online riders to ${o.store.name}. They get the job immediately in Rider Mode.`}
      footer={<Button variant="ghost" onClick={() => onOpenChange(false)}>Close</Button>}>
      {isPending ? (
        <div className="flex flex-col gap-3">{[0, 1, 2].map((i) => <div key={i} className="sw-skeleton h-14" />)}</div>
      ) : riders.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">No riders are online right now.</p>
      ) : (
        <ul className="-mx-6 divide-y divide-hairline">
          {riders.map(({ r, d }) => (
            <li key={r.id} className="flex items-center gap-3 px-6 py-3">
              <RiderAvatar r={r} size={36} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{r.name}</div>
                <div className="text-xs text-muted">{fmtDistance(d)} from store · {r.presence === 'IDLE' ? 'free' : 'on a delivery'} · ★ {r.rating.toFixed(1)}</div>
              </div>
              <ActionButton size="sm" variant={r.presence === 'IDLE' ? 'primary' : 'secondary'} icon={<Wand2 strokeWidth={1.5} />} onAction={() => onAssign(r.id)}>Assign</ActionButton>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}
