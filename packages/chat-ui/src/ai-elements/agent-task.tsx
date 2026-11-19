import { useI18n } from '../i18n';
import { Check, ChevronRight, CircleAlert, LoaderCircle, SquareTerminal } from 'lucide-react';
import { Button } from '../ui/button';
import { SlidingText } from '../ui/sliding-text';

function formatRoleLabel(role: string): string {
  const trimmed = role.trim();
  if (!trimmed) return '';
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

export interface AgentTaskProps {
  readonly title: string;
  readonly role: string;
  readonly statusLabel: string;
  readonly tone: 'running' | 'completed' | 'failed' | 'idle';
  readonly variant?: 'card' | 'row';
  readonly elapsed?: string;
  readonly toolCount?: number;
  readonly activity?: string;
  readonly activityTitle?: string;
  readonly feedback?: { readonly text: string; readonly opening: boolean; readonly failed: boolean };
  readonly onOpen?: () => void;
}

/** Presentation only: session resolution and lifecycle stay with the caller. */
export function AgentTask({ title, role, statusLabel, tone, variant = 'card', elapsed,
  toolCount, activity, activityTitle, feedback, onOpen }: AgentTaskProps) {
  const { t } = useI18n();
  const busy = tone === 'running' || feedback?.opening === true;
  const roleLabel = formatRoleLabel(role);
  const icon = busy ? <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
    : tone === 'completed' ? <Check aria-hidden="true" className="dvx-agent-check" />
      : tone === 'failed' ? <CircleAlert aria-hidden="true" />
        : <SquareTerminal aria-hidden="true" />;
  const statusText = feedback?.opening ? feedback.text : statusLabel;
  return <div className="dvx-agent-task" data-variant={variant} data-tone={tone}>
    <Button variant="plain" size="none" className="dvx-agent-task-open"
      disabled={!onOpen} onClick={onOpen} aria-busy={feedback?.opening || undefined}>
      <span className="dvx-agent-task-icon" title={feedback?.opening ? feedback.text : t(statusLabel)}>
        {icon}
      </span>
      <span className="dvx-agent-task-body">
        <span className="dvx-agent-task-heading">
          <span className="dvx-agent-task-title" title={title}>{title}</span>
          {roleLabel ? <span data-ui-notice="" className="dvx-agent-task-role" title={roleLabel}>{roleLabel}<span className="sr-only"> {t("subagent")}</span></span> : null}
          <span data-ui-notice="" className="dvx-agent-task-trailing">
            {elapsed !== undefined ? <span className="dvx-agent-task-elapsed">{elapsed}</span>
              : tone === 'running' && onOpen ? <span className="dvx-agent-task-hint">{t("Click to see progress")}</span> : null}
            {onOpen ? <ChevronRight aria-hidden="true" className="dvx-agent-task-chevron" /> : null}
          </span>
        </span>
        <span data-ui-notice="" className="dvx-agent-task-meta">
          <span className="dvx-agent-task-status">{t(statusText)}</span>
          {activity ? <><span aria-hidden="true" className="dvx-agent-task-sep">·</span><SlidingText text={activity} title={activityTitle} className="dvx-agent-task-activity" /></> : null}
          {toolCount !== undefined ? <span className="dvx-agent-task-tools">{toolCount} {toolCount === 1 ? t("tool") : t("tools")}</span> : null}
        </span>
      </span>
    </Button>
    {feedback && !feedback.opening ? <div className="dvx-agent-task-feedback" data-failed={feedback.failed || undefined}>
      <span data-ui-notice="" role="status" className="dvx-agent-task-feedback-message">
        <CircleAlert aria-hidden="true" />
        <span>{t(feedback.text)}</span>
      </span>
      {onOpen ? <Button variant="ghost" size="sm" className="dvx-agent-task-retry"
        onClick={onOpen} aria-label={t("Retry opening {p0}", { p0: title })}><SquareTerminal aria-hidden="true" />{t("Retry")}</Button> : null}
    </div> : null}
  </div>;
}
