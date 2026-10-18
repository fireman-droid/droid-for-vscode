import { useI18n } from '../i18n';
import { useId, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { ProcessGroupContext, useProcessDisclosure } from './processPresentation';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleTrigger, AnimatedCollapsibleContent } from '../ui/collapsible';
import { SlidingText } from '../ui/sliding-text';
export interface ActivityPresentation { readonly running: boolean; readonly action: string; readonly summary?: string; readonly target?: string | null; readonly facts: readonly string[]; readonly detailFacts?: readonly string[]; readonly failed: boolean; readonly waiting?: boolean; readonly latest?: { readonly label: string; readonly status: string }; readonly count?: number }
export function ActivityGroupView({ messageId, groupId, presentation, children, attention }: {
  readonly messageId: string; readonly groupId: string; readonly presentation: ActivityPresentation;
  readonly incomplete?: string | null; readonly children: ReactNode;
  readonly attention?: ReactNode;
}) {
  const { t } = useI18n();
  const disclosure = useProcessDisclosure(messageId, groupId);
  const summary = presentation.latest?.label ?? [t(presentation.action), presentation.target].filter(Boolean).join(' ');
  const facts = [...(disclosure.expanded ? [t('{count} records', { count: presentation.count ?? 0 })]
    : presentation.latest?.status ? [presentation.latest.status] : []),
    ...(disclosure.expanded && presentation.waiting ? [t(presentation.action)] : []), ...presentation.facts];
  const id = useId();
  return <Collapsible open={disclosure.expanded} className="v2-activity-group">
    <CollapsibleTrigger asChild><Button ref={disclosure.buttonRef} variant="plain" size="none" aria-label={t('Process: {action}', { action: summary })} aria-controls={id} onClick={disclosure.toggle} className="v2-chat-disclosure v2-activity-row v2-activity-row-compact min-h-6 w-full min-w-0 select-none py-0.5 text-left text-xs leading-[18px] text-muted-foreground hover:text-foreground">
      <ChevronRight className={`size-3 transition-transform motion-reduce:transition-none ${disclosure.expanded ? 'rotate-90' : ''}`} />
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <SlidingText text={disclosure.expanded ? t('Execution history') : summary} />
        {facts.length ? <span className={`ml-auto shrink-0 text-[10.5px] ${presentation.failed ? 'text-destructive' : ''}`}>{facts.join(' · ')}</span> : null}
      </span>
    </Button></CollapsibleTrigger>
    {!disclosure.expanded ? attention : null}
    <AnimatedCollapsibleContent id={id} ref={disclosure.contentRef} open={disclosure.expanded} visible={disclosure.visible}
      className={`transition-[grid-template-rows,opacity] motion-reduce:transition-none ${disclosure.visible ? 'opacity-100' : 'opacity-0'}`}>
      {disclosure.mounted ? <div className="v2-activity-items min-w-0">
        <ProcessGroupContext.Provider value={true}>{children}</ProcessGroupContext.Provider>
        {presentation.detailFacts?.length ? <p className="v2-activity-detail py-1 text-[11px] text-muted-foreground">{presentation.detailFacts.join(' · ')}</p> : null}
      </div> : null}
    </AnimatedCollapsibleContent>
  </Collapsible>;
}
