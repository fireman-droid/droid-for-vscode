import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { MissionSessionState } from './MissionSessionState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
export interface ControlsPort
  extends Pick<
    HostOperations,
    'missionGateway' | 'emit' | 'interactions' | 'emitSessionDiagnostic'
  > {
  readonly sessionState: Readonly<Pick<SessionLifecycleState, 'runtime' | 'sessionId'>>;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
  readonly missionState: Readonly<Pick<MissionSessionState, 'missionRuntime' | 'refreshMission'>>;
  readonly effects: Pick<ChatEffects, 'handleSend'>;
}
