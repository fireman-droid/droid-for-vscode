import type { RuntimeEvent } from '../../../runtime/runtimeEvents';
import type { RuntimeEventsPort } from './runtimeEventsMissionPort';

type TurnRuntimeEvent = Exclude<RuntimeEvent, { type: 'turn-complete' }>;

export function handleMissionRuntimeEvent(
  ctl: RuntimeEventsPort,
  event: TurnRuntimeEvent,
): boolean {
  switch (event.type) {
    case 'mission-state':
    case 'mission-features':
    case 'mission-progress':
    case 'mission-heartbeat':
    case 'mission-worker-started':
    case 'mission-worker-completed':
      if (ctl.missionState.stopMissionSubscription) return true;
      if (ctl.missionState.missionRuntime?.apply(event) === true) {
        if (event.type === 'mission-state') {
          ctl.missionState.mission = {
            state: event.lifecycle,
            role: ctl.missionState.mission?.role ?? 'orchestrator',
          };
        }
        ctl.emit(ctl.missionState.missionRuntime.snapshot());
      }
      return true;
    default:
      return false;
  }
}
