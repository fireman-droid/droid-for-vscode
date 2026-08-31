// liveChanges: the live half of the changes ledger, split out of
// turnFlow.ts (the settled half stays with the turn-end
// reconciliation in publishTurnChanges).
import type { RuntimeEvent } from '../../runtime/runtimeEvents';
import { reconcileTurnChanges } from '../hostTranscriptState';
import { createTurnChangesLedger } from '../turnChangesLedger';
import { isTurnActive, type ChatControllerInternals } from './internals';

/** Captures a complete file-tool path set before the stream advances. */
export async function capturePreToolBaseline(
  ctl: ChatControllerInternals,
  sessionId: string,
  turnId: string,
  event: Extract<RuntimeEvent, { type: 'tool-start' }>,
): Promise<boolean> {
  const paths =
    event.filePaths ??
    (event.filePath === undefined ? [] : [event.filePath]);
  if (
    paths.length === 0 ||
    (event.inputComplete !== true && event.filePathsComplete !== true)
  ) {
    return false;
  }
  try {
    await ctl.turnSnapshots?.capturePaths({ sessionId, turnId }, paths);
    await ctl.changeStats.captureTurnBaseline?.(
      { sessionId, turnId },
      paths,
    );
  } catch {
    // Change accounting is advisory and never fails a turn.
  }
  return true;
}

/**
 * Feeds the live changes ledger with the file paths of one completed
 * file-modifying tool call (decard design §4). The ledger is created
 * lazily on the first fed path; its publisher re-checks turn
 * identity on every emit so stale debounce timers can never leak a
 * `writing` update into a later turn or past the settled message.
 */
export function recordLiveToolChanges(
  ctl: ChatControllerInternals,
  sessionId: string,
  turnId: string,
  toolUseId: string,
): void {
  const turn = ctl.turn;
  if (turn === null || turn.turnId !== turnId) {
    return;
  }
  const entry = turn.activity.tools.get(toolUseId);
  const paths =
    entry?.filePaths ??
    (entry?.filePath === undefined ? [] : [entry.filePath]);
  if (paths.length === 0) {
    return;
  }
  if (turn.changesLedger === undefined) {
    const runtimeGeneration = ctl.runtimeGeneration;
    turn.changesLedger = createTurnChangesLedger({
      reader: ctl.changeStats,
      scope: { sessionId, turnId },
      publish: (files) => {
        if (
          ctl.disposed ||
          ctl.sessionId !== sessionId ||
          ctl.runtimeGeneration !== runtimeGeneration ||
          ctl.turn?.turnId !== turnId ||
          !isTurnActive(ctl.turn)
        ) {
          return;
        }
        ctl.transcript = reconcileTurnChanges(
          ctl.transcript,
          turnId,
          files,
          true,
        );
        ctl.reviewCoordinator?.refreshWritingTurn(
          sessionId,
          turnId,
          files,
        );
        ctl.emit({
          type: 'changes.update',
          sessionId,
          turnId,
          state: 'writing',
          files,
        });
      },
    });
  }
  turn.changesLedger.recordPaths(paths);
}
