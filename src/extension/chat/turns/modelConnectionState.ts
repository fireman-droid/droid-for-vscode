import type { HostOperations } from '../hostOperations';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from './TurnState';

export interface ModelConnectionPort extends Pick<HostOperations, 'emit'> {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'sessionId' | 'conversationId'>> &
    Pick<SessionLifecycleState, 'connection'>;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
}

/** A new prompt or working-state notification does not establish provider recovery. */
export function setModelRequestFailed(ctl: ModelConnectionPort, sessionId: string, turnId: string, failed: boolean): void {
  if (ctl.sessionState.sessionId !== sessionId || ctl.turnState.turn?.turnId !== turnId ||
    Boolean(ctl.sessionState.connection.modelRequestFailed) === failed) return;
  const { modelRequestFailed: _previous, ...connection } = ctl.sessionState.connection;
  ctl.sessionState.connection = { ...connection, ...(failed ? { modelRequestFailed: true } : {}) };
  ctl.emit({ type: 'host.connection', sessionId, conversationId: ctl.sessionState.conversationId,
    connection: ctl.sessionState.connection });
}
