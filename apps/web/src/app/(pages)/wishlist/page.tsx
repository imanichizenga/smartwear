import type { Metadata } from 'next';
import { WishlistScreen } from '@/screens/account';

export const metadata: Metadata = { title: 'Wishlist', robots: { index: false, follow: false } };
export default function Page() {
  return <WishlistScreen />;
}
