import type { ReviewWebviewMessage } from '../../../shared/protocol/reviewProtocol';
import { isTurnActive } from '../internals';
import type { ReviewActionsPort } from './reviewActionsPort';

export function handleReviewMessage(
  ctl: ReviewActionsPort,
  message: ReviewWebviewMessage,
): void {
  if (
    message.sessionId !== ctl.sessionState.sessionId ||
    (message.type === 'review.runAgentReview' && ctl.sessionState.connection.status !== 'connected')
  ) {
    return;
  }
  if (
    message.type === 'review.open' &&
    message.requestId === undefined &&
    message.scopeKind === 'turn' &&
    ctl.turnState.turn?.turnId === message.turnId &&
    isTurnActive(ctl.turnState.turn)
  ) {
    const changes = ctl.effects.readConversationTurnChanges(message.turnId!);
    ctl.reviewCoordinator?.openWritingTurn(
      message.sessionId,
      message.turnId!,
      changes?.files ?? [],
    );
    return;
  }
  ctl.reviewCoordinator?.handle(message);
}
