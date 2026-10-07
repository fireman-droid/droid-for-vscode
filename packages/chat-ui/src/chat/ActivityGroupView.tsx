import { useId, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { useProcessDisclosure } from './processPresentation';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleTrigger, AnimatedCollapsibleContent } from '../ui/collapsible';
export interface ActivityPresentation { readonly running: boolean; readonly action: string; readonly summary?: string; readonly target?: string | null; readonly facts: readonly string[]; readonly failed: boolean }
export function ActivityGroupView({ messageId, groupId, presentation, children }: {
  readonly messageId: string; readonly groupId: string; readonly presentation: ActivityPresentation;
  readonly incomplete?: string | null; readonly children: ReactNode;
}) {
  const disclosure = useProcessDisclosure(messageId, groupId);
  const waiting = presentation.action.startsWith('Waiting');
  const action = disclosure.expanded && !waiting ? presentation.summary : presentation.action;
  const target = !disclosure.expanded ? presentation.target : null;
  const id = useId();
  return <Collapsible open={disclosure.expanded} className="v2-activity-group">
    <CollapsibleTrigger asChild><Button ref={disclosure.buttonRef} variant="plain" size="none" aria-controls={id} onClick={disclosure.toggle} className="v2-chat-disclosure flex min-h-6 w-full min-w-0 select-none items-center gap-1.5 py-0.5 text-left text-[13px] leading-[18px] text-muted-foreground hover:text-foreground">
      <ChevronRight className={`size-3 shrink-0 transition-transform motion-reduce:transition-none ${disclosure.expanded ? 'rotate-90' : ''}`} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <span className="shrink-0">Activity</span>
        {action ? <><span aria-hidden="true">·</span><span className="truncate" title={action}>{action}</span></> : null}
        {target ? <span className="truncate" title={target}>{target}</span> : null}
      </span>
      {presentation.facts.length ? <span className={`shrink-0 text-[10.5px] ${presentation.failed ? 'text-destructive' : ''}`}>{presentation.facts.join(' · ')}</span> : null}
    </Button></CollapsibleTrigger>
    <AnimatedCollapsibleContent id={id} ref={disclosure.contentRef} open={disclosure.expanded} visible={disclosure.visible}
      className={`transition-[grid-template-rows,opacity] motion-reduce:transition-none ${disclosure.visible ? 'opacity-100' : 'opacity-0'}`}>
      {disclosure.mounted ? <div className="v2-activity-items min-w-0">{children}</div> : null}
    </AnimatedCollapsibleContent>
  </Collapsible>;
}
