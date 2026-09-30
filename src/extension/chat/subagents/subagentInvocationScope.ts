import type { SessionTranscriptItem } from '../../../shared/protocol/transcript';
import type { HostTranscriptState } from '../../../shared/transcript/hostTranscriptState';
import type {
  ParentSubagentEvidence,
  SubagentEvidenceNotice,
  SubagentOperationEvidence,
  SubagentParentRow,
  SubagentViewerSnapshot,
} from './SubagentTranscriptService';

export interface SubagentInvocation extends SubagentParentRow {
  lifecycle: SubagentViewerSnapshot['lifecycle'];
  promptMessageId?: string;
}

export interface InvocationTranscript {
  readonly childSessionId: string;
  readonly rows: ReadonlyMap<string, SubagentInvocation>;
  readonly state: HostTranscriptState;
  readonly historyPhase: 'loading' | 'ready' | 'unavailable';
}

/** Ledger prompt ids delimit invocations within a continued child session. */
export function invocationTranscripts(
  entry: InvocationTranscript,
): ReadonlyMap<string, readonly SessionTranscriptItem[] | null> {
  const items = entry.state.transcript;
  const rows = [...entry.rows.entries()];
  if (rows.length === 1 && rows[0]![1].promptMessageId === undefined) return new Map([[rows[0]![0], items]]);
  const messages = new Map<string, number>();
  items.forEach((item, index) => {
    if (item.kind === 'user' && item.messageId !== undefined && !messages.has(item.messageId)) messages.set(item.messageId, index);
  });
  const boundaries = rows.map(([key, row]) => ({ key,
    start: row.promptMessageId === undefined ? undefined : messages.get(row.promptMessageId) }));
  // Missing or conflicting boundaries must never assign another invocation's tail.
  if (boundaries.some(boundary => boundary.start === undefined) ||
    new Set(boundaries.map(boundary => boundary.start)).size !== boundaries.length)
    return new Map(rows.map(([key]) => [key, null]));
  boundaries.sort((left, right) => left.start! - right.start!);
  return new Map(boundaries.map((boundary, index) =>
    [boundary.key, items.slice(boundary.start!, boundaries[index + 1]?.start)]));
}

export function readInvocationEvidence(
  entries: Iterable<InvocationTranscript>,
  evidenceRows: ReadonlySet<string>,
  issues: ReadonlyMap<string, SubagentEvidenceNotice>,
  parentSessionId: string,
  turnId?: string,
): ParentSubagentEvidence {
  const operations: SubagentOperationEvidence[] = [];
  const notices = [...issues.entries()]
    .filter(([key, notice]) => key.startsWith(`${parentSessionId}\u0000`) &&
      (turnId === undefined || notice.turnId === turnId))
    .map(([, notice]) => notice);
  const dedupe = new Set<string>();
  for (const entry of entries) {
    const transcripts = invocationTranscripts(entry);
    for (const row of entry.rows.values()) {
      if (row.parentSessionId !== parentSessionId || turnId !== undefined && row.turnId !== turnId) continue;
      const key = invocationRowKey(parentSessionId, row.toolUseId);
      const notice = (reason: SubagentEvidenceNotice['reason'], message: string): void => {
        notices.push({ turnId: row.turnId, toolUseId: row.toolUseId, reason, message });
      };
      if (!evidenceRows.has(key) || issues.get(key)?.reason === 'mapping-ambiguous') {
        notice('mapping-ambiguous', 'Child history is matched only by description. Its parent operation cannot be confirmed.');
        continue;
      }
      if (entry.historyPhase === 'loading') notice('pending', 'Child operation evidence is still loading.');
      else if (entry.historyPhase === 'unavailable') notice('history-unavailable', 'The mapped child transcript is unavailable.');
      else if (entry.state.historyStatus === 'partial' || entry.state.truncated)
        notice('history-partial', 'The mapped child transcript is partial; operation coverage may be incomplete.');
      const items = transcripts.get(key) ?? null;
      if (items === null) {
        if (entry.historyPhase === 'ready') notice('history-partial',
          'The invocation boundary is unavailable in this continued child session. Its operations cannot be assigned to this Task.');
        continue;
      }
      for (const item of items) {
        if (item.kind !== 'tool' || item.operationDiff === undefined) continue;
        const diff = item.operationDiff.status === 'ready'
          ? { ...item.operationDiff, sourceSessionId: entry.childSessionId } : item.operationDiff;
        const identity = `${entry.childSessionId}\u0000${diff.status === 'ready' ? diff.callId ?? item.toolUseId : item.toolUseId}`;
        if (dedupe.has(identity)) continue;
        dedupe.add(identity);
        operations.push({ sequence: operations.length, parentToolUseId: row.toolUseId,
          childSessionId: entry.childSessionId, toolUseId: item.toolUseId, toolName: item.toolName,
          operationDiff: diff, ...(item.executionPhase === undefined ? {} : { executionPhase: item.executionPhase }) });
      }
    }
  }
  const seen = new Set<string>();
  return { operations, notices: notices.filter(notice => {
    const key = `${notice.turnId}\u0000${notice.toolUseId}\u0000${notice.reason}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }) };
}

export function invocationRowKey(parentSessionId: string, toolUseId: string): string {
  return `${parentSessionId}\u0000${toolUseId}`;
}

export function invocationRunning(lifecycle: SubagentViewerSnapshot['lifecycle']): boolean {
  return lifecycle === 'starting' || lifecycle === 'working';
}
