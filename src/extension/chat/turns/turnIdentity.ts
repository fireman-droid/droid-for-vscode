import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import { isTurnActive } from '../internals';
import type { TurnIdentityPort } from './turnFlowPort';

export function isCurrentTurn(
  ctl: TurnIdentityPort,
  runtime: DroidRuntime,
  runtimeGeneration: number,
  turnGeneration: number,
  sessionId: string,
  turnId: string,
): boolean {
  if (
    ctl.effects.isCurrentRuntime(runtime, runtimeGeneration) &&
    ctl.turnState.turnGeneration === turnGeneration &&
    ctl.sessionState.sessionId === sessionId &&
    ctl.turnState.turn?.turnId === turnId &&
    isTurnActive(ctl.turnState.turn)
  ) {
    return ctl.effects.ensureActiveRuntimeWorkspaceCurrent();
  }
  return false;
}
