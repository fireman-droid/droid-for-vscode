import type { HostConnectionMessage } from '../../shared/bridgeMessages';
import { EMPTY_SESSION_BTW_STATE } from '../../shared/btwProtocol';
import { EMPTY_SESSION_QUEUE_STATE } from '../../shared/queueProtocol';
import { EMPTY_SESSION_TOKEN_USAGE } from '../../shared/tokenUsage';
import { initialGitCommitFlowState } from './gitCommitStore';
import { EMPTY_REVIEW_UI_STATE } from './reviewStore';
import type { AssistantWebviewState } from './store';

export function reduceHostConnection(
  state: AssistantWebviewState,
  event: HostConnectionMessage,
): AssistantWebviewState {
  const conversationChanged =
    event.conversationId !== state.conversationId;
  const sessionChanged = event.sessionId !== state.sessionId;
  return {
    ...state,
    sequence: event.sequence,
    conversationId: event.conversationId,
    sessionId: event.sessionId,
    connection: event.connection,
    ...(conversationChanged
      ? {
          turn: null,
          mission: null,
          missionSnapshot: null,
          missionControlResult: null,
          btw: EMPTY_SESSION_BTW_STATE,
          tokenUsage: EMPTY_SESSION_TOKEN_USAGE,
          queue: EMPTY_SESSION_QUEUE_STATE,
          queueEditing: null,
          transcript: [],
          latestChanges: null,
          historyStatus: null,
          truncated: false,
          settings: { status: 'loading' as const, value: null },
          context: { status: 'loading' as const, value: null },
          modelCatalog: {
            status: 'loading' as const,
            items: [] as const,
          },
          skills: { status: 'idle' as const, items: [] as const },
          mcp: { status: 'idle' as const, items: [] as const },
          plugins: { status: 'idle' as const, items: [] as const },
          commands: {
            status: 'idle' as const,
            items: [] as const,
            recent: [] as const,
          },
          mcpAuth: null,
          attachments: [],
          attachmentImages: {},
          editAttachments: null,
          editResendRejection: null,
          interactions: [],
          terminalTurnId: null,
          review: EMPTY_REVIEW_UI_STATE,
          git: initialGitCommitFlowState,
        }
      : sessionChanged
        ? {
            turn: null,
            mission: null,
            missionSnapshot: null,
            missionControlResult: null,
            btw: EMPTY_SESSION_BTW_STATE,
            tokenUsage: EMPTY_SESSION_TOKEN_USAGE,
            settings: { status: 'loading' as const, value: null },
            context: { status: 'loading' as const, value: null },
            modelCatalog: {
              status: 'loading' as const,
              items: [] as const,
            },
            skills: { status: 'idle' as const, items: [] as const },
            mcp: { status: 'idle' as const, items: [] as const },
            plugins: { status: 'idle' as const, items: [] as const },
            commands: {
              status: 'idle' as const,
              items: [] as const,
              recent: [] as const,
            },
            mcpAuth: null,
            interactions: [],
            terminalTurnId: null,
          }
        : {}),
  };
}
