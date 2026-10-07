import { useId, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '../ui/button';
import { cn } from '../ui/cn';
import { AnimatedCollapsibleContent, Collapsible, CollapsibleTrigger } from '../ui/collapsible';
import { useProcessDisclosure } from './processPresentation';

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
  const selectable = children !== undefined;
  const selected = disclosure.expanded;
  const detailsId = useId();
  const labels = <>
    <span className="grid size-4 shrink-0 place-items-center [&_svg]:size-3.5">{icon}</span>
    <span className="max-w-[55%] shrink-0 truncate text-[13px]" title={title}>{title}</span>
    {target ? <span className="min-w-0 flex-1 truncate text-[13px] text-foreground" title={target}>{target}</span> : <span className="min-w-0 flex-1" />}
    {status ? <span className="shrink-0 text-[11px] text-muted-foreground">{status}</span> : null}
  </>;
  const content = description ? <span className="min-w-0 flex-1">
    <span className="flex min-w-0 items-center gap-1.5">{labels}</span>
    <span className="block truncate pl-[22px] text-[11px] leading-[18px] text-muted-foreground" title={description}>{description}</span>
  </span> : labels;
  if (!selectable) return <div className={cn('flex min-h-6 min-w-0 items-center gap-1.5 px-1.5 py-0.5 pl-6 text-muted-foreground', !textSelectable && 'select-none')}>
    {content}
    {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
  </div>;
  return <Collapsible open={selected} className="min-w-0">
    <div className="flex min-w-0 items-center gap-1">
      <CollapsibleTrigger asChild><Button textSelectable={textSelectable} ref={disclosure.buttonRef} variant="plain" size="none" aria-controls={detailsId} onClick={disclosure.toggle}
        className={cn('v2-chat-disclosure flex min-h-6 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left text-muted-foreground hover:text-foreground', !textSelectable && 'select-none')}>
        <ChevronRight className={cn('size-3 shrink-0 transition-transform motion-reduce:transition-none', selected && 'rotate-90')} />
        {content}
      </Button></CollapsibleTrigger>
      {actions ? <div className="flex shrink-0 items-center pr-1">{actions}</div> : null}
    </div>
    <AnimatedCollapsibleContent id={detailsId} ref={disclosure.contentRef} open={selected} visible={disclosure.visible}>
      {disclosure.mounted ? <div className="v2-activity-detail min-w-0 px-1.5 pb-1 pl-6">{children}</div> : null}
    </AnimatedCollapsibleContent>
  </Collapsible>;
}
