'use client';

import { useState } from 'react';
import { Eye, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Card, Checkbox, Switch } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/cn';
import { humanize, type FieldMeta, type GroupMeta } from '@/lib/settings-meta';
import { usePendingAction } from '@/lib/use-pending';

/* ------------------------------------------------------------------ JSON-schema helpers */
export interface JsonSchema {
  type?: string | string[];
  enum?: (string | number)[];
  const?: string;
  title?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  maxLength?: number;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
  $ref?: string;
  $defs?: Record<string, JsonSchema>;
  additionalProperties?: boolean | JsonSchema;
}

type Json = string | number | boolean | null | Json[] | { [k: string]: Json };
type Obj = Record<string, Json>;

function resolve(s: JsonSchema, root: JsonSchema): { schema: JsonSchema; nullable: boolean } {
  let nullable = false;
  let cur = s;
  if (cur.anyOf) {
    const nonNull = cur.anyOf.filter((x) => x.type !== 'null');
    nullable = nonNull.length < cur.anyOf.length;
    cur = { ...nonNull[0], default: cur.default, title: cur.title };
  }
  if (cur.$ref) {
    const name = cur.$ref.split('/').pop()!;
    cur = { ...(root.$defs?.[name] ?? {}), default: cur.default ?? root.$defs?.[name]?.default };
  }
  return { schema: cur, nullable };
}

function defaultFor(s: JsonSchema, root: JsonSchema): Json {
  const { schema } = resolve(s, root);
  if (schema.default !== undefined) return structuredClone(schema.default) as Json;
  if (schema.type === 'object' || schema.properties) {
    const o: Obj = {};
    for (const [k, v] of Object.entries(schema.properties ?? {})) o[k] = defaultFor(v, root);
    return o;
  }
  if (schema.type === 'array') return [];
  if (schema.type === 'boolean') return false;
  if (schema.type === 'integer' || schema.type === 'number') return schema.minimum ?? 0;
  if (schema.enum) return schema.enum[0] as Json;
  return '';
}

/* ------------------------------------------------------------------ secrets */
export interface SecretState {
  set: boolean;
  masked: string;
}

