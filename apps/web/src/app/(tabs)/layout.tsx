import { TabBar, TopBar } from '@/components/shell/app-shell';

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TopBar />
      {children}
      <TabBar />
    </>
  );
}
