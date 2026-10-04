import type { HostOperations } from '../hostOperations';
import type { MissionSessionState } from './MissionSessionState';
export interface RecoveryPort
  extends Pick<HostOperations, 'isCurrentSessionOperation' | 'emit' | 'recordHost'> {
  readonly missionState: Pick<MissionSessionState, 'mission' | 'missionRuntime' | 'stopMissionSubscription' | 'refreshMission'>;
}
