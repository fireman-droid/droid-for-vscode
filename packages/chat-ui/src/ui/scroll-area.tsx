import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export function ScrollArea({ children, className, viewportClassName, viewportRef, viewportProps, nonce, orientation = 'vertical', ...props }: ComponentProps<typeof ScrollAreaPrimitive.Root> & {
  readonly viewportClassName?: string;
  readonly viewportRef?: ComponentProps<typeof ScrollAreaPrimitive.Viewport>['ref'];
  readonly viewportProps?: Omit<ComponentProps<typeof ScrollAreaPrimitive.Viewport>, 'children' | 'ref' | 'className' | 'nonce'>;
  readonly orientation?: 'vertical' | 'horizontal';
}) {
  return <ScrollAreaPrimitive.Root type="auto" data-orientation={orientation} className={cn('dvx-scroll-area', className)} {...props}>
    <ScrollAreaPrimitive.Viewport tabIndex={0} aria-label={props['aria-label']} {...viewportProps} ref={viewportRef} nonce={nonce} className={cn('dvx-scroll-viewport', viewportClassName)}>
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollAreaPrimitive.Scrollbar orientation={orientation} className="dvx-scrollbar">
      <ScrollAreaPrimitive.Thumb className="dvx-scroll-thumb" />
    </ScrollAreaPrimitive.Scrollbar>
  </ScrollAreaPrimitive.Root>;
}
