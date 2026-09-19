import type { HostOperations } from '../hostOperations';
import type { MissionSessionState } from '../mission/MissionSessionState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
export interface ActivationTranscriptPort
  extends Pick<
    HostOperations,
    'metadata' | 'recoveryStore' | 'getWorkspaceContext' | 'recordHost' | 'sessionHistory' | 'turnSnapshots'
  > {
  readonly sessionState: Readonly<
    Pick<SessionLifecycleState, 'runtimeGeneration' | 'disposed'>
  >;
  readonly missionState: Pick<MissionSessionState, 'mission'>;
}
