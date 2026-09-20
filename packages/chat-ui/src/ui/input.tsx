import type { ComponentProps } from 'react';
import { cn } from './cn';

const fieldClass =
  'dvx-control dvx-field min-w-0 rounded-[var(--control-radius)] border bg-input-background text-foreground placeholder:text-muted-foreground disabled:opacity-45';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input data-slot="input" className={cn(fieldClass, 'h-7 w-full px-2 text-[13px]', className)} {...props} />;
}

export function Textarea({ className, variant = 'default', ...props }: ComponentProps<'textarea'> & { variant?: 'default' | 'plain' }) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(variant === 'plain' ? 'outline-none placeholder:text-muted-foreground disabled:opacity-45' : [fieldClass, 'w-full resize-none px-2 py-1.5 text-[13px] leading-relaxed'], className)}
      {...props}
    />
  );
}
