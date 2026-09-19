import { type ConnectionState } from '../../shared/protocol/shell';
import type { DroidRuntime } from '../../runtime/DroidRuntime';
import type { CurrentTurn } from './internals';
import { isTurnActive } from './internals';

export interface CapturedSessionIdentity {
  readonly runtime: DroidRuntime;
  readonly generation: number;
  readonly sessionId: string;
  readonly cwd: string;
}

export type UserPanelRequestDropReason =
  | 'session-mismatch'
  | 'no-runtime'
  | 'not-connected'
  | 'operation-in-progress'
  | 'workspace-changed';

export type UserPanelRequestEligibility =
  | ({ readonly kind: 'eligible' } & CapturedSessionIdentity)
  | {
      readonly kind: 'blocked';
      readonly reason: UserPanelRequestDropReason;
    };

export interface UserPanelRequestState {
  readonly requestedSessionId: string;
  readonly activeSessionId: string | null;
  readonly runtime: DroidRuntime | null;
  readonly connectionStatus: ConnectionState['status'];
  readonly sessionOperationInProgress: boolean;
  readonly runtimeGeneration: number;
  readonly activeRuntimeCwd: string | null;
  readonly isWorkspaceCurrent: () => boolean;
}

export function evaluateUserPanelRequest(
  state: UserPanelRequestState,
): UserPanelRequestEligibility {
  if (state.requestedSessionId !== state.activeSessionId) {
    return { kind: 'blocked', reason: 'session-mismatch' };
  }
  if (state.runtime === null) {
    return { kind: 'blocked', reason: 'no-runtime' };
  }
  if (state.connectionStatus !== 'connected') {
    return { kind: 'blocked', reason: 'not-connected' };
  }
  if (state.sessionOperationInProgress) {
    return { kind: 'blocked', reason: 'operation-in-progress' };
  }
  if (state.activeRuntimeCwd === null || !state.isWorkspaceCurrent()) {
    return { kind: 'blocked', reason: 'workspace-changed' };
  }
  return {
    kind: 'eligible',
    runtime: state.runtime,
    generation: state.runtimeGeneration,
    sessionId: state.requestedSessionId,
    cwd: state.activeRuntimeCwd,
  };
}

export type SessionReplacementEligibility =
  | { readonly kind: 'eligible' }
  | {
      readonly kind: 'blocked';
      readonly reason:
        | 'process-turn-active'
        | 'pending-interaction'
        | 'connecting'
        | 'session-operation-in-progress'
        | 'catalog-refresh-in-progress'
        | 'settings-update-in-progress';
    };

export interface SessionReplacementState {
  readonly runtime: DroidRuntime | null;
  readonly turn: CurrentTurn | null;
  readonly hasPendingInteractions: boolean;
  readonly connectionStatus: ConnectionState['status'];
  readonly sessionOperationInProgress: boolean;
  readonly refreshInProgress: boolean;
  readonly settingsUpdateInProgress: boolean;
}

export function evaluateSessionReplacement(
  state: SessionReplacementState,
): SessionReplacementEligibility {
  if (isTurnActive(state.turn) && state.runtime?.supportsBackgroundTurns?.() !== true) {
    return { kind: 'blocked', reason: 'process-turn-active' };
  }
  if (state.hasPendingInteractions) {
    return { kind: 'blocked', reason: 'pending-interaction' };
  }
  if (state.connectionStatus === 'connecting') {
    return { kind: 'blocked', reason: 'connecting' };
  }
  if (state.sessionOperationInProgress) {
    return {
      kind: 'blocked',
      reason: 'session-operation-in-progress',
    };
  }
  if (state.refreshInProgress) {
    return {
      kind: 'blocked',
      reason: 'catalog-refresh-in-progress',
    };
  }
  if (state.settingsUpdateInProgress) {
    return {
      kind: 'blocked',
      reason: 'settings-update-in-progress',
    };
  }
  return { kind: 'eligible' };
}

export type ActiveSessionTransformEligibility =
  | { readonly kind: 'eligible' }
  | {
      readonly kind: 'blocked';
      readonly reason:
        | 'turn-active'
        | 'pending-interaction'
        | 'session-operation-in-progress'
        | 'catalog-refresh-in-progress'
        | 'settings-update-in-progress';
    };

export interface ActiveSessionTransformState {
  readonly turn: CurrentTurn | null;
  readonly hasPendingInteractions: boolean;
  readonly sessionOperationInProgress: boolean;
  readonly refreshInProgress: boolean;
  readonly settingsUpdateInProgress: boolean;
}

export function evaluateActiveSessionTransform(
  state: ActiveSessionTransformState,
): ActiveSessionTransformEligibility {
  if (isTurnActive(state.turn)) {
    return { kind: 'blocked', reason: 'turn-active' };
  }
  if (state.hasPendingInteractions) {
    return { kind: 'blocked', reason: 'pending-interaction' };
  }
  if (state.sessionOperationInProgress) {
    return {
      kind: 'blocked',
      reason: 'session-operation-in-progress',
    };
  }
  if (state.refreshInProgress) {
    return {
      kind: 'blocked',
      reason: 'catalog-refresh-in-progress',
    };
  }
  if (state.settingsUpdateInProgress) {
    return {
      kind: 'blocked',
      reason: 'settings-update-in-progress',
    };
  }
  return { kind: 'eligible' };
}

export type TurnStartEligibility =
  | { readonly kind: 'eligible'; readonly runtime: DroidRuntime }
  | {
      readonly kind: 'blocked';
      readonly reason:
        | 'session-mismatch'
        | 'no-runtime'
        | 'not-connected'
        | 'workspace-changed'
        | 'blank-text'
        | 'duplicate-turn-id'
        | 'turn-active'
        | 'session-operation-in-progress'
        | 'settings-update-in-progress';
    };

export interface TurnStartState {
  readonly requestedSessionId: string;
  readonly activeSessionId: string | null;
  readonly runtime: DroidRuntime | null;
  readonly connectionStatus: ConnectionState['status'];
  readonly isWorkspaceCurrent: () => boolean;
  readonly text: string;
  readonly turnId: string;
  readonly turn: CurrentTurn | null;
  readonly sessionOperationInProgress: boolean;
  readonly settingsUpdateInProgress: boolean;
}

export function evaluateTurnStart(state: TurnStartState): TurnStartEligibility {
  if (state.requestedSessionId !== state.activeSessionId) {
    return { kind: 'blocked', reason: 'session-mismatch' };
  }
  if (state.runtime === null) {
    return { kind: 'blocked', reason: 'no-runtime' };
  }
  if (state.connectionStatus !== 'connected') {
    return { kind: 'blocked', reason: 'not-connected' };
  }
  if (!state.isWorkspaceCurrent()) {
    return { kind: 'blocked', reason: 'workspace-changed' };
  }
  if (state.text.trim().length === 0) {
    return { kind: 'blocked', reason: 'blank-text' };
  }
  if (state.turn?.turnId === state.turnId) {
    return { kind: 'blocked', reason: 'duplicate-turn-id' };
  }
  if (isTurnActive(state.turn)) {
    return { kind: 'blocked', reason: 'turn-active' };
  }
  if (state.sessionOperationInProgress) {
    return {
      kind: 'blocked',
      reason: 'session-operation-in-progress',
    };
  }
  if (state.settingsUpdateInProgress) {
    return {
      kind: 'blocked',
      reason: 'settings-update-in-progress',
    };
  }
  return { kind: 'eligible', runtime: state.runtime };
}
