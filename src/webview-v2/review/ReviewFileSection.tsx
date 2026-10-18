import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, ChevronRight, ExternalLink, MoreHorizontal, Undo2 } from 'lucide-react';
import { ChangeFileIcon } from '@droidvisx/chat-ui/chat/ChangeFileIcon';
import { MAX_REVIEW_UNDO_FILES, type ReviewFile } from '../../shared/protocol/reviewProtocol';
import type { ReviewRecordedEntry } from '../../shared/protocol/reviewPanelProtocol';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { DiffView } from './DiffView';
import { RecordedFileReview } from './RecordedFileReview';
import { ReviewIconButton } from './ReviewIconButton';
import type { ReviewPort, useReviewWorkbench } from './useReviewWorkbench';

export type ReviewWorkbench = ReturnType<typeof useReviewWorkbench>;
export function ReviewFileSection({ entry, flow, port, split, open, onOpenChange, onNavigate, onMarkAndNext, hasPrevious, hasNext }: {
  entry: ReviewFile; flow: ReviewWorkbench; port: ReviewPort; split: boolean;
  open: boolean; onOpenChange(open: boolean): void; onNavigate(path: string, direction: number): void;
  onMarkAndNext(path: string): void; hasPrevious: boolean; hasNext: boolean;
}) {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const { review, target, fileReads, actions } = flow;
  const operation = target?.operation?.status === 'ready' ? target.operation : null;
  const operationFile = operation?.files.find(file => file.path === entry.path);
  const read = fileReads.get(entry.path);
  const file = read.file;
  const patch = operationFile?.patch ?? file?.patch ?? '';
  const recordedEntries = useMemo<readonly ReviewRecordedEntry[] | undefined>(() => operationFile && operation ? [{
    ...operationFile, toolUseId: operation.callId ?? 'operation', source: operation.source,
  }] : file?.recordedOperations, [operationFile, operation, file?.recordedOperations]);
  const recordedContent = operation ? operationFile?.submittedContent !== undefined ? {
    content: operationFile.submittedContent, sourceToolUseId: operation.callId ?? 'operation', appliedEdits: 0, remainingOperations: 0,
  } : undefined : file?.recordedContent;
  const selectedEdit = read.toolUseId ? recordedEntries?.find(edit => edit.toolUseId === read.toolUseId) : recordedEntries?.at(-1);
  const writing = review?.lifecycle === 'writing';
  const readOnly = !!operation || (review?.scopeKind !== 'operations' && review?.recordedOnly) || entry.status === 'open-only';
  const canMark = !readOnly && !flow.scopePending && review?.lifecycle !== 'stale' && !!file && !file.error && !file.truncated &&
    !read.pending && !read.error && file.version === entry.version && entry.version !== 'unavailable' && entry.status !== 'reviewed' && !writing;
  useEffect(() => {
    fileReads.retain(entry.path);
    return () => fileReads.forget(entry.path);
  }, [fileReads, entry.path]);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const observer = new IntersectionObserver(entries => setNear(entries.some(entry => entry.isIntersecting)),
      { root: element.closest('.review-stream'), rootMargin: '600px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!open || !near || operation) return;
    fileReads.watch(entry.path);
    return () => fileReads.unwatch(entry.path);
  }, [fileReads, fileReads.epoch, entry.path, review?.reviewScopeId, flow.context, target, open, near, operation]);
  return <Collapsible ref={root} className="review-file-section" data-review-path={entry.path}
    open={open} onOpenChange={onOpenChange}>
    <header className="review-section-heading">
      <CollapsibleTrigger asChild><Button variant="plain" size="none" className="review-section-title" title={entry.path}>
        <ChevronRight className="review-section-chevron" aria-hidden /><ChangeFileIcon path={entry.path} />
        <span>{entry.path}</span>
        <span className="review-file-stats"><i>{entry.additions === null ? '' : `+${entry.additions}`}</i><b>{entry.deletions === null ? '' : `−${entry.deletions}`}</b></span>
      </Button></CollapsibleTrigger>
      {read.pending && file ? <span className="review-muted" role="status">{t("Updating…")}</span> : null}
      {!readOnly ? <ReviewIconButton variant="ghost" size="icon-sm" className="review-viewed" data-reviewed={entry.status === 'reviewed'}
        aria-label={entry.status === 'reviewed' ? t("{p0} reviewed", { p0: entry.path }) : t("Mark {p0} viewed", { p0: entry.path })} disabled={!canMark}
        onClick={() => actions.onMarkReviewed(false, entry.path)}><CheckCheck /></ReviewIconButton> : null}
      <ReviewIconButton variant="ghost" size="icon-sm" aria-label={t("Open {p0}", { p0: entry.path })} onClick={() => port.postMessage({ type: 'reviewPanel.openPath', path: entry.path })}><ExternalLink /></ReviewIconButton>
      <DropdownMenu><DropdownMenuTrigger asChild><ReviewIconButton variant="ghost" size="icon-sm" aria-label={t("Actions for {p0}", { p0: entry.path })}><MoreHorizontal /></ReviewIconButton></DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="review-menu review-undo-menu">
          <DropdownMenuItem disabled={flow.scopePending || !hasPrevious} onSelect={() => onNavigate(entry.path, -1)}>{t("Previous file")}</DropdownMenuItem>
          <DropdownMenuItem disabled={flow.scopePending || !hasNext} onSelect={() => onNavigate(entry.path, 1)}>{t("Next file")}</DropdownMenuItem>
          {!readOnly ? <DropdownMenuItem disabled={!canMark || !hasNext} onSelect={() => onMarkAndNext(entry.path)}>{t("Mark viewed & next")}</DropdownMenuItem> : null}
          {!operation ? <DropdownMenuItem disabled={flow.scopePending || read.pending || !file || !!read.error || selectedEdit?.fullPatchUnavailableReason === 'unavailable'}
            onSelect={() => flow.openNative(entry.path)}>{t("Open Native Diff")}</DropdownMenuItem> : null}
          {!readOnly && review?.scopeKind === 'operations' ? <>
            {!entry.restorable ? <p data-ui-notice="" className="review-undo-hint">{entry.undoReason ?? t("This file does not have a complete, reversible record.")}</p> : null}
            <DropdownMenuItem disabled={writing || flow.scopePending || read.pending || !!read.error || !entry.restorable}
              onSelect={() => actions.onPreviewRestore('file', entry.path)}><Undo2 />{t("Undo this file…")}</DropdownMenuItem>
            <DropdownMenuItem disabled={writing || flow.scopePending || review.files.length > MAX_REVIEW_UNDO_FILES ||
              !review.files.some(file => file.restorable) || !review.files.every(file => file.restorable || file.undone)}
              onSelect={() => actions.onPreviewRestore('turn')}>{t("Undo remaining files in this turn…")}</DropdownMenuItem>
          </> : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
    <CollapsibleContent>
      {read.error && !operation ? <div data-ui-notice="" className="review-notice review-error" role="status">{read.error}{file && !file.error ? t("Showing the previous diff.") : ''}
        <Button variant="ghost" size="sm" onClick={() => flow.retryFile(entry.path)}>{t("Retry")}</Button></div> : null}
      {!operation && !file ? <p className="review-file-placeholder" role="status">{read.error ? t("Diff unavailable.") : near ? t("Reading Diff…") : t("Diff loads as you scroll.")}</p>
        : !operation && file?.error ? read.error ? null : <p data-ui-notice="" className="review-empty">{file.error}</p>
        : recordedEntries ? <RecordedFileReview entries={recordedEntries} content={recordedContent} path={entry.path}
          split={split} loading={read.pending} showDiffControls={false} preserveReadingPosition={false}
          selectedToolUseId={read.toolUseId} onSelectEdit={toolUseId => flow.selectRecordedEdit(toolUseId, entry.path)} />
        : patch && patch !== '@@' ? <DiffView patch={patch} path={entry.path} split={split} source={file?.syntaxSource} />
        : operationFile?.contentRestricted ? null
        : <p data-ui-notice="" className="review-empty">{operationFile ? t("File {p0}. Text changes were not recorded.", { p0: operationFile.kind })
          : review?.scopeKind === 'operations' ? t("No text Diff evidence is available.") : t("No net text changes.")}</p>}
      {file?.truncated && !operation ? <p data-ui-notice="" className="review-notice">{t("Preview limit reached. Open Native Diff to read the complete comparison.")}</p> : null}
    </CollapsibleContent>
  </Collapsible>;
}
