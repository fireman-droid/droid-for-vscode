import type { ConversationTurnRecord } from '../conversationRecoveryState';
import type { ChatControllerInternals } from './internals';

export function readConversationTurnChanges(
  ctl: ChatControllerInternals,
  turnId: string,
): ConversationTurnRecord | undefined {
  if (ctl.conversationId === null) {
    return undefined;
  }
  const turn = ctl.recoveryStore.readTurn(ctl.conversationId, turnId);
  return turn?.changesSettled === true ? turn : undefined;
}

export function readLatestConversationChanges(
  ctl: ChatControllerInternals,
): ConversationTurnRecord | undefined {
  return ctl.conversationId === null
    ? undefined
    : ctl.recoveryStore.readLatestChanges(ctl.conversationId);
}
