import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { Shell } from '@/components/layout/shell';
import type { AdminMe } from '@/lib/admin-context';
import { serverApi } from '@/lib/server-api';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await serverApi<{ admin: AdminMe; mfaPassed: boolean }>('/admin/auth/me');
  if (!me.mfaPassed) redirect('/login?step=mfa');
  const jar = await cookies();
  const t = jar.get('sw_theme')?.value;
  return (
    <Shell admin={me.admin} theme={t === 'light' || t === 'dark' ? t : 'system'} sidebarCollapsed={jar.get('sw_sidebar')?.value === 'collapsed'}>
      {children}
    </Shell>
  );
}
