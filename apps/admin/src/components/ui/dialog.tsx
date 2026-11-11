'use client';

import type { ReactNode } from 'react';
import { Dialog as RDialog } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface DialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** Side sheet instead of centred dialog. */
  side?: boolean;
}

export function Dialog({ open, onOpenChange, title, description, children, footer, size = 'md', side = false }: DialogProps) {
  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-[2px] data-[state=open]:animate-[sw-fade-in_200ms_ease-out]" />
        <RDialog.Content
          className={cn(
            'fixed z-50 flex flex-col bg-surface shadow-sheet focus:outline-none',
            side
              ? 'inset-y-0 right-0 w-full max-w-xl border-l border-hairline data-[state=open]:animate-[sw-slide-in_260ms_cubic-bezier(0.22,0.61,0.36,1)]'
              : cn('left-1/2 top-1/2 max-h-[88vh] w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 rounded-lg', size === 'sm' ? 'max-w-md' : size === 'lg' ? 'max-w-3xl' : 'max-w-xl'),
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-hairline px-6 py-5">
            <div>
              <RDialog.Title className="font-display text-2xl leading-8">{title}</RDialog.Title>
              {description ? <RDialog.Description className="mt-1 text-sm text-muted">{description}</RDialog.Description> : <RDialog.Description className="sr-only">{String(title)}</RDialog.Description>}
            </div>
            <RDialog.Close className="-mr-2 inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-ink/5 hover:text-ink" aria-label="Close">
              <X className="size-5" strokeWidth={1.5} />
            </RDialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-hairline px-6 py-4">{footer}</div>}
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}
