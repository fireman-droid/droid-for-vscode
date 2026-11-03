import type { SessionTranscriptItem } from '../protocol/transcript';
import type { HistoryWindowState } from '../protocol/historyPaging';

function identity(item: SessionTranscriptItem): string {
  if (item.kind === 'user' && item.messageId) return `user:${item.messageId}`;
  if (item.kind === 'tool') return `tool:${item.toolUseId}`;
  return item.id;
}

/** Never append a live tail across evicted pages. The latest action reconnects it. */
export function historyWindowTranscript(
  history: HistoryWindowState | null | undefined,
  live: readonly SessionTranscriptItem[],
): readonly SessionTranscriptItem[] {
  if (!history) return live;
  if (history.hasNewer) return history.items;
  const livePositions = new Map(live.map((item, index) => [identity(item), index]));
  let lastOverlap = -1;
  const items = history.items.map(item => {
    const index = livePositions.get(identity(item));
    if (index === undefined) return item;
    lastOverlap = Math.max(lastOverlap, index);
    return live[index]!;
  });
  if (lastOverlap < 0) {
    if (history.tailAnchor) {
      const start = live.findIndex(item => item.kind === 'user' && item.messageId === history.tailAnchor);
      return start < 0 ? live : [...items, ...live.slice(start)];
    }
    // A refreshed latest page can be newer than the bounded recovery tail.
    // Only pending/running content belongs after its authoritative history.
    const latestHistoryTime = history.items.reduce((time, item) =>
      'timestamp' in item && typeof item.timestamp === 'number' ? Math.max(time, item.timestamp) : time, 0);
    const nextUser = live.findIndex(item => item.kind === 'user' &&
      (item.timestamp ?? 0) > latestHistoryTime);
    return nextUser < 0 ? (history.items.length ? history.items : live) : live;
  }
  const known = new Set(items.map(identity));
  return [...items, ...live.slice(lastOverlap + 1).filter(item => !known.has(identity(item)))];
}
