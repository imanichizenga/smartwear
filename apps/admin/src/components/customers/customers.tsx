'use client';

import { useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Ban, Briefcase, Building2, Check, ExternalLink, FileText, Search, ShieldCheck, Star, Users, X } from 'lucide-react';
import { toast } from 'sonner';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { LoadMore, Rise, RowsSkeleton, Tabs, Toolbar } from '@/components/ui/kit';
import { useDebounced } from '@/components/ui/pickers';
import { Card, CardHeader, Chip, EmptyState, PageHeader, Stat } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { cn } from '@/lib/cn';
import { fmtAgo, fmtDate, fmtMoney, fmtNum, titleCase } from '@/lib/format';
import { orderTone, type OrderRow } from '@/lib/ops';
import type { MediaOut } from '@/lib/types';

interface CustomerRow { id: string; name: string; phone: string | null; email: string | null; customerType: 'RETAIL' | 'WHOLESALE'; wholesaleApproved: boolean; orders: number; ltv: number; lastOrderAt: string | null; blocked: boolean; createdAt: string; loyaltyPoints: number }
interface WholesaleApp { id: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; businessName: string; tin: string; businessType: string | null; address: string | null; expectedMonthlyVolume: string | null; licence: MediaOut | null; reviewNote: string | null; reviewedAt: string | null; submittedAt: string; customer: { id: string; name: string; phone: string | null } }
interface CustomerDetail extends Omit<CustomerRow, 'orders' | 'ltv' | 'lastOrderAt'> {
  group: { id: string; name: string } | null;
  blockedReason: string | null;
  styleProfile: Record<string, unknown> | null;
  lastSeenAt: string | null;
  identities: string[];
  stats: { ltv: number; aov: number; delivered: number; orders: number; cancelled: number };
  orders: OrderRow[];
  wholesaleApplications: WholesaleApp[];
  priceLists: { id: string; name: string; active: boolean }[];
}

const SEGMENTS = [
  { key: '', label: 'Everyone' },
  { key: 'new', label: 'New (30 days)' },
  { key: 'vip', label: 'VIP' },
  { key: 'lapsed', label: 'Lapsed (60 days)' },
  { key: 'wholesale', label: 'Wholesale' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'applications', label: 'Wholesale applications' },
] as const;
type Seg = (typeof SEGMENTS)[number]['key'];

