import { useI18n } from '../i18n';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { MoveDiagonal2, MoreHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Button } from './button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './dropdown-menu';
import { usePortalContainer } from './overlays';
import { cn } from './cn';
import { PinwheelIcon } from './pinwheel-icon';

interface Frame { left: number; top: number; width: number; height: number }
interface Anchor { getBoundingClientRect(): DOMRect }
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** A non-modal Radix surface with a stable viewport position and shared movement controls. */
export function FloatingPanel({ anchor, boundary, title, children, onClose, className, ...props }: {
  anchor: Anchor; boundary?: Element | null; title: string; children: ReactNode; onClose(): void;
} & Omit<ComponentProps<typeof DialogPrimitive.Content>, 'title' | 'children'>) {
  const { t } = useI18n();
  const container = usePortalContainer();
  const bounds = () => {
    const box = boundary?.getBoundingClientRect();
    return { left: Math.max(8, (box?.left ?? 0) + 8), top: Math.max(8, (box?.top ?? 0) + 8),
      right: Math.min(window.innerWidth - 8, (box?.right ?? window.innerWidth) - 8),
      bottom: Math.min(window.innerHeight - 8, (box?.bottom ?? window.innerHeight) - 8) };
  };
  const constrain = (frame: Frame): Frame => {
    const box = bounds();
    const width = clamp(frame.width, Math.min(300, box.right - box.left), box.right - box.left);
    const height = clamp(frame.height, Math.min(160, box.bottom - box.top), box.bottom - box.top);
    return { width, height, left: clamp(frame.left, box.left, box.right - width), top: clamp(frame.top, box.top, box.bottom - height) };
  };
  const initial = () => {
    const box = anchor.getBoundingClientRect();
    return constrain({ left: box.left, top: box.top - 304, width: 500, height: 300 });
  };
  const [frame, setFrame] = useState(initial);
  const drag = useRef<{ pointer: number; x: number; y: number; frame: Frame } | null>(null);
  useEffect(() => {
    const fit = () => setFrame(current => constrain(current));
    const observer = new ResizeObserver(fit);
    if (boundary) observer.observe(boundary);
    window.addEventListener('resize', fit);
    return () => { observer.disconnect(); window.removeEventListener('resize', fit); };
  }, [boundary]);
  const change = (mode: 'move' | 'resize', start: Frame, x: number, y: number) => setFrame(constrain(mode === 'move'
    ? { ...start, left: start.left + x, top: start.top + y }
    : { ...start, width: start.width + x, height: start.height + y }));
  const handle = (mode: 'move' | 'resize'): Pick<ComponentProps<typeof Button>,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture' | 'onKeyDown'> => ({
    onPointerDown(event) {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, frame };
    },
    onPointerMove(event) {
      const start = drag.current;
      if (start?.pointer === event.pointerId) change(mode, start.frame, event.clientX - start.x, event.clientY - start.y);
    },
    onPointerUp() { drag.current = null; }, onPointerCancel() { drag.current = null; }, onLostPointerCapture() { drag.current = null; },
    onKeyDown(event) {
      const step = event.shiftKey ? 40 : 10;
      const x = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const y = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
      if (x || y) { event.preventDefault(); change(mode, frame, x, y); }
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault(); event.stopPropagation(); setFrame(drag.current.frame);
        event.currentTarget.releasePointerCapture(drag.current.pointer); drag.current = null;
      }
    },
  });
  return <DialogPrimitive.Root open modal={false} onOpenChange={open => { if (!open) onClose(); }}>
    <DialogPrimitive.Portal container={container}>
      <DialogPrimitive.Content {...props} data-webview-overlay="" data-slot="floating-panel"
        className={cn('dvx-floating-panel dvx-overlay-surface', className)} style={frame} aria-describedby={undefined}
        onInteractOutside={event => event.preventDefault()} onOpenAutoFocus={event => event.preventDefault()}
        onCloseAutoFocus={event => event.preventDefault()}>
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
        <div className="dvx-floating-panel-header">
          <Button variant="plain" size="none" className="dvx-floating-panel-move" aria-label={t("Move question panel")}
            title={t("Drag to move · Arrow keys to adjust")} {...handle('move')}><PinwheelIcon /></Button>
          <DropdownMenu modal={false}><DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={t("Panel position and size")}><MoreHorizontal /></Button>
          </DropdownMenuTrigger><DropdownMenuContent>
            <DropdownMenuItem onSelect={() => setFrame(initial())}>{t("Return to selection")}</DropdownMenuItem>
            {([['Move left', -40, 0], ['Move right', 40, 0], ['Move up', 0, -40], ['Move down', 0, 40]] as const).map(([label, x, y]) =>
              <DropdownMenuItem key={label} onSelect={() => change('move', frame, x, y)}>{t(label)}</DropdownMenuItem>)}
            <DropdownMenuItem onSelect={() => change('resize', frame, 60, 40)}>{t("Larger")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => change('resize', frame, -60, -40)}>{t("Smaller")}</DropdownMenuItem>
          </DropdownMenuContent></DropdownMenu>
          <Button variant="ghost" size="icon-sm" aria-label={t("Close question")} onClick={onClose}><X /></Button>
        </div>
        <div className="dvx-floating-panel-body">{children}</div>
        <Button variant="plain" size="none" className="dvx-floating-panel-resize" aria-label={t("Resize question panel")}
          title={t("Drag to resize · Arrow keys to adjust")} {...handle('resize')}><MoveDiagonal2 /></Button>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
