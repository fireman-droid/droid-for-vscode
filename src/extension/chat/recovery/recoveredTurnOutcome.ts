import type { DroidRuntime, RuntimeSessionWorkingState } from '../../../runtime/DroidRuntime';
import type { RuntimeEvent } from '../../../runtime/runtimeEvents';
import type { CurrentTurn } from '../internals';
import type { RecoveryPort } from './recoveryPort';

type Completion = Extract<RuntimeEvent, { type: 'turn-complete' }>;
export type RecoveredTurnOutcome =
  | { readonly status: 'confirmed'; readonly completion: Completion }
  | { readonly status: 'unconfirmed' }
  | { readonly status: 'legacy' };

/** Only an explicitly captured submission id can select a durable outcome. */
export async function readRecoveredTurnOutcome(
  runtime: DroidRuntime, turn: CurrentTurn,
): Promise<RecoveredTurnOutcome> {
  const received = turn.transportRecovery?.completion;
  if (received) return { status: 'confirmed', completion: received };
  if (turn.backendTurnId === undefined) return { status: 'legacy' };
  try {
    const outcome = await runtime.readTurnOutcome?.(turn.backendTurnId);
    const liveCompletion = turn.transportRecovery?.completion;
    if (liveCompletion) return { status: 'confirmed', completion: liveCompletion };
    return outcome?.backendTurnId === turn.backendTurnId
      ? { status: 'confirmed', completion: outcome.completion } : { status: 'unconfirmed' };
  } catch {
    const liveCompletion = turn.transportRecovery?.completion;
    return liveCompletion ? { status: 'confirmed', completion: liveCompletion } : { status: 'unconfirmed' };
  }
}

/** A paused worker's registry row may be idle while an owned prompt still awaits input. */
export function preservePendingRecoveredState(
  ctl: Pick<RecoveryPort, 'interactions'>, sessionId: string, state: RuntimeSessionWorkingState,
): RuntimeSessionWorkingState {
  return state === 'idle' && ctl.interactions.snapshotPending().some(entry => entry.sessionId === sessionId)
    ? 'waiting-for-user' : state;
}
