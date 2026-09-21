import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import { RuntimeTurnRecoveryError } from '../../../runtime/turnRecovery';
import { attachUserMessageId } from '../../recovery/hostTranscriptState';
import type { TurnFlowPort } from '../turns/turnFlowPort';

export function recoverTransportTurn(
  ctl: TurnFlowPort,
  runtime: DroidRuntime,
  generation: number,
  sessionId: string,
  turnId: string,
  error: unknown,
): boolean {
  if (!(error instanceof RuntimeTurnRecoveryError) || ctl.turnState.turn === null ||
      ctl.sessionState.activeRuntimeCwd === null) return false;
  ctl.recoveryState.transcript = attachUserMessageId(ctl.recoveryState.transcript, turnId, error.messageId);
  ctl.effects.retainSentAttachments(turnId, error.messageId);
  ctl.turnState.turn = { ...ctl.turnState.turn, recovery: true,
    transportRecovery: { messageId: error.messageId, get completion() { return error.completion; },
      dispose: error.dispose } };
  ctl.effects.clearTurnWatchdog();
  ctl.effects.scheduleRecoveryCheckpoint();
  ctl.effects.reconcileDaemonTurn(runtime, generation, sessionId, ctl.sessionState.activeRuntimeCwd);
  return true;
}
