import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ImageIcon, Minus, Plus, Scan } from 'lucide-react';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/overlays';

export interface MediaSize { readonly width: number; readonly height: number }
const levels = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 8];
const clamp = (scale: number, fit: number) => Math.min(8, Math.max(Math.min(0.25, fit), scale));

export function MediaPreview({ label, size, onClose, children, actions, onEscape, preventDismiss = false, returnFocus }: {
  readonly label: string;
  readonly size: MediaSize | null;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly actions?: ReactNode;
  readonly onEscape?: (event: KeyboardEvent) => void;
  readonly preventDismiss?: boolean;
  readonly returnFocus?: HTMLElement | null;
}) {
  const opener = useRef(returnFocus ?? document.activeElement);
  const dialog = useRef<HTMLDivElement>(null);
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent ref={dialog} className="inset-2 top-2 flex h-[calc(100vh-16px)] max-h-none max-w-none flex-col overflow-hidden rounded-xl p-0"
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        dialog.current?.querySelector<HTMLElement>('[data-media-viewport]')?.focus({ preventScroll: true });
      }}
      onEscapeKeyDown={onEscape}
      onInteractOutside={(event) => { if (preventDismiss) event.preventDefault(); }}
      onCloseAutoFocus={(event) => {
      event.preventDefault();
      if (opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus({ preventScroll: true });
    }}>
      <header className="flex h-11 shrink-0 items-center gap-2.5 border-b border-border px-3 pr-12">
        <ImageIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <DialogTitle className="min-w-0 flex-1 truncate text-xs font-medium" title={label}>{label}</DialogTitle>
        {size ? <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{size.width} × {size.height}</span> : null}
      </header>
      <DialogDescription className="sr-only">Scroll to zoom, drag to pan, or double-click to toggle fit and actual size.</DialogDescription>
      <MediaViewport size={size} actions={actions}>{children}</MediaViewport>
    </DialogContent>
  </Dialog>;
}

