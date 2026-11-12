'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import { DropdownMenu } from 'radix-ui';
import { ChevronsLeft, LogOut, Menu, Monitor, Moon, Search, Sun, X } from 'lucide-react';
import { BrandMark, Wordmark } from '@/components/brand/BrandMark';
import { LoaderA } from '@/components/brand/LoaderA';
import { AppLink } from '@/components/ui/app-link';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { AdminProvider, type AdminMe } from '@/lib/admin-context';
import { cn } from '@/lib/cn';
import { navFor, type NavGroup } from '@/lib/nav';
import { RouteProgress } from '@/lib/nav-progress';
import { applyTheme, type ThemePref } from '@/lib/theme';

function isActive(path: string, href: string) {
  return href === '/' ? path === '/' : path === href || path.startsWith(`${href}/`);
}

function Sidebar({ groups, collapsed, onToggle, onNavigate }: { groups: NavGroup[]; collapsed: boolean; onToggle?: () => void; onNavigate?: () => void }) {
  const path = usePathname();
  return (
    <nav aria-label="Main" className="flex h-full flex-col">
      <div className={cn('flex h-16 shrink-0 items-center gap-3 px-5', collapsed && 'justify-center px-0')}>
        <BrandMark size={28} />
        {!collapsed && <Wordmark />}
      </div>
      <div className="scrollbar-none flex-1 overflow-y-auto px-3 pb-6">
        {groups.map((g) => (
          <div key={g.label} className="mt-5 first:mt-2">
            {!collapsed && <div className="label-caps mb-1.5 px-3 text-subtle">{g.label}</div>}
            <ul className="flex flex-col gap-0.5">
              {g.items.map((it) => {
                const active = isActive(path, it.href);
                const Icon = it.icon;
                return (
                  <li key={it.href}>
                    <AppLink
                      href={it.href}
                      onClick={onNavigate}
                      title={collapsed ? it.label : undefined}
                      aria-current={active ? 'page' : undefined}
                      icon={<Icon strokeWidth={1.5} />}
                      className={cn(
                        'flex h-9 w-full gap-3 rounded-sm px-3 text-[13.5px] font-medium text-muted transition-colors duration-150 hover:bg-ink/5 hover:text-ink',
                        active && 'bg-ink/[0.06] text-ink',
                        collapsed && 'justify-center px-0',
                      )}
                    >
                      {!collapsed && <span className="truncate">{it.label}</span>}
                      {active && !collapsed && <span className="ml-auto size-1.5 rounded-full bg-accent" aria-hidden />}
                    </AppLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      {onToggle && (
        <button onClick={onToggle} className="flex h-12 shrink-0 items-center gap-2 border-t border-hairline px-5 text-xs font-medium text-muted hover:text-ink" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>
          <ChevronsLeft className={cn('size-4 transition-transform', collapsed && 'mx-auto rotate-180')} strokeWidth={1.5} />
          {!collapsed && 'Collapse'}
        </button>
      )}
    </nav>
  );
}

function ThemeMenu({ initial }: { initial: ThemePref }) {
  const [t, setT] = useState<ThemePref>(initial);
  const opts: [ThemePref, string, typeof Sun][] = [['light', 'Light', Sun], ['dark', 'Dark', Moon], ['system', 'System', Monitor]];
  const Icon = t === 'dark' ? Moon : t === 'light' ? Sun : Monitor;
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="ghost" size="icon" aria-label="Theme" icon={<Icon strokeWidth={1.5} />} />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 min-w-36 rounded-md border border-hairline bg-surface p-1 shadow-floating">
          {opts.map(([k, label, I]) => (
            <DropdownMenu.Item key={k} onSelect={() => { applyTheme(k); setT(k); }} className={cn('flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-[13px] outline-none data-[highlighted]:bg-ink/5', t === k && 'font-semibold')}>
              <I className="size-4" strokeWidth={1.5} /> {label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function UserMenu({ admin }: { admin: AdminMe }) {
  const router = useRouter();
  const [out, setOut] = useState(false);
  const initials = (admin.name || admin.email).split(/\s+/).map((s) => s[0]).slice(0, 2).join('').toUpperCase();
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-1 hover:bg-ink/5 sm:pr-3" aria-label="Account">
        <span className="flex size-8 items-center justify-center rounded-full bg-ink text-[11px] font-bold tracking-wide text-on-ink">{initials}</span>
        <span className="hidden text-left sm:block">
          <span className="block text-[13px] font-semibold leading-4">{admin.name || admin.email}</span>
          <span className="block text-[11px] leading-4 text-muted">{admin.role.name}</span>
        </span>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={6} className="z-50 w-60 rounded-md border border-hairline bg-surface p-1 shadow-floating">
          <div className="px-2.5 py-2 text-xs text-muted">{admin.email}</div>
          <DropdownMenu.Separator className="my-1 h-px bg-hairline" />
          <DropdownMenu.Item
            onSelect={async (e) => {
              e.preventDefault();
              setOut(true);
              await api('/admin/auth/logout', { method: 'POST' }).catch(() => undefined);
              router.replace('/login');
              router.refresh();
            }}
            className="flex h-9 cursor-pointer items-center gap-2.5 rounded-sm px-2.5 text-[13px] outline-none data-[highlighted]:bg-ink/5"
          >
            <span className="sw-swap" data-pending={out}>
              <LogOut className="sw-swap-content size-4" strokeWidth={1.5} />
              <span className="sw-swap-loader">{out && <LoaderA size="xs" />}</span>
            </span>
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function CommandPalette({ groups, open, setOpen }: { groups: NavGroup[]; open: boolean; setOpen: (v: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<{ id: string; title: string; slug: string; status: string }[]>([]);
  const query = open ? q.trim() : '';
  useEffect(() => {
    if (query.length < 2) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      api<{ items: { id: string; title: string; slug: string; status: string }[] }>('/admin/products', { query: { q: query, limit: 6 }, signal: ctrl.signal })
        .then((r) => setHits(r.items))
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);
  const shownHits = query.length < 2 ? [] : hits;
  const go = (href: string) => {
    setOpen(false);
    setQ('');
    router.push(href);
  };
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-overlay px-4 pt-[12vh] backdrop-blur-[2px]" onClick={() => setOpen(false)}>
      <Command label="Command menu" className="w-full max-w-xl overflow-hidden rounded-lg border border-hairline bg-surface shadow-sheet" onClick={(e) => e.stopPropagation()} loop>
        <div className="flex items-center gap-3 border-b border-hairline px-4">
          <Search className="size-4 text-muted" strokeWidth={1.5} />
          <Command.Input autoFocus value={q} onValueChange={setQ} placeholder="Jump to a page or search products…" className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle" />
          <kbd className="rounded-xs border border-hairline px-1.5 py-0.5 text-[10px] font-semibold text-muted">ESC</kbd>
        </div>
        <Command.List className="max-h-[60vh] overflow-y-auto p-2">
          <Command.Empty className="px-3 py-8 text-center text-sm text-muted">Nothing matches “{q}”.</Command.Empty>
          {shownHits.length > 0 && (
            <Command.Group heading="Products" className="[&_[cmdk-group-heading]]:label-caps [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-subtle">
              {shownHits.map((h) => (
                <Command.Item key={h.id} value={`product ${h.title} ${h.id}`} onSelect={() => go(`/products/${h.id}`)} className="flex h-10 cursor-pointer items-center justify-between rounded-sm px-3 text-sm data-[selected=true]:bg-ink/5">
                  {h.title}
                  <span className="text-xs text-muted">{h.status.toLowerCase()}</span>
                </Command.Item>
              ))}
            </Command.Group>
          )}
          {groups.map((g) => (
            <Command.Group key={g.label} heading={g.label} className="[&_[cmdk-group-heading]]:label-caps [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-subtle">
              {g.items.map((it) => (
                <Command.Item key={it.href} value={`${it.label} ${it.keywords ?? ''}`} onSelect={() => go(it.href)} className="flex h-10 cursor-pointer items-center gap-3 rounded-sm px-3 text-sm data-[selected=true]:bg-ink/5">
                  <it.icon className="size-4 text-muted" strokeWidth={1.5} />
                  {it.label}
                </Command.Item>
              ))}
            </Command.Group>
          ))}
        </Command.List>
      </Command>
    </div>
  );
}

export function Shell({ admin, theme, sidebarCollapsed, children }: { admin: AdminMe; theme: ThemePref; sidebarCollapsed: boolean; children: ReactNode }) {
  const groups = navFor(admin.permissions);
  const [collapsed, setCollapsed] = useState(sidebarCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [cmd, setCmd] = useState(false);
  const bleed = usePathname().startsWith('/dispatch');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmd((v) => !v);
      }
      if (e.key === 'Escape') setCmd(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const toggle = () => {
    const next = !collapsed;
    document.cookie = `sw_sidebar=${next ? 'collapsed' : 'open'}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setCollapsed(next);
  };
  return (
    <AdminProvider admin={admin}>
      <RouteProgress />
      <div className="flex min-h-dvh">
        <aside className={cn('sticky top-0 hidden h-dvh shrink-0 border-r border-hairline bg-surface transition-[width] duration-200 ease-atelier lg:block', collapsed ? 'w-[72px]' : 'w-64')}>
          <Sidebar groups={groups} collapsed={collapsed} onToggle={toggle} />
        </aside>
        {mobileOpen && (
          <div className="fixed inset-0 z-50 lg:hidden">
            <div className="absolute inset-0 bg-overlay" onClick={() => setMobileOpen(false)} />
            <aside className="absolute inset-y-0 left-0 w-72 bg-surface shadow-sheet">
              <Button variant="ghost" size="icon" className="absolute right-2 top-3" aria-label="Close menu" onClick={() => setMobileOpen(false)} icon={<X strokeWidth={1.5} />} />
              <Sidebar groups={groups} collapsed={false} onNavigate={() => setMobileOpen(false)} />
            </aside>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-hairline bg-canvas/85 px-4 backdrop-blur-md sm:px-6">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)} icon={<Menu strokeWidth={1.5} />} />
            <button onClick={() => setCmd(true)} className="flex h-10 min-w-0 flex-1 items-center gap-3 rounded-sm border border-hairline bg-surface px-3 text-left text-sm text-subtle hover:border-ink/25 sm:max-w-md">
              <Search className="size-4 shrink-0" strokeWidth={1.5} />
              <span className="truncate">Search or jump to…</span>
              <kbd className="ml-auto hidden rounded-xs border border-hairline px-1.5 py-0.5 text-[10px] font-semibold text-muted sm:inline">⌘K</kbd>
            </button>
            <div className="ml-auto flex items-center gap-1">
              <ThemeMenu initial={theme} />
              <UserMenu admin={admin} />
            </div>
          </header>
          <main id="main" className={cn('mx-auto w-full flex-1', bleed ? 'flex flex-col' : 'max-w-[1400px] px-4 py-6 sm:px-6 lg:px-10 lg:py-8')}>
            {children}
          </main>
        </div>
      </div>
      <CommandPalette groups={groups} open={cmd} setOpen={setCmd} />
    </AdminProvider>
  );
}
