'use client';

import { useEffect, useMemo, useRef } from 'react';
import { ALoader } from '../ui/aloader';
import { SwButton } from '../ui/button';
import { cn } from '../ui/cn';
import { Ic } from '../ui/icons';
import { EmptyState, LoadError, Reveal } from '../ui/kit';
import { useProductList, useT, type ProductQuery } from '@/lib/hooks';
import { int, list, str } from '@/lib/json';
import { GridSkeleton, gridCols, ProductCard } from './product-card';

/** 2–5 column 4:5 grid with infinite scroll; used for categories, collections, brands and search. */
export function ProductGridView({ query, enabled = true, header, className, onTotal, initial }: { query: ProductQuery; enabled?: boolean; header?: React.ReactNode; className?: string; onTotal?: (n: number | null) => void; initial?: import('@/lib/json').Json | null }) {
  const t = useT();
  const q = useProductList(query, enabled, initial);
  const items = useMemo(() => (q.data?.pages ?? []).flatMap((p) => list(p, 'items')), [q.data]);
  const total = q.data?.pages[0] ? (typeof q.data.pages[0].total === 'number' ? int(q.data.pages[0], 'total') : null) : null;
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => onTotal?.(total), [total, onTotal]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting) && q.hasNextPage && !q.isFetchingNextPage && !q.isFetchNextPageError) void q.fetchNextPage();
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [q.hasNextPage, q.isFetchingNextPage, q.isFetchNextPageError, q]);

  return (
    <div className={cn('px-5 md:px-0', className)}>
      {header}
      {q.isPending ? (
        <GridSkeleton className="pt-4" />
      ) : q.isError && !items.length ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <LoadError error={q.error} onRetry={() => void q.refetch()} />
        </div>
      ) : !items.length ? (
        <div className="flex min-h-[50vh] items-center justify-center">
          <EmptyState title={t('search.noResults.title')} body={t('search.noResults.body')} icon={Ic.search} />
        </div>
      ) : (
        <>
          <div className={cn(gridCols, 'pt-4')}>
            {items.map((p, i) => (
              <Reveal key={str(p, 'id')} index={i < 6 ? i : i % 2}>
                <ProductCard product={p} priority={i < 4} />
              </Reveal>
            ))}
          </div>
          <div ref={sentinel} className="flex justify-center py-8">
            {q.isFetchingNextPage ? <ALoader size="lg" /> : q.isFetchNextPageError ? <SwButton label={t('common.retry')} icon={Ic.refreshCw} variant="ghost" onPress={() => q.fetchNextPage()} /> : null}
          </div>
        </>
      )}
    </div>
  );
}
