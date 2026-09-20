import { useContext, useState } from 'react';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { InlineDiffContext } from '../../webview/assistant/changes/useInlineDiff';
import { DiffView } from '../review/DiffView';
import { Button } from '../ui/button';
import { useToolActions } from './toolActions';
import { isConfirmedOperationFile, operationDiffWithChanges } from '../../shared/protocol/operationDiff';
import { inlineDiffLines } from '../../webview/assistant/changes/inlineDiffLines';
import { operationLabel } from './operationPresentation';
export const OPERATION_UNAVAILABLE = {
  'not-recorded': 'This operation’s Diff was not recorded.',
  'unattributed': 'An exact before/after change could not be attributed to this operation.',
  'failed': 'The operation failed. Any partial changes cannot be attributed reliably.',
  'too-large': 'This operation exceeds the inline Diff limit.',
  'restricted': 'This operation’s content is restricted.',
  'evicted': 'This operation’s Diff is no longer retained.',
  'unchanged': 'No changes in this operation.',
};
export function OperationDiff({ item }: { item: ToolTranscriptItem }) {
  const context = useContext(InlineDiffContext);
  const actions = useToolActions();
  const [expanded, setExpanded] = useState(false);
  const result = item.operationDiff ? operationDiffWithChanges(item.operationDiff) : undefined;
  const hasToolResult = result?.status === 'ready' && result.source === 'tool-result';
  const open = (path?: string) => {
    if (context?.sessionId && context.connected) context.port.postMessage({
      type: 'review.panel.open', sessionId: context.sessionId,
      scopeKind: 'operations', turnId: item.turnId,
      ...(path ? { path } : {}),
    });
  };
  if ((item.status === 'running' || item.status === 'stopping') && !hasToolResult) return null;
  if (result?.status === 'unavailable' && result.reason === 'unchanged') return null;
  if (result?.status !== 'ready') return <div className="operation-diff-unavailable">
    <span>{OPERATION_UNAVAILABLE[result?.reason ?? 'not-recorded']}</span>
  </div>;
  if (result.source !== 'tool-result') return <p className="operation-diff-unavailable" role="status">
    {operationLabel(result)}. No confirmed changes were recorded.
  </p>;
  return <section className="operation-diff" aria-label={operationLabel(result)}>
    <p className="operation-diff-note" role="status">{operationLabel(result)}</p>
    {result.files.map((file) => {
      const confirmed = isConfirmedOperationFile(result, file);
      const lines = confirmed ? inlineDiffLines(file.patch) : [];
      const added = lines.filter((line) => line.kind === 'add').length;
      const removed = lines.filter((line) => line.kind === 'remove').length;
      return <div key={file.path} className="operation-diff-file">
      <header>
        <Button variant="plain" size="none" title={file.path} disabled={!actions.openPath} onClick={() => actions.openPath?.({ path: file.path })}>{file.path}</Button>
        {(added || removed) && confirmed
          ? <span className="operation-diff-stats" aria-label={`${added} operation lines added, ${removed} operation lines removed`}><i>+{added}</i><b>−{removed}</b></span> : null}
        <span>{file.kind}{file.outcome ? ` · ${file.outcome === 'uncertain' ? 'side effects unconfirmed' : file.outcome}` : ''}</span>
        {confirmed ? <Button variant="link" size="sm" disabled={!context?.connected || !context.sessionId} onClick={() => open(file.path)}>Review</Button> : null}
      </header>
      {file.previousPath ? <p className="operation-diff-note">Moved from {file.previousPath}</p> : null}
      {file.message ? <p role="status" className="operation-diff-note">{file.message}</p> : null}
      {!confirmed ? <p className="operation-diff-note">No confirmed change to display for this file.</p>
        : !file.patch || file.patch === '@@' ? <p className="operation-diff-note">No complete text Diff was recorded for this result.</p>
        : <DiffView patch={file.patch} path={file.path} limit={expanded ? undefined : 14} />}
    </div>;
    })}
    <footer><span>Operation record · not the current workspace Diff</span>
      {result.files.some((file) => isConfirmedOperationFile(result, file) && file.patch.split('\n').length > 14) ? <Button variant="plain" size="none" onClick={() => setExpanded(!expanded)}>{expanded ? 'Show less' : 'Show all changes'}</Button> : null}
    </footer>
  </section>;
}
