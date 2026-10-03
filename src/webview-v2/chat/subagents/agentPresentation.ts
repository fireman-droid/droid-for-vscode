import type { AgentTaskProps } from '@droidvisx/chat-ui/ai-elements/agent-task';
import type { AgentChatEntry, AgentChatStatus } from '../../../shared/protocol/agentChatProtocol';
import type { ToolTranscriptItem } from '../../../shared/protocol/toolProtocol';
import type { SubagentStatus } from '../../../shared/protocol/transcript';
import type { SubagentRowExtras } from './subagentPanelFlow';
import { formatElapsed } from './subagentWorking';
import { formatDuration } from '../thread/readers';

type AgentDisplayStatus = AgentChatStatus | SubagentStatus;
type AgentPresentation = Pick<AgentTaskProps, 'title' | 'role' | 'statusLabel' | 'tone' | 'onOpen'>;

const STATUS_LABELS: Readonly<Record<AgentDisplayStatus, string>> = {
  pending: 'Pending', running: 'Running', paused: 'Paused', completed: 'Completed',
  failed: 'Failed', cancelled: 'Stopped', unknown: 'Status unavailable',
};

function statusPresentation(status: AgentDisplayStatus, background = false): Pick<AgentPresentation, 'statusLabel' | 'tone'> {
  return {
    statusLabel: background ? 'Running in background' : STATUS_LABELS[status],
    tone: status === 'running' || status === 'completed' || status === 'failed' ? status : 'idle',
  };
}

/** Navigation owns the full family and Host-authorized stop actions, not tool activity. */
export function presentNavigationAgent(entry: AgentChatEntry, currentKey: string | null, actions: {
  readonly open: () => void;
  readonly stop: () => void;
}): AgentPresentation & {
  readonly selected: boolean;
  readonly stopPending: boolean;
  readonly onStop?: () => void;
} {
  const selected = entry.key === currentKey;
  return {
    title: entry.title,
    role: entry.role,
    ...statusPresentation(entry.status),
    selected,
    onOpen: selected ? undefined : actions.open,
    stopPending: entry.stopPending === true,
    onStop: entry.canStop || entry.stopPending ? actions.stop : undefined,
  };
}

/** Tool cards retain their recorded timing and link feedback; they cannot infer stop authority. */
export function presentSubagent(item: ToolTranscriptItem, extras: SubagentRowExtras | undefined,
  onOpen: (() => void) | undefined, now: number): AgentTaskProps & { readonly startedAt: number | undefined } {
  const subagent = item.subagent!;
  const status = subagent.status ?? (item.status === 'running' ? 'running' : 'unknown');
  const background = status === 'running' && (item.status === 'completed' || item.status === 'failed');
  const startedAt = status === 'running' ? subagent.startedAt : undefined;
  const elapsed = startedAt !== undefined ? formatElapsed(now - startedAt)
    : subagent.durationMs !== undefined ? formatDuration(subagent.durationMs) : undefined;
  const opening = extras?.openStatus === 'opening';
  const feedback = opening ? 'Opening agent chat…' : extras?.openStatus === 'unavailable'
    ? 'Agent chat is not linked yet.' : extras?.openStatus === 'failed' ? 'Could not open agent chat.' : undefined;
  const latestActivity = extras?.activities[0];
  const activity = latestActivity ? [latestActivity.action, latestActivity.target].filter(Boolean).join(' · ')
    : feedback ? undefined : (subagent.toolUseCount ?? 0) > 0
      ? 'Open to view activity' : status === 'running' ? 'Waiting for activity…' : undefined;
  return {
    title: subagent.description || `${subagent.type} subagent`,
    role: subagent.type,
    ...statusPresentation(status, background),
    onOpen,
    startedAt,
    elapsed,
    toolCount: subagent.toolUseCount,
    activity,
    feedback: feedback ? { text: feedback, opening, failed: extras?.openStatus === 'failed' } : undefined,
  };
}