export function CustomersWorkspace({ currency }: { currency: string }) {
  const [seg, setSeg] = useState<Seg>('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [open, setOpen] = useState<string | null>(null);
  const apps = useQuery({ queryKey: ['wholesale', 'PENDING'], queryFn: () => api<{ items: WholesaleApp[]; counts: Record<string, number> }>('/admin/wholesale', { query: { status: 'PENDING' } }) });
  const query = useInfiniteQuery({
    queryKey: ['customers', seg, dq],
    enabled: seg !== 'applications',
    queryFn: ({ pageParam }) => api<{ items: CustomerRow[]; nextCursor: string | null }>('/admin/customers', {
      query: { q: dq, cursor: pageParam, segment: ['new', 'vip', 'lapsed'].includes(seg) ? seg : undefined, type: seg === 'wholesale' ? 'WHOLESALE' : undefined, blocked: seg === 'blocked' ? 1 : undefined },
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const rows = query.data?.pages.flatMap((p) => p.items) ?? [];
  const pending = apps.data?.counts.PENDING ?? 0;

  return (
    <>
      <PageHeader title="Customers" description="Profiles, lifetime value and wholesale accounts. Approve wholesale applications to unlock bulk pricing for a business." />
      <AnimatePresence>
        {pending > 0 && seg !== 'applications' && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <Card className="mb-4 flex flex-wrap items-center gap-4 border-accent/40 bg-accent-soft/40 px-5 py-3.5">
              <span className="flex size-9 items-center justify-center rounded-full bg-surface"><Briefcase className="size-4" strokeWidth={1.5} /></span>
              <span className="flex-1 text-sm"><b className="font-semibold">{pending} wholesale {pending === 1 ? 'application' : 'applications'}</b> waiting for review.</span>
              <Button size="sm" onClick={() => setSeg('applications')}>Review</Button>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-3">
          <Tabs id="customers" tabs={[...SEGMENTS]} value={seg} onChange={setSeg} counts={{ applications: pending }} />
        </div>
        {seg === 'applications' ? (
          <WholesaleQueue />
        ) : (
          <>
            <Toolbar><Input className="min-w-0 flex-1 sm:max-w-sm" leading={<Search />} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, phone or email" aria-label="Search customers" /></Toolbar>
            {query.isPending ? <RowsSkeleton rows={8} /> : rows.length === 0 ? (
              <EmptyState icon={<Users />} title="No customers here" body={dq ? 'Try another name or number.' : 'Customers appear when they sign up in the app.'} />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-sm">
                  <thead><tr className="label-caps border-b border-hairline text-left text-muted"><th className="px-5 py-3 font-semibold">Customer</th><th className="px-3 py-3 font-semibold">Type</th><th className="px-3 py-3 text-right font-semibold">Orders</th><th className="px-3 py-3 text-right font-semibold">Lifetime value</th><th className="px-3 py-3 font-semibold">Last order</th><th className="px-5 py-3 text-right font-semibold">Points</th></tr></thead>
                  <tbody className="divide-y divide-hairline">
                    {rows.map((c, i) => (
                      <Rise as="tr" i={i} key={c.id} className="cursor-pointer hover:bg-ink/[0.025]">
                        <td className="px-5 py-3" onClick={() => setOpen(c.id)}>
                          <div className="flex items-center gap-3">
                            <Initials name={c.name} />
                            <div className="min-w-0"><div className="flex items-center gap-2 font-semibold">{c.name}{c.blocked && <Chip tone="danger">Blocked</Chip>}</div><div className="text-xs text-muted tabular">{c.phone ?? c.email ?? '—'}</div></div>
                          </div>
                        </td>
                        <td className="px-3 py-3" onClick={() => setOpen(c.id)}>{c.customerType === 'WHOLESALE' ? <Chip tone="accent">Wholesale</Chip> : <Chip>Retail</Chip>}</td>
                        <td className="px-3 py-3 text-right tabular" onClick={() => setOpen(c.id)}>{fmtNum(c.orders)}</td>
                        <td className="px-3 py-3 text-right font-semibold tabular" onClick={() => setOpen(c.id)}>{fmtMoney(c.ltv, currency)}</td>
                        <td className="px-3 py-3 text-xs text-muted" onClick={() => setOpen(c.id)}>{c.lastOrderAt ? fmtAgo(c.lastOrderAt) : 'Never'}</td>
                        <td className="px-5 py-3 text-right tabular" onClick={() => setOpen(c.id)}>{fmtNum(c.loyaltyPoints)}</td>
                      </Rise>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <LoadMore hasMore={query.hasNextPage} onMore={() => query.fetchNextPage()} />
          </>
        )}
      </Card>
      {open && <CustomerSheet id={open} currency={currency} onClose={() => setOpen(null)} />}
    </>
  );
}

function Initials({ name, size = 36 }: { name: string; size?: number }) {
  const ini = name.split(/\s+/).map((p) => p[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  return <span className="flex shrink-0 items-center justify-center rounded-full bg-blush font-display text-ink" style={{ width: size, height: size, fontSize: size * 0.4 }}>{ini || '·'}</span>;
}

function CustomerSheet({ id, currency, onClose }: { id: string; currency: string; onClose: () => void }) {
  const qc = useQueryClient();
  const canManage = useCan('customers.manage');
  const canApprove = useCan('wholesale.approve');
  const q = useQuery({ queryKey: ['customer', id], queryFn: () => api<CustomerDetail>(`/admin/customers/${id}`) });
  const groups = useQuery({ queryKey: ['price-lists'], queryFn: () => api<{ items: unknown[]; groups: { id: string; name: string }[] }>('/admin/price-lists') });
  const [blockOpen, setBlockOpen] = useState(false);
  const [reason, setReason] = useState('');
  const c = q.data;
  const patch = async (body: Record<string, unknown>, msg: string) => {
    try {
      const d = await api<CustomerDetail>(`/admin/customers/${id}`, { method: 'PATCH', body });
      qc.setQueryData(['customer', id], d);
      void qc.invalidateQueries({ queryKey: ['customers'] });
      toast.success(msg);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not update');
    }
  };
  const style = (c?.styleProfile ?? {}) as { departments?: string[]; styles?: string[]; sizes?: Record<string, string>; colours?: string[]; skinType?: string; skinTone?: string };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} side title={c?.name ?? 'Customer'} description={c ? `Joined ${fmtDate(c.createdAt)}${c.lastSeenAt ? ` · seen ${fmtAgo(c.lastSeenAt)}` : ''}` : undefined}
      footer={c && canManage && (
        c.blocked ? <ActionButton variant="secondary" onAction={() => patch({ blocked: false }, 'Unblocked')}>Unblock</ActionButton>
          : <Button variant="danger" icon={<Ban strokeWidth={1.5} />} onClick={() => setBlockOpen(true)}>Block customer</Button>
      )}>
      {!c ? <RowsSkeleton rows={5} /> : (
        <div className="grid gap-5">
          <div className="flex items-center gap-4">
            <Initials name={c.name} size={56} />
            <div className="min-w-0 flex-1">
              <div className="text-sm tabular">{c.phone ?? '—'}</div>
              <div className="text-sm text-muted">{c.email ?? 'No email'}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {c.customerType === 'WHOLESALE' ? <Chip tone="accent">Wholesale</Chip> : <Chip>Retail</Chip>}
                {c.identities.map((x) => <Chip key={x} tone="neutral">{x === 'google' ? 'Google' : 'Phone'}</Chip>)}
                {c.blocked && <Chip tone="danger">Blocked{c.blockedReason ? ` · ${c.blockedReason}` : ''}</Chip>}
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Lifetime" value={fmtMoney(c.stats.ltv, currency)} />
            <Stat label="Avg order" value={fmtMoney(c.stats.aov, currency)} />
            <Stat label="Orders" value={fmtNum(c.stats.orders)} hint={c.stats.cancelled ? `${c.stats.cancelled} cancelled` : undefined} />
          </div>
          <div className="flex items-center gap-2 rounded-sm bg-canvas px-4 py-3 text-[13px]"><Star className="size-4 text-accent" strokeWidth={1.5} /> <b className="font-semibold tabular">{fmtNum(c.loyaltyPoints)}</b> loyalty points</div>
          {canManage && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Account type">
                {(fid) => (
                  <Select id={fid} value={c.customerType} disabled={!canApprove} onChange={(e) => void patch({ customerType: e.target.value }, e.target.value === 'WHOLESALE' ? 'Now a wholesale account' : 'Moved to retail')}>
                    <option value="RETAIL">Retail</option><option value="WHOLESALE">Wholesale</option>
                  </Select>
                )}
              </Field>
              <Field label="Customer group" help="Groups get their price lists.">
                {(fid) => (
                  <Select id={fid} value={c.group?.id ?? ''} onChange={(e) => void patch({ groupId: e.target.value || null }, 'Group updated')}>
                    <option value="">No group</option>
                    {groups.data?.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </Select>
                )}
              </Field>
            </div>
          )}
          {(style.departments?.length || style.styles?.length || style.skinType) && (
            <div>
              <div className="label-caps mb-2 text-muted">Style profile</div>
              <div className="flex flex-wrap gap-1.5">
                {[...(style.departments ?? []), ...(style.styles ?? [])].map((s) => <Chip key={s} tone="blush">{titleCase(s)}</Chip>)}
                {style.skinType && <Chip tone="blush">{titleCase(style.skinType)} skin</Chip>}
                {Object.entries(style.sizes ?? {}).map(([k, v]) => <Chip key={k}>{titleCase(k)} {v}</Chip>)}
              </div>
            </div>
          )}
          {c.wholesaleApplications.length > 0 && (
            <div>
              <div className="label-caps mb-2 text-muted">Wholesale applications</div>
              {c.wholesaleApplications.map((a) => <AppCard key={a.id} a={a} compact />)}
            </div>
          )}
          <div>
            <div className="label-caps mb-2 text-muted">Recent orders</div>
            {c.orders.length === 0 ? <p className="text-sm text-muted">No orders yet.</p> : (
              <ul className="divide-y divide-hairline rounded-sm border border-hairline">
                {c.orders.map((o) => (
                  <li key={o.id}>
                    <AppLink href={`/orders/${o.id}`} className="flex w-full items-center gap-3 px-3 py-2.5 text-[13px] hover:bg-ink/[0.025]">
                      <span className="font-semibold tabular">{o.number}</span>
                      <Chip tone={orderTone(o.status)}>{o.statusLabel}</Chip>
                      <span className="ml-auto tabular">{fmtMoney(o.total, o.currency)}</span>
                      <span className="w-20 text-right text-xs text-muted">{fmtAgo(o.placedAt)}</span>
                    </AppLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
      <Dialog open={blockOpen} onOpenChange={setBlockOpen} size="sm" title="Block this customer?" description="They are signed out everywhere and can’t place orders until unblocked."
        footer={<><Button variant="ghost" onClick={() => setBlockOpen(false)}>Cancel</Button><ActionButton variant="danger" onAction={async () => { await patch({ blocked: true, reason }, 'Customer blocked'); setBlockOpen(false); }}>Block</ActionButton></>}>
        <Field label="Reason" help="Visible to your team only.">{(fid) => <Input id={fid} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Repeated fake orders" />}</Field>
      </Dialog>
    </Dialog>
  );
}

function WholesaleQueue() {
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const q = useQuery({ queryKey: ['wholesale', status], queryFn: () => api<{ items: WholesaleApp[]; counts: Record<string, number> }>('/admin/wholesale', { query: { status } }) });
  const items = q.data?.items ?? [];
  return (
    <>
      <Toolbar>
        {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} className={cn('h-8 rounded-full px-3 text-[13px] font-semibold transition-colors', status === s ? 'bg-ink text-on-ink' : 'text-muted hover:bg-ink/5')}>
            {titleCase(s)} <span className="tabular opacity-70">{q.data?.counts[s] ?? 0}</span>
          </button>
        ))}
      </Toolbar>
      {q.isPending ? <RowsSkeleton /> : items.length === 0 ? (
        <EmptyState icon={<Building2 />} title={status === 'PENDING' ? 'All caught up' : `No ${status.toLowerCase()} applications`} body="Businesses apply from their profile in the app with their TIN and licence." />
      ) : (
        <div className="grid gap-3 p-4 md:grid-cols-2">{items.map((a, i) => <Rise key={a.id} i={i}><AppCard a={a} /></Rise>)}</div>
      )}
    </>
  );
}

function AppCard({ a, compact }: { a: WholesaleApp; compact?: boolean }) {
  const qc = useQueryClient();
  const canApprove = useCan('wholesale.approve');
  const [mode, setMode] = useState<'approve' | 'reject' | null>(null);
  const [note, setNote] = useState('');
  const [groupId, setGroupId] = useState('');
  const groups = useQuery({ queryKey: ['price-lists'], enabled: mode === 'approve', queryFn: () => api<{ groups: { id: string; name: string }[] }>('/admin/price-lists') });
  const decide = async () => {
    try {
      await api(`/admin/wholesale/${a.id}`, { body: { decision: mode, note, groupId: groupId || undefined } });
      toast.success(mode === 'approve' ? `${a.businessName} approved — they’ll be notified` : 'Application rejected');
      setMode(null);
      void qc.invalidateQueries({ queryKey: ['wholesale'] });
      void qc.invalidateQueries({ queryKey: ['customer'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  return (
    <Card className={cn('p-4', compact && 'mb-2 border-hairline shadow-none')}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-xl leading-7">{a.businessName}</div>
          <div className="text-[13px] text-muted">{a.customer.name} · {a.customer.phone ?? '—'}</div>
        </div>
        <Chip tone={a.status === 'APPROVED' ? 'success' : a.status === 'REJECTED' ? 'danger' : 'warning'} dot={a.status === 'PENDING'}>{titleCase(a.status)}</Chip>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
        <dt className="text-muted">TIN</dt><dd className="font-mono tabular">{a.tin}</dd>
        {a.businessType && <><dt className="text-muted">Type</dt><dd>{titleCase(a.businessType)}</dd></>}
        {a.expectedMonthlyVolume && <><dt className="text-muted">Monthly volume</dt><dd>{a.expectedMonthlyVolume}</dd></>}
        {a.address && <><dt className="text-muted">Address</dt><dd>{a.address}</dd></>}
        <dt className="text-muted">Submitted</dt><dd>{fmtAgo(a.submittedAt)}</dd>
      </dl>
      {a.reviewNote && <p className="mt-3 rounded-sm bg-canvas px-3 py-2 text-[13px] text-muted">“{a.reviewNote}”</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {a.licence && (
          <a href={a.licence.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-ink/18 px-3 text-[13px] font-semibold hover:border-ink/40">
            <FileText className="size-4" strokeWidth={1.5} /> Licence <ExternalLink className="size-3" strokeWidth={1.5} />
          </a>
        )}
        {a.status === 'PENDING' && canApprove && (
          <>
            <Button size="sm" variant="ghost" className="ml-auto" icon={<X strokeWidth={1.5} />} onClick={() => setMode('reject')}>Reject</Button>
            <Button size="sm" icon={<ShieldCheck strokeWidth={1.5} />} onClick={() => setMode('approve')}>Approve</Button>
          </>
        )}
      </div>
      <Dialog open={!!mode} onOpenChange={(v) => !v && setMode(null)} size="sm" title={mode === 'approve' ? `Approve ${a.businessName}?` : 'Reject application'} description={mode === 'approve' ? 'They switch to wholesale pricing immediately and get a notification.' : 'The customer sees your note in the app, so be specific about what to fix.'}
        footer={<><Button variant="ghost" onClick={() => setMode(null)}>Cancel</Button><ActionButton variant={mode === 'reject' ? 'danger' : 'primary'} icon={mode === 'approve' ? <Check strokeWidth={1.5} /> : undefined} onAction={decide}>{mode === 'approve' ? 'Approve' : 'Reject'}</ActionButton></>}>
        <div className="grid gap-4">
          {mode === 'approve' && (
            <Field label="Price list group" optional help="Custom pricing for this business.">
              {(id) => <Select id={id} value={groupId} onChange={(e) => setGroupId(e.target.value)}><option value="">Standard wholesale tiers</option>{groups.data?.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select>}
            </Field>
          )}
          <Field label="Note" optional={mode === 'approve'}>{(id) => <Textarea id={id} rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'reject' ? 'The licence photo is unreadable — please upload a clearer copy.' : 'Welcome aboard!'} />}</Field>
        </div>
      </Dialog>
    </Card>
  );
}
