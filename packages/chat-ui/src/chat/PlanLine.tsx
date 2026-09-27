import { Check, ChevronDown, Circle } from 'lucide-react';
import { useId } from 'react';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleTrigger, AnimatedCollapsibleContent } from '../ui/collapsible';

export interface PlanStep { readonly text: string; readonly status: 'pending' | 'in_progress' | 'completed' }
export interface PlanPresentation { readonly id: string; readonly title: string; readonly steps: readonly PlanStep[]; readonly completedCount: number; readonly totalCount: number; readonly allCompleted: boolean }

export function PlanLine({ anchor, running, override, onToggle }: {
  readonly anchor: PlanPresentation;
  readonly running: boolean;
  readonly override: boolean | null;
  readonly onToggle: (id: string, expanded: boolean) => void;
}) {
  const id = useId();
  const expanded = override ?? false;
  const live = running && !anchor.allCompleted;
  const current = anchor.steps.find((step) => step.status === 'in_progress')?.text ?? anchor.steps.find((step) => step.status === 'pending')?.text ?? anchor.title;
  const title = anchor.allCompleted ? `Completed ${anchor.totalCount} ${anchor.totalCount === 1 ? 'step' : 'steps'}` : current;
  const progress = `${anchor.completedCount} of ${anchor.totalCount} steps completed`;
  return <Collapsible open={expanded} onOpenChange={(open) => onToggle(anchor.id, open)} asChild>
    <section aria-label={`Task plan, ${progress}`} className="dvx-plan" data-live={live} data-complete={anchor.allCompleted}>
      <CollapsibleTrigger asChild>
        <Button variant="plain" size="none" className="dvx-plan-trigger" aria-controls={id}
          aria-label={`${expanded ? 'Hide' : 'Show'} plan steps: ${title}. ${progress}`} title={title}>
          <span aria-hidden="true" className="dvx-plan-marker"><Check /></span>
          <span className="dvx-plan-title"><span key={title} className="dvx-plan-title-text">{title}</span></span>
          <span className="dvx-plan-count" aria-hidden="true">{anchor.completedCount} / {anchor.totalCount}</span>
          <ChevronDown aria-hidden="true" className="dvx-plan-chevron" />
        </Button>
      </CollapsibleTrigger>
      <AnimatedCollapsibleContent id={id} open={expanded} className="dvx-plan-details">
        <PlanSteps steps={anchor.steps} />
      </AnimatedCollapsibleContent>
    </section>
  </Collapsible>;
}

export function PlanSteps({ steps }: { readonly steps: readonly PlanStep[] }) {
  return <ol className="dvx-plan-steps" aria-label="Plan steps">
    {steps.map((step, index) => <li key={`${index}:${step.text}`} className="dvx-plan-step" data-status={step.status}
      aria-current={step.status === 'in_progress' ? 'step' : undefined}>
      <span aria-hidden="true" className="dvx-plan-step-marker"><Circle /><Check /></span>
      <span className="sr-only">{step.status === 'completed' ? 'Completed: ' : step.status === 'in_progress' ? 'In progress: ' : 'Pending: '}</span>
      <span>{step.text}</span>
    </li>)}
  </ol>;
}
