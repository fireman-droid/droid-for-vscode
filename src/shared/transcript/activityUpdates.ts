import type { SessionTranscriptItem } from '../protocol/transcript';

export type PendingActivityOutcome = 'stopping' | 'stopped' | 'completed';

/** Only pending activity changes; completed tool results remain authoritative. */
export function updatePendingActivity(
  item: SessionTranscriptItem,
  turnId: string,
  outcome: PendingActivityOutcome,
): SessionTranscriptItem {
  if ((item.kind !== 'thinking' && item.kind !== 'tool') || item.turnId !== turnId)
    return item;
  if (
    item.kind === 'thinking' &&
    (item.status === 'active' || item.status === 'stopping')
  ) {
    const status = outcome === 'completed' ? 'complete' : outcome;
    return item.status === status ? item : { ...item, status };
  }
  if (item.kind === 'tool' && (item.status === 'running' || item.status === 'stopping')) {
    return item.status === outcome ? item : { ...item, status: outcome };
  }
  return item;
}

export function hasTrailingDiagnostic(
  transcript: readonly SessionTranscriptItem[],
  next: {
    readonly turnId: string | null;
    readonly severity: string;
    readonly code: string;
    readonly message: string;
  },
): boolean {
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item?.kind !== 'diagnostic') return false;
    if (
      item.turnId === next.turnId &&
      item.severity === next.severity &&
      item.code === next.code &&
      item.message === next.message
    )
      return true;
  }
  return false;
}
