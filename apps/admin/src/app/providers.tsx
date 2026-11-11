'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Tooltip } from 'radix-ui';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2 },
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <Tooltip.Provider>{children}</Tooltip.Provider>
      <Toaster
        position="bottom-right"
        toastOptions={{
          classNames: {
            toast: '!rounded-md !border !border-hairline !bg-surface !text-ink !shadow-floating !font-sans',
            description: '!text-muted',
            error: '!text-danger',
            success: '[&_[data-icon]]:!text-success',
          },
        }}
      />
    </QueryClientProvider>
  );
}
