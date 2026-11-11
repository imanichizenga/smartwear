import { AlertTriangle, ArrowUpRight, Bike, PackageSearch } from 'lucide-react';
import { SalesChart } from '@/components/dashboard/sales-chart';
import { AppLink } from '@/components/ui/app-link';
import { Card, CardHeader, Chip, EmptyState, PageHeader, Stat } from '@/components/ui/primitives';
import { fmtMoney, fmtNum, fmtPct, titleCase } from '@/lib/format';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Dashboard' };

interface Dashboard {
  currency: string;
  today: { sales: number; orders: number; aov: number; visitors: number; conversion: number };
  yesterdaySameTime: { sales: number; orders: number };
  byStatus: Record<string, number>;
  last14Days: { date: string; sales: number; orders: number }[];
  topProducts: { productId: string; title: string; qty: number; revenue: number }[];
  lowStock: { sku: string; title: string; store: string; onHand: number; threshold: number; productId: string }[];
  riders: Record<string, number>;
  needsRider: number;
  pendingWholesale: number;
  pendingReviews: number;
  products: number;
}

function delta(now: number, before: number) {
  if (!before) return now ? { text: 'First sales today', tone: 'success' as const } : { text: 'No sales yet today', tone: undefined };
  const p = ((now - before) / before) * 100;
  return { text: `${p >= 0 ? '+' : ''}${p.toFixed(0)}% vs. this time yesterday`, tone: p >= 0 ? ('success' as const) : ('warning' as const) };
}

/** The API returns only days with sales; the chart needs all 14 (zeros included) to read as a trend. */
function fill14(days: Dashboard['last14Days']): Dashboard['last14Days'] {
  const by = new Map(days.map((d) => [d.date, d]));
  const out: Dashboard['last14Days'] = [];
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Dar_es_Salaam' });
  for (let i = 13; i >= 0; i--) {
    const key = fmt.format(new Date(Date.now() - i * 86_400_000));
    out.push(by.get(key) ?? { date: key, sales: 0, orders: 0 });
  }
  return out;
}

export default async function DashboardPage() {
  const d = await serverApi<Dashboard>('/admin/dashboard');
  const online = (d.riders.IDLE ?? 0) + (d.riders.ASSIGNED ?? 0) + (d.riders.EN_ROUTE ?? 0);
  const s = delta(d.today.sales, d.yesterdaySameTime.sales);
  const greeting = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Africa/Dar_es_Salaam' }).format(new Date());
  return (
    <>
      <PageHeader eyebrow={greeting} title="Today at SmartWear" />
      {(d.needsRider > 0 || d.pendingWholesale > 0 || d.pendingReviews > 0) && (
        <div className="mb-6 flex flex-wrap gap-2">
          {d.needsRider > 0 && (
            <AppLink href="/dispatch" icon={<AlertTriangle strokeWidth={1.5} />} className="h-9 rounded-sm bg-warning-soft px-3 text-[13px] font-semibold text-warning">
              {d.needsRider} {d.needsRider === 1 ? 'order needs' : 'orders need'} a rider
            </AppLink>
          )}
          {d.pendingWholesale > 0 && (
            <AppLink href="/customers?tab=wholesale" icon={<ArrowUpRight strokeWidth={1.5} />} className="h-9 rounded-sm bg-accent-soft px-3 text-[13px] font-semibold">
              {d.pendingWholesale} wholesale {d.pendingWholesale === 1 ? 'application' : 'applications'}
            </AppLink>
          )}
          {d.pendingReviews > 0 && (
            <AppLink href="/reviews" icon={<ArrowUpRight strokeWidth={1.5} />} className="h-9 rounded-sm bg-ink/5 px-3 text-[13px] font-semibold">
              {d.pendingReviews} reviews to moderate
            </AppLink>
          )}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Stat label="Sales today" value={fmtMoney(d.today.sales, d.currency)} hint={s.text} tone={s.tone} />
        <Stat label="Orders" value={fmtNum(d.today.orders)} hint={`${fmtNum(d.yesterdaySameTime.orders)} by now yesterday`} />
        <Stat label="Average order" value={fmtMoney(d.today.aov, d.currency)} hint={`${fmtNum(d.products)} products live`} />
        <Stat label="Conversion" value={fmtPct(d.today.conversion)} hint={`${fmtNum(d.today.visitors)} shoppers today`} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Sales, last 14 days" description={`Daily revenue in ${d.currency}. Today is highlighted.`} />
          <div className="px-3 pb-4 pt-5 sm:px-5">
            <SalesChart days={fill14(d.last14Days)} currency={d.currency} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Open orders" description="Placed and not yet delivered." actions={<AppLink href="/orders" className="text-[13px] font-semibold text-muted hover:text-ink">View all</AppLink>} />
          {Object.keys(d.byStatus).length === 0 ? (
            <EmptyState title="All caught up" body="Every order has been delivered or collected." />
          ) : (
            <ul className="divide-y divide-hairline">
              {Object.entries(d.byStatus).map(([k, v]) => (
                <li key={k}>
                  <AppLink href={`/orders?status=${k}`} className="flex h-12 w-full justify-between px-5 text-sm hover:bg-ink/[0.03]">
                    <span>{titleCase(k)}</span>
                    <span className="font-semibold tabular">{fmtNum(v)}</span>
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center gap-3 border-t border-hairline px-5 py-4">
            <span className="flex size-9 items-center justify-center rounded-full bg-ink/5"><Bike className="size-4" strokeWidth={1.5} /></span>
            <div className="text-sm">
              <div className="font-semibold">{online} riders online</div>
              <div className="text-xs text-muted">{d.riders.OFFLINE ?? 0} offline · {d.riders.EN_ROUTE ?? 0} on a delivery</div>
            </div>
            <AppLink href="/dispatch" className="ml-auto text-[13px] font-semibold text-muted hover:text-ink">Live map</AppLink>
          </div>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top products today" />
          {d.topProducts.length === 0 ? (
            <EmptyState title="Nothing sold yet" body="Bestsellers appear as orders come in." />
          ) : (
            <ol className="divide-y divide-hairline">
              {d.topProducts.map((p, i) => (
                <li key={p.productId} className="flex items-center gap-4 px-5 py-3">
                  <span className="w-5 font-display text-lg text-subtle tabular">{i + 1}</span>
                  <AppLink href={`/products/${p.productId}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">{p.title}</AppLink>
                  <span className="text-xs text-muted tabular">{fmtNum(p.qty)} sold</span>
                  <span className="w-28 text-right text-sm font-semibold tabular">{fmtMoney(p.revenue, d.currency)}</span>
                </li>
              ))}
            </ol>
          )}
        </Card>
        <Card>
          <CardHeader title="Low stock" description="At or below the alert threshold, per store." actions={<AppLink href="/inventory?filter=low" className="text-[13px] font-semibold text-muted hover:text-ink">Inventory</AppLink>} />
          {d.lowStock.length === 0 ? (
            <EmptyState icon={<PackageSearch />} title="Fully stocked" body="Every variant is above its threshold." />
          ) : (
            <ul className="divide-y divide-hairline">
              {d.lowStock.slice(0, 8).map((l) => (
                <li key={`${l.sku}-${l.store}`} className="flex items-center gap-3 px-5 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <AppLink href={`/products/${l.productId}`} className="block truncate font-medium hover:underline">{l.title}</AppLink>
                    <div className="truncate text-xs text-muted">{l.sku} · {l.store}</div>
                  </div>
                  <Chip tone={l.onHand === 0 ? 'danger' : 'warning'}>{l.onHand === 0 ? 'Out' : `${l.onHand} left`}</Chip>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
