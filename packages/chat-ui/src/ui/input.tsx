import type { ComponentProps } from 'react';
import { cn } from './cn';

const fieldClass =
  'min-w-0 rounded border border-input bg-input-background text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring disabled:opacity-45';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(fieldClass, 'h-7 w-full px-2 text-[13px]', className)} {...props} />;
}

export function Textarea({ className, variant = 'default', ...props }: ComponentProps<'textarea'> & { variant?: 'default' | 'plain' }) {
  return (
    <textarea
      className={cn(variant === 'plain' ? 'outline-none placeholder:text-muted-foreground disabled:opacity-45' : [fieldClass, 'w-full resize-none px-2 py-1.5 text-[13px] leading-relaxed'], className)}
      {...props}
    />
  );
}
