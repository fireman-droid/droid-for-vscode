import { advance } from '../state/turnIdentity';
import type { AssistantWebviewState, StoreHostMessage } from '../state/types';
import { reduceReviewUiMessage } from './reviewStore';

export function reduceChangesMessage(
  state: AssistantWebviewState,
  event: Extract<
    StoreHostMessage,
    {
      type:
        | 'git.branchDiff'
        | 'git.status'
        | 'git.commitResult'
        | 'review.state'
        | 'review.restorePreview'
        | 'review.operationResult'
        | 'review.agentReviewState';
    }
  >,
): AssistantWebviewState {
  switch (event.type) {
    case 'git.branchDiff': {
      const { type: _type, sequence, sessionId, ...branchDiff } = event;
      return sessionId === state.sessionId
        ? { ...state, sequence, branchDiff }
        : advance(state, sequence);
    }

    case 'review.state':
    case 'review.restorePreview':

    case 'review.operationResult':
    case 'review.agentReviewState':
      return {
        ...state,
        sequence: event.sequence,
        review: reduceReviewUiMessage(state.review, event, state.sessionId),
      };

    case 'git.status':
      if (
        event.sessionId !== state.sessionId ||
        event.turnId !== state.git.statusTurnId
      ) {
        return advance(state, event.sequence);
      }
      return {
        ...state,
        sequence: event.sequence,
        git: {
          ...state.git,
          availability:
            event.unavailableReason === undefined ? 'available' : 'unavailable',
          unavailableReason: event.unavailableReason ?? null,
          statusPending: false,
          branch: event.branch,
          files: event.files,
          committedHash: event.committedHash ?? null,
        },
      };

    case 'git.commitResult':
      if (
        event.sessionId !== state.sessionId ||
        event.turnId !== state.git.commitTurnId
      ) {
        return advance(state, event.sequence);
      }
      return {
        ...state,
        sequence: event.sequence,
        git: {
          ...state.git,
          commitPending: false,
          lastResult: event.ok
            ? { ok: true, hash: event.hash, subject: event.subject }
            : { ok: false, error: event.error },
        },
      };
  }
}
