'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Archive, ArchiveRestore, ChevronRight, CornerDownRight, EyeOff, FolderInput, GripVertical, Layers, Lock, Plus, Search, Sparkles, Star, Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { LoaderA, LoaderBlock } from '@/components/brand/LoaderA';
import { ActionButton, Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Card, Checkbox, Chip, EmptyState, PageHeader, Switch, Tooltip } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { useCan } from '@/lib/admin-context';
import { CATEGORY_ICON_MAP, CategoryIcon } from '@/lib/category-icons';
import { cn } from '@/lib/cn';
import { fmtNum } from '@/lib/format';

/* ------------------------------------------------------------------ types */
export interface CatNode {
  id: string;
  parentId: string | null;
  rootKey: string;
  slug: string;
  path: string;
  depth: number;
  name: string;
  nameSw: string | null;
  description: string | null;
  descriptionSw: string | null;
  kind: 'fashion' | 'beauty';
  department: 'women' | 'men' | 'kids' | 'unisex' | null;
  icon: string | null;
  sortOrder: number;
  isActive: boolean;
  showInNav: boolean;
  isFeatured: boolean;
  attributeKeys: string[];
  defaultSizeChartId: string | null;
  seoTitle: string | null;
  seoDescription: string | null;
  productCount: number;
  directProductCount: number;
  archived: boolean;
  isRoot: boolean;
  children: CatNode[];
}
interface TreeRes {
  items: CatNode[];
  roots: { key: string; name: string; nameSw: string; kind: string; core: boolean; description: string; enabled: boolean; id: string | null }[];
  maxDepth: number;
  canManageRoots: boolean;
}
interface Detail extends CatNode {
  breadcrumbs: { id: string; name: string }[];
  effectiveAttributeKeys: string[];
  effectiveSizeChart: { id: string; name: string } | null;
}
interface Attr {
  key: string;
  label: string;
  type: string;
  options: { value: string; label: string }[];
}
interface Chart {
  id: string;
  name: string;
}

const flatten = (nodes: CatNode[], out: CatNode[] = []) => {
  for (const n of nodes) {
    out.push(n);
    flatten(n.children, out);
  }
  return out;
};

