// Adapted from shadcn/ui (MIT), button.tsx e3345d985d14c33e3cb9d8c45cf973807326c944.
// Changes: compact editor sizing and theme tokens. See THIRD_PARTY_LICENSES.txt.
import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';

export function isTextSelectionClick(event: { readonly detail: number; readonly currentTarget: HTMLElement }): boolean {
  if (event.detail === 0) return false;
  const selection = event.currentTarget.ownerDocument.getSelection();
  return !!selection && !selection.isCollapsed && selection.rangeCount > 0 &&
    selection.getRangeAt(0).intersectsNode(event.currentTarget);
}

const layout = 'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded text-[13px] [&_svg]:pointer-events-none [&_svg]:size-3.5 [&_svg]:shrink-0';
export const buttonVariants = cva(
  'select-none outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-45',
  {
    variants: {
      variant: {
        default: `${layout} bg-primary text-primary-foreground hover:bg-primary/90`,
        secondary: `${layout} bg-secondary text-secondary-foreground hover:bg-accent`,
        outline: `${layout} border border-border bg-background hover:bg-accent`,
        ghost: `${layout} text-muted-foreground hover:bg-accent hover:text-foreground`,
        destructive: `${layout} text-destructive hover:bg-destructive/10`,
        link: `${layout} text-link hover:underline`,
        plain: '',
      },
      size: {
        default: 'h-7 px-2.5',
        sm: 'h-6 px-2 text-xs',
        icon: 'size-7',
        'icon-sm': 'size-6',
        none: '',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
);

export function Button({
  className,
  variant,
  size,
  asChild = false,
  textSelectable = false,
  onClick,
  type = 'button',
  ...props
}: ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & { readonly asChild?: boolean; readonly textSelectable?: boolean }) {
  const Component = asChild ? Slot.Root : 'button';
  return (
    <Component
      data-slot="button"
      data-text-selectable={textSelectable || undefined}
      type={type}
      className={cn(buttonVariants({ variant, size }), textSelectable && 'select-text', className)}
      onClick={textSelectable ? (event) => {
        if (isTextSelectionClick(event)) { event.preventDefault(); return; }
        onClick?.(event);
      } : onClick}
      {...props}
    />
  );
}
