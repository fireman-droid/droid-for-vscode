import type { ChatEffects } from './chatEffects';
import type { HostOperations } from './hostOperations';
import type { SessionLifecycleState } from './sessions/SessionLifecycleState';
export interface BrowserReplayPort
  extends Pick<
    HostOperations,
    'handleMessage' | 'emitTo' | 'reviewCoordinator' | 'interactions' | 'planDocuments'
  > {
  readonly sessionState: Readonly<
    Pick<SessionLifecycleState, 'sessionId' | 'initialization' | 'disposed'>
  >;
  readonly effects: Pick<
    ChatEffects,
    | 'waitForWorkspaceTransition'
    | 'ensureActiveRuntimeWorkspaceCurrent'
    | 'buildHostSnapshot'
  >;
}
