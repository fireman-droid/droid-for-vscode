import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { Check, Hand, Pencil, RotateCcw, Undo2 } from 'lucide-react';
export type ImageMediaType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
import { blobToBase64, canvasToBlob, drawStroke, isAnimatedWebp, type Point, type Stroke } from './imageAnnotation';
import { Button } from '../ui/button';
import { ToggleGroup, ToggleGroupItem } from '../ui/controls';
import { MediaPreview, type MediaSize } from './MediaPreview';

export function StagedImagePreview({ name, data, mediaType, onSave, onClose, returnFocus, maxBytes }: {
  readonly maxBytes?: number;
  readonly name: string;
  readonly data: string;
  readonly mediaType: ImageMediaType;
  readonly onSave: (data: string, mediaType: ImageMediaType) => void;
  readonly onClose: () => void;
  readonly returnFocus?: HTMLElement | null;
}) {
  const image = useRef<HTMLImageElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const space = useRef(false);
  const active = useRef<{ id: number; points: Point[]; width: number } | null>(null);
  const [mode, setMode] = useState<'move' | 'draw'>('move');
  const [spacePressed, setSpacePressed] = useState(false);
  const [size, setSize] = useState<MediaSize | null>(null);
  const [strokes, setStrokes] = useState<readonly Stroke[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  const annotatable = mediaType !== 'image/gif' && (mediaType !== 'image/webp' || !isAnimatedWebp(data));
  useEffect(() => {
    live.current = true;
    const down = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !(event.target instanceof HTMLElement) || !event.target.closest('[data-media-viewport]')) return;
      event.preventDefault(); space.current = true; setSpacePressed(true);
    };
    const up = (event: KeyboardEvent) => { if (event.code === 'Space') { space.current = false; setSpacePressed(false); } };
    const blur = () => { space.current = false; setSpacePressed(false); };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      live.current = false;
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);
  const redraw = (completed: readonly Stroke[], pending = active.current) => {
    const context = canvas.current?.getContext('2d');
    if (!context || !size) return;
    context.clearRect(0, 0, size.width, size.height);
    context.strokeStyle = '#E5484D';
    context.lineCap = 'round';
    context.lineJoin = 'round';
    for (const stroke of completed) drawStroke(context, stroke.points, stroke.width);
    if (pending) drawStroke(context, pending.points, pending.width);
  };
  const point = (event: PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * size!.width / rect.width, y: (event.clientY - rect.top) * size!.height / rect.height };
  };
  const cancel = () => { active.current = null; setStrokes([]); setError(null); redraw([], null); };
  const save = async () => {
    if (!image.current || !size || strokes.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const output = document.createElement('canvas');
      output.width = size.width;
      output.height = size.height;
      const context = output.getContext('2d');
      if (!context) throw new Error('Canvas is unavailable.');
      context.drawImage(image.current, 0, 0, size.width, size.height);
      context.strokeStyle = '#E5484D';
      context.lineCap = 'round';
      context.lineJoin = 'round';
      for (const stroke of strokes) drawStroke(context, stroke.points, stroke.width);
      const blob = await canvasToBlob(output, mediaType, mediaType === 'image/png' ? undefined : 0.92);
      if (maxBytes !== undefined && blob.size > maxBytes) {
        if (live.current) setError(`Annotated image exceeds the ${maxBytes / (1024 * 1024)} MB attachment limit.`);
        return;
      }
      const encoded = await blobToBase64(blob);
      if (!live.current) return;
      onSave(encoded, mediaType);
      onClose();
    } catch {
      if (live.current) setError('The annotation could not be saved.');
    } finally {
      if (live.current) setSaving(false);
    }
  };
  return <MediaPreview label={`Preview ${name}`} size={size} onClose={onClose} returnFocus={returnFocus} preventDismiss={strokes.length > 0}
    onEscape={(event) => { if (strokes.length > 0 || active.current) { event.preventDefault(); cancel(); } }}
    actions={<div className="flex flex-wrap items-center gap-2 text-xs">
      {error ? <p role="status" className="w-full text-center text-destructive">{error}</p> : null}
      {annotatable ? <>
        <ToggleGroup type="single" value={mode} disabled={saving} onValueChange={(value) => {
          if (value === 'move' || value === 'draw') setMode(value);
        }} aria-label="Image interaction mode" className="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
          <ToggleGroupItem value="move" aria-label="Move image" title="Drag to move the image" className="h-7 gap-1.5 px-2"><Hand />Move</ToggleGroupItem>
          <ToggleGroupItem value="draw" aria-label="Annotate image" title="Draw to annotate; hold Space to move" className="h-7 gap-1.5 px-2"><Pencil />Draw</ToggleGroupItem>
        </ToggleGroup>
        <div className="ml-auto flex items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Undo annotation" title="Undo annotation" disabled={saving || strokes.length === 0} onClick={() => {
          const next = strokes.slice(0, -1); setStrokes(next); redraw(next);
        }}><Undo2 /></Button>
        <Button variant="ghost" size="icon" aria-label="Clear annotations" title="Clear annotations" disabled={saving || strokes.length === 0} onClick={cancel}><RotateCcw /></Button>
        <Button size="sm" className="ml-1 h-7 gap-1.5" aria-label="Save annotation" disabled={saving || strokes.length === 0} onClick={() => void save()}><Check />{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </> : <span className="text-muted-foreground">Drag to move · Scroll to zoom · Animated image</span>}
    </div>}>
    <img ref={image} src={`data:${mediaType};base64,${data}`} alt={name} draggable={false} className="size-full max-w-none object-contain"
      onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
    {annotatable && size ? <canvas ref={canvas} width={size.width} height={size.height} aria-label="Image annotation canvas"
      className={`absolute inset-0 size-full touch-none ${mode === 'draw' && !spacePressed && !saving ? 'cursor-crosshair' : 'pointer-events-none'}`}
      onDoubleClick={(event) => { if (mode === 'draw' && !space.current) event.stopPropagation(); }}
      onPointerDown={(event) => {
        if (mode !== 'draw' || event.button !== 0 || !event.isPrimary || space.current || saving) return;
        event.preventDefault(); event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const position = point(event);
        active.current = { id: event.pointerId, points: [position, position], width: 4 * size.width / event.currentTarget.getBoundingClientRect().width };
        setError(null);
        redraw(strokes);
      }}
      onPointerMove={(event) => {
        if (active.current?.id !== event.pointerId) return;
        event.stopPropagation();
        active.current.points.push(point(event));
        redraw(strokes);
      }}
      onPointerUp={(event) => {
        if (active.current?.id !== event.pointerId) return;
        event.stopPropagation();
        const next = [...strokes, active.current];
        active.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        setStrokes(next); redraw(next, null);
      }}
      onPointerCancel={() => { active.current = null; redraw(strokes, null); }}
      onLostPointerCapture={() => { if (active.current) { active.current = null; redraw(strokes, null); } }}
    /> : null}
  </MediaPreview>;
}
