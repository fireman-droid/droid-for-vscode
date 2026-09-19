import { EMPTY_SESSION_BTW_STATE } from '../../../shared/protocol/btwProtocol';
import { UNAVAILABLE_IDE } from '../../../shared/protocol/ideProtocol';
import { EMPTY_SESSION_QUEUE_STATE } from '../../../shared/protocol/queueProtocol';
import { EMPTY_SESSION_TOKEN_USAGE } from '../../../shared/protocol/tokenUsage';
import { initialGitCommitFlowState } from '../changes/gitCommitStore';
import { EMPTY_REVIEW_UI_STATE } from '../changes/reviewStore';
import { hydrateChangesTranscript } from '../changes/storeChanges';
import { reconcileQueueEditing } from '../queue/reconcileQueueEditing';
import { isTerminalStatus } from './turnIdentity';
import type { AssistantWebviewState, StoreHostMessage } from './types';

export function reduceSnapshotMessage(
  state: AssistantWebviewState,
  event: Extract<StoreHostMessage, { type: 'host.snapshot' }>,
): AssistantWebviewState {
  switch (event.type) {
    case 'host.snapshot': {
      const sameConversation = event.conversationId === state.conversationId;
      const sameSession = event.sessionId === state.sessionId;
      return {
        sequence: event.sequence,
        conversationId: event.conversationId,
        sessionId: event.sessionId,
        latestChanges: event.latestChanges ?? null,
        connection: event.connection,
        ide: event.ide ?? UNAVAILABLE_IDE,
        turn:
          event.turn === null
            ? null
            : {
                turnId: event.turn.turnId,
                status: event.turn.status,
                compacting: event.turn.compacting === true,
                ...(event.turn.error === undefined ? {} : { error: event.turn.error }),
              },
        sessions: event.sessions,
        settings: event.settings,
        context: event.context,
        modelCatalog: event.modelCatalog,
        // Snapshots do not carry skills/MCP; keep them for the same session.
        skills: sameSession ? state.skills : { status: 'idle', items: [] },
        mcp: sameSession ? state.mcp : { status: 'idle', items: [] },
        plugins: sameSession ? state.plugins : { status: 'idle', items: [] },
        commands: sameSession
          ? state.commands
          : { status: 'idle', items: [], recent: [] },
        mcpAuth: sameSession ? state.mcpAuth : null,
        attachments: sameConversation ? state.attachments : [],
        attachmentImages: sameConversation ? state.attachmentImages : {},
        fileSearch: sameConversation ? state.fileSearch : null,
        localImages: sameConversation ? state.localImages : {},
        // Archived list and content search are workspace-level, not
        // session-level; they survive session switches.
        archived: state.archived,
        sessionSearch: state.sessionSearch,
        rewindInfo: null,
        branchDiff: sameConversation ? state.branchDiff : null,
        review: sameConversation ? state.review : EMPTY_REVIEW_UI_STATE,
        // A snapshot means the session identity may have changed (e.g.
        // an adopted edit-resend fork); any in-progress edit is stale.
        editAttachments: sameConversation ? state.editAttachments : null,
        editResendRejection: sameConversation ? state.editResendRejection : null,
        worktreeCreateAvailable: event.worktreeCreateAvailable === true,
        btwAvailable: event.btwAvailable === true,
        backgroundTurnsAvailable: event.backgroundTurnsAvailable === true,
        btw: sameSession ? state.btw : EMPTY_SESSION_BTW_STATE,
        workspaceRoot: event.workspaceRoot ?? null,
        mission: event.mission ?? null,
        missionSnapshot: sameSession ? state.missionSnapshot : null,
        missionControlResult: sameSession ? state.missionControlResult : null,
        tokenUsage: event.tokenUsage ?? EMPTY_SESSION_TOKEN_USAGE,
        queue: event.queue ?? EMPTY_SESSION_QUEUE_STATE,
        queueEditing: reconcileQueueEditing(
          state.queueEditing,
          event.queue ?? EMPTY_SESSION_QUEUE_STATE,
        ),
        transcript: hydrateChangesTranscript(event.transcript, event.turn),
        historyStatus: event.historyStatus,
        truncated: event.truncated,
        interactions: [],
        terminalTurnId:
          event.turn !== null && isTerminalStatus(event.turn.status)
            ? event.turn.turnId
            : null,
        // Git status is workspace-level; a fresh status arrives on demand.
        git: sameConversation ? state.git : initialGitCommitFlowState,
      };
    }
  }
}