/* ------------------------------------------------------------------ page */
export function CategoriesWorkspace() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = params.get('id');
  const qc = useQueryClient();
  const canEdit = useCan('catalog.manage');
  const [showArchived, setShowArchived] = useState(false);
  const [q, setQ] = useState('');
  const [rootsOpen, setRootsOpen] = useState(false);
  const [adding, setAdding] = useState<CatNode | null>(null);

  const tree = useQuery({ queryKey: ['categories', showArchived], queryFn: () => api<TreeRes>('/admin/categories', { query: { archived: showArchived ? '1' : undefined } }) });
  const all = useMemo(() => flatten(tree.data?.items ?? []), [tree.data]);
  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all]);

  const select = (id: string | null) => {
    const sp = new URLSearchParams(params);
    if (id) sp.set('id', id);
    else sp.delete('id');
    router.replace(`${pathname}?${sp}`, { scroll: false });
  };
  // Land on the first department so the editor is never empty.
  useEffect(() => {
    if (!selected && tree.data?.items[0]) select(tree.data.items[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree.data, selected]);

  const total = all.filter((c) => !c.archived).length;
  const roots = tree.data?.items ?? [];
  return (
    <>
      <PageHeader
        eyebrow="Catalog"
        title="Categories"
        description="The fashion & beauty taxonomy shoppers browse. Departments are fixed; everything beneath them is yours to shape. Attributes and size charts set here are inherited by every subcategory."
        actions={
          <>
            {tree.data?.canManageRoots && (
              <Button variant="secondary" icon={<Layers strokeWidth={1.5} />} onClick={() => setRootsOpen(true)}>
                Departments
              </Button>
            )}
          </>
        }
      />
      {tree.isLoading ? (
        <LoaderBlock />
      ) : tree.error ? (
        <EmptyState title="Couldn't load categories" body={(tree.error as Error).message} action={<Button onClick={() => void tree.refetch()}>Try again</Button>} />
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <Card className="lg:sticky lg:top-24">
            <div className="flex items-center gap-2 border-b border-hairline p-3">
              <Input leading={<Search strokeWidth={1.5} />} placeholder={`Search ${fmtNum(total)} categories`} value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search categories" className="flex-1" />
            </div>
            <div className="flex items-center justify-between border-b border-hairline px-4 py-2 text-xs text-muted">
              <span>{roots.length} departments · drag to reorder</span>
              <label className="inline-flex cursor-pointer items-center gap-2">
                <Checkbox checked={showArchived} onCheckedChange={setShowArchived} label="Show archived" /> Archived
              </label>
            </div>
            <div className="max-h-[calc(100dvh-280px)] overflow-y-auto py-2" role="tree" aria-label="Category tree">
              <SiblingList nodes={roots} parentId={null} depth={0} selected={selected} onSelect={select} q={q.trim().toLowerCase()} canEdit={canEdit && !!tree.data?.canManageRoots} canEditChildren={canEdit} onAdd={setAdding} />
            </div>
          </Card>
          <div className="min-w-0">
            {selected && byId.get(selected) ? (
              <CategoryEditor key={selected} id={selected} node={byId.get(selected)!} all={all} onSelect={select} onAdd={setAdding} canManageRoots={!!tree.data?.canManageRoots} maxDepth={tree.data?.maxDepth ?? 3} />
            ) : (
              <Card>
                <EmptyState title="Choose a category" body="Select any department or subcategory to edit it." />
              </Card>
            )}
          </div>
        </div>
      )}
      <AddCategoryDialog parent={adding} onClose={() => setAdding(null)} onCreated={(id) => { void qc.invalidateQueries({ queryKey: ['categories'] }); select(id); }} />
      {tree.data && <DepartmentsDialog open={rootsOpen} onOpenChange={setRootsOpen} roots={tree.data.roots} onChanged={() => void qc.invalidateQueries({ queryKey: ['categories'] })} />}
    </>
  );
}

/* ------------------------------------------------------------------ tree */
function matches(n: CatNode, q: string): boolean {
  return !q || n.name.toLowerCase().includes(q) || (n.nameSw ?? '').toLowerCase().includes(q) || n.slug.includes(q) || n.children.some((c) => matches(c, q));
}

function SiblingList(props: { nodes: CatNode[]; parentId: string | null; depth: number; selected: string | null; onSelect: (id: string) => void; q: string; canEdit: boolean; canEditChildren: boolean; onAdd: (p: CatNode) => void }) {
  const { nodes, parentId } = props;
  const qc = useQueryClient();
  const [order, setOrder] = useState(nodes.map((n) => n.id));
  const [prevNodes, setPrevNodes] = useState(nodes);
  if (prevNodes !== nodes) {
    setPrevNodes(nodes);
    setOrder(nodes.map((n) => n.id));
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const reorder = useMutation({
    mutationFn: (ids: string[]) => api('/admin/categories/reorder', { body: { parentId, ids } }),
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Could not reorder');
      setOrder(nodes.map((n) => n.id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['categories'] }),
  });
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return;
    const next = arrayMove(order, order.indexOf(String(e.active.id)), order.indexOf(String(e.over.id)));
    setOrder(next);
    reorder.mutate(next);
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const visible = order.map((id) => byId.get(id)).filter((n): n is CatNode => !!n && matches(n, props.q));
  const canDrag = (parentId === null ? props.canEdit : props.canEditChildren) && !props.q;
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <ul role="group">
          {visible.map((n) => (
            <TreeRow key={n.id} node={n} {...props} canDrag={canDrag} />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}

function TreeRow({ node, depth, selected, onSelect, q, canEdit, canEditChildren, onAdd, canDrag }: { node: CatNode; depth: number; selected: string | null; onSelect: (id: string) => void; q: string; canEdit: boolean; canEditChildren: boolean; onAdd: (p: CatNode) => void; canDrag: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: node.id, disabled: !canDrag });
  const hasKids = node.children.length > 0;
  const containsSelected = useMemo(() => !!selected && flatten(node.children).some((c) => c.id === selected), [node.children, selected]);
  const [open, setOpen] = useState(false);
  const expanded = open || containsSelected || (!!q && hasKids);
  const active = selected === node.id;
  const hit = q && (node.name.toLowerCase().includes(q) || (node.nameSw ?? '').toLowerCase().includes(q));
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform), transition }} className={cn(isDragging && 'relative z-10 opacity-80')} role="treeitem" aria-expanded={hasKids ? expanded : undefined} aria-selected={active}>
      <div
        className={cn(
          'group flex h-10 items-center gap-1 pr-2 transition-colors',
          active ? 'bg-ink/[0.06]' : 'hover:bg-ink/[0.03]',
          isDragging && 'bg-surface shadow-floating',
          node.archived && 'opacity-55',
        )}
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        {canDrag ? (
          <button {...attributes} {...listeners} className="inline-flex size-6 cursor-grab items-center justify-center rounded-xs text-subtle opacity-0 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 active:cursor-grabbing" aria-label={`Reorder ${node.name}`}>
            <GripVertical className="size-3.5" strokeWidth={1.5} />
          </button>
        ) : (
          <span className="w-6" />
        )}
        <button onClick={() => setOpen(!expanded)} className={cn('inline-flex size-6 items-center justify-center rounded-xs text-muted hover:text-ink', !hasKids && 'invisible')} aria-label={expanded ? `Collapse ${node.name}` : `Expand ${node.name}`} tabIndex={hasKids ? 0 : -1}>
          <ChevronRight className={cn('size-4 transition-transform duration-150', expanded && 'rotate-90')} strokeWidth={1.5} />
        </button>
        <button onClick={() => onSelect(node.id)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <CategoryIcon name={node.icon} className={cn('size-4 shrink-0', node.isRoot ? 'text-ink' : 'text-muted')} />
          <span className={cn('truncate text-[13.5px]', node.isRoot ? 'font-semibold' : 'font-medium', hit && 'underline decoration-accent decoration-2 underline-offset-4')}>{node.name}</span>
          {node.isRoot && <Lock className="size-3 shrink-0 text-subtle" strokeWidth={1.5} aria-label="Fixed department" />}
          {!node.isActive && <EyeOff className="size-3.5 shrink-0 text-subtle" strokeWidth={1.5} aria-label="Inactive" />}
          {node.isFeatured && <Star className="size-3.5 shrink-0 fill-accent text-accent" strokeWidth={1.5} aria-label="Featured" />}
        </button>
        <span className="ml-1 text-xs tabular text-subtle" title="Published products in this branch">{node.productCount || ''}</span>
        {canEditChildren && node.depth < 3 && !node.archived && (
          <Tooltip content="Add subcategory">
            <button onClick={() => onAdd(node)} className="inline-flex size-6 items-center justify-center rounded-xs text-muted opacity-0 hover:bg-ink/5 hover:text-ink focus-visible:opacity-100 group-hover:opacity-100" aria-label={`Add subcategory to ${node.name}`}>
              <Plus className="size-3.5" strokeWidth={1.5} />
            </button>
          </Tooltip>
        )}
      </div>
      {hasKids && expanded && <SiblingList nodes={node.children} parentId={node.id} depth={depth + 1} selected={selected} onSelect={onSelect} q={q} canEdit={canEdit} canEditChildren={canEditChildren} onAdd={onAdd} />}
    </li>
  );
}

/* ------------------------------------------------------------------ editor */
type Draft = Pick<CatNode, 'name' | 'nameSw' | 'description' | 'descriptionSw' | 'department' | 'icon' | 'isActive' | 'showInNav' | 'isFeatured' | 'attributeKeys' | 'defaultSizeChartId' | 'seoTitle' | 'seoDescription' | 'slug'>;
const pick = (n: CatNode): Draft => ({
  name: n.name, nameSw: n.nameSw ?? '', description: n.description ?? '', descriptionSw: n.descriptionSw ?? '', department: n.department, icon: n.icon, isActive: n.isActive,
  showInNav: n.showInNav, isFeatured: n.isFeatured, attributeKeys: n.attributeKeys, defaultSizeChartId: n.defaultSizeChartId, seoTitle: n.seoTitle ?? '', seoDescription: n.seoDescription ?? '', slug: n.slug,
});

function CategoryEditor({ id, node, all, onSelect, onAdd, canManageRoots, maxDepth }: { id: string; node: CatNode; all: CatNode[]; onSelect: (id: string | null) => void; onAdd: (p: CatNode) => void; canManageRoots: boolean; maxDepth: number }) {
  const qc = useQueryClient();
  const canEdit = useCan('catalog.manage') && (!node.isRoot || canManageRoots);
  const canEditBody = useCan('catalog.manage');
  const detail = useQuery({ queryKey: ['category', id], queryFn: () => api<Detail>(`/admin/categories/${id}`) });
  const attrs = useQuery({ queryKey: ['attributes'], queryFn: () => api<{ items: Attr[] }>('/admin/attributes'), staleTime: 300_000 });
  const charts = useQuery({ queryKey: ['size-charts'], queryFn: () => api<{ items: Chart[] }>('/admin/size-charts'), staleTime: 300_000 });
  const [draft, setDraft] = useState<Draft>(() => pick(node));
  const [base, setBase] = useState<Draft>(() => pick(node));
  const dirty = JSON.stringify(draft) !== JSON.stringify(base);
  const [moveOpen, setMoveOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const save = async () => {
    const patch: Partial<Draft> = {};
    for (const k of Object.keys(draft) as (keyof Draft)[]) if (JSON.stringify(draft[k]) !== JSON.stringify(base[k])) (patch as Record<string, unknown>)[k] = draft[k];
    try {
      const out = await api<CatNode>(`/admin/categories/${id}`, { method: 'PATCH', body: patch });
      const next = pick({ ...node, ...out });
      setBase(next);
      setDraft(next);
      toast.success(`${out.name} saved`);
      await Promise.all([qc.invalidateQueries({ queryKey: ['categories'] }), qc.invalidateQueries({ queryKey: ['category', id] })]);
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not save');
    }
  };
  const restore = async () => {
    try {
      await api(`/admin/categories/${id}/archive`, { body: { restore: true } });
      toast.success(`${node.name} restored`);
      await qc.invalidateQueries({ queryKey: ['categories'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not restore');
    }
  };
  const remove = async () => {
    try {
      await api(`/admin/categories/${id}`, { method: 'DELETE' });
      toast.success(`${node.name} deleted`);
      onSelect(node.parentId);
      await qc.invalidateQueries({ queryKey: ['categories'] });
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not delete');
    }
  };

  const d = detail.data;
  const own = new Set(draft.attributeKeys);
  const inherited = (d?.effectiveAttributeKeys ?? []).filter((k) => !node.attributeKeys.includes(k));
  const attrLabel = (k: string) => attrs.data?.items.find((a) => a.key === k)?.label ?? k;
  const deletable = !node.isRoot && node.children.length === 0 && node.directProductCount === 0;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex flex-wrap items-start gap-4 p-5">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-soft">
            <CategoryIcon name={draft.icon} className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-xs text-muted">
              {(d?.breadcrumbs ?? []).map((b) => (
                <span key={b.id} className="inline-flex items-center gap-1">
                  <button className="hover:text-ink hover:underline" onClick={() => onSelect(b.id)}>{b.name}</button>
                  <ChevronRight className="size-3" strokeWidth={1.5} />
                </span>
              ))}
              {!d && detail.isLoading && <LoaderA size="xs" />}
            </nav>
            <h2 className="mt-1 text-[28px] leading-9">{node.name}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Chip tone={node.kind === 'beauty' ? 'blush' : 'neutral'}>{node.kind}</Chip>
              {node.isRoot && <Chip tone="ink"><Lock className="size-3" strokeWidth={2} /> Department</Chip>}
              {node.archived && <Chip tone="warning">Archived</Chip>}
              {!node.isActive && <Chip>Inactive</Chip>}
              {!node.showInNav && <Chip>Hidden from menus</Chip>}
              <Chip tone="neutral">{fmtNum(node.productCount)} products{node.directProductCount !== node.productCount ? ` · ${fmtNum(node.directProductCount)} here` : ''}</Chip>
              <Chip tone="neutral">Level {node.depth + 1} of {maxDepth + 1}</Chip>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {canEditBody && node.depth < maxDepth && !node.archived && (
              <Button variant="secondary" icon={<Plus strokeWidth={1.5} />} onClick={() => onAdd(node)}>Subcategory</Button>
            )}
            {canEditBody && !node.isRoot && !node.archived && (
              <Button variant="secondary" icon={<FolderInput strokeWidth={1.5} />} onClick={() => setMoveOpen(true)}>Move</Button>
            )}
            {canEdit && !node.archived && (
              <Button variant="ghost" icon={<Archive strokeWidth={1.5} />} onClick={() => setArchiveOpen(true)}>Archive</Button>
            )}
            {canEdit && node.archived && <ActionButton variant="secondary" icon={<ArchiveRestore strokeWidth={1.5} />} onAction={restore}>Restore</ActionButton>}
            {canEditBody && deletable && (
              <Tooltip content="Only empty categories with no subcategories can be deleted">
                <span>
                  <ActionButton variant="danger" size="icon" aria-label="Delete category" icon={<Trash2 strokeWidth={1.5} />} onAction={remove} />
                </span>
              </Tooltip>
            )}
          </div>
        </div>
      </Card>

      <fieldset disabled={!canEditBody || node.archived} className="flex min-w-0 flex-col gap-4">
        <Card>
          <div className="border-b border-hairline px-5 py-4">
            <h3 className="font-sans text-[15px] font-semibold tracking-normal">Names & description</h3>
            <p className="mt-0.5 text-[13px] text-muted">Shown in the app menus, category pages and search. Both languages appear to shoppers.</p>
          </div>
          <div className="grid gap-5 p-5 md:grid-cols-2">
            <Field label="Name · English" help={node.isRoot && !canManageRoots ? 'Only a Super Admin can rename a department.' : undefined}>
              {(fid) => <Input id={fid} value={draft.name} onChange={(e) => set('name', e.target.value)} disabled={node.isRoot && !canManageRoots} maxLength={80} />}
            </Field>
            <Field label="Jina · Kiswahili" optional>
              {(fid) => <Input id={fid} value={draft.nameSw ?? ''} onChange={(e) => set('nameSw', e.target.value)} maxLength={80} placeholder="e.g. Magauni" />}
            </Field>
            <Field label="Description · English" optional>
              {(fid) => <Textarea id={fid} rows={3} value={draft.description ?? ''} onChange={(e) => set('description', e.target.value)} />}
            </Field>
            <Field label="Maelezo · Kiswahili" optional>
              {(fid) => <Textarea id={fid} rows={3} value={draft.descriptionSw ?? ''} onChange={(e) => set('descriptionSw', e.target.value)} />}
            </Field>
            <Field label="URL" help={node.isRoot ? 'Department URLs are fixed.' : 'Changing it updates every subcategory URL too.'}>
              {(fid) => <Input id={fid} value={draft.slug} disabled={node.isRoot} onChange={(e) => set('slug', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'))} leading={<span className="text-xs">/c/</span>} className="font-mono text-[13px]" />}
            </Field>
            <Field label="Department" help="Used for personalisation and the style quiz.">
              {(fid) => (
                <Select id={fid} value={draft.department ?? ''} onChange={(e) => set('department', (e.target.value || null) as Draft['department'])}>
                  <option value="">Inherit / not specific</option>
                  <option value="women">Women</option>
                  <option value="men">Men</option>
                  <option value="kids">Kids</option>
                  <option value="unisex">Unisex</option>
                </Select>
              )}
            </Field>
          </div>
        </Card>

        <Card>
          <div className="border-b border-hairline px-5 py-4">
            <h3 className="font-sans text-[15px] font-semibold tracking-normal">Visibility</h3>
          </div>
          <div className="grid gap-x-8 gap-y-4 p-5 md:grid-cols-3">
            {([
              ['isActive', 'Active', 'Inactive categories and everything beneath them are hidden from shoppers.'],
              ['showInNav', 'Show in menus', 'Keep it reachable by link and search, but out of the menus.'],
              ['isFeatured', 'Featured', 'Promoted in category tiles on Home.'],
            ] as const).map(([k, label, help]) => (
              <label key={k} className="flex items-start justify-between gap-3">
                <span>
                  <span className="block text-[13px] font-semibold">{label}</span>
                  <span className="mt-0.5 block text-xs text-muted">{help}</span>
                </span>
                <Switch checked={draft[k]} onCheckedChange={(v) => set(k, v)} label={label} disabled={!canEditBody || node.archived} />
              </label>
            ))}
          </div>
        </Card>

        <Card>
          <div className="border-b border-hairline px-5 py-4">
            <h3 className="font-sans text-[15px] font-semibold tracking-normal">Icon</h3>
            <p className="mt-0.5 text-[13px] text-muted">One thin-line icon set across both apps.</p>
          </div>
          <div className="flex flex-wrap gap-1.5 p-5" role="radiogroup" aria-label="Category icon">
            {Object.entries(CATEGORY_ICON_MAP).map(([name, I]) => (
              <Tooltip key={name} content={name}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draft.icon === name}
                  aria-label={name}
                  onClick={() => set('icon', draft.icon === name ? null : name)}
                  className={cn('inline-flex size-10 items-center justify-center rounded-sm border transition-colors', draft.icon === name ? 'border-ink bg-ink text-on-ink' : 'border-hairline text-muted hover:border-ink/30 hover:text-ink')}
                >
                  <I className="size-[18px]" strokeWidth={1.5} />
                </button>
              </Tooltip>
            ))}
          </div>
        </Card>

        <Card>
          <div className="border-b border-hairline px-5 py-4">
            <h3 className="font-sans text-[15px] font-semibold tracking-normal">Product attributes</h3>
            <p className="mt-0.5 text-[13px] text-muted">The filters and product fields this level adds. Subcategories inherit them; products may only use attributes their category allows.</p>
          </div>
          <div className="flex flex-col gap-4 p-5">
            {inherited.length > 0 && (
              <div>
                <div className="label-caps mb-2 text-subtle">Inherited</div>
                <div className="flex flex-wrap gap-1.5">
                  {inherited.map((k) => (
                    <span key={k} className="inline-flex h-8 items-center gap-1.5 rounded-sm bg-ink/5 px-2.5 text-[13px] text-muted">
                      <CornerDownRight className="size-3.5" strokeWidth={1.5} /> {attrLabel(k)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div>
              <div className="label-caps mb-2 text-subtle">Added here</div>
              {attrs.isLoading ? (
                <LoaderA size="sm" />
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {(attrs.data?.items ?? []).filter((a) => !inherited.includes(a.key)).map((a) => {
                    const on = own.has(a.key);
                    return (
                      <button
                        key={a.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => set('attributeKeys', on ? draft.attributeKeys.filter((k) => k !== a.key) : [...draft.attributeKeys, a.key])}
                        className={cn('inline-flex h-8 items-center rounded-sm border px-2.5 text-[13px] font-medium transition-colors', on ? 'border-ink bg-ink text-on-ink' : 'border-hairline text-muted hover:border-ink/30 hover:text-ink')}
                        title={a.options.map((o) => o.label).join(', ')}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </Card>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <div className="border-b border-hairline px-5 py-4">
              <h3 className="font-sans text-[15px] font-semibold tracking-normal">Size chart</h3>
              <p className="mt-0.5 text-[13px] text-muted">Default for products here; a product or brand chart overrides it.</p>
            </div>
            <div className="p-5">
              <Field label="Default size chart" help={!draft.defaultSizeChartId && d?.effectiveSizeChart ? `Inheriting “${d.effectiveSizeChart.name}”.` : undefined}>
                {(fid) => (
                  <Select id={fid} value={draft.defaultSizeChartId ?? ''} onChange={(e) => set('defaultSizeChartId', e.target.value || null)}>
                    <option value="">{d?.effectiveSizeChart && !node.defaultSizeChartId ? `Inherit (${d.effectiveSizeChart.name})` : 'None'}</option>
                    {(charts.data?.items ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
          </Card>
          <Card>
            <div className="border-b border-hairline px-5 py-4">
              <h3 className="font-sans text-[15px] font-semibold tracking-normal">Search engines</h3>
            </div>
            <div className="flex flex-col gap-4 p-5">
              <Field label="SEO title" optional aside={<span className="text-xs tabular text-subtle">{(draft.seoTitle ?? '').length}/70</span>}>
                {(fid) => <Input id={fid} maxLength={70} value={draft.seoTitle ?? ''} onChange={(e) => set('seoTitle', e.target.value)} placeholder={`${node.name} · SmartWear`} />}
              </Field>
              <Field label="SEO description" optional aside={<span className="text-xs tabular text-subtle">{(draft.seoDescription ?? '').length}/160</span>}>
                {(fid) => <Textarea id={fid} rows={2} maxLength={160} value={draft.seoDescription ?? ''} onChange={(e) => set('seoDescription', e.target.value)} />}
              </Field>
            </div>
          </Card>
        </div>
      </fieldset>

      {dirty && (
        <div className="sticky bottom-4 z-20 flex items-center gap-3 rounded-md border border-hairline bg-surface/95 px-4 py-3 shadow-sticky backdrop-blur-md">
          <span className="text-[13px] font-semibold">Unsaved changes to {node.name}</span>
          <div className="ml-auto flex gap-2">
            <Button variant="ghost" onClick={() => setDraft(base)}>Discard</Button>
            <ActionButton onAction={save}>Save category</ActionButton>
          </div>
        </div>
      )}

      <MoveDialog open={moveOpen} onOpenChange={setMoveOpen} node={node} all={all} maxDepth={maxDepth} onMoved={() => void qc.invalidateQueries({ queryKey: ['categories'] })} />
      <ArchiveDialog open={archiveOpen} onOpenChange={setArchiveOpen} node={node} all={all} onArchived={() => void qc.invalidateQueries({ queryKey: ['categories'] })} />
    </div>
  );
}

/* ------------------------------------------------------------------ dialogs */
function subtreeDepth(n: CatNode): number {
  return n.children.length ? 1 + Math.max(...n.children.map(subtreeDepth)) : 0;
}
function label(c: CatNode, all: CatNode[]) {
  const byId = new Map(all.map((x) => [x.id, x]));
  const parts = [c.name];
  let p = c.parentId ? byId.get(c.parentId) : undefined;
  while (p) {
    parts.unshift(p.name);
    p = p.parentId ? byId.get(p.parentId) : undefined;
  }
  return parts.join(' › ');
}

function AddCategoryDialog({ parent, onClose, onCreated }: { parent: CatNode | null; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('');
  const [nameSw, setNameSw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = async () => {
    setError(null);
    try {
      const c = await api<CatNode>('/admin/categories', { body: { parentId: parent!.id, name, nameSw: nameSw || null } });
      toast.success(`${c.name} added to ${parent!.name}`);
      setName('');
      setNameSw('');
      onClose();
      onCreated(c.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create');
    }
  };
  return (
    <Dialog
      open={!!parent}
      onOpenChange={(v) => !v && onClose()}
      size="sm"
      title="New subcategory"
      description={parent ? `Inside ${parent.name}. It inherits ${parent.name}'s attributes and size chart.` : undefined}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <ActionButton onAction={create} disabled={!name.trim()} icon={<Plus strokeWidth={1.5} />}>Add</ActionButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name · English" error={error}>{(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Wrap dresses" maxLength={80} />}</Field>
        <Field label="Jina · Kiswahili" optional>{(id) => <Input id={id} value={nameSw} onChange={(e) => setNameSw(e.target.value)} placeholder="e.g. Magauni ya kufunga" maxLength={80} />}</Field>
      </div>
    </Dialog>
  );
}

function MoveDialog({ open, onOpenChange, node, all, maxDepth, onMoved }: { open: boolean; onOpenChange: (v: boolean) => void; node: CatNode; all: CatNode[]; maxDepth: number; onMoved: () => void }) {
  const [target, setTarget] = useState('');
  const own = new Set([node.id, ...flatten(node.children).map((c) => c.id)]);
  const need = subtreeDepth(node);
  const options = all.filter((c) => !c.archived && !own.has(c.id) && c.id !== node.parentId && c.rootKey === node.rootKey && c.depth + 1 + need <= maxDepth);
  const otherRoots = all.filter((c) => !c.archived && !own.has(c.id) && c.id !== node.parentId && c.rootKey !== node.rootKey && c.depth + 1 + need <= maxDepth);
  const move = async () => {
    try {
      await api(`/admin/categories/${node.id}/move`, { body: { parentId: target } });
      toast.success(`${node.name} moved`);
      onOpenChange(false);
      onMoved();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not move');
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="sm" title={`Move ${node.name}`} description="Its subcategories and products move with it. URLs update automatically." footer={<ActionButton onAction={move} disabled={!target}>Move here</ActionButton>}>
      <Field label="New parent">
        {(id) => (
          <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">Choose…</option>
            <optgroup label="Same department">
              {options.map((c) => <option key={c.id} value={c.id}>{label(c, all)}</option>)}
            </optgroup>
            <optgroup label="Other departments">
              {otherRoots.map((c) => <option key={c.id} value={c.id}>{label(c, all)}</option>)}
            </optgroup>
          </Select>
        )}
      </Field>
    </Dialog>
  );
}

function ArchiveDialog({ open, onOpenChange, node, all, onArchived }: { open: boolean; onOpenChange: (v: boolean) => void; node: CatNode; all: CatNode[]; onArchived: () => void }) {
  const [target, setTarget] = useState('');
  const own = new Set([node.id, ...flatten(node.children).map((c) => c.id)]);
  const candidates = all.filter((c) => !c.archived && !own.has(c.id) && !c.isRoot);
  const hasProducts = node.productCount > 0 || node.directProductCount > 0;
  const archive = async () => {
    try {
      const r = await api<Record<string, number>>(`/admin/categories/${node.id}/archive`, { body: { reassignToId: target || null } });
      const moved = r.productsReassigned ?? 0;
      toast.success(`${node.name} archived`, { description: moved ? `${moved} products moved to the new category.` : undefined });
      onOpenChange(false);
      onArchived();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not archive');
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      size="sm"
      title={`Archive ${node.name}?`}
      description="Shoppers stop seeing it and its subcategories straight away. You can restore it later — nothing is deleted."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <ActionButton variant="danger" icon={<Archive strokeWidth={1.5} />} onAction={archive} disabled={hasProducts && !target}>Archive</ActionButton>
        </>
      }
    >
      {hasProducts ? (
        <Field label={`Move its ${fmtNum(Math.max(node.productCount, node.directProductCount))} products to`} help="Products must always live in an active category.">
          {(id) => (
            <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Choose a category…</option>
              {candidates.map((c) => <option key={c.id} value={c.id}>{label(c, all)}</option>)}
            </Select>
          )}
        </Field>
      ) : (
        <p className="text-sm text-muted">No products are filed here.</p>
      )}
    </Dialog>
  );
}

function DepartmentsDialog({ open, onOpenChange, roots, onChanged }: { open: boolean; onOpenChange: (v: boolean) => void; roots: TreeRes['roots']; onChanged: () => void }) {
  const enable = async (key: string) => {
    try {
      await api(`/admin/categories/roots/${key}`, { body: { withSuggestedTree: true } });
      toast.success('Department enabled', { description: 'With a suggested set of subcategories you can edit.' });
      onChanged();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Could not enable');
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} size="lg" title="Departments" description="SmartWear's top level is a controlled fashion & beauty list. Core departments are always on; optional ones can be switched on by a Super Admin — nothing outside fashion and beauty can become a department.">
      <ul className="grid gap-2 sm:grid-cols-2">
        {roots.map((r) => (
          <li key={r.key} className="flex items-start gap-3 rounded-sm border border-hairline p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{r.name}</span>
                <span className="text-xs text-muted">{r.nameSw}</span>
              </div>
              <p className="mt-1 text-xs leading-4 text-muted">{r.description}</p>
              <div className="mt-2 flex gap-1.5">
                <Chip tone={r.kind === 'beauty' ? 'blush' : 'neutral'}>{r.kind}</Chip>
                {r.core && <Chip tone="ink">Core</Chip>}
              </div>
            </div>
            {r.enabled ? (
              <Chip tone="success">On</Chip>
            ) : (
              <ActionButton size="sm" variant="secondary" icon={<Sparkles strokeWidth={1.5} />} onAction={() => enable(r.key)}>Enable</ActionButton>
            )}
          </li>
        ))}
      </ul>
    </Dialog>
  );
}
