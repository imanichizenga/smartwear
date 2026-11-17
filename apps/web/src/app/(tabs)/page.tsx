import type { Metadata } from 'next';
import { HomeScreen } from '@/screens/home';
import type { Json } from '@/lib/json';
import { JsonLd, organizationLd } from '@/lib/seo';
import { serverGet, slim } from '@/lib/server';

export const metadata: Metadata = {
  title: { absolute: 'SmartWear — Fashion & beauty, delivered in Tanzania' },
  description: 'Shop editorial fashion, jerseys, beauty and fragrance from Tanzania’s favourite labels. Fast delivery across Dar es Salaam, mobile money or cash on delivery.',
  alternates: { canonical: '/' },
};

export default async function Page() {
  const [home, cfg] = await Promise.all([serverGet<Json>('/home', 120), serverGet<Json>('/config/public', 300)]);
  return (
    <>
      <JsonLd data={organizationLd(cfg?.branding as Json | undefined)} />
      <HomeScreen initial={slim(home)} />
    </>
  );
}
