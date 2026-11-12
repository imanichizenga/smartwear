'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, MapPin, Star } from 'lucide-react';
import { toast } from 'sonner';
import { LoaderA } from '@/components/brand/LoaderA';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { Meter, Rise, Tabs } from '@/components/ui/kit';
import { Card, CardHeader, EmptyState, PageHeader, Stat } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fmtMoney, fmtNum, fmtPct, titleCase } from '@/lib/format';
import { PAYMENT_LABEL } from '@/lib/ops';
import { downloadApiFile } from '@/lib/upload';

type Report = 'sales' | 'products' | 'riders' | 'delivery-times' | 'heatmap';
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000));
const short = (s: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(s));
const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const axis = { tickLine: false, axisLine: false, tick: { fill: 'var(--sw-muted)', fontSize: 11 } } as const;

function ChartTip({ active, payload, label, money, currency }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string; money?: boolean; currency: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-sm border border-hairline bg-surface px-3 py-2 text-xs shadow-floating">
      <div className="font-semibold">{label && /^\d{4}-/.test(label) ? short(label) : label}</div>
      {payload.map((p) => <div key={p.name} className="tabular">{money ? fmtMoney(p.value, currency) : fmtNum(p.value)}</div>)}
    </div>
  );
}

export function ReportsWorkspace({ currency }: { currency: string }) {
  const [report, setReport] = useState<Report>('sales');
  const [range, setRange] = useState({ from: daysAgo(29), to: iso(new Date()) });
  const preset = (n: number) => setRange({ from: daysAgo(n - 1), to: iso(new Date()) });
  const q = useQuery({ queryKey: ['report', report, range], queryFn: () => api<Record<string, unknown> & { rows: Record<string, unknown>[] }>(`/admin/reports/${report}`, { query: range }), placeholderData: (p, prevQ) => (prevQ?.queryKey[1] === report ? p : undefined) });
  const exportCsv = () => downloadApiFile(`/admin/reports/${report}?from=${range.from}&to=${range.to}&format=csv`, `${report}.csv`).catch(() => toast.error('Nothing to export for this range'));
  const span = Math.round((new Date(range.to).getTime() - new Date(range.from).getTime()) / 86_400_000) + 1;

  return (
    <>
      <PageHeader title="Reports" description="Sales, products, riders and delivery performance for any date range. Every table exports to CSV."
        actions={report !== 'heatmap' && <ActionButton variant="secondary" icon={<Download strokeWidth={1.5} />} onAction={exportCsv}>Export CSV</ActionButton>} />
      <Card className="mb-4 overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-3">
          <Tabs id="reports" value={report} onChange={setReport} tabs={[{ key: 'sales', label: 'Sales' }, { key: 'products', label: 'Products' }, { key: 'riders', label: 'Riders' }, { key: 'delivery-times', label: 'Delivery times' }, { key: 'heatmap', label: 'Demand map' }]} />
          <div className="flex flex-wrap items-center gap-1.5 py-2">
            {[7, 30, 90].map((n) => <button key={n} type="button" onClick={() => preset(n)} className={cn('h-8 rounded-full px-3 text-[12.5px] font-semibold transition-colors', span === n && range.to === iso(new Date()) ? 'bg-ink text-on-ink' : 'text-muted hover:bg-ink/5')}>{n}d</button>)}
            <Input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} className="h-8 w-36 [&_input]:h-8" aria-label="From" />
            <span className="text-muted">–</span>
            <Input type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} className="h-8 w-36 [&_input]:h-8" aria-label="To" />
          </div>
        </div>
      </Card>
      <AnimatePresence mode="wait">
        <motion.div key={report} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          {!q.data ? <div className="flex justify-center py-24"><LoaderA size="lg" /></div> : (
            <div className={cn('transition-opacity', q.isFetching && 'opacity-60')}>
              {report === 'sales' && <Sales d={fillDays(q.data as never, range)} currency={currency} />}
              {report === 'products' && <Products d={q.data as never} currency={currency} />}
              {report === 'riders' && <Riders d={q.data as never} currency={currency} />}
              {report === 'delivery-times' && <Times d={q.data as never} />}
              {report === 'heatmap' && <Heat d={q.data as never} />}
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

/** The API only returns days with sales; pad the range with zero days so the chart reads as a timeline. */
function fillDays<T extends { rows: { date: string }[] }>(d: T, range: { from: string; to: string }): T {
  const have = new Map(d.rows.map((r) => [r.date, r]));
  const rows: T['rows'] = [];
  for (let t = new Date(`${range.from}T00:00:00Z`).getTime(), end = new Date(`${range.to}T00:00:00Z`).getTime(); t <= end; t += 86_400_000) {
    const k = new Date(t).toISOString().slice(0, 10);
    rows.push(have.get(k) ?? ({ date: k, orders: 0, revenue: 0, discount: 0, delivery: 0, tax: 0 } as T['rows'][number]));
  }
  return { ...d, rows };
}

function Sales({ d, currency }: { d: { rows: { date: string; orders: number; revenue: number; discount: number; delivery: number; tax: number }[]; byCustomerType: { customer_type: string; revenue: number; orders: number }[]; byPayment: { payment_method: string; revenue: number; orders: number }[] }; currency: string }) {
  const t = d.rows.reduce((a, r) => ({ revenue: a.revenue + r.revenue, orders: a.orders + r.orders, discount: a.discount + r.discount, delivery: a.delivery + r.delivery }), { revenue: 0, orders: 0, discount: 0, delivery: 0 });
  const split = (rows: { revenue: number }[]) => rows.reduce((a, r) => a + (r.revenue ?? 0), 0) || 1;
  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={fmtMoney(t.revenue, currency)} />
        <Stat label="Orders" value={fmtNum(t.orders)} />
        <Stat label="Average order" value={fmtMoney(t.orders ? Math.round(t.revenue / t.orders) : 0, currency)} />
        <Stat label="Discounts given" value={fmtMoney(t.discount, currency)} hint={`${fmtMoney(t.delivery, currency)} delivery fees`} />
      </div>
      <Card>
        <CardHeader title="Revenue by day" />
        <div className="h-72 p-4">
          {t.orders === 0 ? <EmptyState title="No sales in this range" /> : (
            <ResponsiveContainer>
              <AreaChart data={d.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="var(--sw-accent)" stopOpacity={0.35} /><stop offset="100%" stopColor="var(--sw-accent)" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="var(--sw-hairline)" />
                <XAxis dataKey="date" tickFormatter={short} minTickGap={24} {...axis} />
                <YAxis tickFormatter={compact} width={44} {...axis} />
                <Tooltip content={<ChartTip money currency={currency} />} cursor={{ stroke: 'var(--sw-hairline)' }} />
                <Area dataKey="revenue" name="Revenue" type="monotone" stroke="var(--sw-ink)" strokeWidth={1.75} fill="url(#rev)" animationDuration={700} />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        {([['Retail vs wholesale', d.byCustomerType.map((r) => ({ k: r.customer_type === 'WHOLESALE' ? 'Wholesale' : 'Retail', ...r }))], ['By payment method', d.byPayment.map((r) => ({ k: PAYMENT_LABEL[r.payment_method] ?? titleCase(r.payment_method), ...r }))]] as const).map(([title, rows]) => (
          <Card key={title}>
            <CardHeader title={title} />
            <ul className="grid gap-4 p-5">
              {rows.length === 0 && <li className="text-sm text-muted">No data</li>}
              {rows.map((r) => (
                <li key={r.k}>
                  <div className="mb-1.5 flex justify-between text-[13px]"><span className="font-semibold">{r.k}</span><span className="tabular text-muted">{fmtMoney(r.revenue, currency)} · {fmtNum(r.orders)} orders</span></div>
                  <Meter value={r.revenue} max={split(rows)} tone={r.k === 'Wholesale' ? 'accent' : 'ink'} />
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  );
}

function Products({ d, currency }: { d: { rows: { product_id: string | null; title: string; brand: string; units: number; revenue: number; wholesaleUnits: number }[]; byRoot: { root: string; revenue: number }[] }; currency: string }) {
  const roots = [...d.byRoot].filter((r) => r.revenue > 0).sort((a, b) => b.revenue - a.revenue);
  const max = d.rows[0]?.revenue ?? 1;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card className="overflow-hidden">
        <CardHeader title="Best sellers" description="By revenue, with the share sold at wholesale prices." />
        {d.rows.length === 0 ? <EmptyState title="Nothing sold in this range" /> : (
          <ul className="divide-y divide-hairline">
            {d.rows.slice(0, 50).map((r, i) => (
              <Rise as="li" i={i} key={`${r.product_id}-${i}`} className="grid grid-cols-[28px_1fr_auto] items-center gap-3 px-5 py-3">
                <span className="font-display text-lg text-muted tabular">{i + 1}</span>
                <div className="min-w-0">
                  {r.product_id ? <AppLink href={`/products/${r.product_id}`} className="truncate text-sm font-semibold hover:underline">{r.title}</AppLink> : <span className="text-sm font-semibold">{r.title}</span>}
                  <div className="mt-1 flex items-center gap-2"><Meter value={r.revenue} max={max} /><span className="shrink-0 text-xs text-muted">{r.brand}</span></div>
                </div>
                <div className="text-right"><div className="text-sm font-semibold tabular">{fmtMoney(r.revenue, currency)}</div><div className="text-xs text-muted tabular">{fmtNum(r.units)} units{r.wholesaleUnits ? ` · ${fmtNum(r.wholesaleUnits)} bulk` : ''}</div></div>
              </Rise>
            ))}
          </ul>
        )}
      </Card>
      <Card>
        <CardHeader title="By department" />
        <div className="h-80 p-4">
          <ResponsiveContainer>
            <BarChart data={roots} layout="vertical" margin={{ left: 8, right: 16 }}>
              <XAxis type="number" hide />
              <YAxis type="category" dataKey="root" width={110} {...axis} />
              <Tooltip content={<ChartTip money currency={currency} />} cursor={{ fill: 'var(--sw-ink)', fillOpacity: 0.04 }} />
              <Bar dataKey="revenue" name="Revenue" fill="var(--sw-ink)" radius={[0, 4, 4, 0]} maxBarSize={18} animationDuration={700} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function Riders({ d, currency }: { d: { rows: { riderId: string; name: string; deliveries: number; earnings: number; avgMinutes: number | null; rating: number; acceptance: number | null }[] }; currency: string }) {
  const max = Math.max(1, ...d.rows.map((r) => r.deliveries));
  return (
    <Card className="overflow-hidden">
      <CardHeader title="Rider performance" description="Deliveries completed in the range, average accept-to-delivered time and offer acceptance." />
      {d.rows.length === 0 ? <EmptyState title="No riders yet" /> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="label-caps border-b border-hairline text-left text-muted"><th className="px-5 py-3 font-semibold">Rider</th><th className="w-64 px-3 py-3 font-semibold">Deliveries</th><th className="px-3 py-3 text-right font-semibold">Avg time</th><th className="px-3 py-3 text-right font-semibold">Acceptance</th><th className="px-3 py-3 text-right font-semibold">Rating</th><th className="px-5 py-3 text-right font-semibold">Earnings</th></tr></thead>
            <tbody className="divide-y divide-hairline">
              {d.rows.map((r, i) => (
                <Rise as="tr" i={i} key={r.riderId}>
                  <td className="px-5 py-3"><AppLink href={`/riders/${r.riderId}`} className="font-semibold hover:underline">{r.name}</AppLink></td>
                  <td className="px-3 py-3"><div className="flex items-center gap-2"><span className="w-8 text-right tabular">{fmtNum(r.deliveries)}</span><Meter value={r.deliveries} max={max} /></div></td>
                  <td className="px-3 py-3 text-right tabular">{r.avgMinutes != null ? `${r.avgMinutes} min` : '—'}</td>
                  <td className={cn('px-3 py-3 text-right tabular', r.acceptance != null && r.acceptance < 60 && 'text-warning')}>{fmtPct(r.acceptance, 0)}</td>
                  <td className="px-3 py-3 text-right"><span className="inline-flex items-center gap-1 tabular"><Star className="size-3 fill-accent text-accent" strokeWidth={0} />{r.rating.toFixed(1)}</span></td>
                  <td className="px-5 py-3 text-right font-semibold tabular">{fmtMoney(r.earnings, currency)}</td>
                </Rise>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Times({ d }: { d: { rows: { bucket: string; orders: number }[]; onTimeRate: number | null; total: number } }) {
  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="grid content-start gap-3">
        <Stat label="On time" value={fmtPct(d.onTimeRate, 0)} hint="Delivered by the promised time" tone={d.onTimeRate != null && d.onTimeRate < 85 ? 'warning' : 'success'} />
        <Stat label="Deliveries" value={fmtNum(d.total)} />
      </div>
      <Card>
        <CardHeader title="Order to door" description="Minutes from placing the order to delivery." />
        <div className="h-72 p-4">
          <ResponsiveContainer>
            <BarChart data={d.rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--sw-hairline)" />
              <XAxis dataKey="bucket" {...axis} />
              <YAxis allowDecimals={false} width={32} {...axis} />
              <Tooltip content={<ChartTip currency="" />} cursor={{ fill: 'var(--sw-ink)', fillOpacity: 0.04 }} />
              <Bar dataKey="orders" name="Orders" fill="var(--sw-ink)" radius={[4, 4, 0, 0]} maxBarSize={48} animationDuration={700} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

/** Density grid of delivery destinations — works without a maps key and never shows an exact address. */
function Heat({ d }: { d: { rows: { lat: number; lng: number; weight: number }[] } }) {
  const cells = useMemo(() => {
    if (!d.rows.length) return null;
    const lats = d.rows.map((r) => r.lat), lngs = d.rows.map((r) => r.lng);
    const b = { s: Math.min(...lats), n: Math.max(...lats), w: Math.min(...lngs), e: Math.max(...lngs) };
    const pad = 0.01;
    b.s -= pad; b.n += pad; b.w -= pad; b.e += pad;
    const cols = 28, rows = Math.max(12, Math.round(cols * ((b.n - b.s) / (b.e - b.w || 1))));
    const grid = new Map<string, number>();
    for (const r of d.rows) {
      const c = Math.min(cols - 1, Math.floor(((r.lng - b.w) / (b.e - b.w)) * cols));
      const rr = Math.min(rows - 1, Math.floor(((b.n - r.lat) / (b.n - b.s)) * rows));
      grid.set(`${c}:${rr}`, (grid.get(`${c}:${rr}`) ?? 0) + r.weight);
    }
    const max = Math.max(...grid.values());
    return { cols, rows, max, list: [...grid.entries()].map(([k, v]) => { const [c, r] = k.split(':').map(Number); return { c: c!, r: r!, v }; }).sort((a, z) => z.v - a.v) };
  }, [d.rows]);
  if (!cells) return <Card><EmptyState icon={<MapPin />} title="No deliveries in this range" /></Card>;
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
      <Card className="overflow-hidden p-4">
        <svg viewBox={`0 0 ${cells.cols} ${cells.rows}`} className="w-full rounded-sm bg-canvas" role="img" aria-label="Delivery demand density">
          {Array.from({ length: cells.cols + 1 }, (_, i) => <line key={`v${i}`} x1={i} x2={i} y1={0} y2={cells.rows} stroke="var(--sw-hairline)" strokeWidth={0.02} />)}
          {Array.from({ length: cells.rows + 1 }, (_, i) => <line key={`h${i}`} y1={i} y2={i} x1={0} x2={cells.cols} stroke="var(--sw-hairline)" strokeWidth={0.02} />)}
          {cells.list.map((x, i) => (
            <motion.circle key={`${x.c}:${x.r}`} cx={x.c + 0.5} cy={x.r + 0.5} fill="var(--sw-accent)" initial={{ r: 0, opacity: 0 }} animate={{ r: 0.25 + 0.75 * Math.sqrt(x.v / cells.max), opacity: 0.25 + 0.7 * (x.v / cells.max) }} transition={{ delay: Math.min(i, 60) * 0.008, type: 'spring', stiffness: 200, damping: 18 }} />
          ))}
        </svg>
      </Card>
      <Card>
        <CardHeader title="Hotspots" description="Busiest cells (~1 km)." />
        <ul className="divide-y divide-hairline">
          {cells.list.slice(0, 8).map((x, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-2.5 text-[13px]"><span className="size-2.5 rounded-full bg-accent" style={{ opacity: 0.3 + 0.7 * (x.v / cells.max) }} /><span className="flex-1">Cell {String.fromCharCode(65 + (x.c % 26))}{x.r + 1}</span><span className="tabular text-muted">{fmtNum(x.v)} orders</span></li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
