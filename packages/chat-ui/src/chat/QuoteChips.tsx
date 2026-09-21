import { Quote, X } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlays';

export interface QuoteChipsProps {
  readonly quotes: readonly string[];
  readonly onRemove?: (index: number) => void;
  readonly className?: string;
}

export function QuoteChips({ quotes, onRemove, className }: QuoteChipsProps) {
  if (quotes.length === 0) return null;
  return <div role="group" aria-label="Quoted context" className={cn('flex max-h-24 min-w-0 flex-wrap gap-1.5 overflow-y-auto', className)}>
    {quotes.map((text, index) => {
      const preview = text.replace(/\s+/g, ' ').trim().slice(0, 80);
      const label = quotes.length === 1 ? 'Quoted context' : `Quoted context ${index + 1}`;
      return <Popover key={`${index}:${text}`}>
        <div className="inline-flex h-6 min-w-0 max-w-full items-center rounded-md border border-[var(--panel-edge)] text-muted-foreground">
          <PopoverTrigger asChild><Button variant="plain" size="none" aria-label={`View ${label.toLowerCase()}: ${preview}`}
            className="flex h-full min-w-0 max-w-[200px] items-center gap-1.5 rounded-md px-2 text-left text-[11px] hover:bg-[var(--control-surface-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
            <Quote aria-hidden="true" className="size-3 shrink-0" /><span className="truncate">{preview}</span>
          </Button></PopoverTrigger>
          {onRemove ? <Button variant="plain" size="none" aria-label={`Remove ${label.toLowerCase()}`}
            className="grid size-[22px] shrink-0 place-items-center rounded-md hover:bg-[var(--control-surface-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => onRemove(index)}><X aria-hidden="true" className="size-3" /></Button> : null}
        </div>
        <PopoverContent side="top" align="start" sideOffset={6} aria-label={label} className="w-[min(420px,calc(100vw-24px))] p-3">
          <p className="mb-2 text-[11px] font-medium text-muted-foreground">{label}</p>
          <blockquote tabIndex={0} aria-label="Full quoted text" className="max-h-[min(320px,50vh)] select-text overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] text-[13px] leading-5 outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">{text}</blockquote>
        </PopoverContent>
      </Popover>;
    })}
  </div>;
}
