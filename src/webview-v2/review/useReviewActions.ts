import { useCallback, useMemo } from 'react';
import type { ReviewScopeKind, ReviewScopeState, ReviewWebviewMessage, WebviewToHostMessage } from '../../shared/bridgeMessages';

type Sessionless<T> = T extends { readonly sessionId: string } ? Omit<T, 'sessionId'> : never;
export interface ReviewActions {
  readonly onOpenScope: (kind: ReviewScopeKind, turnId?: string, openCurrent?: true) => void;
  readonly onSelectFile: (path: string) => void;
  readonly onNavigate: (direction: 'previous' | 'next') => void;
  readonly onMarkReviewed: (advance: boolean) => void;
  readonly onPreviewRestore: (target: 'file' | 'turn') => void;
  readonly onConfirmRestore: (target: 'file' | 'turn', previewId: string) => void;
  readonly onRunAgentReview: () => void;
}

export function useReviewActions(
  vscode: { postMessage(message: WebviewToHostMessage): void },
  sessionId: string | null,
  review: ReviewScopeState | null,
) {
  const scope = review?.sessionId === sessionId ? review : null;
  const post = useCallback((message: Sessionless<ReviewWebviewMessage>) => {
    if (sessionId !== null) vscode.postMessage({ ...message, sessionId } as WebviewToHostMessage);
  }, [vscode, sessionId]);
  const actions = useMemo<ReviewActions>(() => ({
    onOpenScope: (scopeKind, turnId, openCurrent) => post({
      type: 'review.open', scopeKind,
      ...(turnId === undefined ? {} : { turnId }),
      ...(openCurrent === true ? { openCurrent } : {}),
    }),
    onSelectFile: (path) => {
      if (scope !== null) post({ type: 'review.selectFile', reviewScopeId: scope.reviewScopeId, baseline: scope.baseline, path });
    },
    onNavigate: (direction) => {
      if (scope !== null) post({ type: 'review.navigate', reviewScopeId: scope.reviewScopeId, baseline: scope.baseline, direction });
    },
    onMarkReviewed: (advance) => {
      const current = scope?.currentIndex == null ? null : scope.files[scope.currentIndex] ?? null;
      if (scope !== null && current !== null) post({
        type: 'review.markReviewed', reviewScopeId: scope.reviewScopeId, baseline: scope.baseline,
        path: current.path, version: current.version, advance,
      });
    },
    onPreviewRestore: (target) => {
      const current = scope?.currentIndex == null ? null : scope.files[scope.currentIndex] ?? null;
      if (scope !== null && (target === 'turn' || current !== null)) post({
        type: 'review.restorePreview', reviewScopeId: scope.reviewScopeId, baseline: scope.baseline, target,
        ...(target === 'file' && current !== null ? { path: current.path, version: current.version } : {}),
      });
    },
    onConfirmRestore: (target, previewId) => {
      if (scope !== null) post({
        type: target === 'file' ? 'review.restoreFile' : 'review.restoreTurn',
        reviewScopeId: scope.reviewScopeId, baseline: scope.baseline, previewId,
      });
    },
    onRunAgentReview: () => {
      if (scope !== null) post({ type: 'review.runAgentReview', reviewScopeId: scope.reviewScopeId, baseline: scope.baseline });
    },
  }), [post, scope]);
  return { scope, actions };
}
