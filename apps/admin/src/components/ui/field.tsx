'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

const control =
  'w-full rounded-sm border border-hairline bg-surface px-3 text-sm text-ink placeholder:text-subtle transition-colors duration-150 ' +
  'hover:border-ink/25 focus:border-ink focus:outline-none disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted ' +
  'aria-invalid:border-danger aria-invalid:focus:border-danger';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode; trailing?: ReactNode }>(function Input(
  { className, leading, trailing, ...p },
  ref,
) {
  if (!leading && !trailing) return <input ref={ref} className={cn(control, 'h-10', className)} {...p} />;
  return (
    <div className={cn('relative flex items-center', className)}>
      {leading && <span className="pointer-events-none absolute left-3 inline-flex text-muted [&>svg]:size-4">{leading}</span>}
      <input ref={ref} className={cn(control, 'h-10', leading && 'pl-9', trailing && 'pr-10')} {...p} />
      {trailing && <span className="absolute right-2 inline-flex items-center text-muted">{trailing}</span>}
    </div>
  );
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, rows = 4, ...p }, ref) {
  return <textarea ref={ref} rows={rows} className={cn(control, 'py-2.5 leading-6', className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <div className={cn('relative', className)}>
      <select ref={ref} className={cn(control, 'h-10 appearance-none pr-9')} {...p}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted" strokeWidth={1.5} />
    </div>
  );
});

export interface FieldProps {
  label: ReactNode;
  help?: ReactNode;
  error?: string | null;
  optional?: boolean;
  children: (id: string, describedBy: string | undefined) => ReactNode;
  className?: string;
  aside?: ReactNode;
}

/** Label + control + help/error, wired for screen readers. */
export function Field({ label, help, error, optional, children, className, aside }: FieldProps) {
  const id = useId();
  const helpId = help || error ? `${id}-help` : undefined;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-[13px] font-semibold text-ink">
          {label}
          {optional && <span className="ml-1.5 font-normal text-subtle">Optional</span>}
        </label>
        {aside}
      </div>
      {children(id, helpId)}
      {(error || help) && (
        <p id={helpId} className={cn('text-xs leading-4', error ? 'text-danger' : 'text-muted')}>
          {error || help}
        </p>
      )}
    </div>
  );
}
