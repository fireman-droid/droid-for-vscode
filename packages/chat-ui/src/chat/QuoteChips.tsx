import { useI18n } from '../i18n';
import { ChevronUp, X } from 'lucide-react';
import { useState, type RefObject } from 'react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '../ui/overlays';

export interface QuoteChipsProps {
  readonly quotes: readonly string[];
  readonly onRemove?: (index: number) => void;
  readonly className?: string;
  readonly previewAnchor?: RefObject<HTMLElement | null>;
}

export function QuoteChips({ quotes, onRemove, className, previewAnchor }: QuoteChipsProps) {
  const { t } = useI18n();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  if (quotes.length === 0) return null;
  const inlineExpanded = !onRemove && expandedKey !== null;
  return <div role="group" aria-label={t("Quoted context")} className={cn('flex w-full min-w-0 flex-wrap gap-1.5', !inlineExpanded && 'max-h-24 overflow-y-auto', className)}>
    {quotes.map((text, index) => {
      const preview = text.replace(/\s+/g, ' ').trim().slice(0, 80);
      const label = quotes.length === 1 ? 'Quoted context' : `Quoted context ${index + 1}`;
      const itemKey = `${index}:${text}`;
      if (!onRemove) {
        const expanded = expandedKey === itemKey;
        if (expanded) {
          return <div key={itemKey} className="w-full rounded-md border border-[var(--panel-edge)] bg-[color-mix(in_srgb,var(--surface)_45%,transparent)] motion-safe:animate-[v2-fade-in_var(--motion-fast)_var(--motion-ease)]">
            <div className="flex items-start gap-1.5 px-2 py-1.5">
              <blockquote tabIndex={0} aria-label={t("Full quoted text")}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    setExpandedKey(null);
                  }
                }}
                className="max-h-36 min-w-0 flex-1 select-text overflow-y-auto whitespace-pre-wrap text-[12px] leading-[18px] text-foreground/90 [overflow-wrap:anywhere] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">{text}</blockquote>
              <Button variant="plain" size="none" aria-expanded={true} aria-label={t("View {p0}: {p1}", { p0: label.toLowerCase(), p1: preview })} title={t("Close")}
                className="grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-[var(--control-surface-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
                onClick={() => setExpandedKey(null)}><ChevronUp aria-hidden="true" className="size-3" /></Button>
            </div>
          </div>;
        }
        return <div key={itemKey} className="inline-flex h-6 min-w-0 max-w-full items-center rounded-md border border-[var(--panel-edge)] text-muted-foreground">
          <Button variant="plain" size="none" aria-expanded={false} aria-label={t("View {p0}: {p1}", { p0: label.toLowerCase(), p1: preview })}
            className="flex h-full min-w-0 max-w-[200px] items-center rounded-md px-2 text-left text-[11px] hover:bg-[var(--control-surface-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => setExpandedKey(itemKey)}>
            <span className="truncate">{preview}</span>
          </Button>
        </div>;
      }
      return <Popover key={itemKey}>
        {previewAnchor ? <PopoverAnchor virtualRef={previewAnchor} /> : null}
        <div className="inline-flex h-6 min-w-0 max-w-full items-center rounded-md border border-[var(--panel-edge)] text-muted-foreground">
          <PopoverTrigger asChild><Button variant="plain" size="none" aria-label={t("View {p0}: {p1}", { p0: label.toLowerCase(), p1: preview })}
            className="flex h-full min-w-0 max-w-[200px] items-center rounded-md px-2 text-left text-[11px] hover:bg-[var(--control-surface-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
            <span className="truncate">{preview}</span>
          </Button></PopoverTrigger>
          <Button variant="plain" size="none" aria-label={t("Remove {p0}", { p0: label.toLowerCase() })}
            className="grid size-[22px] shrink-0 place-items-center rounded-md hover:bg-[var(--control-surface-hover)] hover:text-foreground focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring"
            onClick={() => onRemove(index)}><X aria-hidden="true" className="size-3" /></Button>
        </div>
        <PopoverContent side="top" align="start" sideOffset={previewAnchor ? 4 : 6} aria-label={t(label)}
          className={cn('max-h-[min(240px,40vh,var(--radix-popover-content-available-height))] rounded-md border-[var(--panel-edge)] px-2.5 py-1.5 shadow-sm',
            previewAnchor ? 'w-[var(--radix-popover-trigger-width)] max-w-[var(--radix-popover-content-available-width)]'
              : 'w-max max-w-[min(320px,var(--radix-popover-content-available-width))]')}>
          <blockquote tabIndex={0} aria-label={t("Full quoted text")} className="select-text whitespace-pre-wrap bg-transparent text-popover-foreground [overflow-wrap:anywhere] text-xs leading-[18px] outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">{text}</blockquote>
        </PopoverContent>
      </Popover>;
    })}
  </div>;
}
