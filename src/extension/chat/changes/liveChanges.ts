import type { LiveChangesPort } from './liveChangesPort';
// liveChanges: the live half of the changes ledger, split out of
// turnFlow.ts (the settled half stays with the turn-end
// reconciliation in publishTurnChanges).
import type { RuntimeEvent } from '../../../runtime/runtimeEvents';
import { reconcileTurnChanges } from '../../recovery/hostTranscriptState';
import { createTurnChangesLedger } from '../../changes/turnChangesLedger';
import { isTurnActive } from '../internals';

/** Captures a complete file-tool path set before the stream advances. */
export async function capturePreToolBaseline(
  ctl: LiveChangesPort,
  sessionId: string,
  turnId: string,
  event: Extract<RuntimeEvent, { type: 'tool-start' }>,
): Promise<boolean> {
  const paths = event.filePaths ?? (event.filePath === undefined ? [] : [event.filePath]);
  if (
    paths.length === 0 ||
    (event.inputComplete !== true && event.filePathsComplete !== true)
  ) {
    return false;
  }
  try {
    await ctl.turnSnapshots?.capturePaths({ sessionId, turnId }, paths);
    await ctl.changeStats.captureTurnBaseline?.({ sessionId, turnId }, paths);
  } catch {
    // Change accounting is advisory and never fails a turn.
  }
  return true;
}

/**
 * Start watching after the before snapshot is ready. Tool results and file
 * events feed the same measured ledger; its publisher retains turn identity.
 */
export function startLiveChanges(
  ctl: LiveChangesPort,
  sessionId: string,
  turnId: string,
): void {
  const turn = ctl.turnState.turn;
  if (ctl.sessionState.disposed || ctl.sessionState.sessionId !== sessionId ||
    turn === null || turn.turnId !== turnId || !isTurnActive(turn)) {
    return;
  }
  if (turn.changesLedger === undefined) {
    const runtimeGeneration = ctl.sessionState.runtimeGeneration;
    turn.changesLedger = createTurnChangesLedger({
      reader: ctl.changeStats,
      scope: { sessionId, turnId },
      publish: (files) => {
        if (
          ctl.sessionState.disposed ||
          ctl.sessionState.sessionId !== sessionId ||
          ctl.sessionState.runtimeGeneration !== runtimeGeneration ||
          ctl.turnState.turn?.turnId !== turnId ||
          !isTurnActive(ctl.turnState.turn)
        ) {
          return;
        }
        ctl.recoveryState.transcript = reconcileTurnChanges(
          ctl.recoveryState.transcript,
          turnId,
          files,
          true,
        );
        ctl.reviewCoordinator?.refreshWritingTurn(sessionId, turnId, files);
        ctl.emit({
          type: 'changes.update',
          sessionId,
          turnId,
          state: 'writing',
          files,
        });
      },
      invalidate: (paths) => {
        if (
          ctl.sessionState.disposed ||
          ctl.sessionState.sessionId !== sessionId ||
          ctl.sessionState.runtimeGeneration !== runtimeGeneration ||
          ctl.turnState.turn?.turnId !== turnId ||
          !isTurnActive(ctl.turnState.turn)
        ) {
          return;
        }
        ctl.reviewCoordinator?.invalidateWritingTurn(sessionId, turnId, paths);
        ctl.emit({
          type: 'file.diff.invalidate',
          sessionId,
          turnId,
          paths,
        });
      },
    });
  }
}

export function recordLiveToolChanges(
  ctl: LiveChangesPort, sessionId: string, turnId: string, toolUseId: string,
): void {
  const turn = ctl.turnState.turn;
  if (turn?.turnId !== turnId) return;
  startLiveChanges(ctl, sessionId, turnId);
  const entry = turn.activity.tools.get(toolUseId);
  const paths = entry?.filePaths ?? (entry?.filePath === undefined ? [] : [entry.filePath]);
  turn.changesLedger?.recordPaths(paths);
}
