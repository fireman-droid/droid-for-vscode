import type { HostTranscriptState } from '../../recovery/hostTranscriptState';
import type { RecoveryPort } from './recoveryPort';

/** Persisted user message identity keeps an interrupted transport on the same UI turn. */
export function recoveredHistoryForCurrentTurn(
  ctl: Pick<RecoveryPort, 'turnState' | 'recoveryState'>,
  history: HostTranscriptState,
): HostTranscriptState {
  const turn = ctl.turnState.turn;
  if (!turn?.transportRecovery) return history;
  const messageId = turn.transportRecovery.messageId;
  let current = false;
  return { ...history, transcript: history.transcript.map((item) => {
    if (item.kind === 'user') {
      current = item.messageId === messageId;
      return item;
    }
    return current ? { ...item, turnId: turn.turnId } : item;
  }) };
}
