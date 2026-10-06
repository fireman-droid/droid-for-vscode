import { useContext } from 'react';
import { FileChangeView } from '@droidvisx/chat-ui/chat/FileChangeView';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { InlineDiffContext } from '../review/useInlineDiff';
import { DiffView } from '../review/DiffView';
import { RecordedSource } from '../review/RecordedSource';
import { isConfirmedOperationFile, isWorkspaceOperationFile, operationDiffWithChanges, type OperationDiffFile } from '../../shared/protocol/operationDiff';
import { operationFileStats } from '../chat/operationSummary';
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

export function OperationFileDetails({ file }: { readonly file: OperationDiffFile }) {
  return <div className="operation-diff">
    {file.scope === 'mission' ? <p className="operation-diff-note">Mission artifact · Read-only</p> : null}
    {file.previousPath ? <p className="operation-diff-note">Moved from {file.previousPath}</p> : null}
    {file.message ? <p role="status" className="operation-diff-note">{file.message}</p> : null}
    {file.submittedContent !== undefined ? <>
      <p className="operation-diff-note">Write succeeded. Showing submitted content; the previous version was not recorded.</p>
      <RecordedSource content={file.submittedContent} path={file.path} label="Submitted file" />
    </> : !file.patch || file.patch === '@@' ? file.contentRestricted ? null : <p className="operation-diff-note">No complete text Diff was recorded for this result.</p>
      : <DiffView patch={file.patch} path={file.path} />}
  </div>;
}

export function OperationDiff({ item, hideConfirmed = false, onInteract }: { item: ToolTranscriptItem; readonly hideConfirmed?: boolean; readonly onInteract?: () => void }) {
  const context = useContext(InlineDiffContext);
  const result = item.operationDiff ? operationDiffWithChanges(item.operationDiff) : undefined;
  const hasToolResult = result?.status === 'ready' && result.source === 'tool-result';
  if ((item.status === 'running' || item.status === 'stopping') && !hasToolResult) return null;
  if (result?.status === 'unavailable' && result.reason === 'unchanged') return null;
  if (result?.status !== 'ready') return <p className="operation-diff-unavailable">{OPERATION_UNAVAILABLE[result?.reason ?? 'not-recorded']}</p>;
  if (result.source !== 'tool-result') return <p className="operation-diff-unavailable" role="status">
    {operationLabel(result)}. No confirmed changes were recorded.
  </p>;
  const files = result.files.filter((file) => !hideConfirmed || !isWorkspaceOperationFile(file) || !isConfirmedOperationFile(result, file));
  if (!files.length) return null;
  return <div aria-label="File operations" className="my-1 w-full min-w-0">
    {files.map((file) => isConfirmedOperationFile(result, file)
      ? <FileChangeView key={`${file.scope ?? 'workspace'}:${file.path}`} file={operationFileStats(file)} onInteract={onInteract} label={file.submittedContent !== undefined ? 'Written' : file.kind === 'added' ? 'Created' : file.kind === 'deleted' ? 'Deleted' : file.kind === 'renamed' ? 'Renamed' : 'Edited'}
        onSelect={isWorkspaceOperationFile(file) && context?.sessionId ? () => { context.port.postMessage({
          type: 'review.panel.open', sessionId: context.sessionId!, scopeKind: 'operations', turnId: item.turnId, toolUseId: item.toolUseId, path: file.path,
        }); } : undefined}>
        <OperationFileDetails file={file} />
      </FileChangeView>
      : <p key={`${file.scope ?? 'workspace'}:${file.path}`} role="status" className="operation-diff-note">{file.path} · {file.outcome === 'failed' ? 'Operation failed' : 'Changes unconfirmed'}{file.message ? ` · ${file.message}` : ''}</p>)}
  </div>;
}
