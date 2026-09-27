import type { HostOperations } from '../hostOperations';
import type { MissionSessionState } from './MissionSessionState';
export interface RecoveryPort
  extends Pick<HostOperations, 'isCurrentSessionOperation' | 'emit'> {
  readonly missionState: Pick<MissionSessionState, 'mission' | 'missionRuntime' | 'stopMissionSubscription'>;
}
