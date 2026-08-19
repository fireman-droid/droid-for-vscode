import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import type { ChatControllerInternals } from '../internals';
import { MissionSnapshotReducer } from './MissionSnapshotReducer';

export function recoverMissionProjection(
  ctl: ChatControllerInternals,
  runtime: DroidRuntime,
  generation: number,
  sessionId: string,
  cwd: string,
): void {
  if (ctl.mission?.role !== 'orchestrator') {
    ctl.missionRuntime = null;
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
      ctl.missionRuntime = recovered;
    } else {
      const detached = new MissionSnapshotReducer(validator);
      if (ctl.mission?.state !== null && ctl.mission?.state !== undefined) {
        detached.apply({
          type: 'mission-state',
          lifecycle: ctl.mission.state,
        });
      }
      detached.setAvailability('detached');
      ctl.missionRuntime = detached;
    }
    ctl.emit(ctl.missionRuntime.snapshot());
  });
}
