import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useContext } from 'react';
import { FileChangeView } from '@droidvisx/chat-ui/chat/FileChangeView';
import { FileDiffPreview } from '@droidvisx/chat-ui/chat/FileDiffPreview';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { InlineDiffContext } from '../review/useInlineDiff';
import { RecordedSource } from '../review/RecordedSource';
import { isConfirmedOperationFile, isWorkspaceOperationFile, operationDiffWithChanges, type OperationDiffFile } from '../../shared/protocol/operationDiff';
import { operationFileStats } from '../chat/operationSummary';
import { operationLabel } from './operationPresentation';
import { formatDuration } from '../chat/thread/readers';
export const OPERATION_UNAVAILABLE = {
  'not-recorded': 'This operation’s Diff was not recorded.',
  'unattributed': 'An exact before/after change could not be attributed to this operation.',
  'failed': 'The operation failed. Any partial changes cannot be attributed reliably.',
  'too-large': 'This operation exceeds the inline Diff limit.',
  'restricted': 'This operation’s content is restricted.',
  'evicted': 'This operation’s Diff is no longer retained.',
  'unchanged': 'No changes in this operation.',
};

function OperationFileDetails({ file, canReview, messageId, disclosureKey, onInteract }: {
  readonly file: OperationDiffFile; readonly canReview: boolean; readonly messageId?: string;
  readonly disclosureKey: string; readonly onInteract?: () => void;
}) {
  const { t } = useI18n();
  return <>
    {file.scope === 'mission' ? <p className="operation-diff-note">{t("Mission artifact · Read-only")}</p> : null}
    {file.previousPath ? <p className="operation-diff-note">{t("Moved from")} {file.previousPath}</p> : null}
    {file.message ? <p role="status" className="operation-diff-note">{file.message}</p> : null}
    {file.submittedContent !== undefined ? <>
      <p className="operation-diff-note">{t("Write succeeded. Showing submitted content; the previous version was not recorded.")}</p>
      <RecordedSource content={file.submittedContent} path={file.path} label={t("Submitted file")} />
    </> : file.bodyRef ? <p className="operation-diff-note">{canReview ? t("This edit is saved. Open Review to read its full content.") : t("Saved patch")}</p>
      : !file.patch || file.patch === '@@' ? file.contentRestricted ? null : <p className="operation-diff-note">{t("No complete text Diff was recorded for this result.")}</p>
      : <FileDiffPreview patch={file.patch} path={file.path} messageId={messageId} disclosureKey={disclosureKey} onInteract={onInteract} />}
  </>;
}

export function OperationDiff({ item, messageId, hideConfirmed = false, confirmedOnly = false, onInteract }: {
  item: ToolTranscriptItem; readonly messageId?: string; readonly hideConfirmed?: boolean; readonly confirmedOnly?: boolean; readonly onInteract?: () => void;
}) {
  const { t } = useI18n();
  const context = useContext(InlineDiffContext);
  const result = item.operationDiff ? operationDiffWithChanges(item.operationDiff) : undefined;
  const hasToolResult = result?.status === 'ready' && result.source === 'tool-result';
  if ((item.status === 'running' || item.status === 'stopping') && !hasToolResult) return null;
  if (result?.status === 'unavailable' && result.reason === 'unchanged') return null;
  if (result?.status !== 'ready') return <p className="operation-diff-unavailable">{t(OPERATION_UNAVAILABLE[result?.reason ?? 'not-recorded'])}</p>;
  if (result.source !== 'tool-result') return <p className="operation-diff-unavailable" role="status">
    {operationLabel(result)}{t(". No confirmed changes were recorded.")}</p>;
  const files = result.files.filter((file) => confirmedOnly
    ? isWorkspaceOperationFile(file) && isConfirmedOperationFile(result, file)
    : !hideConfirmed || !isWorkspaceOperationFile(file) || !isConfirmedOperationFile(result, file));
  if (!files.length) return null;
  return <div aria-label={t("File operations")} className="my-1 w-full min-w-0">
    {files.map((file) => isConfirmedOperationFile(result, file)
      ? <FileChangeView key={`${file.scope ?? 'workspace'}:${file.path}`} file={operationFileStats(file)} onInteract={onInteract} alwaysExpanded
        metadata={item.durationMs === undefined ? undefined : formatDuration(item.durationMs)} label={file.submittedContent !== undefined ? t("Written") : file.kind === 'added' ? t("Created") : file.kind === 'deleted' ? t("Deleted") : file.kind === 'renamed' ? t("Renamed") : t("Edited")}
        onSelect={isWorkspaceOperationFile(file) && context?.sessionId ? () => { context.port.postMessage({
          type: 'review.panel.open', sessionId: context.sessionId!, scopeKind: 'operations', turnId: item.turnId, toolUseId: item.toolUseId, path: file.path,
        }); } : undefined}>
        <OperationFileDetails file={file} canReview={isWorkspaceOperationFile(file) && !!context?.sessionId} messageId={messageId}
          disclosureKey={JSON.stringify(['file-diff', item.toolUseId, file.scope ?? 'workspace', file.path])} onInteract={onInteract} />
      </FileChangeView>
      : <p key={`${file.scope ?? 'workspace'}:${file.path}`} role="status" className="operation-diff-note">{file.path} · {file.outcome === 'failed' ? t("Operation failed") : t("Changes unconfirmed")}{file.message ? ` · ${file.message}` : ''}</p>)}
  </div>;
}
