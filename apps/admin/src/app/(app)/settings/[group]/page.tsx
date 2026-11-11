import { notFound } from 'next/navigation';
import { SettingsEditor } from '@/components/settings/settings-editor';
import { ApiError } from '@/lib/api-error';
import { serverApi } from '@/lib/server-api';
import { SETTINGS_META } from '@/lib/settings-meta';

export async function generateMetadata({ params }: { params: Promise<{ group: string }> }) {
  const { group } = await params;
  return { title: SETTINGS_META[group]?.title ?? 'Settings' };
}

export default async function SettingsGroupPage({ params }: { params: Promise<{ group: string }> }) {
  const { group } = await params;
  let loaded;
  try {
    loaded = await Promise.all([
      serverApi<Parameters<typeof SettingsEditor>[0]['initial']>(`/admin/settings/${group}`),
      serverApi<{ items: { group: string; consoleUrl: string; docsUrl: string; testable?: boolean; lastTest: unknown }[] }>('/admin/settings/status'),
      serverApi<{ value: { currency: string } }>('/admin/settings/pricing.wholesale'),
    ]);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) notFound();
    throw e;
  }
  const [data, status, pricing] = loaded;
  const integration = status.items.find((i) => i.group === group) ?? null;
  return <SettingsEditor group={group} initial={data} integration={integration} currency={pricing.value.currency} />;
}
