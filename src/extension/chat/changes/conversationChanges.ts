import type { ConversationTurnRecord } from '../../recovery/conversationRecoveryState';
import type { ConversationChangesPort } from './conversationChangesPort';

export function readConversationTurnChanges(
  ctl: ConversationChangesPort,
  turnId: string,
): ConversationTurnRecord | undefined {
  if (ctl.sessionState.conversationId === null) {
    return undefined;
  }
  const turn = ctl.recoveryStore.readTurn(ctl.sessionState.conversationId, turnId);
  return turn?.changesSettled === true ? turn : undefined;
}

export function readLatestConversationChanges(
  ctl: ConversationChangesPort,
): ConversationTurnRecord | undefined {
  return ctl.sessionState.conversationId === null
    ? undefined
    : ctl.recoveryStore.readLatestChanges(ctl.sessionState.conversationId);
}
