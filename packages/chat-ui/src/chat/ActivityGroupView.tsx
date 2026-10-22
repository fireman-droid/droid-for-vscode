import { useI18n } from '../i18n';
import { useId, type ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { ProcessGroupContext, ProcessLatestContext, useProcessDisclosure } from './processPresentation';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleTrigger, AnimatedCollapsibleContent } from '../ui/collapsible';
export interface ActivityPresentation {
  readonly running: boolean;
  readonly action: string;
  readonly summary?: string;
  readonly target?: string | null;
  readonly facts: readonly string[];
  readonly detailFacts?: readonly string[];
  readonly failed: boolean;
  readonly waiting?: boolean;
  readonly count: number;
  readonly notice?: string;
}
export function ActivityGroupView({ messageId, groupId, presentation, children, attention, latest }: {
  readonly messageId: string; readonly groupId: string; readonly presentation: ActivityPresentation;
  readonly children: ReactNode; readonly attention?: ReactNode; readonly latest?: ReactNode;
}) {
  const { t } = useI18n();
  const disclosure = useProcessDisclosure(messageId, groupId, false, false, { surface: 'history', records: presentation.count });
  const id = useId();
  const summaryText = presentation.summary || t('{count} records', { count: presentation.count });
  return <div className="v2-activity-group min-w-0">
    {presentation.count > 0 ? <Collapsible open={disclosure.expanded}>
    <CollapsibleTrigger asChild><Button ref={disclosure.buttonRef} variant="plain" size="none" aria-label={t('Process: {action}', { action: t('Execution history') })} aria-controls={id} onClick={disclosure.toggle} className="v2-explored-summary select-none">
      <span className="v2-explored-verb">{t('Explored')}</span>
      <span className="v2-explored-counts" title={summaryText}>{summaryText}</span>
      {presentation.facts.length ? <span className={`v2-explored-facts ${presentation.failed ? 'failed' : ''}`}>{presentation.facts.join(' · ')}</span> : null}
      <ChevronRight className="v2-explored-chev" />
    </Button></CollapsibleTrigger>
    {!disclosure.expanded ? attention : null}
    <AnimatedCollapsibleContent id={id} ref={disclosure.contentRef} open={disclosure.expanded} visible={disclosure.visible}
      className={`transition-[grid-template-rows,opacity] motion-reduce:transition-none ${disclosure.visible ? 'opacity-100' : 'opacity-0'}`}>
      {disclosure.mounted ? <div className="v2-activity-items min-w-0">
        <ProcessGroupContext.Provider value={true}>{children}</ProcessGroupContext.Provider>
        {presentation.detailFacts?.length ? <p data-ui-notice="" className="py-1 text-[11px] text-muted-foreground">{presentation.detailFacts.join(' · ')}</p> : null}
      </div> : null}
    </AnimatedCollapsibleContent>
    {presentation.running && !disclosure.expanded ? <Button variant="plain" size="none" aria-controls={id} aria-expanded={disclosure.expanded} onClick={disclosure.toggle} className="v2-running-latest select-none">
      <span className="v2-shimmer-text">{t(presentation.action)}</span>
      {presentation.target ? <span className="v2-shimmer-sub" title={presentation.target}>{presentation.target}</span> : null}
    </Button> : null}
    </Collapsible> : null}
    {presentation.waiting ? <p role="status" className="py-0.5 text-xs text-muted-foreground">{t(presentation.action)}</p> : null}
    {presentation.notice ? <p role="status" className={`py-0.5 text-xs ${presentation.failed ? 'text-destructive' : 'text-muted-foreground'}`}>{presentation.notice}</p> : null}
    {latest ? <ProcessGroupContext.Provider value={false}>
      <ProcessLatestContext.Provider value={true}>{latest}</ProcessLatestContext.Provider>
    </ProcessGroupContext.Provider> : null}
  </div>;
}
