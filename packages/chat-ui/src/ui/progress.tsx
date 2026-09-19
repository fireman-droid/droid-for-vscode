import { Progress as ProgressPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export function Progress({ className, value = null, max = 100, ...props }: ComponentProps<typeof ProgressPrimitive.Root>) {
  return <ProgressPrimitive.Root value={value} max={max} className={cn('h-1.5 overflow-hidden rounded-full bg-muted', className)} {...props}>
    <ProgressPrimitive.Indicator className="h-full bg-primary" style={{ width: `${value === null ? 0 : Math.min(100, Math.max(0, value / max * 100))}%` }} />
  </ProgressPrimitive.Root>;
}
