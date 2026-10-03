import type { SessionSummary } from '../../../shared/protocol/sessions';
import type { HostTranscriptState } from '../../recovery/hostTranscriptState';
import type { ChatEffects } from '../chatEffects';
import type { CurrentTurn } from '../internals';
import type { ConversationRecoveryState } from '../recovery/ConversationRecoveryState';
import type { TurnState } from '../turns/TurnState';
import type { SessionDirectoryState } from './SessionDirectoryState';
import type { SessionLifecycleState } from './SessionLifecycleState';

interface SessionIdentity {
  readonly sessionId: string | null;
  readonly conversationId: string | null;
}

interface SessionBindingPort {
  readonly sessionState: Pick<SessionLifecycleState, 'sessionId' | 'conversationId'>;
  readonly turnState: Pick<TurnState, 'turn'>;
  readonly recoveryState: Pick<ConversationRecoveryState, 'transcript'>;
  readonly catalogState: Pick<SessionDirectoryState, 'sessions'>;
  readonly effects: Pick<ChatEffects, 'withActiveSession'>;
}

/** Identity always moves as a pair, including an unavailable resume target. */
export function bindSessionIdentity(ctl: Pick<SessionBindingPort, 'sessionState'>, identity: SessionIdentity): void {
  ctl.sessionState.sessionId = identity.sessionId;
  ctl.sessionState.conversationId = identity.conversationId;
}

/** Show already loaded history without claiming that its runtime is connected. */
export function showSessionHistory(
  ctl: Pick<SessionBindingPort, 'sessionState' | 'turnState' | 'recoveryState'>,
  identity: SessionIdentity,
  transcript: HostTranscriptState,
): void {
  bindSessionIdentity(ctl, identity);
  ctl.recoveryState.transcript = transcript;
  ctl.turnState.turn = null;
}

/**
 * Commit a prepared binding synchronously. Callers own persistence, runtime
 * adoption and generation checks; this operation never emits or starts work.
 */
export function commitSessionBinding(
  ctl: SessionBindingPort,
  binding: SessionIdentity & {
    readonly transcript: HostTranscriptState;
    readonly turn: CurrentTurn | null;
    readonly catalogEntry?: SessionSummary;
  },
): void {
  bindSessionIdentity(ctl, binding);
  ctl.recoveryState.transcript = binding.transcript;
  ctl.turnState.turn = binding.turn;
  ctl.catalogState.sessions = ctl.effects.withActiveSession(ctl.catalogState.sessions, binding.catalogEntry);
}
