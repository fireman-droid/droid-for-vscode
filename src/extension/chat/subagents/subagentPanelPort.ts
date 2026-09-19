import type { HostOperations } from '../hostOperations';
import type { ConversationRecoveryState } from '../recovery/ConversationRecoveryState';
import type { SessionLifecycleState } from '../sessions/SessionLifecycleState';
import type { SubagentWatchState } from './SubagentWatchState';
export interface SubagentPanelPort
  extends Pick<HostOperations, 'emit' | 'sessionHistory'> {
  readonly sessionState: Readonly<
    Pick<SessionLifecycleState, 'sessionId' | 'activeRuntimeCwd' | 'disposed'>
  >;
  readonly recoveryState: Readonly<Pick<ConversationRecoveryState, 'transcript'>>;
  readonly subagentState: Readonly<Pick<SubagentWatchState, 'subagentTranscripts'>>;
}
