import { memo, useEffect, useState } from 'react';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { useSubagentActivity } from './subagents/subagentPanelFlow';
import { presentSubagent } from './subagents/agentPresentation';
import { useToolActions } from '../content/toolActions';
import { AgentTask } from '@droidvisx/chat-ui/ai-elements/agent-task';

export const SubagentRow = memo(function SubagentRow({ item, variant = 'card' }: {
  readonly item: ToolTranscriptItem;
  readonly variant?: 'card' | 'row';
}) {
  const extras = useSubagentActivity(item.toolUseId);
  const actions = useToolActions();
  const { startedAt, ...task } = presentSubagent(item, extras,
    actions.openSubagent ? () => actions.openSubagent?.(item.turnId, item.toolUseId) : undefined, Date.now());
  const [, tick] = useState(0);
  useEffect(() => {
    if (startedAt === undefined) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  return <AgentTask {...task} variant={variant} />;
});
