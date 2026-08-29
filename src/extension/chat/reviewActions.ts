import type { ReviewWebviewMessage } from '../../shared/reviewProtocol';
import { isTurnActive, type ChatControllerInternals } from './internals';

export function handleReviewMessage(
  ctl: ChatControllerInternals,
  message: ReviewWebviewMessage,
): void {
  if (
    message.sessionId !== ctl.sessionId ||
    ctl.connection.status !== 'connected'
  ) {
    return;
  }
  if (
    message.type === 'review.open' &&
    message.scopeKind === 'turn' &&
    ctl.turn?.turnId === message.turnId &&
    isTurnActive(ctl.turn)
  ) {
    const changes = [...ctl.transcript.transcript]
      .reverse()
      .find(
        (item) =>
          item.kind === 'changes' && item.turnId === message.turnId,
      );
    ctl.reviewCoordinator?.openWritingTurn(
      message.sessionId,
      message.turnId!,
      changes?.kind === 'changes' ? changes.files : [],
    );
    return;
  }
  ctl.reviewCoordinator?.handle(message);
}
