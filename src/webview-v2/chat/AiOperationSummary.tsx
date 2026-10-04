import { useContext } from 'react';
import { ChangeSummaryView } from '@droidvisx/chat-ui/chat/ChangeSummaryView';
import { InlineDiffContext } from '../review/useInlineDiff';
import { OperationFileDetails } from '../content/OperationDiff';
import type { OperationSummary } from './operationSummary';
export { summarizeOperations, type OperationSummary } from './operationSummary';

export function AiOperationSummary({ summary, onInteract }: { readonly summary: OperationSummary; readonly onInteract?: () => void }) {
  const context = useContext(InlineDiffContext);
  if (summary.files.size === 0) return null;
  const connected = !!context?.sessionId;
  const contentRestricted = [...summary.files.values()].some((file) =>
    file.records.some((record) => record.contentRestricted));
  const open = (path?: string, action?: 'undo', scopeKind: 'turn' | 'operations' = 'turn') => {
    if (context?.sessionId) context.port.postMessage({
      type: 'review.panel.open', sessionId: context.sessionId, scopeKind: action ? 'operations' : scopeKind, turnId: summary.turnId,
      ...(path ? { path } : {}), ...(action ? { action } : {}),
    });
  };
  return <ChangeSummaryView files={[...summary.files.values()]} onInteract={onInteract}
    onReview={connected ? () => open() : undefined} onUndo={connected ? () => open(undefined, 'undo') : undefined}
    onReviewEdits={connected ? () => open(undefined, undefined, 'operations') : undefined}
    undoDisabled={contentRestricted}
    undoReason={contentRestricted ? 'Some file content is restricted. Review individual files to undo available operations.' : undefined}
    onSelectFile={connected ? (path) => open(path) : undefined}
    renderFileDetails={(path) => summary.files.get(path)?.records.map((file, index) => <div key={index}>
      {summary.files.get(path)!.records.length > 1 ? <p className="operation-diff-note">Recorded operation {index + 1}</p> : null}
      <OperationFileDetails file={file} />
    </div>)}
    note={summary.unconfirmed || summary.delegated ? <>
      {summary.unconfirmed ? `${summary.unconfirmed} failed or unconfirmed file results are excluded. ` : ''}
      {summary.delegated ? 'Delegated results are available in Review and excluded from these counts.' : ''}
    </> : undefined} />;
}
