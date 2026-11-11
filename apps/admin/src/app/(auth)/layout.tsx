import { BrandMark, Wordmark } from '@/components/brand/BrandMark';

/** Editorial split screen: an ink brand panel (dark tokens, scoped) beside a quiet form column. */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside data-theme="dark" className="relative hidden overflow-hidden bg-canvas text-ink lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="flex items-center gap-3">
          <BrandMark size={40} />
          <Wordmark />
        </div>
        <div className="relative z-10 max-w-md">
          <p className="font-display text-5xl leading-[1.08] tracking-[-0.03em]">The atelier behind every order.</p>
          <p className="mt-6 text-[15px] leading-6 text-muted">Catalog, riders, orders and every setting — one calm place to run the house.</p>
        </div>
        <p className="label-caps text-subtle">Admin · Dar es Salaam</p>
        <svg aria-hidden className="pointer-events-none absolute -bottom-28 -right-20 size-[560px] text-ink opacity-[0.06]" viewBox="0 0 100 100">
          <path d="M18 86 L50 14 L82 86" stroke="currentColor" strokeWidth="1.6" fill="none" />
          <path d="M28.67 62 L71.33 62" stroke="currentColor" strokeWidth="1" strokeDasharray="3.2 2.4" fill="none" />
        </svg>
      </aside>
      <section className="flex items-center justify-center px-4 py-12 sm:px-8">
        <div className="w-full max-w-[400px]">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <BrandMark size={32} />
            <Wordmark />
          </div>
          {children}
        </div>
      </section>
    </main>
  );
}
