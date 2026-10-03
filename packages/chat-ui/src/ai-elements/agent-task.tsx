import { Check, ChevronRight, Circle, CircleAlert, LoaderCircle, RotateCw, Users } from 'lucide-react';
import { Button } from '../ui/button';

export interface AgentTaskProps {
  readonly title: string;
  readonly role: string;
  readonly statusLabel: string;
  readonly tone: 'running' | 'completed' | 'failed' | 'idle';
  readonly variant?: 'card' | 'row';
  readonly elapsed?: string;
  readonly toolCount?: number;
  readonly activity?: string;
  readonly feedback?: { readonly text: string; readonly opening: boolean; readonly failed: boolean };
  readonly onOpen?: () => void;
}

/** Presentation only: session resolution and lifecycle stay with the caller. */
export function AgentTask({ title, role, statusLabel, tone, variant = 'card', elapsed,
  toolCount, activity, feedback, onOpen }: AgentTaskProps) {
  const StatusIcon = tone === 'running' ? LoaderCircle : tone === 'completed' ? Check
    : tone === 'failed' ? CircleAlert : Circle;
  return <div className="dvx-agent-task" data-variant={variant} data-tone={tone}>
    <Button variant="plain" size="none" className="dvx-agent-task-open"
      disabled={!onOpen} onClick={onOpen} aria-busy={feedback?.opening || undefined}>
      <span className="dvx-agent-task-icon"><Users aria-hidden="true" /></span>
      <span className="dvx-agent-task-body">
        <span className="dvx-agent-task-heading">
          <span className="dvx-agent-task-title" title={title}>{title}</span>
          <span className="dvx-agent-task-status">
            <StatusIcon aria-hidden="true" className={tone === 'running' ? 'motion-safe:animate-spin' : undefined} />
            <span>{statusLabel}</span>
          </span>
        </span>
        <span className="dvx-agent-task-meta">
          <span className="dvx-agent-task-role">{role}<span className="sr-only"> subagent</span></span>
          {elapsed !== undefined ? <span className="dvx-agent-task-elapsed">Elapsed {elapsed}</span> : null}
          {toolCount !== undefined ? <span>{toolCount} {toolCount === 1 ? 'tool' : 'tools'}</span> : null}
        </span>
        {activity ? <span className="dvx-agent-task-activity" title={activity}>{activity}</span> : null}
      </span>
      <ChevronRight aria-hidden="true" className="dvx-agent-task-chevron" />
    </Button>
    {feedback ? <div className="dvx-agent-task-feedback" data-failed={feedback.failed || undefined}>
      <span role="status" className="dvx-agent-task-feedback-message">
        {feedback.opening ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" /> : <CircleAlert aria-hidden="true" />}
        <span>{feedback.text}</span>
      </span>
      {!feedback.opening && onOpen ? <Button variant="ghost" size="sm" className="dvx-agent-task-retry"
        onClick={onOpen} aria-label={`Retry opening ${title}`}><RotateCw aria-hidden="true" />Retry</Button> : null}
    </div> : null}
  </div>;
}
