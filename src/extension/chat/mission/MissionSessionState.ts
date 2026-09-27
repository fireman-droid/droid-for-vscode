import { type SessionMissionSummary } from '../../../shared/protocol/sessions';
import type { MissionSnapshotReducer } from './MissionSnapshotReducer';
export class MissionSessionState {
  mission: SessionMissionSummary | null = null;
  missionRuntime: MissionSnapshotReducer | null = null;
  stopMissionSubscription: (() => void) | null = null;
  missionStartInProgress = false;

  stopSubscription(): void {
    this.stopMissionSubscription?.();
    this.stopMissionSubscription = null;
  }

  detachRuntime(): void {
    this.stopSubscription();
    this.missionRuntime = null;
  }
}
