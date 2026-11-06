import type { ConversationDisplaySnapshot } from '../../recovery/conversationRecoveryState';
import type { CurrentTurn } from '../internals';

/** Every checkpoint uses the same submission identity and display metadata. */
export function projectRecoveryTurn(
  turn: Pick<CurrentTurn, 'turnId' | 'backendTurnId' | 'status' | 'error'> | null,
): ConversationDisplaySnapshot['turn'] {
  return turn === null ? null : {
    turnId: turn.turnId,
    ...(turn.backendTurnId === undefined ? {} : { backendTurnId: turn.backendTurnId }),
    status: turn.status,
    ...(turn.error === undefined ? {} : { error: turn.error }),
  };
}
