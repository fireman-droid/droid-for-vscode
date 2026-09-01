import { collectToolFilePaths } from '../turnActivityState';
import { reconcileTurnChanges } from '../hostTranscriptState';
import type { TurnStatus } from '../../shared/bridgeMessages';
import type { ChatControllerInternals } from './internals';
import { resolveSettledChangeFiles } from './settleTurnChanges';

/**
 * Publishes a finished turn's canonical changed-file ledger only after
 * its transcript checkpoint is durable.
 */
export function publishTurnChanges(
  ctl: ChatControllerInternals,
  sessionId: string,
  turnId: string,
  status: Extract<TurnStatus, 'completed' | 'interrupted' | 'failed'>,
): void {
  const conversationId = ctl.conversationId;
  if (
    conversationId === null ||
    ctl.sessionId !== sessionId ||
    ctl.turn?.turnId !== turnId
  ) {
    return;
  }
  ctl.turn.changesLedger?.cancel();
  const toolPaths = collectToolFilePaths(ctl.turn.activity);
  const runtimeGeneration = ctl.runtimeGeneration;
  void resolveSettledChangeFiles(ctl, sessionId, turnId, toolPaths).then(
    (files) => {
      if (
        ctl.disposed ||
        ctl.sessionId !== sessionId ||
        ctl.runtimeGeneration !== runtimeGeneration
      ) {
        return;
      }
      const next = reconcileTurnChanges(ctl.transcript, turnId, files);
      const prompt = readTurnPrompt(next.transcript, turnId);
      let retries = 0;
      const persistAndPublish = (): void => {
        if (
          ctl.disposed ||
          ctl.sessionId !== sessionId ||
          ctl.runtimeGeneration !== runtimeGeneration ||
          !ctl.recoveryStore.writeActiveDisplay(
            conversationId,
            sessionId,
            next,
            null,
          ) ||
          !ctl.recoveryStore.recordSettledTurn(
            conversationId,
            sessionId,
            turnId,
            prompt?.text ?? null,
            files,
            status,
            prompt?.messageId,
          )
        ) {
          return;
        }
        void ctl.recoveryStore.flush().then(
          () => {
            if (
              ctl.disposed ||
              ctl.sessionId !== sessionId ||
              ctl.runtimeGeneration !== runtimeGeneration
            ) {
              return;
            }
            ctl.transcript = next;
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
    },
  );
}

function readTurnPrompt(
  transcript: ChatControllerInternals['transcript']['transcript'],
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
        ...(item.messageId === undefined
          ? {}
          : { messageId: item.messageId }),
      };
    }
  }
  return undefined;
}
