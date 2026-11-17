'use client';

import { useState } from 'react';
import type { Json } from '@/lib/json';
import { useSearchParams } from 'next/navigation';
import { ProductGridView } from '@/components/product/product-grid-view';
import { AppBar } from '@/components/shell/app-shell';
import { useT } from '@/lib/hooks';
import { useBack } from '@/lib/nav';

/** Category, collection or brand listing: serif title, 4:5 grid with infinite scroll. */
export function ProductListScreen({ category, collection, brand: brandProp, title: serverTitle, intro, initial }: { category?: string; collection?: string; brand?: string; title?: string | null; intro?: string | null; initial?: Json | null }) {
  const t = useT();
  const sp = useSearchParams();
  const back = useBack('/');
  const title = serverTitle || sp.get('title') || t('home.newIn');
  const brand = brandProp ?? sp.get('brand');
  const [total, setTotal] = useState<number | null>(null);
  return (
    <main className="min-h-dvh pb-16">
      <div className="sw-container">
        <AppBar
          title={
            <span className="flex items-baseline gap-3">
              <h1 className="truncate md:t-display-l">{title}</h1>
              {total != null && <span className="t-caption hidden shrink-0 text-muted md:inline">{t('search.results', { count: total })}</span>}
            </span>
          }
          onBack={back}
        />
        {intro && <p className="t-body-m max-w-2xl px-5 pb-2 text-muted md:px-0 md:pt-2">{intro}</p>}
        <ProductGridView query={{ category: category === 'all' ? null : category, collection, brand }} onTotal={setTotal} className="md:pt-4" initial={initial} />
      </div>
    </main>
  );
}
