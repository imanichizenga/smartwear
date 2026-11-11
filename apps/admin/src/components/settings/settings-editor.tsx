'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, BookOpen, CircleAlert, CircleCheck, ExternalLink, PlugZap, RotateCcw, Save } from 'lucide-react';
import { toast } from 'sonner';
import { AnimatePresence, motion } from 'motion/react';
import { AppLink } from '@/components/ui/app-link';
import { ActionButton, Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { Card, CardHeader, Chip } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { fmtAgo } from '@/lib/format';
import { SETTINGS_META } from '@/lib/settings-meta';
import { SchemaForm, type JsonSchema, type SecretState } from './schema-form';

type Obj = Record<string, never>;
interface Initial {
  group: string;
  value: Record<string, unknown>;
  secrets: Record<string, SecretState>;
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  schema: JsonSchema;
}
interface TestResult {
  ok: boolean;
  message: string;
  checks: { name: string; ok: boolean; message?: string }[];
  testedAt: string;
}
interface Integration {
  group: string;
  consoleUrl: string;
  docsUrl: string;
  testable?: boolean;
  lastTest: unknown;
}

export function SettingsEditor({ group, initial, integration, currency }: { group: string; initial: Initial; integration: Integration | null; currency: string }) {
  const router = useRouter();
  const meta = SETTINGS_META[group];
  const canManage = useCan('settings.manage');
  const canReveal = useCan('settings.secrets.reveal');
  const [saved, setSaved] = useState(initial);
  const [value, setValue] = useState(initial.value);
  const dirty = useMemo(() => JSON.stringify(value) !== JSON.stringify(saved.value), [value, saved.value]);
  const [conflict, setConflict] = useState(false);
  const [test, setTest] = useState<TestResult | null>((integration?.lastTest as TestResult | null) ?? null);
  const [testInputs, setTestInputs] = useState<Record<string, string>>({});

  const save = async () => {
    try {
      const next = await api<Initial>(`/admin/settings/${group}`, { method: 'PUT', body: { value, version: saved.version } });
      setSaved(next);
      setValue(next.value);
      setConflict(false);
      toast.success(`${meta?.title ?? group} saved`, { description: 'Live everywhere within a second — no restart needed.' });
      router.refresh();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'stale_settings') setConflict(true);
      else if (e instanceof ApiError) toast.error(e.message, { description: formatDetails(e.details) });
      else toast.error('Could not save');
    }
  };
  const reload = async () => {
    const fresh = await api<Initial>(`/admin/settings/${group}`);
    setSaved(fresh);
    setValue(fresh.value);
    setConflict(false);
  };
  const runTest = async () => {
    try {
      setTest(await api<TestResult>(`/admin/settings/${group}/test`, { body: testInputs }));
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Test could not run');
    }
  };

  const testable = integration && meta?.test;
  return (
    <>
      <AppLink href="/settings" icon={<ArrowLeft strokeWidth={1.5} />} className="mb-5 text-[13px] font-semibold text-muted hover:text-ink">
        Settings
      </AppLink>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[32px] leading-10 md:text-4xl md:leading-[44px]">{meta?.title ?? group}</h1>
          {meta?.description && <p className="mt-2 max-w-2xl text-sm text-muted">{meta.description}</p>}
          <p className="mt-2 text-xs text-subtle">
            {saved.updatedAt ? `Version ${saved.version} · updated ${fmtAgo(saved.updatedAt)}${saved.updatedBy ? ` by ${saved.updatedBy}` : ''}` : 'Using defaults — not saved yet'}
          </p>
        </div>
        {integration && (
          <div className="flex gap-2">
            <a href={integration.docsUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-sm px-3 text-[13px] font-semibold text-muted hover:bg-ink/5 hover:text-ink">
              <BookOpen className="size-4" strokeWidth={1.5} /> Docs
            </a>
            <a href={integration.consoleUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-2 rounded-sm border border-ink/18 bg-surface px-3 text-[13px] font-semibold hover:border-ink/40">
              Provider console <ExternalLink className="size-3.5" strokeWidth={1.5} />
            </a>
          </div>
        )}
      </div>

      <div className={testable ? 'grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]' : ''}>
        <fieldset disabled={!canManage} className="min-w-0">
          <SchemaForm group={group} schema={initial.schema} value={value as Obj} onChange={setValue} meta={meta} secrets={saved.secrets} canReveal={canReveal} currency={currency} />
        </fieldset>
        {testable && (
          <Card className="xl:sticky xl:top-24">
            <CardHeader title="Test connection" description={meta.test!.label} />
            <div className="flex flex-col gap-4 p-5">
              {meta.test!.inputs?.map((inp) => (
                <Field key={inp.key} label={inp.label} help={inp.help}>
                  {(id) => <Input id={id} placeholder={inp.placeholder} value={testInputs[inp.key] ?? ''} onChange={(e) => setTestInputs({ ...testInputs, [inp.key]: e.target.value })} />}
                </Field>
              ))}
              <ActionButton variant="secondary" icon={<PlugZap strokeWidth={1.5} />} onAction={runTest} disabled={!canManage || dirty} className="w-full">
                Test connection
              </ActionButton>
              {dirty && <p className="-mt-2 text-xs text-muted">Save your changes first — the test uses the saved settings.</p>}
              {test && (
                <div aria-live="polite" className="rounded-sm border border-hairline">
                  <div className={`flex items-center gap-2 border-b border-hairline px-4 py-3 text-sm font-semibold ${test.ok ? 'text-success' : 'text-danger'}`}>
                    {test.ok ? <CircleCheck className="size-4" strokeWidth={2} /> : <CircleAlert className="size-4" strokeWidth={2} />}
                    {test.ok ? 'All checks passed' : 'Something needs attention'}
                    <span className="ml-auto text-xs font-normal text-subtle">{fmtAgo(test.testedAt)}</span>
                  </div>
                  <ul className="divide-y divide-hairline">
                    {test.checks.map((c) => (
                      <li key={c.name} className="flex gap-3 px-4 py-3 text-[13px]">
                        <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${c.ok ? 'bg-success' : 'bg-danger'}`} aria-hidden />
                        <div className="min-w-0">
                          <div className="font-semibold">
                            {c.name} <span className="sr-only">{c.ok ? 'passed' : 'failed'}</span>
                          </div>
                          {c.message && <div className="mt-0.5 break-words text-muted">{c.message}</div>}
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        )}
      </div>

      <AnimatePresence>
        {(dirty || conflict) && canManage && (
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', damping: 28, stiffness: 300 }}
            className="sticky bottom-4 z-20 mt-6 flex flex-wrap items-center gap-3 rounded-md border border-hairline bg-surface/95 px-4 py-3 shadow-sticky backdrop-blur-md"
          >
            {conflict ? (
              <>
                <Chip tone="warning">Changed elsewhere</Chip>
                <span className="text-[13px] text-muted">Someone saved these settings after you opened them.</span>
                <div className="ml-auto flex gap-2">
                  <ActionButton variant="secondary" icon={<RotateCcw strokeWidth={1.5} />} onAction={reload}>Load latest</ActionButton>
                </div>
              </>
            ) : (
              <>
                <span className="text-[13px] font-semibold">Unsaved changes</span>
                <div className="ml-auto flex gap-2">
                  <Button variant="ghost" onClick={() => setValue(saved.value)}>Discard</Button>
                  <ActionButton icon={<Save strokeWidth={1.5} />} onAction={save}>Save</ActionButton>
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function formatDetails(d: Record<string, unknown>): string | undefined {
  const errs = d.errors as { loc?: (string | number)[]; msg?: string }[] | undefined;
  if (Array.isArray(errs) && errs.length) return errs.slice(0, 3).map((e) => `${(e.loc ?? []).join('.')}: ${e.msg}`).join(' · ');
  return undefined;
}
