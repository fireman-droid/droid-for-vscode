import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
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
