import { PaymentsLedger } from '@/components/payments/payments-ledger';
import { serverApi } from '@/lib/server-api';

export const metadata = { title: 'Payments' };

export default async function PaymentsPage() {
  const c = await serverApi<{ pricing_wholesale?: { currency?: string }; payments?: { mobileMoneyProvider?: string } }>('/config/public');
  return <PaymentsLedger currency={c.pricing_wholesale?.currency ?? 'TZS'} provider={c.payments?.mobileMoneyProvider ?? 'none'} />;
}
