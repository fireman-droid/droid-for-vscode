import { SessionHistoryWindow } from './SessionHistoryWindow';
import type { SessionHistoryLoader, SessionHistoryRequest, SessionHistoryResult } from './SessionHistory';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';

/** Explicit whole-history consumers (export/evidence) opt into walking all pages. */
export async function collectSessionHistory(
  loader: SessionHistoryLoader,
  request: SessionHistoryRequest,
): Promise<SessionHistoryResult> {
  const window = new SessionHistoryWindow(loader, request.cwd, [request.sessionId]);
  const initial = await loader.loadHistory(request);
  if (initial.status !== 'available' || !initial.page) return initial;
  const latest = await window.open(initial);
  let view = window.snapshot()!;
  let order: string[] = [];
  const byId = new Map<string, SessionTranscriptItem>();
  let truncated = false;
  for (;;) {
    const prefix: string[] = [];
    for (const item of view.items) {
      if (!byId.has(item.id)) prefix.push(item.id);
      byId.set(item.id, item);
    }
    order = [...prefix, ...order];
    truncated ||= view.truncated;
    if (!view.hasOlder) break;
    view = await window.navigate('older');
  }
  const messageIds = [...window.locations].reverse().flatMap(location =>
    (JSON.parse(location.identity) as unknown[]).filter((id): id is string => typeof id === 'string'));
  return { ...latest, page: undefined, messageIds, state: { transcript: order.map(id => byId.get(id)!),
    historyStatus: truncated ? 'partial' : 'complete', truncated } };
}
