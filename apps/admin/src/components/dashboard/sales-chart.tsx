'use client';

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fmtMoney, fmtNum } from '@/lib/format';

interface Day {
  date: string;
  sales: number;
  orders: number;
}

const short = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(iso));
const compact = (n: number) => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

/** One series (sales per day): no legend — the card title names it. Today is the accent bar; the rest are ink. */
export function SalesChart({ days, currency }: { days: Day[]; currency: string }) {
  const last = days.length - 1;
  return (
    <div className="h-64 w-full" role="img" aria-label={`Sales for the last ${days.length} days`}>
      <ResponsiveContainer>
        <BarChart data={days} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke="var(--sw-hairline)" />
          <XAxis dataKey="date" tickFormatter={short} tickLine={false} axisLine={false} tick={{ fill: 'var(--sw-muted)', fontSize: 11 }} interval="preserveStartEnd" minTickGap={16} />
          <YAxis tickFormatter={compact} tickLine={false} axisLine={false} tick={{ fill: 'var(--sw-muted)', fontSize: 11 }} width={44} />
          <Tooltip
            cursor={{ fill: 'var(--sw-ink)', fillOpacity: 0.04 }}
            content={({ active, payload }) => {
              const d = active && payload?.[0]?.payload as Day | undefined;
              if (!d) return null;
              return (
                <div className="rounded-sm border border-hairline bg-surface px-3 py-2 text-xs shadow-floating">
                  <div className="font-semibold">{short(d.date)}</div>
                  <div className="mt-1 tabular text-ink">{fmtMoney(d.sales, currency)}</div>
                  <div className="tabular text-muted">{fmtNum(d.orders)} orders</div>
                </div>
              );
            }}
          />
          <Bar dataKey="sales" radius={[4, 4, 0, 0]} maxBarSize={28}>
            {days.map((d, i) => (
              <Cell key={d.date} fill={i === last ? 'var(--sw-accent)' : 'var(--sw-ink)'} fillOpacity={i === last ? 1 : 0.82} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
