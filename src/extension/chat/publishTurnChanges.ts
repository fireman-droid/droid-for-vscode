import { collectToolFilePaths } from '../turnActivityState';
import { reconcileTurnChanges } from '../hostTranscriptState';
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
): void {
  if (ctl.sessionId !== sessionId || ctl.turn?.turnId !== turnId) {
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
      let retries = 0;
      const persistAndPublish = (): void => {
        if (
          ctl.disposed ||
          ctl.sessionId !== sessionId ||
          ctl.runtimeGeneration !== runtimeGeneration ||
          !ctl.recoveryStore.writeSession(sessionId, next)
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
