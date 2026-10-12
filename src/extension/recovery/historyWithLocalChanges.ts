import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import type { OperationDiff } from '../../shared/protocol/operationDiff';
import { trimTranscriptToLimits } from '../../shared/transcript/transcriptLimits';
import { preserveSubagentSummaries } from '../../shared/transcript/preserveSubagentSummaries';
import type { ConversationRecoveryRecord, ConversationTurnRecord } from './conversationRecoveryState';
import type { HostTranscriptState } from './hostTranscriptState';

/** The SDK message id connects authoritative history to extension-owned turn snapshots. */
export function historyWithLocalChanges(
  history: HostTranscriptState,
  conversation: ConversationRecoveryRecord | undefined,
  currentTranscript: readonly SessionTranscriptItem[] = [],
): HostTranscriptState {
  const turns = new Map<string, ConversationTurnRecord>();
  for (const turn of conversation?.turns ?? []) {
    if (turn.messageId !== undefined && turn.changesSettled) turns.set(turn.messageId, turn);
  }
  const transcript: SessionTranscriptItem[] = [];
  let current: ConversationTurnRecord | undefined;
  const finish = () => {
    if (current !== undefined && current.files.length > 0) {
      transcript.push({
        kind: 'changes', id: `changes-${current.turnId}`,
        turnId: current.turnId, files: current.files,
      });
    }
  };
  // A live settlement can be newer than the debounced display checkpoint.
  // Loaded ledger fields remain authoritative; only absent fields are filled.
  const observed = preserveSubagentSummaries(history.transcript, currentTranscript);
  const restored = preserveSubagentSummaries(observed, conversation?.display.transcript.transcript ?? []);
  restoreTurnMessageIds(restored, conversation?.turns ?? [], turns);
  for (const item of restored) {
    if (item.kind === 'user') {
      finish();
      current = item.messageId === undefined ? undefined : turns.get(item.messageId);
      transcript.push(item);
    } else if (item.kind !== 'changes') {
      transcript.push(current === undefined ? item : { ...item, turnId: current.turnId });
    }
  }
  finish();
  const bounded = trimTranscriptToLimits(transcript);
  return {
    transcript: bounded.transcript,
    historyStatus: bounded.trimmed ? 'partial' : history.historyStatus,
    truncated: history.truncated || bounded.trimmed,
  };
}

/** Repair old reminder-bound records only when recorded calls identify one user turn. */
function restoreTurnMessageIds(
  transcript: readonly SessionTranscriptItem[],
  recordedTurns: readonly ConversationTurnRecord[],
  turns: Map<string, ConversationTurnRecord>,
): void {
  const visibleIds = new Set(transcript.flatMap(item =>
    item.kind === 'user' && item.messageId !== undefined ? [item.messageId] : []));
  const owners = new Map<string, ConversationTurnRecord | null>();
  for (const turn of recordedTurns) {
    if (!turn.changesSettled) continue;
    for (const operation of turn.toolOperations ?? []) {
      const key = operationIdentity(operation);
      if (key === undefined) continue;
      const previous = owners.get(key);
      owners.set(key, previous === undefined || previous?.turnId === turn.turnId ? turn : null);
    }
  }
  const candidates = new Map<string, Set<ConversationTurnRecord | null>>();
  let messageId: string | undefined;
  for (const item of transcript) {
    if (item.kind === 'user') {
      messageId = item.messageId;
    } else if (item.kind === 'tool' && messageId !== undefined && !turns.has(messageId)) {
      const key = operationIdentity(item);
      const owner = key === undefined ? undefined : owners.get(key);
      if (owner === undefined) continue;
      const matches = candidates.get(messageId) ?? new Set();
      matches.add(owner);
      candidates.set(messageId, matches);
    }
  }
  const claims = new Map<string, { messageId: string; turn: ConversationTurnRecord } | null>();
  for (const [id, matches] of candidates) {
    if (matches.size !== 1) continue;
    const turn = [...matches][0];
    if (turn == null || (turn.messageId !== undefined && visibleIds.has(turn.messageId))) continue;
    // A record spanning two actual user messages cannot establish either boundary.
    claims.set(turn.turnId, claims.has(turn.turnId) ? null : { messageId: id, turn });
  }
  for (const claim of claims.values()) {
    if (claim !== null) turns.set(claim.messageId, claim.turn);
  }
}

function operationIdentity(operation: { toolUseId: string; operationDiff?: OperationDiff }): string | undefined {
  const diff = operation.operationDiff;
  if (diff?.status !== 'ready' || diff.source !== 'tool-result' || diff.sourceSessionId === undefined) {
    return undefined;
  }
  return JSON.stringify([diff.sourceSessionId, diff.callId ?? operation.toolUseId]);
}
