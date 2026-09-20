import { DropdownMenu as MenuPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { usePortalContainer } from './overlays';

export const DropdownMenu = MenuPrimitive.Root;
export const DropdownMenuTrigger = MenuPrimitive.Trigger;
export function DropdownMenuContent({ className, sideOffset = 4, ...props }: ComponentProps<typeof MenuPrimitive.Content>) {
  const container = usePortalContainer();
  return <MenuPrimitive.Portal container={container}>
    <MenuPrimitive.Content data-webview-overlay="" data-slot="dropdown-menu-content" sideOffset={sideOffset} collisionPadding={8}
      className={cn('dvx-overlay-surface z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] max-w-[calc(100vw-16px)] overflow-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground outline-none', className)} {...props} />
  </MenuPrimitive.Portal>;
}
export function DropdownMenuItem({ className, ...props }: ComponentProps<typeof MenuPrimitive.Item>) {
  return <MenuPrimitive.Item className={cn('dvx-menu-item flex cursor-default select-none items-center gap-1.5 rounded px-2 py-1.5 text-xs data-[disabled]:pointer-events-none data-[disabled]:opacity-45', className)} {...props} />;
}
