import { MAX_TURN_TEXT_LENGTH } from '../../../shared/protocol/bounds';
import { MAX_QUEUED_MESSAGES } from '../../../shared/protocol/queueProtocol';
import type { TurnStatus } from '../../../shared/protocol/turns';
import type { AssistantWebviewState } from '../state/types';

export interface SendEligibility {
  readonly connectionStatus: AssistantWebviewState['connection']['status'];
  readonly sessionId: string | null;
  readonly turnStatus: TurnStatus | null;
  readonly interactionCount: number;
  readonly queuedCount: number;
  readonly queueEditing: boolean;
}

/** A paused queue must stay ordered; a new prompt cannot overtake it. */
export function shouldQueueMessage(
  eligibility: Pick<SendEligibility, 'turnStatus' | 'queuedCount'>,
): boolean {
  return (
    eligibility.turnStatus === 'submitting' ||
    eligibility.turnStatus === 'streaming' ||
    eligibility.turnStatus === 'stopping' ||
    eligibility.queuedCount > 0
  );
}

export function canSendMessage(
  eligibility: SendEligibility,
  text?: string,
  additionallyDisabled = false,
): eligibility is SendEligibility & { readonly sessionId: string } {
  if (
    eligibility.connectionStatus !== 'connected' ||
    eligibility.sessionId === null ||
    additionallyDisabled
  ) {
    return false;
  }
  if (shouldQueueMessage(eligibility)) {
    if (eligibility.queuedCount >= MAX_QUEUED_MESSAGES && !eligibility.queueEditing) {
      return false;
    }
  } else if (eligibility.interactionCount > 0) {
    return false;
  }
  return text === undefined || (text.trim().length > 0 && text.length <= MAX_TURN_TEXT_LENGTH);
}