function SecretField({ group, path, label, help, value, state, onChange, canReveal }: {
  group: string;
  path: string;
  label: string;
  help?: string;
  value: Json;
  state: SecretState | undefined;
  onChange: (v: Json) => void;
  canReveal: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [password, setPassword] = useState('');
  const [reveal, revealing] = usePendingAction(async () => {
    try {
      const r = await api<{ value: string }>(`/admin/settings/${group}/reveal`, { body: { path } });
      setRevealed(r.value);
      setTimeout(() => setRevealed(null), 30_000);
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'reauth_required' || e.status === 403)) setReauth(true);
      else toast.error(e instanceof Error ? e.message : 'Could not reveal');
    }
  });
  const [confirmReauth, confirming] = usePendingAction(async () => {
    try {
      await api('/admin/auth/reauth', { body: { password } });
      setReauth(false);
      setPassword('');
      await reveal();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Password not accepted');
    }
  });
  const isSet = state?.set;
  return (
    <Field label={label} help={help}>
      {(id) =>
        editing || !isSet ? (
          <div className="flex gap-2">
            <Input id={id} type="password" autoComplete="off" spellCheck={false} value={editing ? String(value === state?.masked ? '' : value ?? '') : String(value ?? '')} placeholder={isSet ? 'Enter a new value' : 'Not set'} onChange={(e) => onChange(e.target.value || (isSet ? state.masked : ''))} className="font-mono" />
            {editing && (
              <Button variant="ghost" onClick={() => { setEditing(false); onChange(state?.masked ?? ''); }}>
                Cancel
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <div id={id} className="flex h-10 flex-1 items-center overflow-hidden rounded-sm border border-hairline bg-canvas px-3 font-mono text-[13px] text-muted">
              <span className="truncate">{revealed ?? state?.masked}</span>
            </div>
            {canReveal && !revealed && (
              <Button variant="secondary" pending={revealing} icon={<Eye strokeWidth={1.5} />} onClick={() => void reveal()}>
                Reveal
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditing(true)}>
              Replace
            </Button>
            <Dialog
              open={reauth}
              onOpenChange={setReauth}
              size="sm"
              title="Confirm your password"
              description="Revealing a secret is recorded in the audit log."
              footer={<Button pending={confirming} disabled={!password} onClick={() => void confirmReauth()}>Confirm</Button>}
            >
              <Field label="Password">{(pid) => <Input id={pid} type="password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void confirmReauth()} />}</Field>
            </Dialog>
          </div>
        )
      }
    </Field>
  );
}

/* ------------------------------------------------------------------ the form */
export interface SchemaFormProps {
  group: string;
  schema: JsonSchema;
  value: Obj;
  onChange: (v: Obj) => void;
  meta: GroupMeta | undefined;
  secrets: Record<string, SecretState>;
  canReveal: boolean;
  currency: string;
}

export function SchemaForm({ group, schema, value, onChange, meta, secrets, canReveal, currency }: SchemaFormProps) {
  const props = schema.properties ?? {};
  const fm = meta?.fields ?? {};
  const visible = Object.keys(props).filter((k) => !fm[k]?.hidden);
  const layout = meta?.layout ?? [{ title: '', fields: visible }];
  const placed = new Set(layout.flatMap((l) => l.fields));
  const rest = visible.filter((k) => !placed.has(k));
  const sections = rest.length && meta?.layout ? [...layout, { title: 'More', fields: rest }] : layout;
  const set = (k: string, v: Json) => onChange({ ...value, [k]: v });
  return (
    <div className="flex flex-col gap-4">
      {sections.map((sec) => (
        <Card key={sec.title || 'main'}>
          {sec.title && (
            <div className="border-b border-hairline px-5 py-4">
              <h3 className="font-sans text-[15px] font-semibold tracking-normal">{sec.title}</h3>
              {'description' in sec && sec.description && <p className="mt-0.5 text-[13px] text-muted">{sec.description}</p>}
            </div>
          )}
          <div className="grid gap-x-6 gap-y-5 p-5 md:grid-cols-2">
            {sec.fields.filter((k) => props[k] && !fm[k]?.hidden).map((k) => (
              <Node
                key={k}
                group={group}
                path={k}
                name={k}
                schema={props[k]!}
                root={schema}
                value={value[k] ?? null}
                onChange={(v) => set(k, v)}
                meta={fm}
                secrets={secrets}
                canReveal={canReveal}
                currency={currency}
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

interface NodeProps {
  group: string;
  path: string;
  name: string;
  schema: JsonSchema;
  root: JsonSchema;
  value: Json;
  onChange: (v: Json) => void;
  meta: Record<string, FieldMeta>;
  secrets: Record<string, SecretState>;
  canReveal: boolean;
  currency: string;
  compact?: boolean;
}

function Node(p: NodeProps) {
  const { schema: s, nullable } = resolve(p.schema, p.root);
  const m = p.meta[p.name] ?? {};
  const label = m.label ?? humanize(p.name);
  const wide = 'md:col-span-2';

  if (p.secrets[p.path] !== undefined) {
    return (
      <div className={wide}>
        <SecretField group={p.group} path={p.path} label={label} help={m.help} value={p.value} state={p.secrets[p.path]} onChange={p.onChange} canReveal={p.canReveal} />
      </div>
    );
  }
  if (m.json || (s.type === 'array' && s.items && (s.items.type === 'object' && !s.items.properties && !s.items.$ref))) {
    return <JsonField label={label} help={m.help} value={p.value} onChange={p.onChange} className={wide} />;
  }
  if (s.type === 'boolean') {
    return (
      <label className={cn('flex items-start justify-between gap-4 rounded-sm py-1', p.compact ? '' : wide)}>
        <span>
          <span className="block text-[13px] font-semibold">{label}</span>
          {m.help && <span className="mt-0.5 block text-xs text-muted">{m.help}</span>}
        </span>
        <Switch checked={Boolean(p.value)} onCheckedChange={p.onChange} label={label} />
      </label>
    );
  }
  if (s.enum) {
    return (
      <Field label={label} help={m.help}>
        {(id) => (
          <Select id={id} value={String(p.value ?? '')} onChange={(e) => p.onChange(typeof s.enum![0] === 'number' ? Number(e.target.value) : e.target.value)}>
            {s.enum!.map((o) => (
              <option key={String(o)} value={String(o)}>
                {m.options?.[String(o)] ?? humanize(String(o))}
              </option>
            ))}
          </Select>
        )}
      </Field>
    );
  }
  if (s.type === 'integer' || s.type === 'number') {
    const factor = m.bytes ? 1024 * 1024 : 1;
    const shown = p.value === null || p.value === undefined || p.value === '' ? '' : Number(p.value) / factor;
    const suffix = m.money ? p.currency : m.suffix;
    return (
      <Field label={label} help={m.help ?? (s.minimum !== undefined && s.maximum !== undefined ? `Between ${s.minimum} and ${s.maximum}.` : undefined)} optional={nullable}>
        {(id) => (
          <Input
            id={id}
            type="number"
            inputMode="decimal"
            step={s.type === 'integer' && !m.bytes ? 1 : 'any'}
            min={s.minimum !== undefined ? s.minimum / factor : undefined}
            max={s.maximum !== undefined ? s.maximum / factor : undefined}
            value={shown}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') return p.onChange(nullable ? null : 0);
              const n = Number(raw) * factor;
              p.onChange(s.type === 'integer' ? Math.round(n) : n);
            }}
            className="tabular"
            trailing={suffix ? <span className="pr-1 text-xs font-medium">{suffix}</span> : undefined}
          />
        )}
      </Field>
    );
  }
  if (s.type === 'array' && s.items) {
    const { schema: item } = resolve(s.items, p.root);
    const arr = Array.isArray(p.value) ? p.value : [];
    if (item.enum) {
      return (
        <Field label={label} help={m.help} className={wide}>
          {() => (
            <div className="flex flex-wrap gap-2">
              {item.enum!.map((o) => {
                const on = arr.includes(o as Json);
                return (
                  <label key={String(o)} className={cn('inline-flex h-9 cursor-pointer items-center gap-2 rounded-sm border px-3 text-[13px] font-medium transition-colors', on ? 'border-ink bg-ink/[0.04]' : 'border-hairline hover:border-ink/30')}>
                    <Checkbox checked={on} onCheckedChange={(v) => p.onChange(v ? [...arr, o as Json] : arr.filter((x) => x !== o))} />
                    {m.options?.[String(o)] ?? humanize(String(o))}
                  </label>
                );
              })}
            </div>
          )}
        </Field>
      );
    }
    if (item.type === 'string' || item.type === 'integer' || item.type === 'number') {
      return (
        <Field label={label} help={m.help ?? 'Separate values with commas.'} className={wide}>
          {(id) => (
            <Input
              id={id}
              defaultValue={arr.join(', ')}
              onBlur={(e) => {
                const parts = e.target.value.split(',').map((x) => x.trim()).filter(Boolean);
                p.onChange(item.type === 'string' ? parts : parts.map(Number).filter((n) => !Number.isNaN(n)));
              }}
              trailing={m.suffix ? <span className="pr-1 text-xs font-medium">{m.suffix}</span> : undefined}
            />
          )}
        </Field>
      );
    }
    return <ObjectList {...p} schema={item} label={label} items={arr as Obj[]} />;
  }
  if (s.type === 'object' || s.properties) {
    const obj = (p.value && typeof p.value === 'object' && !Array.isArray(p.value) ? p.value : defaultFor(p.schema, p.root)) as Obj;
    return (
      <fieldset className={cn('rounded-sm border border-hairline p-4', wide)}>
        <legend className="px-1 text-[13px] font-semibold">{label}</legend>
        <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
          {Object.entries(s.properties ?? {}).filter(([k]) => !p.meta[k]?.hidden).map(([k, sub]) => (
            <Node key={k} {...p} path={`${p.path}.${k}`} name={k} schema={sub} value={obj[k] ?? null} onChange={(v) => p.onChange({ ...obj, [k]: v })} compact />
          ))}
        </div>
      </fieldset>
    );
  }
  const multiline = m.multiline || (typeof p.value === 'string' && (p.value.includes('\n') || p.value.length > 90));
  return (
    <Field label={label} help={m.help} optional={nullable} className={multiline ? wide : undefined}>
      {(id) =>
        multiline ? (
          <Textarea id={id} value={String(p.value ?? '')} onChange={(e) => p.onChange(e.target.value)} placeholder={m.placeholder} rows={3} maxLength={s.maxLength} />
        ) : (
          <Input id={id} value={String(p.value ?? '')} onChange={(e) => p.onChange(nullable && e.target.value === '' ? null : e.target.value)} placeholder={m.placeholder} maxLength={s.maxLength} spellCheck={false} />
        )
      }
    </Field>
  );
}

function ObjectList(p: NodeProps & { label: string; items: Obj[] }) {
  const titleKey = ['name', 'label', 'key', 'id'].find((k) => p.schema.properties?.[k]);
  return (
    <div className="flex flex-col gap-3 md:col-span-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold">{p.label}</span>
        <Button variant="secondary" size="sm" icon={<Plus strokeWidth={1.5} />} onClick={() => p.onChange([...p.items, defaultFor(p.schema, p.root)])}>
          Add
        </Button>
      </div>
      {p.items.length === 0 && <p className="rounded-sm border border-dashed border-hairline px-4 py-6 text-center text-[13px] text-muted">None yet.</p>}
      {p.items.map((it, i) => (
        <div key={i} className="rounded-sm border border-hairline bg-canvas/50">
          <div className="flex items-center justify-between border-b border-hairline px-4 py-2.5">
            <span className="text-[13px] font-semibold">{(titleKey && String(it[titleKey] ?? '')) || `${p.label} ${i + 1}`}</span>
            <Button variant="ghost" size="icon-sm" aria-label="Remove" icon={<Trash2 strokeWidth={1.5} />} onClick={() => p.onChange(p.items.filter((_, j) => j !== i))} />
          </div>
          <div className="grid gap-x-6 gap-y-4 p-4 md:grid-cols-2">
            {Object.entries(p.schema.properties ?? {}).map(([k, sub]) => (
              <Node key={k} {...p} path={`${p.path}.${i}.${k}`} name={k} schema={sub} value={it[k] ?? null} onChange={(v) => p.onChange(p.items.map((x, j) => (j === i ? { ...x, [k]: v } : x)))} compact />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function JsonField({ label, help, value, onChange, className }: { label: string; help?: string; value: Json; onChange: (v: Json) => void; className?: string }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? [], null, 2));
  const [err, setErr] = useState<string | null>(null);
  return (
    <Field label={label} help={help} error={err} className={className}>
      {(id) => (
        <Textarea
          id={id}
          rows={8}
          className="font-mono text-xs"
          spellCheck={false}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            try {
              onChange(JSON.parse(e.target.value || '[]'));
              setErr(null);
            } catch {
              setErr('Not valid JSON yet');
            }
          }}
        />
      )}
    </Field>
  );
}
