import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useContext, useEffect, useState } from 'react';
import { ChangeSummaryView } from '@droidvisx/chat-ui/chat/ChangeSummaryView';
import { InlineDiffContext } from '../review/useInlineDiff';
import type { OperationSummary } from './operationSummary';
import { operationUndoUnavailable } from '../../shared/protocol/operationUndo';
import type { ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import { subscribeHostMessages } from '../host/hostMessageSource';
export { summarizeOperations, type OperationSummary } from './operationSummary';

export function AiOperationSummary({ summary, onInteract }: { readonly summary: OperationSummary; readonly onInteract?: () => void }) {
  const { t } = useI18n();
  const context = useContext(InlineDiffContext);
  const [undoScope, setUndoScope] = useState<ReviewScopeState | null>(null);
  useEffect(() => {
    setUndoScope(null);
    return subscribeHostMessages(message => {
      if (message.type === 'review.state' && message.state.scopeKind === 'operations' &&
        message.state.sessionId === context?.sessionId && message.state.turnId === summary.turnId)
        setUndoScope(message.state);
    });
  }, [context?.sessionId, summary]);
  if (summary.files.size === 0) return null;
  const connected = !!context?.sessionId;
  const recordedReason = [...summary.files.values()].flatMap(file => file.records)
    .map(operationUndoUnavailable).find(reason => reason !== undefined);
  const currentScope = undoScope?.sessionId === context?.sessionId && undoScope?.turnId === summary.turnId ? undoScope : null;
  const undoReason = currentScope ? currentScope.lifecycle === 'writing' ? 'Wait for this turn to finish.' :
    currentScope.files.every(file => file.undone) ? 'These recorded operations have already been undone.' :
    currentScope.files.find(file => !file.undone && !file.restorable)?.undoReason : recordedReason;
  const open = (path?: string, action?: 'undo') => {
    if (context?.sessionId) context.port.postMessage({
      type: 'review.panel.open', sessionId: context.sessionId, scopeKind: action ? 'operations' : 'turn', turnId: summary.turnId,
      ...(path ? { path } : {}), ...(action ? { action } : {}),
    });
  };
  return <ChangeSummaryView files={[...summary.files.values()]} onInteract={onInteract}
    onReview={connected ? () => open() : undefined} onUndo={connected ? () => open(undefined, 'undo') : undefined}
    undoDisabled={undoReason !== undefined}
    undoReason={undoReason}
    onSelectFile={connected ? (path) => open(path) : undefined}
    note={summary.unconfirmed || summary.delegated ? <>
      {summary.unconfirmed ? t("{p0} failed or unconfirmed file results are excluded. ", { p0: summary.unconfirmed }) : ''}
      {summary.delegated ? t("Delegated results are available in Review and excluded from these counts.") : ''}
    </> : undefined} />;
}
