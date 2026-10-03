import { memo, useEffect, useState } from 'react';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { useSubagentActivity } from './subagents/subagentPanelFlow';
import { formatElapsed } from './subagents/subagentWorking';
import { formatDuration } from './thread/readers';
import { useToolActions } from '../content/toolActions';
import { AgentTask } from '@droidvisx/chat-ui/ai-elements/agent-task';

export const SubagentRow = memo(function SubagentRow({ item, variant = 'card' }: {
  readonly item: ToolTranscriptItem;
  readonly variant?: 'card' | 'row';
}) {
  const extras = useSubagentActivity(item.toolUseId);
  const actions = useToolActions();
  const subagent = item.subagent!;
  const status = subagent.status ?? (item.status === 'running' ? 'running' : undefined);
  const background = status === 'running' && (item.status === 'completed' || item.status === 'failed');
  const label = background ? 'Running in background' : status === undefined ? 'Status unavailable' : status.charAt(0).toUpperCase() + status.slice(1);
  const liveStartedAt = status === 'running' ? subagent.startedAt : undefined;
  const [, tick] = useState(0);
  useEffect(() => {
    if (liveStartedAt === undefined) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [liveStartedAt]);
  const elapsed = liveStartedAt !== undefined ? formatElapsed(Date.now() - liveStartedAt)
    : subagent.durationMs !== undefined ? formatDuration(subagent.durationMs) : undefined;
  const task = subagent.description || `${subagent.type} subagent`;
  const latestActivity = extras?.activities[0];
  const opening = extras?.openStatus === 'opening';
  const openFeedback = opening ? 'Opening agent chat…' : extras?.openStatus === 'unavailable'
    ? 'Agent chat is not linked yet.' : extras?.openStatus === 'failed'
      ? 'Could not open agent chat.' : undefined;
  const activity = latestActivity ? [latestActivity.action, latestActivity.target].filter(Boolean).join(' · ')
    : openFeedback ? undefined : (subagent.toolUseCount ?? 0) > 0
      ? 'Open to view activity' : status === 'running' ? 'Waiting for activity…' : undefined;
  return <AgentTask title={task} role={subagent.type} statusLabel={label}
    tone={status === 'running' || status === 'completed' || status === 'failed' ? status : 'idle'}
    variant={variant} elapsed={elapsed} toolCount={subagent.toolUseCount} activity={activity}
    feedback={openFeedback ? { text: openFeedback, opening, failed: extras?.openStatus === 'failed' } : undefined}
    onOpen={actions.openSubagent ? () => actions.openSubagent?.(item.turnId, item.toolUseId) : undefined} />;
});
