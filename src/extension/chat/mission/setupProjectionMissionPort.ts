import type { HostOperations } from '../hostOperations';
import type { MissionSessionState } from './MissionSessionState';
import type { SessionDirectoryState } from '../sessions/SessionDirectoryState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
export interface SetupProjectionPort
  extends Pick<
    HostOperations,
    'subscribe' | 'missionGateway' | 'metadata' | 'getWorkspaceContext' | 'emit'
  > {
  readonly sessionState: Readonly<
    Pick<
      SessionLifecycleState,
      | 'runtime'
      | 'connection'
      | 'sessionId'
      | 'runtimeGeneration'
      | 'workspaceContext'
      | 'workspaceContextGeneration'
      | 'sessionOperationInProgress'
    >
  >;
  readonly catalogState: Readonly<Pick<SessionDirectoryState, 'refreshInProgress'>>;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
  readonly missionState: Readonly<Pick<MissionSessionState, 'missionStartInProgress'>>;
}
