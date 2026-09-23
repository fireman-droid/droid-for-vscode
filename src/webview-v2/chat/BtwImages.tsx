import { useRef, useState } from 'react';
import { ImageIcon, X } from 'lucide-react';
import type { BtwImageSummary } from '../../shared/protocol/btwAttachments';
import type { BtwImagePreview } from './useBtwImages';
import { Button } from '../ui/button';
import { MediaPreview, type MediaSize } from '@droidvisx/chat-ui/content/MediaPreview';

export function BtwImages({ images, previews, onRemove }: {
  readonly images: readonly BtwImageSummary[];
  readonly previews: ReadonlyMap<string, BtwImagePreview>;
  readonly onRemove?: (id: string) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [size, setSize] = useState<MediaSize | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const selected = images.find((image) => image.id === open);
  const preview = selected ? previews.get(selected.id) : undefined;
  if (!images.length) return null;
  return <div className="mb-2 flex min-w-0 flex-wrap gap-2" aria-label="Side question images">
    {images.map((image) => {
      const source = previews.get(image.id);
      return <div key={image.id} className="relative min-w-0 max-w-full">
        <Button variant="outline" size="none" className="h-16 w-20 overflow-hidden rounded-lg p-1" disabled={!source}
          title={source ? image.name : `${image.name} · Preview no longer retained`} aria-label={`Preview ${image.name}`}
          onClick={(event) => { trigger.current = event.currentTarget; setSize(null); setOpen(image.id); }}>
          {source ? <img src={source.url} alt={image.name} className="h-full w-full object-contain" />
            : <span className="min-w-0 truncate px-1 text-[10px]"><ImageIcon className="mx-auto size-4" />{image.name}</span>}
        </Button>
        {onRemove ? <Button variant="secondary" size="none" className="absolute -right-1 -top-1 size-5 rounded-full border border-border p-0"
          aria-label={`Remove ${image.name}`} onClick={() => onRemove(image.id)}><X className="size-3" /></Button> : null}
      </div>;
    })}
    {selected && preview ? <MediaPreview label={selected.name} size={size} onClose={() => setOpen(null)} returnFocus={trigger.current}>
      <img src={preview.url} alt={selected.name} draggable={false} className="block h-full w-full object-contain"
        onLoad={(event) => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })} />
    </MediaPreview> : null}
  </div>;
}
