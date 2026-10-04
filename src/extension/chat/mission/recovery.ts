import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import type { RecoveryPort } from './recoveryMissionPort';
import { MissionSnapshotReducer } from './MissionSnapshotReducer';

export function recoverMissionProjection(
  ctl: RecoveryPort,
  runtime: DroidRuntime,
  generation: number,
  sessionId: string,
  cwd: string,
  refreshOnAttach = false,
): void {
  ctl.missionState.stopMissionSubscription?.();
  ctl.missionState.stopMissionSubscription = null;
  ctl.missionState.refreshMission = null;
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
  let active = true;
  let pending: Promise<boolean> | undefined;
  let autoRefreshAttempted = false;
  const isCurrent = () => active && ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd) &&
    ctl.missionState.missionRuntime === mission;
  const publish = (snapshot: unknown): boolean => {
    if (!isCurrent()) return false;
    const available = !(refreshOnAttach && snapshot == null) && mission.hydrate(snapshot);
    if (available) {
      autoRefreshAttempted = false;
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
    return available;
  };
  const refresh = (): Promise<boolean> => {
    if (!isCurrent() || runtime.refreshMissionSnapshot === undefined) return Promise.resolve(false);
    if (pending !== undefined) return pending;
    autoRefreshAttempted = true;
    const operation = Promise.resolve().then(() => isCurrent() ? runtime.refreshMissionSnapshot!() : undefined).then((snapshot) => {
      if (!isCurrent()) return false;
      const available = publish(snapshot);
      ctl.recordHost({ level: available ? 'info' : 'warn', name: 'host.mission.refresh',
        attributes: { sessionId, outcome: available ? 'attached' : snapshot == null ? 'missing-snapshot' : 'invalid-snapshot' } });
      return available;
    }).catch((error: unknown) => {
      if (isCurrent()) ctl.recordHost({ level: 'warn', name: 'host.mission.refresh',
        attributes: { sessionId, outcome: 'request-failed' },
        detail: error instanceof Error ? error.message : String(error) });
      return false;
    });
    pending = operation;
    void operation.then(() => { if (pending === operation) pending = undefined; });
    return operation;
  };
  ctl.missionState.refreshMission = refresh;
  const receive = (): void => {
    if (!isCurrent()) return;
    const available = publish(runtime.readMissionSnapshot?.());
    if (!available && !autoRefreshAttempted && pending === undefined) void refresh();
  };
  const unsubscribe = runtime.subscribeMissionSnapshot?.(receive);
  ctl.missionState.stopMissionSubscription = unsubscribe === undefined ? null : () => { active = false; unsubscribe(); };
  receive();
  // Persisted history carries the Mission role, but not its lifecycle. A null
  // cache can therefore look like new-task setup even when workers already exist.
  if (refreshOnAttach) void refresh();
}
