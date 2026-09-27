import type { HostOperations } from '../hostOperations';
import type { MissionSessionState } from './MissionSessionState';
export interface RuntimeEventsPort extends Pick<HostOperations, 'emit'> {
  readonly missionState: Readonly<Pick<MissionSessionState, 'missionRuntime' | 'stopMissionSubscription'>> &
    Pick<MissionSessionState, 'mission'>;
}
