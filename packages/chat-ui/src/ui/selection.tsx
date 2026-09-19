import { Checkbox as CheckboxPrimitive, Select as SelectPrimitive, Tabs as TabsPrimitive } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import type { ComponentProps } from 'react';
import { cn } from './cn';
import { usePortalContainer } from './overlays';

export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn('flex size-3.5 shrink-0 items-center justify-center rounded-xs border border-input bg-input-background outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-45 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground', className)}
      {...props}
    >
      <CheckboxPrimitive.Indicator><Check className="size-3" /></CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn('inline-flex h-7 min-w-0 select-none items-center justify-between gap-2 rounded border border-input bg-input-background px-2 text-[13px] outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-45 [&>span]:truncate', className)}
      {...props}
    >
      {children}<SelectPrimitive.Icon><ChevronDown className="size-3" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({ children, className, ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  const container = usePortalContainer();
  return (
    <SelectPrimitive.Portal container={container}>
      <SelectPrimitive.Content
        data-webview-overlay=""
        position="popper"
        sideOffset={4}
        collisionPadding={8}
        className={cn('z-50 max-h-[var(--radix-select-content-available-height)] w-[var(--radix-select-trigger-width)] min-w-0 max-w-[calc(100vw-16px)] overflow-auto rounded border border-border bg-popover p-1 text-popover-foreground shadow-md', className)}
        {...props}
      >
        <SelectPrimitive.Viewport className="w-full min-w-0">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({ children, className, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn('relative flex min-w-0 cursor-default select-none items-center gap-2 rounded py-1 pl-1 pr-5 text-left text-[13px] whitespace-normal [overflow-wrap:anywhere] outline-none [&>span]:min-w-0 data-[disabled]:opacity-45 data-[highlighted]:bg-accent', className)}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-1"><Check className="size-3" /></SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn('flex min-w-0 select-none gap-1 border-b border-border', className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger className={cn('border-b-2 border-transparent px-2 py-1.5 text-xs text-muted-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring data-[state=active]:border-primary data-[state=active]:text-foreground', className)} {...props} />;
}
export const TabsContent = TabsPrimitive.Content;
