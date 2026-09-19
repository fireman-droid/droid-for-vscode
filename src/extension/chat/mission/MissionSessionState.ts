import { type SessionMissionSummary } from '../../../shared/protocol/sessions';
import type { MissionSnapshotReducer } from './MissionSnapshotReducer';
export class MissionSessionState {
  mission: SessionMissionSummary | null = null;
  missionRuntime: MissionSnapshotReducer | null = null;
  missionStartInProgress = false;
}
