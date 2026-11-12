'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MapPin, Plus, Save, Store as StoreIcon } from 'lucide-react';
import { toast } from 'sonner';
import { LiveMap, type MapMarker } from '@/components/maps/live-map';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Card, Chip, EmptyState, PageHeader, Switch } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { cn } from '@/lib/cn';
import type { LatLng } from '@/lib/geo';

interface StoreRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  address: string;
  area: string | null;
  city: string;
  location: LatLng;
  phone: string | null;
  email: string | null;
  hours: Record<string, unknown>;
  serviceableRadiusMeters: number;
  fulfilsDelivery: boolean;
  allowsPickup: boolean;
  isActive: boolean;
}
type Draft = Partial<StoreRow> & { location?: LatLng };

export function StoresWorkspace() {
  const qc = useQueryClient();
  const canManage = useCan('stores.manage');
  const { data } = useQuery({ queryKey: ['stores'], queryFn: () => api<{ items: StoreRow[] }>('/admin/stores') });
  const [sel, setSel] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const items = data?.items ?? [];

  const markers: MapMarker[] = items.map((s) => ({ id: s.id, kind: 'store', position: s.location, label: s.name, selected: sel === s.id, dimmed: !s.isActive, onClick: () => setSel(s.id) }));
  const save = async () => {
    if (!draft) return;
    try {
      if (draft.id) await api(`/admin/stores/${draft.id}`, { method: 'PATCH', body: draft });
      else await api('/admin/stores', { body: { city: 'Dar es Salaam', kind: 'store', fulfilsDelivery: true, allowsPickup: true, ...draft } });
      toast.success(`${draft.name} saved`);
      setDraft(null);
      await qc.invalidateQueries({ queryKey: ['stores'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };

  return (
    <>
      <PageHeader
        title="Stores & offices"
        description="Every location that holds stock or hands over orders. Shown as blue pins to riders and customers; delivery fees are measured from the nearest store with the items."
        actions={canManage && <Button icon={<Plus strokeWidth={1.5} />} onClick={() => setDraft({ name: '', address: '', serviceableRadiusMeters: 15000, isActive: true, fulfilsDelivery: true, allowsPickup: true })}>Add location</Button>}
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="overflow-hidden">
          <LiveMap className="h-[520px]" markers={markers} fitKey={String(items.length)} />
        </Card>
        <Card>
          {items.length === 0 ? (
            <EmptyState icon={<StoreIcon />} title="No locations yet" body="Add your first store so deliveries can be priced and dispatched." />
          ) : (
            <ul className="divide-y divide-hairline">
              {items.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setSel(s.id)} className={cn('flex w-full items-start gap-3 px-5 py-4 text-left transition-colors', sel === s.id ? 'bg-accent-soft/60' : 'hover:bg-ink/[0.025]')}>
                    <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-map-office text-white"><StoreIcon className="size-4" strokeWidth={1.75} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-semibold">{s.name} {!s.isActive && <Chip>Inactive</Chip>}</div>
                      <div className="truncate text-xs text-muted">{s.address}</div>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        {s.fulfilsDelivery && <Chip tone="ink">Delivers</Chip>}
                        {s.allowsPickup && <Chip>Pickup</Chip>}
                        <Chip>{(s.serviceableRadiusMeters / 1000).toFixed(0)} km</Chip>
                      </div>
                    </div>
                    {canManage && <span role="button" tabIndex={0} onClick={(e) => { e.stopPropagation(); setDraft(s); }} onKeyDown={(e) => e.key === 'Enter' && setDraft(s)} className="text-xs font-semibold text-muted hover:text-ink">Edit</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {draft && (
        <Dialog open onOpenChange={(v) => !v && setDraft(null)} size="lg" title={draft.id ? `Edit ${draft.name}` : 'Add a location'} description="Click the map to drop the pin exactly where riders collect orders."
          footer={<><Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button><ActionButton icon={<Save strokeWidth={1.5} />} onAction={save} disabled={!draft.location || !draft.name || !draft.address}>Save location</ActionButton></>}>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-4">
              <Field label="Name">{(id) => <Input id={id} value={draft.name ?? ''} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="SmartWear Masaki" />}</Field>
              <Field label="Address">{(id) => <Input id={id} value={draft.address ?? ''} onChange={(e) => setDraft({ ...draft, address: e.target.value })} placeholder="Haile Selassie Rd, Masaki" />}</Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Area" optional>{(id) => <Input id={id} value={draft.area ?? ''} onChange={(e) => setDraft({ ...draft, area: e.target.value })} placeholder="Masaki" />}</Field>
                <Field label="Type">
                  {(id) => (
                    <Select id={id} value={draft.kind ?? 'store'} onChange={(e) => setDraft({ ...draft, kind: e.target.value })}>
                      <option value="store">Store</option>
                      <option value="warehouse">Warehouse</option>
                      <option value="office">Office</option>
                    </Select>
                  )}
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Phone" optional>{(id) => <Input id={id} value={draft.phone ?? ''} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} />}</Field>
                <Field label="Delivers within" help="kilometres">{(id) => <Input id={id} inputMode="numeric" value={String((draft.serviceableRadiusMeters ?? 15000) / 1000)} onChange={(e) => setDraft({ ...draft, serviceableRadiusMeters: (parseFloat(e.target.value) || 0) * 1000 })} />}</Field>
              </div>
              <div className="flex flex-col gap-3 rounded-md border border-hairline p-3 text-[13px]">
                {([['fulfilsDelivery', 'Ships deliveries'], ['allowsPickup', 'Customers can collect here'], ['isActive', 'Active']] as const).map(([k, l]) => (
                  <label key={k} className="flex items-center justify-between gap-3 font-semibold">{l}<Switch checked={!!draft[k]} onCheckedChange={(v) => setDraft({ ...draft, [k]: v })} label={l} /></label>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <div className="overflow-hidden rounded-md border border-hairline">
                <LiveMap className="h-[340px]" markers={draft.location ? [{ id: 'pin', kind: 'store', position: draft.location, label: draft.name || 'New location' }] : []} fitKey={draft.id ?? 'new'} onMapClick={(p) => setDraft({ ...draft, location: p })} />
              </div>
              <p className="flex items-center gap-1.5 text-xs text-muted tabular"><MapPin className="size-3.5" strokeWidth={1.5} /> {draft.location ? `${draft.location.lat.toFixed(5)}, ${draft.location.lng.toFixed(5)}` : 'No pin yet — click the map'}</p>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}
