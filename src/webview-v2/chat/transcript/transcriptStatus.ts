import type { SessionTranscriptItem } from '../../../shared/protocol/transcript';
import type { TurnStatus } from '../../../shared/protocol/turns';

export type TranscriptStatus =
  | { readonly type: 'running' }
  | { readonly type: 'complete'; readonly reason: 'stop' }
  | { readonly type: 'incomplete'; readonly reason: 'cancelled' | 'error' };

export function resolveAssistantStatus(
  items: readonly SessionTranscriptItem[],
  turnId: string,
  turn: { readonly turnId: string; readonly status: TurnStatus } | null,
): TranscriptStatus {
  if (turn?.turnId === turnId) return mapTurnStatus(turn.status);
  if (items.some((item) => (item.kind === 'thinking' && item.status === 'active') || (item.kind === 'tool' && item.status === 'running'))) {
    return { type: 'running' };
  }
  if (items.some((item) => (item.kind === 'tool' && item.status === 'failed') || (item.kind === 'diagnostic' && item.severity === 'error'))) {
    return { type: 'incomplete', reason: 'error' };
  }
  const stopped = items.some((item) => (item.kind === 'thinking' || item.kind === 'tool') && (item.status === 'stopping' || item.status === 'stopped'));
  return stopped ? { type: 'incomplete', reason: 'cancelled' } : { type: 'complete', reason: 'stop' };
}

function mapTurnStatus(status: TurnStatus): TranscriptStatus {
  switch (status) {
    case 'submitting':
    case 'streaming': return { type: 'running' };
    case 'stopping':
    case 'interrupted': return { type: 'incomplete', reason: 'cancelled' };
    case 'failed': return { type: 'incomplete', reason: 'error' };
    case 'idle':
    case 'completed': return { type: 'complete', reason: 'stop' };
  }
}
