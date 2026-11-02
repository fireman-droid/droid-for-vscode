import { Collapsible as CollapsiblePrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export const Collapsible = CollapsiblePrimitive.Root;
export const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
export const CollapsibleContent = CollapsiblePrimitive.Content;

// Keep selected/streaming DOM mounted without Radix's height measurement
// temporarily disabling the grid transition (notably command terminals).
export function AnimatedCollapsibleContent({ open, visible = open, children, className, ...props }: ComponentProps<'div'> & { open: boolean; visible?: boolean }) {
  return <div data-state={open ? 'open' : 'closed'} aria-hidden={!open} inert={!open || undefined}
    className={cn('grid transition-[grid-template-rows,opacity] duration-200 motion-reduce:transition-none', visible ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0', className)} {...props}>
    <div className="min-h-0 overflow-hidden">{children}</div>
  </div>;
}
