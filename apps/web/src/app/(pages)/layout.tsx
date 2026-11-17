import { TopBar } from '@/components/shell/app-shell';

/** Pushed pages: their own back-button app bar on phones; the shared top bar from tablet up. */
export default function PagesLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopBar />
      <div className="sw-page">{children}</div>
    </>
  );
}
