import { Separator as SeparatorPrimitive } from 'radix-ui';
import { useRef, useState } from 'react';

/** Keyboard and pointer resizing at either edge of a horizontal panel. */
export function ResizeHandle({ value, min, max, defaultValue, label, onValueChange, edge = 'right' }: {
  readonly value: number; readonly min: number; readonly max: number;
  readonly defaultValue: number; readonly label: string;
  readonly onValueChange: (value: number) => void;
  readonly edge?: 'left' | 'right';
}) {
  const drag = useRef<{ pointerId: number; x: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const direction = edge === 'left' ? -1 : 1;
  const update = (next: number) => onValueChange(Math.min(max, Math.max(min, Math.round(next))));
  const finish = () => { drag.current = null; setDragging(false); };
  return <SeparatorPrimitive.Root decorative={false} orientation="vertical" tabIndex={0}
    className="dvx-resize-handle" data-edge={edge} aria-label={label} aria-valuemin={min} aria-valuemax={max}
    aria-valuenow={value} aria-valuetext={`${Math.round(value)} pixels`} data-dragging={dragging || undefined}
    title="Drag to resize · Arrow keys to adjust · Double-click to reset"
    onPointerDown={(event) => {
      if (!event.isPrimary || event.button !== 0) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, x: event.clientX, value };
      setDragging(true);
    }}
    onPointerMove={(event) => {
      const start = drag.current;
      if (start?.pointerId === event.pointerId) update(start.value + (event.clientX - start.x) * direction);
    }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={() => update(defaultValue)}
    onKeyDown={(event) => {
      const step = event.shiftKey ? 50 : 10;
      const next = event.key === 'ArrowLeft' ? value - step * direction : event.key === 'ArrowRight' ? value + step * direction
        : event.key === 'Home' ? min : event.key === 'End' ? max : event.key === 'Enter' ? defaultValue : null;
      if (next !== null) { event.preventDefault(); update(next); }
      if (event.key === 'Escape' && drag.current) {
        event.preventDefault();
        update(drag.current.value);
        event.currentTarget.releasePointerCapture(drag.current.pointerId);
        finish();
      }
    }} />;
}
