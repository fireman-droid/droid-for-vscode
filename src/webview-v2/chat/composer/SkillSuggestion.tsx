import { useId } from 'react';
import { X } from 'lucide-react';
import { Button } from '../../ui/button';
import { cn } from '../../ui/cn';
import {
  HoverCard, HoverCardContent, HoverCardTrigger,
  Popover, PopoverAnchor, PopoverClose, PopoverContent, PopoverTrigger,
} from '../../ui/overlays';

export function SkillSuggestion({ id, name, description, selected, preview, onHoverChange, onPinnedChange, onActivate, onSelect }: {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly selected: boolean;
  readonly preview: 'hover' | 'pinned' | null;
  readonly onHoverChange: (open: boolean) => void;
  readonly onPinnedChange: (open: boolean) => void;
  readonly onActivate: () => void;
  readonly onSelect: () => void;
}) {
  const titleId = useId();
  const content = (closable: boolean) => <>
    <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
      <p id={titleId} className="min-w-0 flex-1 break-words text-xs font-medium">{name}</p>
      <span className="text-[10px] text-muted-foreground">Skill</span>
      {closable ? <PopoverClose asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Close skill preview"><X /></Button>
      </PopoverClose> : null}
    </div>
    <p className="min-h-0 overflow-y-auto overscroll-contain whitespace-pre-wrap break-words px-3 py-2 text-xs leading-relaxed text-muted-foreground">{description}</p>
  </>;
  return <HoverCard open={preview === 'hover'} onOpenChange={onHoverChange} openDelay={400} closeDelay={150}>
    <Popover open={preview === 'pinned'} onOpenChange={onPinnedChange}>
      <div onMouseEnter={onActivate} className={cn('flex min-w-0 items-center gap-1 rounded pr-1 hover:bg-[var(--control-surface-hover)]', selected && 'bg-[var(--control-surface-active)]')}>
        <PopoverAnchor asChild>
          <HoverCardTrigger asChild>
            <Button variant="plain" size="none" id={id} role="option" aria-selected={selected} tabIndex={-1}
              className="min-w-0 flex-1 rounded px-2 py-1 text-left text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onMouseDown={(event) => event.preventDefault()} onClick={onSelect}>
              <span className="block truncate">{name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{description}</span>
            </Button>
          </HoverCardTrigger>
        </PopoverAnchor>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`View ${name} skill description`} className="text-[11px]">View</Button>
        </PopoverTrigger>
      </div>
      <HoverCardContent data-suggestion-preview="" side="top" align="end" hideWhenDetached
        className="flex max-h-[min(18rem,var(--radix-hover-card-content-available-height))] w-80 flex-col overflow-hidden p-0">
        {content(false)}
      </HoverCardContent>
      <PopoverContent data-suggestion-preview="" side="top" align="end" sideOffset={8} hideWhenDetached aria-labelledby={titleId}
        className="z-50 flex max-h-[min(18rem,var(--radix-popover-content-available-height))] w-80 flex-col overflow-hidden p-0">
        {content(true)}
      </PopoverContent>
    </Popover>
  </HoverCard>;
}
