import { ArrowUpRight, CircleAlert, CircleCheck, CircleDashed, CircleHelp } from 'lucide-react';
import { AppLink } from '@/components/ui/app-link';
import { Card, Chip, PageHeader, type Tone } from '@/components/ui/primitives';
import { fmtAgo } from '@/lib/format';
import { SETTINGS_META } from '@/lib/settings-meta';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Settings' };

interface Status {
  group: string;
  title: string;
  description: string;
  consoleUrl: string;
  docsUrl: string;
  state: 'ok' | 'failing' | 'untested' | 'not_configured';
  lastTest: { ok: boolean; message: string; testedAt: string; stale: boolean } | null;
}

const STATE: Record<Status['state'], { tone: Tone; label: string; Icon: typeof CircleCheck }> = {
  ok: { tone: 'success', label: 'Connected', Icon: CircleCheck },
  failing: { tone: 'danger', label: 'Failing', Icon: CircleAlert },
  untested: { tone: 'warning', label: 'Not tested', Icon: CircleHelp },
  not_configured: { tone: 'neutral', label: 'Not configured', Icon: CircleDashed },
};

export default async function SettingsPage() {
  const [{ items }, { groups }] = await Promise.all([serverApi<{ items: Status[] }>('/admin/settings/status'), serverApi<{ groups: string[] }>('/admin/settings')]);
  const integrations = new Set(items.map((i) => i.group));
  const others = groups.filter((g) => !integrations.has(g));
  const bySection = new Map<string, string[]>();
  for (const g of others) {
    const s = SETTINGS_META[g]?.section ?? 'Store';
    bySection.set(s, [...(bySection.get(s) ?? []), g]);
  }
  const ok = items.filter((i) => i.state === 'ok').length;
  return (
    <>
      <PageHeader eyebrow="Admin" title="Settings" description="Every key, credential and business rule lives here — encrypted at rest and applied instantly across the API and workers, no restart needed." />
      <section aria-labelledby="int">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 id="int" className="text-2xl">Integrations</h2>
          <span className="text-[13px] text-muted">{ok} of {items.length} connected</span>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => {
            const st = STATE[i.state];
            return (
              <AppLink key={i.group} href={`/settings/${i.group}`} className="group block">
                <Card className="flex h-full w-full flex-col p-5 transition-colors group-hover:border-ink/25">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-sans text-[15px] font-semibold tracking-normal">{SETTINGS_META[i.group]?.title ?? i.title}</h3>
                    <Chip tone={st.tone}>
                      <st.Icon className="size-3.5" strokeWidth={2} /> {st.label}
                    </Chip>
                  </div>
                  <p className="mt-1.5 flex-1 text-[13px] leading-5 text-muted">{i.description}</p>
                  <div className="mt-4 text-xs text-subtle">
                    {i.lastTest ? (
                      <span className={i.lastTest.ok ? '' : 'text-danger'}>
                        {i.lastTest.ok ? 'Passed' : 'Failed'} {fmtAgo(i.lastTest.testedAt)}
                        {i.lastTest.stale && ' · settings changed since'}
                      </span>
                    ) : (
                      'Never tested'
                    )}
                  </div>
                </Card>
              </AppLink>
            );
          })}
        </div>
      </section>
      {(['Store', 'Delivery', 'Content'] as const).map((sec) =>
        bySection.get(sec)?.length ? (
          <section key={sec} className="mt-10">
            <h2 className="mb-3 text-2xl">{sec}</h2>
            <Card className="divide-y divide-hairline">
              {bySection.get(sec)!.map((g) => (
                <AppLink key={g} href={`/settings/${g}`} className="flex w-full items-center gap-4 px-5 py-4 hover:bg-ink/[0.02]">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{SETTINGS_META[g]?.title ?? g}</div>
                    <div className="truncate text-[13px] text-muted">{SETTINGS_META[g]?.description}</div>
                  </div>
                  <ArrowUpRight className="size-4 shrink-0 text-subtle" strokeWidth={1.5} />
                </AppLink>
              ))}
            </Card>
          </section>
        ) : null,
      )}
    </>
  );
}
