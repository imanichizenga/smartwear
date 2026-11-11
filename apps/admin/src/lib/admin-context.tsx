'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { can } from './nav';

export interface AdminMe {
  id: string;
  email: string;
  name: string;
  role: { key: string; name: string };
  permissions: string[];
  mfaEnabled: boolean;
}

const Ctx = createContext<AdminMe | null>(null);
export function AdminProvider({ admin, children }: { admin: AdminMe; children: ReactNode }) {
  return <Ctx.Provider value={admin}>{children}</Ctx.Provider>;
}
export function useAdmin(): AdminMe {
  const a = useContext(Ctx);
  if (!a) throw new Error('useAdmin outside AdminProvider');
  return a;
}
export function useCan(perm: string): boolean {
  return can(useAdmin().permissions, perm);
}
