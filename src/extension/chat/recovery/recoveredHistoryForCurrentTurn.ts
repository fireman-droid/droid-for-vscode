import type { HostTranscriptState } from '../../recovery/hostTranscriptState';
import type { RecoveryPort } from './recoveryPort';
import type { HistoryMessageAncestry } from '../../../runtime/history/SessionHistory';

/** Visible user anchors or hidden-request ancestry retain the original UI turn. */
export function recoveredHistoryForCurrentTurn(
  ctl: Pick<RecoveryPort, 'turnState'>,
  history: HostTranscriptState,
  messageAncestry?: readonly HistoryMessageAncestry[],
): HostTranscriptState {
  const turn = ctl.turnState.turn;
  if (!turn?.transportRecovery) return history;
  const messageId = turn.transportRecovery.messageId;
  if (!history.transcript.some(item => item.kind === 'user' && item.messageId === messageId) &&
      messageAncestry?.some(message => message.messageId === messageId)) {
    const owned = descendantTurns(messageAncestry, messageId);
    return { ...history, transcript: history.transcript.map(item =>
      item.kind !== 'user' && item.turnId !== null && owned.has(item.turnId) ? { ...item, turnId: turn.turnId } : item) };
  }
  let current = false;
  return { ...history, transcript: history.transcript.map((item) => {
    if (item.kind === 'user') {
      current = item.messageId === messageId;
      return item;
    }
    return current ? { ...item, turnId: turn.turnId } : item;
  }) };
}

/** Only the latest persisted message can supply newly pending calls. Older
 * unmatched calls may really have been interrupted; never revive them. */
export function restorePendingTools(
  history: HostTranscriptState,
  ancestry: readonly HistoryMessageAncestry[] | undefined,
): HostTranscriptState {
  const latest = ancestry?.at(-1);
  if (latest === undefined || latest.startsTurn) return history;
  return { ...history, transcript: history.transcript.map(item =>
    item.kind === 'tool' && item.turnId === latest.projectedTurnId && item.status === 'stopped'
      ? { ...item, status: 'running' } : item) };
}

/** New user/system request boundaries cannot inherit ownership from an earlier turn. */
function descendantTurns(ancestry: readonly HistoryMessageAncestry[], root: string): Set<string> {
  const messages = new Map(ancestry.map(message => [message.messageId, message]));
  const owned = new Map<string, boolean>([[root, true]]);
  const turns = new Set<string>();
  for (const message of ancestry) {
    const path = new Set<string>();
    let current: string | null = message.messageId;
    while (current !== null && !owned.has(current) && !path.has(current)) {
      path.add(current);
      const parent = messages.get(current);
      if (parent === undefined || parent.startsTurn) { current = null; break; }
      current = parent.parentId;
    }
    const belongs = current !== null && owned.get(current) === true;
    for (const id of path) owned.set(id, belongs);
    if (belongs) turns.add(message.projectedTurnId);
  }
  return turns;
}
