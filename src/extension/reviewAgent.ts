import type {
  ReviewHostMessage,
  ReviewScopeKind,
  ReviewWebviewMessage,
} from '../shared/reviewProtocol';

type Unsequenced<T> = T extends { readonly sequence: number }
  ? Omit<T, 'sequence'>
  : never;

export interface ReviewAgentRunner {
  run(scope: {
    readonly sessionId: string;
    readonly reviewScopeId: string;
    readonly scopeKind: ReviewScopeKind;
    readonly baselineLabel: string;
  }): Promise<{
    readonly sessionId: string;
    readonly completion: Promise<void>;
  }>;
}

export async function runAgentReview(
  runner: ReviewAgentRunner | undefined,
  publish: (message: Unsequenced<ReviewHostMessage>) => void,
  message: Extract<
    ReviewWebviewMessage,
    { type: 'review.runAgentReview' }
  >,
  scope: {
    readonly sessionId: string;
    readonly reviewScopeId: string;
    readonly scopeKind: ReviewScopeKind;
    readonly baselineLabel: string;
  } | undefined,
): Promise<void> {
  if (scope === undefined) return;
  if (scope.scopeKind === 'turn') {
    publish({
      type: 'review.agentReviewState',
      sessionId: message.sessionId,
      reviewScopeId: message.reviewScopeId,
      status: 'failed',
      message:
        'Agent Review is available for Workspace or Branch scope.',
    });
    return;
  }
  if (runner === undefined) return;
  publish({
    type: 'review.agentReviewState',
    sessionId: message.sessionId,
    reviewScopeId: message.reviewScopeId,
    status: 'starting',
  });
  try {
    const run = await runner.run(scope);
    const state = {
      sessionId: message.sessionId,
      reviewScopeId: message.reviewScopeId,
      reviewSessionId: run.sessionId,
    };
    publish({ type: 'review.agentReviewState', ...state, status: 'running' });
    void run.completion.then(
      () =>
        publish({
          type: 'review.agentReviewState',
          ...state,
          status: 'complete',
        }),
      () =>
        publish({
          type: 'review.agentReviewState',
          ...state,
          status: 'failed',
          message: 'Agent Review did not complete.',
        }),
    );
  } catch {
    publish({
      type: 'review.agentReviewState',
      sessionId: message.sessionId,
      reviewScopeId: message.reviewScopeId,
      status: 'failed',
      message: 'Agent Review could not be started.',
    });
  }
}
