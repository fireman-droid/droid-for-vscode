import type { HostOperations } from '../hostOperations';
import type { SessionDirectoryState } from './SessionDirectoryState';
import type { SessionLifecycleState } from './SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
export interface SessionRunningPort
  extends Pick<HostOperations, 'emit' | 'daemonSessions'> {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'sessionId' | 'disposed'>>;
  readonly catalogState: Readonly<
    Pick<SessionDirectoryState, 'sessions' | 'catalogCwd' | 'runningSessionIds'>
  > &
    Pick<SessionDirectoryState, 'backgroundRunningPoll'>;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
}
