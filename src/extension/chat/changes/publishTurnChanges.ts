import { type TurnStatus } from '../../../shared/protocol/turns';
import { reconcileTurnChanges } from '../../recovery/hostTranscriptState';
import { collectToolFilePaths } from '../turns/turnActivityState';
import type { PublishTurnChangesPort } from './publishTurnChangesPort';

/**
 * Publishes a finished turn's canonical changed-file ledger only after
 * its transcript checkpoint is durable.
 */
export function publishTurnChanges(
  ctl: PublishTurnChangesPort,
  sessionId: string,
  turnId: string,
  status: Extract<TurnStatus, 'completed' | 'interrupted' | 'failed'>,
): void {
  const conversationId = ctl.sessionState.conversationId;
  if (
    conversationId === null ||
    ctl.sessionState.sessionId !== sessionId ||
    ctl.turnState.turn?.turnId !== turnId
  ) {
    return;
  }
  ctl.turnState.turn.changesLedger?.cancel();
  const measuredFiles = ctl.turnState.turn.changesLedger?.files() ?? [];
  const toolPaths = [...new Set([
    ...collectToolFilePaths(ctl.turnState.turn.activity),
    ...measuredFiles.map((file) => file.path),
  ])];
  const runtimeGeneration = ctl.sessionState.runtimeGeneration;
  void ctl.effects
    .resolveSettledChangeFiles(sessionId, turnId, toolPaths, measuredFiles)
    .then((files) => {
      if (
        ctl.sessionState.disposed ||
        ctl.sessionState.sessionId !== sessionId ||
        ctl.sessionState.runtimeGeneration !== runtimeGeneration
      ) {
        return;
      }
      let retries = 0;
      const persistAndPublish = (): void => {
        const next = reconcileTurnChanges(ctl.recoveryState.transcript, turnId, files);
        const prompt = readTurnPrompt(next.transcript, turnId);
        const toolOperations = next.transcript.flatMap((item) =>
          item.kind === 'tool' &&
          item.turnId === turnId &&
          item.operationDiff !== undefined
            ? [{
                toolUseId: item.toolUseId,
                toolName: item.toolName,
                operationDiff: item.operationDiff,
                ...(item.executionPhase === undefined
                  ? {}
                  : { executionPhase: item.executionPhase }),
              }]
            : [],
        );
        const currentTurn = ctl.turnState.turn;
        const displayTurn = currentTurn === null ? null : {
          turnId: currentTurn.turnId, status: currentTurn.status,
          ...(currentTurn.error === undefined ? {} : { error: currentTurn.error }),
        };
        if (
          ctl.sessionState.disposed ||
          ctl.sessionState.sessionId !== sessionId ||
          ctl.sessionState.runtimeGeneration !== runtimeGeneration ||
          ctl.sessionState.conversationId !== conversationId ||
          !ctl.recoveryStore.writeActiveDisplay(conversationId, sessionId, next, displayTurn) ||
          !ctl.recoveryStore.recordSettledTurn(
            conversationId,
            sessionId,
            turnId,
            prompt?.text ?? null,
            files,
            status,
            prompt?.messageId,
            toolOperations,
          )
        ) {
          return;
        }
        void ctl.recoveryStore.flush().then(
          () => {
            if (
              ctl.sessionState.disposed ||
              ctl.sessionState.sessionId !== sessionId ||
              ctl.sessionState.conversationId !== conversationId ||
              ctl.sessionState.runtimeGeneration !== runtimeGeneration
            ) {
              return;
            }
            // Other turns may have streamed while persistence was in flight.
            // Only merge this turn's changes into the current transcript.
            ctl.recoveryState.transcript = reconcileTurnChanges(ctl.recoveryState.transcript, turnId, files);
            ctl.effects.scheduleRecoveryCheckpoint();
            ctl.reviewCoordinator?.settleWritingTurn(sessionId, turnId, files);
            ctl.emitSnapshot();
            ctl.emit({
              type: 'changes.update',
              sessionId,
              turnId,
              state: 'settled',
              files,
            });
          },
          () => {
            if (retries < 1) {
              retries += 1;
              setTimeout(persistAndPublish, 0);
            }
          },
        );
      };
      persistAndPublish();
    });
}

function readTurnPrompt(
  transcript: PublishTurnChangesPort['recoveryState']['transcript']['transcript'],
  turnId: string,
): { readonly text: string; readonly messageId?: string } | undefined {
  const anchor = transcript.findIndex(
    (item) => item.kind !== 'user' && item.turnId === turnId,
  );
  for (let index = anchor - 1; index >= 0; index -= 1) {
    const item = transcript[index];
    if (item?.kind === 'user') {
      return {
        text: item.text,
        ...(item.messageId === undefined ? {} : { messageId: item.messageId }),
      };
    }
  }
  return undefined;
}
