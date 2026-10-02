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
  ctl.missionState.stopMissionSubscription?.();
  ctl.missionState.stopMissionSubscription = null;
  if (ctl.missionState.mission?.role !== 'orchestrator') {
    ctl.missionState.missionRuntime = null;
    return;
  }
  const mission = new MissionSnapshotReducer(runtime.readMissionSettings?.() ?? {
    scrutinyEnabled: true,
    userTestingEnabled: true,
  });
  const knownLifecycle = ctl.missionState.mission.state;
  if (knownLifecycle) mission.apply({ type: 'mission-state', lifecycle: knownLifecycle });
  ctl.missionState.missionRuntime = mission;
  let emittedRevision = -1;
  const publish = (): void => {
    if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd) ||
        ctl.missionState.missionRuntime !== mission) return;
    const snapshot = runtime.readMissionSnapshot?.();
    if (mission.hydrate(snapshot)) {
      mission.setAvailability('attached');
      ctl.missionState.mission = {
        role: 'orchestrator', state: mission.snapshot().lifecycle ?? null,
      };
    } else {
      const lifecycle = ctl.missionState.mission?.state;
      if (lifecycle) mission.apply({ type: 'mission-state', lifecycle });
      mission.setAvailability('detached');
    }
    if (mission.currentRevision() !== emittedRevision) {
      emittedRevision = mission.currentRevision();
      ctl.emit(mission.snapshot());
    }
  };
  ctl.missionState.stopMissionSubscription = runtime.subscribeMissionSnapshot?.(publish) ?? null;
  publish();
}
