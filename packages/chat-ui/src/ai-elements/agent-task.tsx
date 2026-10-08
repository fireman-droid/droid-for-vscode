import { Check, Circle, CircleAlert, LoaderCircle, RotateCw } from 'lucide-react';
import { Button } from '../ui/button';
import { SlidingText } from '../ui/sliding-text';

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
  const busy = tone === 'running' || feedback?.opening === true;
  const StatusIcon = busy ? LoaderCircle : tone === 'completed' ? Check
    : tone === 'failed' ? CircleAlert : Circle;
  return <div className="dvx-agent-task" data-variant={variant} data-tone={tone}>
    <Button variant="plain" size="none" className="dvx-agent-task-open"
      disabled={!onOpen} onClick={onOpen} aria-busy={feedback?.opening || undefined}>
      <span className="dvx-agent-task-icon" title={feedback?.opening ? feedback.text : statusLabel}>
        <StatusIcon aria-hidden="true" className={busy ? 'motion-safe:animate-spin' : undefined} />
      </span>
      <span className="dvx-agent-task-body">
        <span className="dvx-agent-task-heading">
          <span className="dvx-agent-task-title" title={title}>{title}</span>
          <span className="dvx-agent-task-role" title={role}>{role}<span className="sr-only"> subagent</span></span>
          <span className="dvx-agent-task-status">{statusLabel}</span>
        </span>
        <span className="dvx-agent-task-meta">
          {activity ? <SlidingText text={activity} className="dvx-agent-task-activity" /> : null}
          {elapsed !== undefined ? <span className="dvx-agent-task-elapsed">Elapsed {elapsed}</span> : null}
          {toolCount !== undefined ? <span>{toolCount} {toolCount === 1 ? 'tool' : 'tools'}</span> : null}
        </span>
      </span>
    </Button>
    {feedback && !feedback.opening ? <div className="dvx-agent-task-feedback" data-failed={feedback.failed || undefined}>
      <span role="status" className="dvx-agent-task-feedback-message">
        <CircleAlert aria-hidden="true" />
        <span>{feedback.text}</span>
      </span>
      {onOpen ? <Button variant="ghost" size="sm" className="dvx-agent-task-retry"
        onClick={onOpen} aria-label={`Retry opening ${title}`}><RotateCw aria-hidden="true" />Retry</Button> : null}
    </div> : null}
  </div>;
}
