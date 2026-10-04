import { type SessionMissionSummary } from '../../../shared/protocol/sessions';
import type { MissionSnapshotReducer } from './MissionSnapshotReducer';
export class MissionSessionState {
  mission: SessionMissionSummary | null = null;
  missionRuntime: MissionSnapshotReducer | null = null;
  stopMissionSubscription: (() => void) | null = null;
  refreshMission: (() => Promise<boolean>) | null = null;
  missionStartInProgress = false;

  stopSubscription(): void {
    this.stopMissionSubscription?.();
    this.stopMissionSubscription = null;
    this.refreshMission = null;
  }

  detachRuntime(): void {
    this.stopSubscription();
    this.missionRuntime = null;
  }
}
