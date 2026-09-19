import type { ChatEffects } from './chatEffects';
import type { HostOperations } from './hostOperations';
import type { ConversationRecoveryState } from './recovery/ConversationRecoveryState';
import type { MissionSessionState } from './mission/MissionSessionState';
import type { QueueState } from './queue/QueueState';
import type { SessionDirectoryState } from './sessions/SessionDirectoryState';
import type { SessionLifecycleState } from './sessions/SessionLifecycleState';
import type { TurnState } from './turns/TurnState';
import type { IdeState } from '../../shared/protocol/ideProtocol';
export interface HostSnapshotPort
  extends Pick<
    HostOperations,
    | 'diagnostics'
    | 'recoveryStore'
    | 'getWorkspaceContext'
    | 'metadata'
    | 'btwSideChat'
    | 'recordHost'
  > {
  readIdeState?(): IdeState;
  readonly sessionState: Readonly<
    Pick<SessionLifecycleState, 'runtime' | 'connection' | 'conversationId' | 'sessionId'>
  >;
  readonly catalogState: Readonly<
    Pick<SessionDirectoryState, 'sessions' | 'worktreeCreateAvailable'>
  >;
  readonly turnState: Readonly<Pick<TurnState, 'turn'>>;
  readonly queueState: Readonly<Pick<QueueState, 'queuedPrompts'>>;
  readonly recoveryState: Readonly<Pick<ConversationRecoveryState, 'transcript'>>;
  readonly missionState: Readonly<Pick<MissionSessionState, 'mission'>>;
  readonly effects: Pick<
    ChatEffects,
    'stampRunningFlags' | 'withActiveSession' | 'projectQueueState'
  >;
}
