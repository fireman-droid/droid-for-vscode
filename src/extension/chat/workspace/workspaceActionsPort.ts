import type { ChatEffects } from '../chatEffects';
import type { HostOperations } from '../hostOperations';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { TurnState } from '../turns/TurnState';
export interface WorkspaceActionsPort
  extends Pick<
    HostOperations,
    | 'changeStats'
    | 'fileDiff'
    | 'emitSessionDiagnostic'
    | 'prototypePreview'
    | 'terminalMirror'
    | 'emit'
    | 'gitWorkflow'
    | 'recordHost'
    | 'pathOpener'
    | 'getWorkspaceContext'
    | 'attachmentSources'
  > {
  readonly sessionState: Readonly<
    Pick<
      SessionLifecycleState,
      'runtime' | 'connection' | 'sessionId' | 'activeRuntimeCwd' | 'disposed'
    >
  >;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
  readonly effects: Pick<
    ChatEffects,
    'readConversationTurnChanges' | 'readLatestConversationChanges'
  >;
}
