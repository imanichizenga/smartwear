'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Globe, Plus, Star, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/field';
import { Rise } from '@/components/ui/kit';
import { MediaImage } from '@/components/ui/media-image';
import { MediaSlot } from '@/components/ui/pickers';
import { Card, Chip, EmptyState, PageHeader, Skeleton, Switch } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { useBrands, type Brand } from '@/lib/catalog';
import { fmtNum } from '@/lib/format';
import type { MediaOut } from '@/lib/types';

type Draft = Partial<Brand> & { logo?: MediaOut | null };

export function BrandsWorkspace() {
  const qc = useQueryClient();
  const canManage = useCan('catalog.manage');
  const brands = useBrands();
  const [edit, setEdit] = useState<Draft | null>(null);
  const save = async () => {
    if (!edit) return;
    const body = { name: edit.name, story: edit.story, storySw: edit.storySw, country: edit.country, website: edit.website, featured: !!edit.featured, isActive: edit.isActive ?? true, logoMediaId: edit.logo?.id ?? null, sortOrder: edit.sortOrder ?? 0 };
    try {
      await api(edit.id ? `/admin/brands/${edit.id}` : '/admin/brands', { method: edit.id ? 'PATCH' : 'POST', body });
      toast.success(edit.id ? 'Brand saved' : 'Brand added');
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ['brands'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  const list = brands.data ?? [];
  return (
    <>
      <PageHeader title="Brands" description="The houses and labels you carry. Featured brands appear in the Home brand spotlight."
        actions={canManage && <Button icon={<Plus strokeWidth={1.5} />} onClick={() => setEdit({ isActive: true })}>Add brand</Button>} />
      {brands.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-40" />)}</div>
      ) : list.length === 0 ? (
        <Card><EmptyState icon={<Tag />} title="No brands yet" body="Add the labels you stock so shoppers can browse by house." /></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((b, i) => (
            <Rise key={b.id} i={i}>
              <button type="button" disabled={!canManage} onClick={() => setEdit(b)} className="group block h-full w-full text-left">
                <Card className="flex h-full flex-col p-5 transition-[border-color,transform] duration-300 group-hover:-translate-y-0.5 group-hover:border-ink/25">
                  <div className="flex items-start justify-between gap-3">
                    {b.logo ? <MediaImage media={b.logo} ratio="1 / 1" className="size-12 rounded-full" sizes="48px" /> : <span className="flex size-12 items-center justify-center rounded-full bg-blush font-display text-lg">{b.name.slice(0, 1)}</span>}
                    <div className="flex gap-1">{b.featured && <Chip tone="accent"><Star className="size-3" strokeWidth={2} /> Featured</Chip>}{!b.isActive && <Chip>Hidden</Chip>}</div>
                  </div>
                  <div className="mt-4 font-display text-xl leading-7">{b.name}</div>
                  <p className="mt-1 line-clamp-2 flex-1 text-[13px] text-muted">{b.story ?? 'No story yet.'}</p>
                  <div className="mt-4 flex items-center justify-between text-xs text-muted"><span>{b.country ?? '—'}</span><span className="tabular">{fmtNum(b.productCount ?? 0)} products</span></div>
                </Card>
              </button>
            </Rise>
          ))}
        </div>
      )}
      <Dialog open={!!edit} onOpenChange={(v) => !v && setEdit(null)} title={edit?.id ? edit.name ?? 'Brand' : 'New brand'}
        footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><ActionButton disabled={!edit?.name?.trim()} onAction={save}>Save</ActionButton></>}>
        {edit && (
          <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
            <MediaSlot media={edit.logo ?? null} onChange={(m) => setEdit({ ...edit, logo: m })} ratio="1 / 1" label="Logo" purpose="brand" />
            <div className="grid gap-4">
              <Field label="Name">{(id) => <Input id={id} value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="Kitenge House" />}</Field>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Country" optional>{(id) => <Input id={id} value={edit.country ?? ''} onChange={(e) => setEdit({ ...edit, country: e.target.value })} />}</Field>
                <Field label="Website" optional>{(id) => <Input id={id} value={edit.website ?? ''} leading={<Globe />} onChange={(e) => setEdit({ ...edit, website: e.target.value })} />}</Field>
              </div>
            </div>
            <Field label="Story" optional className="sm:col-span-2">{(id) => <Textarea id={id} rows={3} value={edit.story ?? ''} onChange={(e) => setEdit({ ...edit, story: e.target.value })} />}</Field>
            <Field label="Story (Swahili)" optional className="sm:col-span-2">{(id) => <Textarea id={id} rows={2} value={edit.storySw ?? ''} onChange={(e) => setEdit({ ...edit, storySw: e.target.value })} />}</Field>
            <label className="flex items-center gap-2 text-[13px]"><Switch checked={!!edit.featured} onCheckedChange={(v) => setEdit({ ...edit, featured: v })} label="Featured" /> Featured</label>
            <label className="flex items-center gap-2 text-[13px]"><Switch checked={edit.isActive ?? true} onCheckedChange={(v) => setEdit({ ...edit, isActive: v })} label="Visible" /> Visible in the app</label>
          </div>
        )}
      </Dialog>
    </>
  );
}
