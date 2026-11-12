import { ProductEditor } from '@/components/products/product-editor';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Product' };

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await serverApi<{ pricing_wholesale?: { currency?: string } }>('/config/public');
  return <ProductEditor key={id} productId={id === 'new' ? undefined : id} currency={c.pricing_wholesale?.currency ?? 'TZS'} />;
}
