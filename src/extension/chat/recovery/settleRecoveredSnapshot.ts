import { isTurnActive } from '../internals';
import { finishPendingSnapshot } from '../changes/snapshotCapture';
import type { RecoveryPort } from './recoveryPort';

export const CAPTURE_RECOVERED_MESSAGE =
  'The previous change recording has been recovered. Your rejected message was not sent; send it again to continue.';

/** Called only after the resumed session's backend has confirmed it is idle. */
export async function settleRecoveredSnapshot(
  ctl: RecoveryPort,
  sessionId: string,
  isCurrent: () => boolean,
): Promise<boolean> {
  const turn = ctl.turnState.turn;
  const store = ctl.turnSnapshots;
  const current = () => isCurrent() && ctl.turnState.turn === turn && !isTurnActive(turn);
  if (!store || !current()) return false;
  try {
    const pending = await store.readPendingCapture?.();
    if (!current()) return false;
    // A failed retry can replace the display checkpoint while the original
    // turn still owns the workspace capture. Settle that durable identity.
    if (pending?.sessionId === sessionId && (pending.turnId !== turn?.turnId || !store.read(pending.sessionId, pending.turnId)?.after)) {
      const after = await finishPendingSnapshot(store, pending);
      if (!current()) return false;
      if (!after) throw new Error('Missing final workspace snapshot');
      const blockedMessage = `This workspace has an unfinished captured turn. Reopen session ${sessionId} to finish recording it before sending another turn.`;
      if (turn?.status === 'failed' && turn.error === blockedMessage) {
        turn.error = CAPTURE_RECOVERED_MESSAGE;
        return true;
      }
    }
    if (turn && store.read(sessionId, turn.turnId)?.coverage === 'workspace-files-v1' &&
        (turn.status === 'completed' || turn.status === 'interrupted' || turn.status === 'failed')) {
      ctl.effects.publishTurnChanges(sessionId, turn.turnId, turn.status);
    }
  } catch {
    if (current()) ctl.emitSessionDiagnostic('recovered-capture-failed',
      'The previous change recording could not be recovered. Retry to finish recording it before sending another message.', turn?.turnId);
  }
  return false;
}
