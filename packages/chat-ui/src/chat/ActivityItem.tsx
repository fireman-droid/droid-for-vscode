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
  status,
  description,
  actions,
  children,
  textSelectable = false,
}: {
  readonly id: string;
  readonly messageId: string;
  readonly icon: ReactNode;
  readonly title: string;
  readonly target?: string;
  readonly status?: string;
  readonly description?: string;
  readonly actions?: ReactNode;
  readonly children?: ReactNode;
  readonly textSelectable?: boolean;
}) {
  const disclosure = useProcessDisclosure(messageId, `activity:${id}`);
  const inline = useContext(ProcessGroupContext);
  const selectable = children !== undefined;
  const selected = disclosure.expanded;
  const detailsId = useId();
  const labels = <>
    <span className="max-w-[55%] shrink-0 truncate text-[13px]" title={title}>{title}</span>
    {target ? <span className="min-w-0 flex-1 truncate text-[13px] text-foreground" title={target}>{target}</span> : <span className="min-w-0 flex-1" />}
    {status ? <span className="shrink-0 text-[11px] text-muted-foreground">{status}</span> : null}
  </>;
  const content = description ? <span className="min-w-0 flex-1">
    <span className="flex min-w-0 items-center gap-1.5">{labels}</span>
    <span className="block truncate text-[11px] leading-[18px] text-muted-foreground" title={description}>{description}</span>
  </span> : <span className="flex min-w-0 items-center gap-1.5">{labels}</span>;
  const leadingIcon = <span className="grid size-3.5 place-items-center [&_svg]:size-3.5">{icon}</span>;
  if (inline) return <div className="min-w-0">
    <div className={cn('v2-activity-row v2-activity-row-flat min-h-6 min-w-0 py-0.5 text-muted-foreground', !textSelectable && 'select-none')}>
      {leadingIcon}{content}{actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
    </div>
    {children !== undefined ? <div className="v2-activity-inline-detail min-w-0 pb-1">{children}</div> : null}
  </div>;
  if (!selectable) return <div className={cn('v2-activity-row min-h-6 min-w-0 py-0.5 text-muted-foreground', !textSelectable && 'select-none')}>
    <span aria-hidden="true" />
    {leadingIcon}
    {content}
    {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
  </div>;
  return <Collapsible open={selected} className="min-w-0">
    <div className="flex min-w-0 items-center gap-1">
      <CollapsibleTrigger asChild><Button textSelectable={textSelectable} ref={disclosure.buttonRef} variant="plain" size="none" aria-controls={detailsId} onClick={disclosure.toggle}
        className={cn('v2-chat-disclosure v2-activity-row min-h-6 min-w-0 flex-1 rounded-md py-0.5 text-left text-muted-foreground hover:text-foreground', !textSelectable && 'select-none')}>
        <ChevronRight className={cn('size-3 transition-transform motion-reduce:transition-none', selected && 'rotate-90')} />
        {leadingIcon}
        {content}
      </Button></CollapsibleTrigger>
      {actions ? <div className="flex shrink-0 items-center pr-1">{actions}</div> : null}
    </div>
    <AnimatedCollapsibleContent id={detailsId} ref={disclosure.contentRef} open={selected} visible={disclosure.visible}>
      {disclosure.mounted ? <div className="v2-activity-detail min-w-0 pb-1">{children}</div> : null}
    </AnimatedCollapsibleContent>
  </Collapsible>;
}
