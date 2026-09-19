import { useEffect, useState } from 'react';
import type { ChangesTranscriptItem } from '../../../shared/protocol/transcript';
import type { ReviewAgentStateMessage, ReviewOperationResultMessage, ReviewRestorePreviewStateMessage, ReviewScopeKind, ReviewScopeState } from '../../../shared/bridgeMessages';
import type { ReviewActions } from './useReviewActions';

export interface ReviewDockProps extends ReviewActions {
  readonly changes: ChangesTranscriptItem;
  readonly review: ReviewScopeState | null;
  readonly restorePreview: ReviewRestorePreviewStateMessage | null;
  readonly operation: ReviewOperationResultMessage | null;
  readonly agent: ReviewAgentStateMessage | null;
  readonly deferMount?: boolean;
}

export function useReviewScopeFlow(review: ReviewScopeState | null, operation: ReviewOperationResultMessage | null, onOpenScope: ReviewActions['onOpenScope']) {
  const [openNoticeSequence, setOpenNoticeSequence] = useState<number | null>(null);
  const [pendingScope, setPendingScope] = useState<{ readonly kind: ReviewScopeKind; readonly turnId?: string; readonly operationSequence: number } | null>(null);
  useEffect(() => {
    if (pendingScope !== null && review?.scopeKind === pendingScope.kind &&
      ((pendingScope.kind !== 'turn' && pendingScope.kind !== 'operations') || review.turnId === pendingScope.turnId)) setPendingScope(null);
  }, [pendingScope, review]);
  useEffect(() => {
    if (pendingScope !== null && operation?.operation === 'open' && !operation.ok && operation.sequence > pendingScope.operationSequence) setPendingScope(null);
  }, [operation, pendingScope]);
  useEffect(() => {
    if (operation?.operation !== 'open' || !operation.ok) return;
    setOpenNoticeSequence(operation.sequence);
    const timer = setTimeout(() => setOpenNoticeSequence((current) => current === operation.sequence ? null : current), 1800);
    return () => clearTimeout(timer);
  }, [operation]);
  const openScope: ReviewActions['onOpenScope'] = (kind, turnId, openCurrent) => {
    if (pendingScope !== null) return;
    setPendingScope({ kind, ...(turnId === undefined ? {} : { turnId }), operationSequence: operation?.sequence ?? -1 });
    onOpenScope(kind, turnId, openCurrent);
  };
  return { pendingScope, openNoticeSequence, openScope };
}
