import type { HostTranscriptState } from '../../../shared/transcript/hostTranscriptState';
import type { SessionTranscriptItem } from '../../../shared/protocol/transcript';
import { preserveToolResultPreviews } from '../../../shared/transcript/toolResultPreview';
import { preserveSubagentSummaries } from '../../../shared/transcript/preserveSubagentSummaries';
import { trimTranscriptToLimits } from '../../../shared/transcript/transcriptLimits';
import type { TurnActivityState } from '../turns/turnActivityState';

/** Snapshot and notifications identify the same SDK messages, never by display text. */
export function reconcileChildHistory(
  loaded: HostTranscriptState,
  before: HostTranscriptState,
  live: HostTranscriptState,
  running: boolean,
): HostTranscriptState {
  const snapshot = preserveSubagentSummaries(
    preserveToolResultPreviews(loaded.transcript, live.transcript), live.transcript,
  );
  if (!running) return { ...loaded, transcript: snapshot };
  const beforeItems = indexed(before.transcript);
  const liveItems = indexed(live.transcript);
  const remaining = new Map(liveItems);
  const transcript = [...indexed(snapshot)].map(([key, saved]) => {
    const current = remaining.get(key);
    remaining.delete(key);
    if (current === undefined) return saved;
    if ((saved.kind === 'assistant' || saved.kind === 'thinking') &&
      current.kind === saved.kind && saved.text.startsWith(current.text)) {
      return { ...saved, id: current.id };
    }
    // No stream cursor exists in getMessages. Keep a concurrently changed row;
    // replaying its deltas over the snapshot could append the same text twice.
    return current !== beforeItems.get(key) ? current : { ...saved, id: current.id };
  });
  transcript.push(...remaining.values());
  const bounded = trimTranscriptToLimits(transcript);
  return {
    transcript: bounded.transcript,
    historyStatus: bounded.trimmed ? 'partial' : loaded.historyStatus,
    truncated: loaded.truncated || bounded.trimmed,
  };
}

function indexed(items: readonly SessionTranscriptItem[]): Map<string, SessionTranscriptItem> {
  const ordinals = new Map<string, number>();
  const result = new Map<string, SessionTranscriptItem>();
  for (const item of items) {
    let key: string;
    if (item.kind === 'user') key = `user:${item.messageId ?? item.id}`;
    else if (item.kind === 'tool') key = `tool:${item.toolUseId}`;
    else {
      const prefix = `${item.turnId}:${item.kind}`;
      const ordinal = ordinals.get(prefix) ?? 0;
      ordinals.set(prefix, ordinal + 1);
      key = `${prefix}:${ordinal}`;
    }
    result.set(key, item);
  }
  return result;
}

export function restoreChildTools(
  state: HostTranscriptState, turnId: string, activity: TurnActivityState,
): TurnActivityState {
  const tools = new Map(activity.tools);
  for (const item of state.transcript) {
    if (item.kind === 'tool' && item.turnId === turnId && !tools.has(item.toolUseId))
      tools.set(item.toolUseId, { ...item,
        // History uses stopped when no saved result exists. A live child event
        // is the authority that can continue this otherwise unknown operation.
        status: item.status === 'stopping' || item.status === 'stopped' ? 'running' : item.status });
  }
  return { ...activity, tools };
}
