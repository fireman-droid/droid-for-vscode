import type {
  ReviewHostMessage,
  ReviewScopeKind,
  ReviewWebviewMessage,
} from '../../shared/protocol/reviewProtocol';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import { classifyOperationError, recordOperation } from '../diagnostics/operationDiagnostics';

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
  message: Extract<ReviewWebviewMessage, { type: 'review.runAgentReview' }>,
  scope:
    | {
        readonly sessionId: string;
        readonly reviewScopeId: string;
        readonly scopeKind: ReviewScopeKind;
        readonly baselineLabel: string;
      }
    | undefined,
  diagnostics?: Pick<RuntimeDiagnosticSink, 'record'>,
): Promise<void> {
  const started = performance.now();
  if (scope === undefined || runner === undefined) {
    recordOperation(diagnostics, 'review', 'review.runAgentReview', started, { outcome: 'blocked', failureKind: 'unavailable' });
    if (scope === undefined) return;
  }
  if (scope.scopeKind !== 'workspace' && scope.scopeKind !== 'branch') {
    if (runner) recordOperation(diagnostics, 'review', 'review.runAgentReview', started, { outcome: 'blocked', failureKind: 'invalid-data' });
    publish({
      type: 'review.agentReviewState',
      sessionId: message.sessionId,
      reviewScopeId: message.reviewScopeId,
      status: 'failed',
      message: 'Agent Review is available for Workspace or Branch scope.',
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
    recordOperation(diagnostics, 'review', 'review.runAgentReview', started, { outcome: 'accepted' });
    const state = {
      sessionId: message.sessionId,
      reviewScopeId: message.reviewScopeId,
      reviewSessionId: run.sessionId,
    };
    publish({ type: 'review.agentReviewState', ...state, status: 'running' });
    void run.completion.then(
      () => {
        recordOperation(diagnostics, 'review', 'review.runAgentReview', started, { outcome: 'success' });
        publish({
          type: 'review.agentReviewState',
          ...state,
          status: 'complete',
        });
      },
      error => {
        recordOperation(diagnostics, 'review', 'review.runAgentReview', started, classifyOperationError(error));
        publish({
          type: 'review.agentReviewState',
          ...state,
          status: 'failed',
          message: 'Agent Review did not complete.',
        });
      },
    );
  } catch (error) {
    recordOperation(diagnostics, 'review', 'review.runAgentReview', started, classifyOperationError(error));
    publish({
      type: 'review.agentReviewState',
      sessionId: message.sessionId,
      reviewScopeId: message.reviewScopeId,
      status: 'failed',
      message: 'Agent Review could not be started.',
    });
  }
}
