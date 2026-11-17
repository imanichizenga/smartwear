'use client';

import { useQuery } from '@tanstack/react-query';
import { GridSkeleton, ProductGrid } from '@/components/product/product-card';
import { AppBar } from '@/components/shell/app-shell';
import { Ic } from '@/components/ui/icons';
import { EmptyState, LoadError, Reveal } from '@/components/ui/kit';
import { SwImage } from '@/components/ui/sw-image';
import { api } from '@/lib/api';
import { useT } from '@/lib/hooks';
import { list, obj, str, type Json } from '@/lib/json';
import { useBack } from '@/lib/nav';

/** A campaign that features several products: picture, message, products (where its notification leads). */
export function CampaignScreen({ id }: { id: string }) {
  const t = useT();
  const back = useBack('/');
  const q = useQuery({ queryKey: ['campaign', id], queryFn: () => api.get<Json>(`/campaigns/${id}`) });
  const d = q.data;
  return (
    <main className="min-h-dvh pb-16">
      <div className="sw-container">
        <AppBar onBack={back} title="" />
        {q.isPending ? (
          <GridSkeleton className="px-5 pt-6 md:px-0" />
        ) : q.isError ? (
          <LoadError error={q.error} onRetry={() => void q.refetch()} />
        ) : (
          <>
            <div className="md:grid md:grid-cols-[1.2fr_1fr] md:items-center md:gap-12">
              {obj(d, 'image') && (
                <div className="px-5 md:px-0">
                  <SwImage media={obj(d, 'image')} aspect={16 / 10} sizes="(min-width:768px) 55vw, 100vw" priority />
                </div>
              )}
              <Reveal className="px-5 pt-6 md:px-0 md:pt-0">
                <h1 className="t-display-l">{str(d, 'title')}</h1>
                <p className="t-body-m mt-2 text-muted">{str(d, 'body')}</p>
              </Reveal>
            </div>
            <div className="px-5 pt-8 md:px-0">
              {list(d, 'products').length ? <ProductGrid items={list(d, 'products')} /> : <EmptyState title={t('search.noResults.title')} body={t('search.noResults.body')} icon={Ic.shoppingBag} />}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
