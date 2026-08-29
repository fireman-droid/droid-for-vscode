import { useCallback } from "react";

import type {
  ChangesTranscriptItem,
  ReviewAgentStateMessage,
  ReviewOperationResultMessage,
  ReviewRestorePreviewStateMessage,
  ReviewScopeKind,
  ReviewScopeState,
  ReviewWebviewMessage,
  WebviewToHostMessage,
} from "../../shared/bridgeMessages";
import { ReviewDock } from "./ReviewDock";

interface MessagePoster {
  postMessage(message: WebviewToHostMessage): void;
}

type Sessionless<T> = T extends { readonly sessionId: string }
  ? Omit<T, "sessionId">
  : never;

export function ReviewDockSlot({
  changes,
  sessionId,
  vscode,
  review,
  restorePreview,
  operation,
  agent,
}: {
  readonly changes: ChangesTranscriptItem | null;
  readonly sessionId: string | null;
  readonly vscode: MessagePoster;
  readonly review: ReviewScopeState | null;
  readonly restorePreview: ReviewRestorePreviewStateMessage | null;
  readonly operation: ReviewOperationResultMessage | null;
  readonly agent: ReviewAgentStateMessage | null;
}): React.JSX.Element | null {
  const postReview = useCallback(
    (message: Sessionless<ReviewWebviewMessage>): void => {
      if (sessionId !== null) {
        vscode.postMessage({ ...message, sessionId } as WebviewToHostMessage);
      }
    },
    [sessionId, vscode],
  );
  if (changes === null || changes.files.length === 0) {
    return null;
  }
  const scope = review?.sessionId === sessionId ? review : null;
  return (
    <ReviewDock
      key={`${sessionId ?? "none"}:${changes.turnId}`}
      changes={changes}
      review={scope}
      restorePreview={restorePreview}
      operation={operation}
      agent={agent}
      onOpenScope={(scopeKind: ReviewScopeKind, turnId?: string) =>
        postReview({
          type: "review.open",
          scopeKind,
          ...(turnId === undefined ? {} : { turnId }),
        })
      }
      onSelectFile={(path) => {
        if (scope !== null) {
          postReview({
            type: "review.selectFile",
            reviewScopeId: scope.reviewScopeId,
            baseline: scope.baseline,
            path,
          });
        }
      }}
      onNavigate={(direction) => {
        if (scope !== null) {
          postReview({
            type: "review.navigate",
            reviewScopeId: scope.reviewScopeId,
            baseline: scope.baseline,
            direction,
          });
        }
      }}
      onMarkReviewed={(advance) => {
        const current =
          scope?.currentIndex === null || scope?.currentIndex === undefined
            ? null
            : scope.files[scope.currentIndex] ?? null;
        if (scope !== null && current !== null) {
          postReview({
            type: "review.markReviewed",
            reviewScopeId: scope.reviewScopeId,
            baseline: scope.baseline,
            path: current.path,
            version: current.version,
            advance,
          });
        }
      }}
      onPreviewRestore={(target) => {
        const current =
          scope?.currentIndex === null || scope?.currentIndex === undefined
            ? null
            : scope.files[scope.currentIndex] ?? null;
        if (scope !== null && (target === "turn" || current !== null)) {
          postReview({
            type: "review.restorePreview",
            reviewScopeId: scope.reviewScopeId,
            baseline: scope.baseline,
            target,
            ...(target === "file" && current !== null
              ? { path: current.path, version: current.version }
              : {}),
          });
        }
      }}
      onConfirmRestore={(target, previewId) => {
        if (scope !== null) {
          postReview({
            type: target === "file" ? "review.restoreFile" : "review.restoreTurn",
            reviewScopeId: scope.reviewScopeId,
            baseline: scope.baseline,
            previewId,
          });
        }
      }}
      onRunAgentReview={() => {
        if (scope !== null) {
          postReview({
            type: "review.runAgentReview",
            reviewScopeId: scope.reviewScopeId,
            baseline: scope.baseline,
          });
        }
      }}
      deferMount
    />
  );
}
