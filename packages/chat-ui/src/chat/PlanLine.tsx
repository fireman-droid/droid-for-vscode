import { useI18n } from '../i18n';
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
  const { t } = useI18n();
  const id = useId();
  const expanded = override ?? false;
  const live = running && !anchor.allCompleted;
  const current = anchor.steps.find((step) => step.status === 'in_progress')?.text ?? anchor.steps.find((step) => step.status === 'pending')?.text ?? anchor.title;
  const completedTitle = anchor.totalCount === 1
    ? t("Completed 1 step")
    : t("Completed {count} steps", { count: anchor.totalCount });
  const title = anchor.allCompleted ? completedTitle : expanded ? t("Task plan") : current;
  const progress = `${anchor.completedCount} of ${anchor.totalCount} steps completed`;
  return <Collapsible open={expanded} onOpenChange={(open) => onToggle(anchor.id, open)} asChild>
    <section aria-label={t("Task plan, {p0}", { p0: progress })} data-transcript-quote-exclude="" className="dvx-plan" data-live={live} data-complete={anchor.allCompleted}>
      <CollapsibleTrigger asChild>
        <Button variant="plain" size="none" className="dvx-plan-trigger" aria-controls={id}
          aria-label={t("{p0} plan steps: {p1}. {p2}", { p0: expanded ? t("Hide") : t("Show"), p1: title, p2: progress })} title={title}>
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
  const { t } = useI18n();
  return <ol className="dvx-plan-steps" aria-label={t("Plan steps")} data-transcript-quote-exclude="">
    {steps.map((step, index) => <li key={`${index}:${step.text}`} className="dvx-plan-step" data-status={step.status}
      aria-current={step.status === 'in_progress' ? 'step' : undefined}>
      <span aria-hidden="true" className="dvx-plan-step-marker"><Circle /><Check /></span>
      <span className="sr-only">{step.status === 'completed' ? t("Completed:") : step.status === 'in_progress' ? t("In progress:") : t("Pending:")}</span>
      <span>{step.text}</span>
    </li>)}
  </ol>;
}
