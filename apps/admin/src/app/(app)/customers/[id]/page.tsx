import { redirect } from 'next/navigation';

/** Old deep links (/customers/<id>) open the customer sheet on the Customers page. */
export default async function CustomerRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/customers?open=${encodeURIComponent(id)}`);
}
