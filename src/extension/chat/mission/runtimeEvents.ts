import type { RuntimeEvent } from '../../../runtime/runtimeEvents';
import type { ChatControllerInternals } from '../internals';

type TurnRuntimeEvent = Exclude<RuntimeEvent, { type: 'turn-complete' }>;

export function handleMissionRuntimeEvent(
  ctl: ChatControllerInternals,
  event: TurnRuntimeEvent,
): boolean {
  switch (event.type) {
    case 'mission-state':
    case 'mission-features':
    case 'mission-progress':
    case 'mission-heartbeat':
    case 'mission-worker-started':
    case 'mission-worker-completed':
      if (ctl.missionRuntime?.apply(event) === true) {
        if (event.type === 'mission-state') {
          ctl.mission = {
            state: event.lifecycle,
            role: ctl.mission?.role ?? 'orchestrator',
          };
        }
        ctl.emit(ctl.missionRuntime.snapshot());
      }
      return true;
    default:
      return false;
  }
}
