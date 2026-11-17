'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CategoryTile } from '@/components/product/product-card';
import { ProductGridView } from '@/components/product/product-grid-view';
import { SwButton, SwIconButton } from '@/components/ui/button';
import { Ic, Icon } from '@/components/ui/icons';
import { ChoiceChip, hexColor, Label, SearchBar, Switch } from '@/components/ui/kit';
import { ChoiceList, openSheet } from '@/components/ui/overlay';
import { api } from '@/lib/api';
import { useCategories, useDebounced, useT } from '@/lib/hooks';
import { list, str, type Json } from '@/lib/json';

const RECENT = 'sw.recentSearches';
const readRecent = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem(RECENT) || '[]') as string[];
  } catch {
    return [];
  }
};
const SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'popular'];
const SIZES = ['XS', 'S', 'M', 'L', 'XL'];
const COLOURS: [string, string][] = [['Ivory', '#F3EDE2'], ['Black', '#141414'], ['Red', '#B3122A'], ['Navy', '#1E2A4A'], ['Blush', '#E7B9A9'], ['Olive', '#4E5A3A'], ['Gold', '#C9A45C']];

/** Instant, typo-tolerant search (Postgres FTS + trigram on the API), 250 ms debounce. The query lives in the URL. */
export function SearchScreen() {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [text, setText] = useState(sp.get('q') ?? '');
  const q = useDebounced(text.trim(), 250);
  const [sort, setSort] = useState<string | null>(sp.get('sort'));
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => setRecent(readRecent()), []);
  useEffect(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (sort) p.set('sort', sort);
    const next = p.toString() ? `${pathname}?${p}` : pathname;
    router.replace(next, { scroll: false });
    if (q.length >= 2) {
      const list2 = [q, ...readRecent().filter((x) => x.toLowerCase() !== q.toLowerCase())].slice(0, 8);
      try {
        localStorage.setItem(RECENT, JSON.stringify(list2));
      } catch {
        /* ignore */
      }
      setRecent(list2);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort]);

  const search = (v: string) => {
    setText(v);
    input.current?.blur();
  };
  const active = Object.entries(filters).flatMap(([k, vs]) => vs.map((v) => [k, v] as const));
  const idle = !q && !active.length;

  return (
    <main className="pb-tabbar min-h-dvh">
      <div className="sticky top-0 z-30 bg-[color-mix(in_srgb,var(--sw-canvas)_94%,transparent)] pt-[env(safe-area-inset-top)] backdrop-blur-md md:top-16">
        <div className="sw-container">
          <div className="px-5 pb-2 pt-3 md:px-0 md:pt-6">
            <SearchBar
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && input.current?.blur()}
              placeholder={t('search.placeholder')}
              aria-label={t('common.search')}
              autoFocus={!sp.get('q')}
              className="md:h-14"
              trailing={text ? <SwIconButton icon={Ic.x} size={40} label={t('search.clearAll')} onPress={() => setText('')} /> : null}
            />
          </div>
          {!idle && (
            <div className="sw-rail gap-2 px-5 py-1 md:px-0">
              <ChoiceChip label={t('search.filters')} selected={active.length > 0} leading={<Icon icon={Ic.slidersHorizontal} size={14} />} onPress={() => void openFilters(filters, setFilters, t)} />
              <ChoiceChip label={sort ? t(`sort.${sort}`) : t('search.sort')} selected={!!sort} leading={<Icon icon={Ic.arrowUpDown} size={14} />} onPress={() => void openSort(sort, setSort, t)} />
              {active.map(([k, v]) => (
                <ChoiceChip key={`${k}:${v}`} label={v} selected leading={<Icon icon={Ic.x} size={12} />} onPress={() => setFilters((f) => {
                  const n = { ...f, [k]: (f[k] ?? []).filter((x) => x !== v) };
                  if (!n[k]!.length) delete n[k];
                  return n;
                })} />
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="sw-container">{idle ? <Idle recent={recent} onSearch={search} onClear={() => { localStorage.removeItem(RECENT); setRecent([]); }} /> : <ProductGridView query={{ q: q || null, sort, filters }} />}</div>
    </main>
  );
}

function Idle({ recent, onSearch, onClear }: { recent: string[]; onSearch: (v: string) => void; onClear: () => void }) {
  const t = useT();
  const cats = useCategories().data ?? [];
  const trending = list(useQuery({ queryKey: ['suggest', ''], queryFn: () => api.get<Json>('/search/suggest', { q: '' }), staleTime: 5 * 60_000 }).data, 'trending');
  return (
    <div className="px-5 pt-4 md:px-0">
      {recent.length > 0 && (
        <section className="pt-6">
          <Label action={<button type="button" onClick={onClear} className="t-caption underline">{t('search.clearAll')}</button>}>{t('search.recent')}</Label>
          <div className="flex flex-wrap gap-2">
            {recent.map((r) => (
              <ChoiceChip key={r} label={r} selected={false} leading={<Icon icon={Ic.history} size={14} className="text-muted" />} onPress={() => onSearch(r)} />
            ))}
          </div>
        </section>
      )}
      {trending.length > 0 && (
        <section className="pt-6">
          <Label>{t('search.trending')}</Label>
          <div className="flex flex-wrap gap-2">
            {trending.map((x, i) => {
              const term = str(x, 'term') || str(x, 'q');
              return <ChoiceChip key={i} label={term} selected={false} leading={<Icon icon={Ic.flame} size={14} className="text-accent" />} onPress={() => onSearch(term)} />;
            })}
          </div>
        </section>
      )}
      <section className="pt-6">
        <Label>{t('filter.category')}</Label>
        <div className="grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
          {cats.map((c) => (
            <CategoryTile key={str(c, 'id')} category={c} fluid />
          ))}
        </div>
      </section>
    </div>
  );
}

async function openSort(sort: string | null, set: (v: string | null) => void, t: (k: string) => string) {
  await openSheet((close) => <ChoiceList options={SORTS.map((k) => [k, t(`sort.${k}`)] as [string, string])} selected={sort ?? 'relevance'} onSelect={(k) => { set(k === 'relevance' ? null : k); close(); }} />, { title: t('search.sort') });
}

function FilterSheet({ initial, onApply, t }: { initial: Record<string, string[]>; onApply: (f: Record<string, string[]>) => void; t: (k: string) => string }) {
  const [draft, setDraft] = useState<Record<string, string[]>>(() => JSON.parse(JSON.stringify(initial)));
  const on = (k: string, v: string) => draft[k]?.includes(v) ?? false;
  const toggle = (k: string, v: string) =>
    setDraft((d) => {
      const l = d[k] ?? [];
      return { ...d, [k]: l.includes(v) ? l.filter((x) => x !== v) : [...l, v] };
    });
  return (
    <div className="flex flex-col">
      <div className="px-5">
        <Label className="pt-6">{t('filter.size')}</Label>
        <div className="flex flex-wrap gap-2">{SIZES.map((z) => <ChoiceChip key={z} label={z} selected={on('size', z)} onPress={() => toggle('size', z)} />)}</div>
        <Label className="pt-6">{t('filter.color')}</Label>
        <div className="flex flex-wrap gap-2">
          {COLOURS.map(([name, hex]) => (
            <ChoiceChip key={name} label={name} selected={on('color', name)} leading={<span className="size-3 rounded-full border border-hairline" style={{ background: hexColor(hex) ?? undefined }} />} onPress={() => toggle('color', name)} />
          ))}
        </div>
        <Label className="pt-6">{t('filter.availability')}</Label>
        <div className="flex items-center">
          <span className="t-body-m flex-1">{t('filter.availability')}</span>
          <Switch checked={on('inStock', 'true')} onChange={() => toggle('inStock', 'true')} label={t('filter.availability')} />
        </div>
      </div>
      <div className="sticky bottom-0 mt-6 flex gap-3 border-t border-hairline bg-surface px-5 py-4">
        <SwButton label={t('search.clearAll')} variant="ghost" onPress={() => setDraft({})} />
        <div className="flex-1">
          <SwButton label={t('search.apply')} large expand onPress={() => onApply(Object.fromEntries(Object.entries(draft).filter(([, v]) => v.length)))} />
        </div>
      </div>
    </div>
  );
}

async function openFilters(filters: Record<string, string[]>, set: (f: Record<string, string[]>) => void, t: (k: string) => string) {
  await openSheet((close) => <FilterSheet initial={filters} t={t} onApply={(f) => { set(f); close(); }} />, { title: t('search.filters'), expand: true });
}
