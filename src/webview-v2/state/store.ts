import { reduceAttachmentMessage } from '../chat/attachments/attachmentImageStore';
import { reduceChangesMessage } from '../review/changeMessages';
import { reduceInteractionsMessage } from '../chat/interactions/interactionMessages';
import { reconcileQueueEditing } from '../chat/queue/reconcileQueueEditing';
import { reduceSessionsMessage } from '../chat/sessions/sessionMessages';
import { reduceTurnsMessage } from '../chat/transcript/turnMessages';
import { reduceCapabilitiesMessage } from './capabilityMessages';
import { reduceHostMessageBatch } from './hostMessageBatch';
import { reduceOptimisticIntent } from './optimisticIntent';
import { reduceSnapshotMessage } from './snapshot';
import { reduceHostConnection } from './storeIdentity';
import { advance } from './turnIdentity';
import type {
  AssistantWebviewAction,
  AssistantWebviewState,
  StoreHostMessage,
} from './types';
import { reduceWorkspaceMessage } from './workspaceMessages';

export function assistantWebviewReducer(
  state: AssistantWebviewState,
  action: AssistantWebviewAction,
): AssistantWebviewState {
  if (action.type === 'host.batch')
    return reduceHostMessageBatch(state, action.messages, reduceHostMessage);
  if (action.type !== 'host.message') return reduceOptimisticIntent(state, action);

  return reduceHostMessage(state, action.message);
}

function reduceHostMessage(
  state: AssistantWebviewState,
  event: StoreHostMessage,
): AssistantWebviewState {
  if (!Number.isFinite(event.sequence) || event.sequence <= state.sequence) {
    return state;
  }
  switch (event.type) {
    case 'file.diff':
    case 'file.diff.invalidate':
      // On-demand previews are held only by expanded rows, not persisted transcript state.
      return advance(state, event.sequence);
    case 'host.snapshot':
      return reduceSnapshotMessage(state, event);

    case 'host.connection':
      return reduceHostConnection(state, event);
    case 'host.ide':
      return event.sessionId === state.sessionId && event.conversationId === state.conversationId
        ? { ...state, sequence: event.sequence, ide: event.ide }
        : advance(state, event.sequence);
    case 'session.settings':
    case 'session.context':
    case 'session.tokenUsage':
    case 'session.model-catalog':
    case 'session.skills':
    case 'session.plugins':
    case 'session.mcp':
    case 'session.commands':
    case 'mcp.auth':
      return reduceCapabilitiesMessage(state, event);

    case 'session.btw':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            btw: event.btw,
          }
        : advance(state, event.sequence);

    case 'customModels.state':

    case 'customModels.discovery':

    case 'providerModels.state':
      // Panel-scoped masked state: the CustomModelsPanel flow hook
      // consumes it off its own window listener (on-demand pull, not
      // snapshot-resident); the store only advances the sequence.
      return advance(state, event.sequence);

    case 'session.attachments':

    case 'session.attachmentImageData':

    case 'session.editAttachments':
      return reduceAttachmentMessage(state, event);

    case 'turn.editResendRejected':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            editResendRejection: {
              messageId: event.messageId,
              reason: event.reason,
              sequence: event.sequence,
            },
          }
        : advance(state, event.sequence);
    case 'session.running':
    case 'session.archived':
    case 'session.searchResults':
      return reduceSessionsMessage(state, event);
    case 'workspace.files':
    case 'workspace.imageData':
      return reduceWorkspaceMessage(state, event);
    case 'git.branchDiff':
    case 'git.status':
    case 'git.commitResult':
    case 'review.state':
    case 'review.restorePreview':
    case 'review.operationResult':
    case 'review.agentReviewState':
      return reduceChangesMessage(state, event);

    case 'rewind.info': {
      const { type: _type, sequence, sessionId, ...rewindInfo } = event;
      return sessionId === state.sessionId
        ? { ...state, sequence, rewindInfo }
        : advance(state, sequence);
    }
    case 'assistant.delta':
    case 'thinking.delta':
    case 'thinking.complete':
    case 'tool.activity':
    case 'subagent.update':
    case 'transcript.image':
    case 'changes.update':
    case 'runtime.diagnostic':
    case 'user.message-meta':
    case 'turn.state':
    case 'turn.error':
      return reduceTurnsMessage(state, event);

    case 'subagent.activity':
      return advance(state, event.sequence);
    case 'interaction.request':
    case 'interaction.closed':
    case 'plan.document.state':
      return reduceInteractionsMessage(state, event);

    case 'queue.state':
      return event.sessionId === state.sessionId
        ? {
            ...state,
            sequence: event.sequence,
            queue: { items: event.items, paused: event.paused },
            queueEditing: reconcileQueueEditing(state.queueEditing, {
              items: event.items,
              paused: event.paused,
            }),
          }
        : advance(state, event.sequence);

    case 'mission.snapshot':
      return {
        ...state,
        sequence: event.sequence,
        missionSnapshot: event,
      };

    case 'mission.controlResult':
      return {
        ...state,
        sequence: event.sequence,
        missionControlResult: event,
      };
  }
}

export type { AttachmentImageEntry } from '../chat/attachments/attachmentImageStore';
export { initialGitCommitFlowState } from '../review/gitCommitStore';
export type {
  GitAvailability,
  GitCommitFlowState,
  GitCommitResultState,
} from '../review/gitCommitStore';
export type { PendingInteraction } from '../chat/interactions/interactionStore';
export { initialAssistantWebviewState } from './initialState';
export { isTurnActive } from './turnIdentity';
export type {
  AssistantTurn,
  AssistantWebviewAction,
  AssistantWebviewState,
  LocalImageEntry,
  StoreHostMessage,
} from './types';
