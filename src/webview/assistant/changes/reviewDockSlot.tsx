import { type ChangesTranscriptItem } from '../../../shared/protocol/transcript';
import {
  type ReviewAgentStateMessage,
  type ReviewOperationResultMessage,
  type ReviewRestorePreviewStateMessage,
  type ReviewScopeState,
  type WebviewToHostMessage,
} from '../../../shared/bridgeMessages';
import { ReviewDock } from './ReviewDock';
import { useReviewActions } from './useReviewActions';

interface MessagePoster {
  postMessage(message: WebviewToHostMessage): void;
}

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
  const { scope, actions } = useReviewActions(vscode, sessionId, review);
  if (changes === null || changes.files.length === 0) {
    return null;
  }
  return (
    <ReviewDock
      key={`${sessionId ?? 'none'}:${changes.turnId}`}
      changes={changes}
      review={scope}
      restorePreview={restorePreview}
      operation={operation}
      agent={agent}
      {...actions}
      deferMount
    />
  );
}
