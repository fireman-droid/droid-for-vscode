import type {
  ReviewAgentStateMessage,
  ReviewHostMessage,
  ReviewOperationResultMessage,
  ReviewRestorePreviewStateMessage,
  ReviewScopeState,
} from '../../../shared/protocol/reviewProtocol';

export interface ReviewUiState {
  readonly scope: ReviewScopeState | null;
  readonly restorePreview: ReviewRestorePreviewStateMessage | null;
  readonly operation: ReviewOperationResultMessage | null;
  readonly agent: ReviewAgentStateMessage | null;
}

export const EMPTY_REVIEW_UI_STATE: ReviewUiState = {
  scope: null,
  restorePreview: null,
  operation: null,
  agent: null,
};

export function reduceReviewUiMessage(
  state: ReviewUiState,
  message: ReviewHostMessage,
  sessionId: string | null,
): ReviewUiState {
  if (
    (message.type === 'review.state' ? message.state.sessionId : message.sessionId) !==
    sessionId
  ) {
    return state;
  }
  switch (message.type) {
    case 'review.state':
      return {
        ...state,
        scope: message.state,
        restorePreview:
          message.state.reviewScopeId === state.restorePreview?.reviewScopeId
            ? state.restorePreview
            : null,
      };
    case 'review.restorePreview':
      return { ...state, restorePreview: message };
    case 'review.operationResult':
      return {
        ...state,
        operation: message,
        restorePreview:
          (message.operation === 'restore-file' ||
            message.operation === 'restore-turn') &&
          message.reviewScopeId === state.restorePreview?.reviewScopeId
            ? null
            : state.restorePreview,
      };
    case 'review.agentReviewState':
      return { ...state, agent: message };
  }
}
