import { Suspense } from 'react';
import { LoaderBlock } from '@/components/brand/LoaderA';
import { OrdersWorkspace } from '@/components/orders/orders-workspace';

export const metadata = { title: 'Orders' };

export default function OrdersPage() {
  return (
    <Suspense fallback={<LoaderBlock />}>
      <OrdersWorkspace />
    </Suspense>
  );
}
