import { useContext, useId, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { AnimatedCollapsibleContent, Collapsible, CollapsibleTrigger } from '../ui/collapsible';
import { ProcessGroupContext, useProcessDisclosure } from './processPresentation';

export function ActivityItem({
  id,
  messageId,
  icon,
  title,
  target,
  targetDetail,
  targetTitle,
  status,
  description,
  actions,
  children,
  textSelectable = false,
  failed = false,
}: {
  readonly id: string;
  readonly messageId: string;
  readonly icon?: ReactNode;
  readonly title: string;
  readonly target?: string;
  readonly targetDetail?: string;
  readonly targetTitle?: string;
  readonly status?: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly textSelectable?: boolean;
  readonly failed?: boolean;
}) {
  const inline = useContext(ProcessGroupContext);
  const disclosure = useProcessDisclosure(messageId, `activity:${id}`, false, inline);
  const selectable = children !== undefined;
  const selected = disclosure.expanded;
  const detailsId = useId();
  const hasLeadingIcon = icon !== undefined && icon !== null;
  const labels = <>
    <span data-ui-notice="" className="max-w-[55%] shrink-0 truncate text-[13px]" title={title}>{title}</span>
    {target ? (
      <span className="flex min-w-0 flex-1 items-baseline gap-1.5 overflow-hidden">
        <span className="min-w-0 truncate text-[13px] text-foreground" title={targetTitle ?? target}>{target}</span>
        {targetDetail ? <span data-ui-notice="" className="shrink-0 truncate text-[11.5px] tabular-nums text-muted-foreground" title={targetTitle ?? targetDetail}>{targetDetail}</span> : null}
      </span>
    ) : <span className="min-w-0 flex-1" />}
    {status ? <span data-ui-notice="" title={status} className={cn('max-w-[50%] shrink-0 truncate text-[11px]', failed ? 'text-destructive' : 'text-muted-foreground')}>{status}</span> : null}
  </>;
  const content = description ? <span className="min-w-0 flex-1">
    <span className="flex min-w-0 items-center gap-1.5">{labels}</span>
    <span data-ui-notice="" className="block truncate text-[11px] leading-[18px] text-muted-foreground" title={description}>{description}</span>
  </span> : <span className="flex min-w-0 items-center gap-1.5">{labels}</span>;
  const chevron = <ChevronRight className={cn('size-3 transition-transform motion-reduce:transition-none', selected && 'rotate-90')} />;
  const leading = hasLeadingIcon
    ? (selectable
      ? <span aria-hidden="true" className="v2-activity-leading-swap" data-open={selected || undefined}>{icon}<ChevronRight className={cn('v2-activity-swap-chev size-3 transition-transform motion-reduce:transition-none', selected && 'rotate-90')} /></span>
      : <span aria-hidden="true" className="v2-activity-leading-icon">{icon}</span>)
    : (selectable ? chevron : null);
  if (!selectable) return <div data-ui-notice={textSelectable ? undefined : ''} className={cn('v2-activity-entry v2-activity-row min-h-6 min-w-0 py-0.5 text-muted-foreground', !hasLeadingIcon && 'v2-activity-row-plain', !textSelectable && 'select-none')}>
    {leading}
    {content}
    {actions ? <div className="v2-activity-actions flex shrink-0 items-center">{actions}</div> : null}
  </div>;
  return <Collapsible open={selected} className="v2-activity-entry min-w-0">
    <div className="flex min-w-0 items-center gap-1">
      <CollapsibleTrigger asChild><Button textSelectable={textSelectable} ref={disclosure.buttonRef} variant="plain" size="none" aria-controls={detailsId} onClick={disclosure.toggle}
        className={cn('v2-chat-disclosure v2-activity-row min-h-6 min-w-0 flex-1 rounded-md py-0.5 text-left text-muted-foreground hover:text-foreground', !textSelectable && 'select-none')}>
        {leading}
        {content}
      </Button></CollapsibleTrigger>
      {actions ? <div className="v2-activity-actions flex shrink-0 items-center pr-1">{actions}</div> : null}
    </div>
    <AnimatedCollapsibleContent id={detailsId} ref={disclosure.contentRef} open={selected} visible={disclosure.visible}>
      {disclosure.mounted ? <div className={cn(inline ? 'v2-activity-inline-detail' : 'v2-activity-detail', 'min-w-0 pb-1')}>{children}</div> : null}
    </AnimatedCollapsibleContent>
  </Collapsible>;
}
