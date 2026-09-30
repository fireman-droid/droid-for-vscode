import { type HostConnectionMessage } from '../../shared/protocol/shell';
import { UNAVAILABLE_IDE } from '../../shared/protocol/ideProtocol';
import { EMPTY_SESSION_BTW_STATE } from '../../shared/protocol/btwProtocol';
import { EMPTY_SESSION_QUEUE_STATE } from '../../shared/protocol/queueProtocol';
import { EMPTY_SESSION_TOKEN_USAGE } from '../../shared/protocol/tokenUsage';
import { initialGitCommitFlowState } from '../review/gitCommitStore';
import { EMPTY_REVIEW_UI_STATE } from '../review/reviewStore';
import { type AssistantWebviewState } from './types';

export function reduceHostConnection(
  state: AssistantWebviewState,
  event: HostConnectionMessage,
): AssistantWebviewState {
  const conversationChanged = event.conversationId !== state.conversationId;
  const sessionChanged = event.sessionId !== state.sessionId;
  return {
    ...state,
    sequence: event.sequence,
    conversationId: event.conversationId,
    sessionId: event.sessionId,
    pendingTurnId: conversationChanged || sessionChanged ? null : state.pendingTurnId,
    connection: event.connection,
    ide: conversationChanged || sessionChanged ? UNAVAILABLE_IDE : state.ide,
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
