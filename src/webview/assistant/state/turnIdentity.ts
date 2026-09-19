import { type TurnStatus } from '../../../shared/protocol/turns';
import type { AssistantTurn, AssistantWebviewState } from './types';

export function isTurnActive(turn: AssistantTurn | null): boolean {
  return (
    turn?.status === 'submitting' ||
    turn?.status === 'streaming' ||
    turn?.status === 'stopping'
  );
}

export function advance(
  state: AssistantWebviewState,
  sequence: number,
): AssistantWebviewState {
  return { ...state, sequence };
}

export function matchesTurn(
  state: AssistantWebviewState,
  sessionId: string,
  turnId: string,
): state is AssistantWebviewState & { turn: AssistantTurn } {
  return (
    state.sessionId === sessionId && state.turn !== null && state.turn.turnId === turnId
  );
}

export function acceptsActiveTurn(
  state: AssistantWebviewState,
  sessionId: string,
  turnId: string,
): state is AssistantWebviewState & { turn: AssistantTurn } {
  return (
    matchesTurn(state, sessionId, turnId) &&
    (state.turn.status === 'submitting' || state.turn.status === 'streaming')
  );
}

export function acceptsTurnError(
  state: AssistantWebviewState,
  sessionId: string,
  turnId: string,
): state is AssistantWebviewState & { turn: AssistantTurn } {
  return (
    matchesTurn(state, sessionId, turnId) &&
    (state.turn.status === 'submitting' ||
      state.turn.status === 'streaming' ||
      state.turn.status === 'stopping')
  );
}

export function acceptsDiagnostic(
  state: AssistantWebviewState,
  sessionId: string | null,
  turnId: string | null,
): boolean {
  if (sessionId !== null && sessionId !== state.sessionId) {
    return false;
  }
  if (turnId === null) {
    return true;
  }
  return (
    state.turn?.turnId === turnId &&
    state.turn.status !== 'stopping' &&
    state.turn.status !== 'interrupted'
  );
}

export function isTerminalStatus(
  status: TurnStatus,
): status is 'completed' | 'interrupted' | 'failed' {
  return status === 'completed' || status === 'interrupted' || status === 'failed';
}
