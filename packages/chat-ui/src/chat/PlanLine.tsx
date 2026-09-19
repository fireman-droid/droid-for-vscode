import { Check, ChevronDown, Circle } from 'lucide-react';
export interface PlanStep { readonly text: string; readonly status: 'pending' | 'in_progress' | 'completed' }
export interface PlanPresentation { readonly id: string; readonly title: string; readonly steps: readonly PlanStep[]; readonly completedCount: number; readonly totalCount: number; readonly allCompleted: boolean }
import { Button } from '../ui/button';
import { useId } from 'react';
import { Collapsible, CollapsibleTrigger, AnimatedCollapsibleContent } from '../ui/collapsible';

export function PlanLine({ anchor, running, override, onToggle }: {
  readonly anchor: PlanPresentation;
  readonly running: boolean;
  readonly override: boolean | null;
  readonly onToggle: (id: string, expanded: boolean) => void;
}) {
  const id = useId();
  const expanded = override ?? (running && !anchor.allCompleted);
  const building = running && !anchor.allCompleted;
  const current = anchor.steps.find((step) => step.status === 'in_progress')?.text ?? anchor.steps.find((step) => step.status === 'pending')?.text ?? anchor.title;
  return <Collapsible open={expanded} onOpenChange={(open) => onToggle(anchor.id, open)} asChild><section aria-label={`Implementation plan, ${anchor.completedCount} of ${anchor.totalCount} done`} className="mt-1 overflow-hidden rounded-lg border border-border bg-input-background text-xs">
    <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="h-[22px] w-full gap-2 rounded-none px-3 text-left text-[11.5px]" aria-controls={id}>
      <span aria-hidden className={`size-[5px] shrink-0 rounded-full ${anchor.allCompleted ? 'bg-muted-foreground' : 'bg-primary'} ${building ? 'motion-safe:animate-pulse' : ''}`} />
      <span className="min-w-0 flex-1 truncate">{expanded ? 'Implementation plan' : `Plan · ${current}`}</span>
      <span className="shrink-0 text-muted-foreground">{anchor.completedCount} / {anchor.totalCount}</span>
      <ChevronDown className={`size-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </Button></CollapsibleTrigger>
    <div className="h-0.5 bg-muted"><div className={`h-full transition-[width] ${anchor.allCompleted ? 'bg-muted-foreground' : 'bg-primary'}`} style={{ width: `${anchor.totalCount === 0 ? 0 : anchor.completedCount / anchor.totalCount * 100}%` }} /></div>
    <AnimatedCollapsibleContent id={id} open={expanded}>
    <PlanSteps steps={anchor.steps} /></AnimatedCollapsibleContent>
  </section></Collapsible>;
}

export function PlanSteps({ steps }: { readonly steps: readonly PlanStep[] }) {
  return <ol className="max-h-[min(160px,25vh)] space-y-1.5 overflow-y-auto px-3 py-2">{steps.map((step, index) => <li key={index} className="flex items-start gap-2 text-[13px] leading-[18px]">
      {step.status === 'completed' ? <span className="mt-0.5 grid size-3 shrink-0 place-items-center rounded-full bg-muted-foreground/40"><Check className="size-2 text-background" /></span> : <Circle className={`mt-0.5 size-3 shrink-0 ${step.status === 'in_progress' ? 'fill-primary text-primary' : 'text-muted-foreground'}`} />}
      <span className={step.status === 'completed' ? 'text-muted-foreground' : undefined}>{step.text}</span>
    </li>)}</ol>;
}
