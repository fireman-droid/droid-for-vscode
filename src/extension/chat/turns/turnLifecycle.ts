import type { RuntimeDiagnosticSink } from '../../../runtime/runtimeDiagnostics';
import type { ChatEffects } from '../chatEffects';
import type { CurrentTurn } from '../internals';
import { createTurnActivityState } from './turnActivityState';
import type { TurnState } from './TurnState';

type InitialTurn = Omit<CurrentTurn, 'activity'>;

interface TurnLifecyclePort {
  readonly turnState: Pick<TurnState, 'turn' | 'turnGeneration' | 'turnIo'>;
  readonly diagnostics?: RuntimeDiagnosticSink;
  readonly effects: Pick<ChatEffects, 'discardPendingThinking'>;
}

/** Restored display does not start a generation or send a prompt. */
export function createRestoredTurn(turn: InitialTurn | null): CurrentTurn | null {
  return turn === null ? null : { ...turn, activity: createTurnActivityState() };
}

export function restoreTurn(ctl: Pick<TurnLifecyclePort, 'turnState'>, turn: InitialTurn): void {
  ctl.turnState.turn = createRestoredTurn(turn);
}

/** A transport handoff keeps local identity, generation and accumulated activity. */
export function attachTurnRecovery(
  ctl: Pick<TurnLifecyclePort, 'turnState'>,
  recovery: Pick<CurrentTurn, 'backendTurnId' | 'transportRecovery'>,
): void {
  if (ctl.turnState.turn === null) return;
  ctl.turnState.turn = { ...ctl.turnState.turn, ...recovery, recovery: true };
}

/** A submitted or observed backend turn acquires fresh local activity ownership. */
export function beginTurn(ctl: TurnLifecyclePort, initial: InitialTurn): number {
  const generation = ++ctl.turnState.turnGeneration;
  ctl.effects.discardPendingThinking();
  ctl.diagnostics?.beginTurnScope?.(initial.turnId);
  ctl.turnState.turnIo = { counts: new Map(), bytes: 0 };
  ctl.turnState.turn = createRestoredTurn(initial);
  return generation;
}

/** Drop local display ownership without publishing a backend terminal outcome. */
export function clearTurn(ctl: Pick<TurnLifecyclePort, 'turnState'>): void {
  ctl.turnState.turn = null;
  ctl.turnState.turnIo = null;
}
