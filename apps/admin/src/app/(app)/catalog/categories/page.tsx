import { Suspense } from 'react';
import { LoaderBlock } from '@/components/brand/LoaderA';
import { CategoriesWorkspace } from '@/components/catalog/categories';

export const metadata = { title: 'Categories' };

export default function CategoriesPage() {
  return (
    <Suspense fallback={<LoaderBlock />}>
      <CategoriesWorkspace />
    </Suspense>
  );
}
