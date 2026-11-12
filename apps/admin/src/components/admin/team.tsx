'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Copy, KeyRound, Laptop, LogOut, Mail, ShieldCheck, UserPlus, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Rise, RowsSkeleton, Tabs } from '@/components/ui/kit';
import { Card, CardHeader, Chip, PageHeader, Switch } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useAdmin } from '@/lib/admin-context';
import { cn } from '@/lib/cn';
import { fmtAgo, fmtDate } from '@/lib/format';

interface Member { id: string; email: string; name: string; role: { key: string; name: string }; permissions: string[]; mfaEnabled: boolean; isActive: boolean; lastLoginAt: string | null; createdAt: string }
interface Role { key: string; name: string; description: string; permissions: string[] }
interface TeamRes { admins: Member[]; invites: { id: number; email: string; name: string; role: string; expiresAt: string }[]; roles: Role[] }

const PERM_GROUPS: [string, string[]][] = [
  ['Orders & delivery', ['dashboard.view', 'orders.view', 'orders.manage', 'orders.refund', 'dispatch.view', 'dispatch.assign', 'riders.view', 'riders.manage', 'payouts.manage', 'stores.manage']],
  ['Catalog', ['products.view', 'products.manage', 'products.publish', 'catalog.manage', 'catalog.roots', 'inventory.view', 'inventory.manage']],
  ['Customers & marketing', ['customers.view', 'customers.manage', 'wholesale.approve', 'marketing.manage', 'reviews.moderate', 'returns.manage', 'support.chat', 'reports.view']],
  ['Administration', ['settings.view', 'settings.manage', 'settings.secrets.reveal', 'team.manage', 'audit.view']],
];
const permLabel = (p: string) => p.replace('.', ' · ').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function TeamWorkspace() {
  const qc = useQueryClient();
  const me = useAdmin();
  const q = useQuery({ queryKey: ['team'], queryFn: () => api<TeamRes>('/admin/team') });
  const [tab, setTab] = useState<'members' | 'roles' | 'sessions'>('members');
  const [invite, setInvite] = useState(false);
  const patch = async (m: Member, body: Record<string, unknown>, msg: string) => {
    try {
      await api(`/admin/team/${m.id}`, { method: 'PATCH', body });
      toast.success(msg);
      void qc.invalidateQueries({ queryKey: ['team'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not update');
    }
  };
  const d = q.data;
  return (
    <>
      <PageHeader title="Team & roles" description="Everyone who can sign in to the admin. Two-factor sign-in is required for every role."
        actions={<Button icon={<UserPlus strokeWidth={1.5} />} onClick={() => setInvite(true)}>Invite</Button>} />
      <Card className="overflow-hidden">
        <div className="border-b border-hairline px-3"><Tabs id="team" value={tab} onChange={setTab} tabs={[{ key: 'members', label: 'Members' }, { key: 'roles', label: 'Roles' }, { key: 'sessions', label: 'Your sessions' }]} counts={{ members: d?.admins.length }} /></div>
        <AnimatePresence mode="wait">
          <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
            {!d ? <RowsSkeleton /> : tab === 'members' ? (
              <>
                <ul className="divide-y divide-hairline">
                  {d.admins.map((m, i) => (
                    <Rise as="li" i={i} key={m.id} className={cn('flex flex-wrap items-center gap-4 px-5 py-3.5', !m.isActive && 'opacity-55')}>
                      <span className="flex size-10 items-center justify-center rounded-full bg-blush font-display">{(m.name || m.email).slice(0, 1).toUpperCase()}</span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm font-semibold">{m.name || m.email}{m.id === me.id && <Chip tone="neutral">You</Chip>}{m.mfaEnabled ? <ShieldCheck className="size-3.5 text-success" strokeWidth={1.75} aria-label="2FA on" /> : <Chip tone="warning">2FA pending</Chip>}</div>
                        <div className="text-xs text-muted">{m.email} · {m.lastLoginAt ? `last in ${fmtAgo(m.lastLoginAt)}` : 'never signed in'}</div>
                      </div>
                      <Select value={m.role.key} onChange={(e) => void patch(m, { roleKey: e.target.value }, `${m.name || m.email} is now ${d.roles.find((r) => r.key === e.target.value)?.name}`)} className="w-44" aria-label="Role">
                        {d.roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                      </Select>
                      {m.id !== me.id && (
                        <>
                          <ActionButton size="sm" variant="ghost" icon={<KeyRound strokeWidth={1.5} />} onAction={() => patch(m, { resetMfa: true }, '2FA reset — they set it up again at next sign-in')}>Reset 2FA</ActionButton>
                          <Switch checked={m.isActive} onCheckedChange={(v) => void patch(m, { isActive: v }, v ? 'Reactivated' : 'Deactivated and signed out')} label={m.isActive ? 'Deactivate' : 'Reactivate'} />
                        </>
                      )}
                    </Rise>
                  ))}
                </ul>
                {d.invites.length > 0 && (
                  <div className="border-t border-hairline">
                    <div className="label-caps px-5 pt-4 text-muted">Pending invites</div>
                    <ul className="divide-y divide-hairline">
                      {d.invites.map((v) => <li key={v.id} className="flex items-center gap-3 px-5 py-3 text-[13px]"><Mail className="size-4 text-muted" strokeWidth={1.5} /><span className="flex-1">{v.name ? `${v.name} · ` : ''}{v.email}</span><Chip>{v.role}</Chip><span className="text-xs text-muted">expires {fmtDate(v.expiresAt)}</span></li>)}
                    </ul>
                  </div>
                )}
              </>
            ) : tab === 'roles' ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] text-[13px]">
                  <thead><tr className="border-b border-hairline"><th className="sticky left-0 bg-surface px-5 py-3 text-left font-semibold">Permission</th>{d.roles.map((r) => <th key={r.key} className="px-2 py-3 text-center font-semibold" title={r.description}>{r.name}</th>)}</tr></thead>
                  <tbody>
                    {PERM_GROUPS.map(([g, perms]) => (
                      <RolesGroup key={g} title={g} perms={perms} roles={d.roles} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <Sessions />}
          </motion.div>
        </AnimatePresence>
      </Card>
      {invite && d && <InviteDialog roles={d.roles} onClose={() => setInvite(false)} onDone={() => void qc.invalidateQueries({ queryKey: ['team'] })} />}
    </>
  );
}

function RolesGroup({ title, perms, roles }: { title: string; perms: string[]; roles: Role[] }) {
  return (
    <>
      <tr><td colSpan={roles.length + 1} className="label-caps bg-canvas px-5 py-2 text-muted">{title}</td></tr>
      {perms.map((p) => (
        <tr key={p} className="border-b border-hairline">
          <td className="sticky left-0 bg-surface px-5 py-2">{permLabel(p)}</td>
          {roles.map((r) => <td key={r.key} className="px-2 py-2 text-center">{r.permissions.includes(p) ? <Check className="mx-auto size-4 text-ink" strokeWidth={2} aria-label="Allowed" /> : <span className="text-subtle" aria-label="Not allowed">—</span>}</td>)}
        </tr>
      ))}
    </>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sessions'], queryFn: () => api<{ items: { id: string; ip: string | null; userAgent: string; createdAt: string; lastSeenAt: string; current: boolean }[] }>('/admin/auth/sessions') });
  if (!q.data) return <RowsSkeleton />;
  return (
    <ul className="divide-y divide-hairline">
      {q.data.items.map((s, i) => (
        <Rise as="li" i={i} key={s.id} className="flex items-center gap-4 px-5 py-3.5">
          <Laptop className="size-5 text-muted" strokeWidth={1.25} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{browser(s.userAgent)}{s.current && <Chip tone="success" className="ml-2">This device</Chip>}</div>
            <div className="text-xs text-muted">{s.ip ?? 'Unknown IP'} · signed in {fmtDate(s.createdAt)} · active {fmtAgo(s.lastSeenAt)}</div>
          </div>
          {!s.current && <ActionButton size="sm" variant="ghost" icon={<LogOut strokeWidth={1.5} />} onAction={async () => { await api(`/admin/auth/sessions/${s.id}`, { method: 'DELETE' }); toast.success('Signed out'); void qc.invalidateQueries({ queryKey: ['sessions'] }); }}>Sign out</ActionButton>}
        </Rise>
      ))}
    </ul>
  );
}
const browser = (ua: string) => (!ua ? 'Server session' : /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser') + (/(Mac OS|Macintosh)/.test(ua) ? ' on macOS' : /Windows/.test(ua) ? ' on Windows' : /Android/.test(ua) ? ' on Android' : /iPhone|iPad/.test(ua) ? ' on iOS' : /Linux/.test(ua) ? ' on Linux' : '');

function InviteDialog({ roles, onClose, onDone }: { roles: Role[]; onClose: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleKey, setRoleKey] = useState(roles.find((r) => r.key === 'SUPPORT')?.key ?? roles[0]?.key ?? '');
  const [link, setLink] = useState<string | null>(null);
  const role = roles.find((r) => r.key === roleKey);
  const send = async () => {
    try {
      const r = await api<{ inviteUrl: string; token: string }>('/admin/team/invites', { body: { email, name, roleKey } });
      setLink(r.inviteUrl.startsWith('/') || !r.inviteUrl.startsWith('http') ? `${window.location.origin}/accept-invite?token=${r.token}` : r.inviteUrl);
      onDone();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not invite');
    }
  };
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()} title={link ? 'Invite ready' : 'Invite to the team'} description={link ? 'Send this one-time link. It expires in 7 days; they choose a password and set up 2FA.' : undefined}
      footer={link ? <Button onClick={onClose}>Done</Button> : <><Button variant="ghost" onClick={onClose}>Cancel</Button><ActionButton disabled={!/^\S+@\S+\.\S+$/.test(email)} icon={<UserPlus strokeWidth={1.5} />} onAction={send}>Create invite</ActionButton></>}>
      {link ? (
        <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-2 rounded-sm border border-hairline bg-canvas p-2">
          <code className="min-w-0 flex-1 truncate px-2 text-[12.5px]">{link}</code>
          <Button size="sm" icon={<Copy strokeWidth={1.5} />} onClick={() => { void navigator.clipboard.writeText(link); toast.success('Link copied'); }}>Copy</Button>
        </motion.div>
      ) : (
        <div className="grid gap-4">
          <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="amina@smartwear.africa" />}</Field>
          <Field label="Name" optional>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Field label="Role" help={role?.description}>{(id) => <Select id={id} value={roleKey} onChange={(e) => setRoleKey(e.target.value)}>{roles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}</Select>}</Field>
          {role && <div className="flex flex-wrap gap-1">{role.permissions.slice(0, 14).map((p) => <Chip key={p} tone="neutral">{permLabel(p)}</Chip>)}{role.permissions.length > 14 && <Chip>+{role.permissions.length - 14}</Chip>}</div>}
          <p className="flex items-center gap-1.5 text-xs text-muted"><UsersRound className="size-3.5" strokeWidth={1.5} /> They’ll be asked to set up an authenticator app on first sign-in.</p>
        </div>
      )}
    </Dialog>
  );
}
