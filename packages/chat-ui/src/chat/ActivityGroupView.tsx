import { useI18n } from '../i18n';
import { useId, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { ProcessGroupContext, ProcessLatestContext, useProcessDisclosure } from './processPresentation';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleTrigger, AnimatedCollapsibleContent } from '../ui/collapsible';
export interface ActivityPresentation { readonly running: boolean; readonly action: string; readonly facts: readonly string[]; readonly detailFacts?: readonly string[]; readonly failed: boolean; readonly waiting?: boolean; readonly count: number; readonly notice?: string }
export function ActivityGroupView({ messageId, groupId, presentation, children, attention, latest }: {
  readonly messageId: string; readonly groupId: string; readonly presentation: ActivityPresentation;
  readonly children: ReactNode; readonly attention?: ReactNode; readonly latest?: ReactNode;
}) {
  const { t } = useI18n();
  const disclosure = useProcessDisclosure(messageId, groupId);
  const id = useId();
  return <div className="v2-activity-group min-w-0">
    {presentation.count > 0 ? <Collapsible open={disclosure.expanded}>
    <CollapsibleTrigger asChild><Button ref={disclosure.buttonRef} variant="plain" size="none" aria-label={t('Process: {action}', { action: t('Execution history') })} aria-controls={id} onClick={disclosure.toggle} className="v2-chat-disclosure v2-activity-row min-h-6 w-full min-w-0 select-none py-0.5 text-left text-xs leading-[18px] text-muted-foreground hover:text-foreground">
      <ChevronRight className={`size-3 transition-transform motion-reduce:transition-none ${disclosure.expanded ? 'rotate-90' : ''}`} />
      <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
        <span>{t(disclosure.expanded ? 'Hide execution history' : 'Show execution history')}</span>
        <span className="text-[10.5px]">{t('{count} records', { count: presentation.count })}</span>
        {presentation.facts.length ? <span className={`text-[10.5px] ${presentation.failed ? 'text-destructive' : ''}`}>{presentation.facts.join(' · ')}</span> : null}
      </span>
    </Button></CollapsibleTrigger>
    {!disclosure.expanded ? attention : null}
    <AnimatedCollapsibleContent id={id} ref={disclosure.contentRef} open={disclosure.expanded} visible={disclosure.visible}
      className={`transition-[grid-template-rows,opacity] motion-reduce:transition-none ${disclosure.visible ? 'opacity-100' : 'opacity-0'}`}>
      {disclosure.mounted ? <div className="v2-activity-items min-w-0">
        <ProcessGroupContext.Provider value={true}>{children}</ProcessGroupContext.Provider>
        {presentation.detailFacts?.length ? <p className="py-1 text-[11px] text-muted-foreground">{presentation.detailFacts.join(' · ')}</p> : null}
      </div> : null}
    </AnimatedCollapsibleContent>
    </Collapsible> : null}
    {presentation.waiting ? <p role="status" className="py-0.5 text-xs text-muted-foreground">{t(presentation.action)}</p> : null}
    {presentation.notice ? <p role="status" className={`py-0.5 text-xs ${presentation.failed ? 'text-destructive' : 'text-muted-foreground'}`}>{presentation.notice}</p> : null}
    <ProcessGroupContext.Provider value={false}>
      <ProcessLatestContext.Provider value={true}>{latest}</ProcessLatestContext.Provider>
    </ProcessGroupContext.Provider>
  </div>;
}
