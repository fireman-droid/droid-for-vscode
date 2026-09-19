import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import type { RecoveryPort } from './recoveryMissionPort';
import { MissionSnapshotReducer } from './MissionSnapshotReducer';

export function recoverMissionProjection(
  ctl: RecoveryPort,
  runtime: DroidRuntime,
  generation: number,
  sessionId: string,
  cwd: string,
): void {
  if (ctl.missionState.mission?.role !== 'orchestrator') {
    ctl.missionState.missionRuntime = null;
    return;
  }
  const validator = runtime.readMissionSettings?.() ?? {
    scrutinyEnabled: true,
    userTestingEnabled: true,
  };
  void ctl.missionGateway?.recover(sessionId, validator).then((recovered) => {
    if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
      return;
    }
    if (recovered !== null && recovered !== undefined) {
      ctl.missionState.missionRuntime = recovered;
    } else {
      const detached = new MissionSnapshotReducer(validator);
      if (
        ctl.missionState.mission?.state !== null &&
        ctl.missionState.mission?.state !== undefined
      ) {
        detached.apply({
          type: 'mission-state',
          lifecycle: ctl.missionState.mission.state,
        });
      }
      detached.setAvailability('detached');
      ctl.missionState.missionRuntime = detached;
    }
    ctl.emit(ctl.missionState.missionRuntime.snapshot());
  });
}