function MediaViewport({ size, children, actions }: { readonly size: MediaSize | null; readonly children: ReactNode; readonly actions?: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const view = useRef({ scale: 1, fit: 1, x: 0, y: 0 });
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const frame = useRef<number | null>(null);
  const [percent, setPercent] = useState(100);
  const [panning, setPanning] = useState(false);
  const apply = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const current = view.current;
      if (stage.current && viewport.current) {
        const x = (viewport.current.clientWidth - stage.current.offsetWidth * current.scale) / 2 + current.x;
        const y = (viewport.current.clientHeight - stage.current.offsetHeight * current.scale) / 2 + current.y;
        stage.current.style.transform = `translate(${x}px, ${y}px) scale(${current.scale})`;
      }
      setPercent(Math.round(current.scale * 100));
    });
  }, []);
  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element || !size || size.width === 0 || size.height === 0) return;
    const updateFit = (initial = false) => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return;
      const fit = Math.min(1, Math.max(1, element.clientWidth - 40) / size.width, Math.max(1, element.clientHeight - 112) / size.height);
      const fitted = initial || Math.abs(view.current.scale - view.current.fit) < 0.001;
      view.current = fitted ? { scale: fit, fit, x: 0, y: 0 } : { ...view.current, fit };
      apply();
    };
    updateFit(true);
    const observer = new ResizeObserver(() => updateFit());
    observer.observe(element);
    return () => observer.disconnect();
  }, [size, apply]);
  const zoom = useCallback((scale: number, clientX?: number, clientY?: number) => {
    const current = view.current;
    const box = viewport.current!.getBoundingClientRect();
    const x = clientX === undefined ? 0 : clientX - box.left - box.width / 2;
    const y = clientY === undefined ? 0 : clientY - box.top - box.height / 2;
    const ratio = scale / current.scale;
    current.x = x - ratio * (x - current.x);
    current.y = y - ratio * (y - current.y);
    current.scale = scale;
    apply();
  }, [apply]);
  useEffect(() => {
    const element = viewport.current!;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      zoom(clamp(view.current.scale * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.002)), view.current.fit), event.clientX, event.clientY);
    };
    element.addEventListener('wheel', wheel, { passive: false });
    return () => element.removeEventListener('wheel', wheel);
  }, [zoom]);
  const reset = (actual = false) => {
    view.current.scale = actual ? 1 : view.current.fit;
    view.current.x = 0;
    view.current.y = 0;
    apply();
  };
  const step = (direction: -1 | 1) => {
    const next = direction === 1 ? levels.find((scale) => scale > view.current.scale) : [...levels].reverse().find((scale) => scale < view.current.scale);
    zoom(next ?? (direction === -1 ? Math.min(0.25, view.current.fit) : 8));
  };
  const endDrag = () => { drag.current = null; setPanning(false); };
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="relative min-h-0 flex-1 bg-background/70">
    <div ref={viewport} data-media-viewport="" role="region" aria-label="Image viewport" tabIndex={0}
      className={`absolute inset-0 overflow-hidden touch-none select-none outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring ${panning ? 'cursor-grabbing' : 'cursor-grab'}`}
      onPointerDownCapture={(event) => event.currentTarget.focus({ preventScroll: true })}
      onDoubleClick={(event) => {
      if (Math.abs(view.current.scale - view.current.fit) < 0.01) zoom(view.current.fit < 1 ? 1 : 2, event.clientX, event.clientY);
      else reset();
    }}
        onPointerDown={(event) => {
          if (!size || !event.isPrimary || (event.button !== 0 && event.button !== 1)) return;
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          setPanning(true);
        }}
        onPointerMove={(event) => {
          if (drag.current?.id !== event.pointerId) return;
          view.current.x += event.clientX - drag.current.x;
          view.current.y += event.clientY - drag.current.y;
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          apply();
        }}
        onPointerUp={(event) => {
          if (drag.current?.id !== event.pointerId) return;
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          endDrag();
        }}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
      <div ref={stage} className="absolute left-0 top-0 origin-top-left"
        style={size ? { width: size.width, height: size.height } : undefined}>{children}</div>
    </div>
    <div role="group" aria-label="Media controls" className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-popover/95 p-1 shadow-lg backdrop-blur-sm">
      <Button variant="ghost" size="icon" aria-label="Zoom out" title="Zoom out" disabled={!size || percent <= Math.round(Math.min(0.25, view.current.fit) * 100)} onClick={() => step(-1)}><Minus /></Button>
      <span className="w-11 text-center text-[11px] tabular-nums text-muted-foreground" aria-live="polite">{percent}%</span>
      <Button variant="ghost" size="icon" aria-label="Zoom in" title="Zoom in" disabled={!size || percent >= 800} onClick={() => step(1)}><Plus /></Button>
      <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
      <Button variant="ghost" size="icon" aria-label="Fit to preview" title="Fit to preview" disabled={!size} onClick={() => reset()}><Scan /></Button>
      <Button variant="ghost" size="icon" aria-label="Actual size" title="Actual size" disabled={!size} className="text-[11px]" onClick={() => reset(true)}>1:1</Button>
    </div>
    </div>
    {actions ? <div className="shrink-0 border-t border-border px-3 py-2">{actions}</div> : null}
  </div>;
}

export function ImageContent({ src, alt, generated = false, thumbnail = false }: { readonly src: string; readonly alt: string; readonly generated?: boolean; readonly thumbnail?: boolean }) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<MediaSize | null>(null);
  return <span className={thumbnail ? 'inline-block' : 'my-2 block'}>
    <Button variant="plain" size="none" aria-label={`Enlarge ${alt}`} className="block min-h-7 min-w-7 max-w-full rounded outline-none focus-visible:ring-1 focus-visible:ring-ring" onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
      <img src={src} alt={alt} className={thumbnail ? 'size-12 rounded-[7px] object-cover' : 'max-h-64 max-w-full rounded object-contain'} loading="lazy" onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
    </Button>
    {generated ? <span className="text-[11px] text-muted-foreground">Generated</span> : null}
    {open ? <MediaPreview label="Image preview" size={size} onClose={() => setOpen(false)}><img src={src} alt={alt} draggable={false} className="size-full max-w-none object-contain" /></MediaPreview> : null}
  </span>;
}
