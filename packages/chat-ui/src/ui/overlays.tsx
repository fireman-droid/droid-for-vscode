import { Dialog as DialogPrimitive, HoverCard as HoverCardPrimitive, Popover as PopoverPrimitive, Tooltip as TooltipPrimitive } from 'radix-ui';
import { createContext, useContext, type ComponentProps, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from './cn';
import { Button } from './button';

const PortalContainerContext = createContext<HTMLElement | undefined>(undefined);

export function usePortalContainer(): HTMLElement | undefined {
  return useContext(PortalContainerContext);
}

export function PortalContainerProvider({
  container,
  children,
}: {
  readonly container: HTMLElement;
  readonly children: ReactNode;
}) {
  return <PortalContainerContext.Provider value={container}>{children}</PortalContainerContext.Provider>;
}

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverAnchor = PopoverPrimitive.Anchor;
export const PopoverClose = PopoverPrimitive.Close;

export const HoverCard = HoverCardPrimitive.Root;
export const HoverCardTrigger = HoverCardPrimitive.Trigger;

export function HoverCardContent({
  className,
  align = 'start',
  sideOffset = 8,
  ...props
}: ComponentProps<typeof HoverCardPrimitive.Content>) {
  const container = usePortalContainer();
  return (
    <HoverCardPrimitive.Portal container={container}>
      <HoverCardPrimitive.Content
        data-webview-overlay=""
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'dvx-overlay-surface z-50 max-h-[var(--radix-hover-card-content-available-height)] max-w-[calc(100vw-16px)] overflow-auto rounded-lg border border-border bg-popover p-3 text-popover-foreground outline-none',
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export function PopoverContent({
  className,
  align = 'start',
  sideOffset = 4,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  const container = usePortalContainer();
  return (
    <PopoverPrimitive.Portal container={container}>
      <PopoverPrimitive.Content
        data-webview-overlay=""
        data-slot="popover-content"
        data-motion="anchored"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          'dvx-overlay-surface v2-popover z-40 max-h-[var(--radix-popover-content-available-height)] max-w-[calc(100vw-16px)] overflow-auto rounded-lg border border-border bg-popover p-2 text-popover-foreground outline-none',
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export function DialogContent({
  children,
  className,
  closeDisabled = false,
  closeLabel = 'Close',
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { readonly closeDisabled?: boolean; readonly closeLabel?: string }) {
  const container = usePortalContainer();
  return (
    <DialogPrimitive.Portal container={container}>
      <DialogPrimitive.Overlay data-webview-overlay="" data-slot="dialog-overlay" className="v2-dialog-overlay fixed inset-0 z-40 bg-black/20" />
      <DialogPrimitive.Content
        data-webview-overlay=""
        data-slot="dialog-content"
        className={cn('dvx-overlay-surface v2-dialog fixed inset-x-2 top-[10%] z-50 mx-auto max-h-[80%] max-w-lg overflow-auto rounded-xl border border-border bg-popover p-4 text-popover-foreground outline-none', className)}
        {...props}
      >
        {children}
        <DialogClose asChild>
          <Button variant="ghost" size="icon" aria-label={closeLabel} disabled={closeDisabled} className="absolute right-2 top-2">
            <X />
          </Button>
        </DialogClose>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

export function Tooltip({ children, content }: { readonly children: ReactNode; readonly content: string }) {
  const container = usePortalContainer();
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal container={container}>
        <TooltipPrimitive.Content
          data-slot="tooltip-content"
          sideOffset={5}
          collisionPadding={8}
          className="dvx-overlay-surface z-50 max-w-64 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
