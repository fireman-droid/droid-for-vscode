import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Columns2, History, Info, Rows3 } from 'lucide-react';
import type { ReviewRecordedContent, ReviewRecordedEntry } from '../../shared/protocol/reviewPanelProtocol';
import { hasOperationTextChanges } from '../../shared/protocol/operationDiff';
import { inlineDiffLines } from '@droidvisx/chat-ui/review/inlineDiffLines';
import { DiffQuestionContext } from '@droidvisx/chat-ui/review/diffQuestion';
import { Button } from '../ui/button';
import { ToggleGroup, ToggleGroupItem } from '../ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { DiffView } from './DiffView';
import { RecordedSource } from './RecordedSource';
import { ReviewIconButton } from './ReviewIconButton';
import { useReviewReadingPosition, type ReviewReadingPositions } from './useReviewReadingPosition';

function operationName(entry: ReviewRecordedEntry): string {
  return entry.toolName ?? (entry.submittedContent !== undefined ? 'Write file' : entry.kind === 'added' ? 'Create file' : entry.kind === 'deleted' ? 'Delete file' : 'Edit file');
}
function outcomeLabel(entry: ReviewRecordedEntry): string {
  if (entry.source !== 'tool-result') return 'Input only';
  return entry.outcome === 'applied' ? 'Applied' : entry.outcome === 'failed' ? 'Failed' : 'Unconfirmed';
}
function OperationStats({ entry }: { readonly entry: ReviewRecordedEntry }) {
  const { t } = useI18n();
  const counts = useMemo(() => {
    let additions = 0, deletions = 0;
    for (const line of inlineDiffLines(entry.patch)) {
      if (line.kind === 'add') additions++;
      if (line.kind === 'remove') deletions++;
    }
    return { additions, deletions };
  }, [entry.patch]);
  if (entry.submittedContent !== undefined) return <span className="review-operation-detail">{t("Full file ·")} {entry.submittedContent.split('\n').length} {t("lines")}</span>;
  if (entry.bodyRef && !entry.patch && entry.submittedContent === undefined) return <span className="review-operation-detail">{t("Saved edit")}</span>;
  if (!hasOperationTextChanges(entry.fullPatch ?? entry.patch)) return <span className="review-operation-detail">{t("No saved text")}</span>;
  return <span className="review-file-stats"><i>+{counts.additions}</i><b>−{counts.deletions}</b></span>;
}
function SavedEdit({ entry, index, path, split, fullContext, showHeader = false, loading = false }: {
  readonly entry: ReviewRecordedEntry; readonly index: number; readonly path: string; readonly split: boolean; readonly fullContext: boolean; readonly showHeader?: boolean; readonly loading?: boolean;
}) {
  const { t } = useI18n();
  return <section className="review-recorded-patch">
    {showHeader ? <header><span className="review-operation-number">{t("Edit")} {index + 1}</span><strong>{t(operationName(entry))}</strong><OperationStats entry={entry} /></header> : null}
    {entry.message && !(fullContext && entry.fullPatch !== undefined) ? <p className="review-recorded-note">{entry.message}</p> : null}
    {fullContext && entry.fullPatch !== undefined ? <DiffView patch={entry.fullPatch} path={path} split={split} source={entry.syntaxSource} questionKey={entry.toolUseId} />
      : entry.submittedContent !== undefined ? <RecordedSource content={entry.submittedContent} path={path} label={t("Submitted file version")} />
      : hasOperationTextChanges(entry.fullPatch ?? entry.patch) ? <DiffView patch={entry.patch} path={path} split={split} source={entry.syntaxSource} questionKey={entry.toolUseId} />
      : entry.bodyRef ? <p className="review-recorded-note" role="status">{showHeader ? t("Select this edit from History to read its saved content.") : loading ? t("Reading saved edit…") : t("Saved content is not loaded. Retry loading this edit.")}</p>
      : <div className="review-recorded-empty"><Info aria-hidden /><div><strong>{t("No saved text for this operation")}</strong><p>{t("The operation result is retained; its code changes are unavailable.")}</p></div></div>}
  </section>;
}

/** Displays saved evidence without treating it as a net workspace diff. */
export function RecordedFileReview({ entries, content, fullContext = false, path, split, onSplit, onHunk, selectedToolUseId, onSelectEdit, readingKey, positions, loading = false, showDiffControls = true, preserveReadingPosition = true }: {
  readonly fullContext?: boolean;
  readonly entries: readonly ReviewRecordedEntry[]; readonly content?: ReviewRecordedContent; readonly path: string;
  readonly split: boolean; readonly onSplit?: (split: boolean) => void; readonly onHunk?: (direction: number) => void;
  readonly showDiffControls?: boolean; readonly preserveReadingPosition?: boolean;
  readonly loading?: boolean;
  readonly selectedToolUseId?: string;
  readonly onSelectEdit?: (toolUseId: string | undefined) => void;
  readonly onOpenNative?: () => void;
  readonly readingKey?: string;
  readonly positions?: ReviewReadingPositions;
}) {
  const { t } = useI18n();
  const [view, setView] = useState('edits');
  const [editKey, setEditKey] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const localPositions = useRef<ReviewReadingPositions>(new Map());
  const records = useMemo(() => entries.map((entry) => ({ entry, key: entry.toolUseId })), [entries]);
  const latestPatch = records.reduce((latest, { entry }, index) => entry.source === 'tool-result' && entry.outcome === 'applied' &&
    (entry.bodyRef || entry.submittedContent !== undefined || hasOperationTextChanges(entry.patch)) ? index : latest, -1);
  const defaultIndex = latestPatch >= 0 ? latestPatch : records.length - 1;
  const selectedIndex = selectedToolUseId !== undefined ? records.findIndex(({ entry }) => entry.toolUseId === selectedToolUseId)
    : editKey === null ? defaultIndex : records.findIndex(({ key }) => key === editKey);
  const index = selectedIndex;
  const selected = records[index];
  const activeView = content ? view : 'edits';
  const allEdits = editKey === 'all' && records.length > 1;
  const question = useContext(DiffQuestionContext);
  useEffect(() => {
    if (question?.anchor?.selection.path === path && (activeView === 'file' ||
      (!allEdits && question.anchor.key !== JSON.stringify([path, selected?.key, split])))) question.close();
  }, [question, path, activeView, allEdits, selected?.key, split]);
  const hasPatch = activeView === 'edits' && (allEdits ? entries.some((entry) => hasOperationTextChanges(entry.fullPatch ?? entry.patch)) : !!selected && hasOperationTextChanges(selected.entry.fullPatch ?? selected.entry.patch));
  useEffect(() => {
    if (editKey === null && selected) setEditKey(selected.key);
  }, [editKey, selected]);
  const selectEdit = (next: number) => {
    const record = records[next]!;
    setEditKey(record.key); setView('edits'); onSelectEdit?.(record.entry.toolUseId);
  };
  const readingRevision = useMemo(() => ({ split, content, entries }), [split, content, entries]);
  useReviewReadingPosition(() => root.current?.closest<HTMLElement>('.review-code-scroll') ?? null,
    preserveReadingPosition ? JSON.stringify([readingKey ?? path, activeView, allEdits ? 'all' : selected?.key]) : null,
    readingRevision,
    positions ?? localPositions.current);
  const toolbar = <>
    {content && entries.length > 0 ? <ToggleGroup type="single" className="review-mode review-recorded-tabs" aria-label={t("Recorded file view")} value={activeView} onValueChange={(value) => { if (value) setView(value); }}>
      <ToggleGroupItem className="h-7 text-xs" value="file">{t("File")}</ToggleGroupItem><ToggleGroupItem className="h-7 text-xs" value="edits">{t("Edits")}</ToggleGroupItem>
    </ToggleGroup> : null}
    {activeView === 'edits' && records.length > 1 ? <div className="review-edit-picker">
      <ReviewIconButton variant="ghost" size="icon-sm" aria-label={t("Previous recorded edit")} disabled={allEdits || index <= 0} onClick={() => selectEdit(index - 1)}><ChevronLeft /></ReviewIconButton>
      <span className="review-edit-position">{allEdits ? t("All edits") : t("Edit {p0} of {p1}", { p0: index + 1, p1: records.length })}</span>
      <ReviewIconButton variant="ghost" size="icon-sm" aria-label={t("Next recorded edit")} disabled={allEdits || index >= records.length - 1} onClick={() => selectEdit(index + 1)}><ChevronRight /></ReviewIconButton>
    </div> : null}
    {records.length > 0 ? <DropdownMenu>
      <DropdownMenuTrigger asChild><ReviewIconButton variant="ghost" size="icon-sm" aria-label={t("Edit history")} title={t("Edit history")}><History /></ReviewIconButton></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="review-menu review-history-menu" data-motion="anchored" sideOffset={6}>
        <p className="review-history-heading">{t("Edit history ·")} {records.length}</p>
        {records.map(({ entry, key }, recordIndex) => <DropdownMenuItem key={key} className="review-history-item" data-selected={activeView === 'edits' && !allEdits && index === recordIndex} onSelect={() => selectEdit(recordIndex)}>
          <span className="review-operation-number">{recordIndex + 1}</span>
          <span className="review-history-description"><strong>{t(operationName(entry))}</strong><small>{t(outcomeLabel(entry))} · {entry.submittedContent !== undefined ? t("Saved file") : entry.bodyRef || hasOperationTextChanges(entry.fullPatch ?? entry.patch) ? t("Saved patch") : t("No saved text")}</small></span><OperationStats entry={entry} />
          {activeView === 'edits' && !allEdits && index === recordIndex ? <Check aria-label={t("Selected edit")} /> : null}
        </DropdownMenuItem>)}
        {records.length > 1 ? <DropdownMenuItem onSelect={() => { setEditKey('all'); setView('edits'); onSelectEdit?.(undefined); }}>{t("Show all saved excerpts")}</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu> : null}
    {hasPatch && showDiffControls ? <>
      <ToggleGroup type="single" className="review-mode" aria-label={t("Diff layout")} value={split ? 'split' : 'unified'} onValueChange={(value) => { if (value) onSplit?.(value === 'split'); }}>
        <ToggleGroupItem className="h-7 w-7 p-1.5" value="unified" aria-label={t("Unified view")} title={t("Unified view")}><Rows3 /></ToggleGroupItem>
        <ToggleGroupItem className="h-7 w-7 p-1.5" value="split" aria-label={t("Split view")} title={t("Split view")}><Columns2 /></ToggleGroupItem>
      </ToggleGroup>
      <ReviewIconButton variant="ghost" size="icon-sm" aria-label={t("Previous change")} onClick={() => onHunk?.(-1)}><ArrowUp /></ReviewIconButton>
      <ReviewIconButton variant="ghost" size="icon-sm" aria-label={t("Next change")} onClick={() => onHunk?.(1)}><ArrowDown /></ReviewIconButton>
    </> : null}
  </>;
  return <div className="review-recorded" ref={root}>
    <div className="review-recorded-summary"><Info aria-hidden /><div className="review-recorded-description">
      <p>{activeView === 'file' && content ? content.appliedEdits ? t('Saved file · {count} later edits included. May differ from your current workspace.', { count: content.appliedEdits }) : t('Saved file. May differ from your current workspace.')
        : allEdits ? t("Saved change excerpts in execution order.")
          : selected ? t('Edit {number} · {operation} · {outcome}. {detail}', { number: index + 1, operation: t(operationName(selected.entry)), outcome: t(outcomeLabel(selected.entry)), detail: t(fullContext && selected.entry.fullPatch !== undefined ? 'Full file comparison from saved versions.' : selected.entry.submittedContent !== undefined ? 'Submitted file version; the previous version is unavailable.' : 'Saved change excerpt.') }) : t("No saved operations.")}</p>
      {activeView === 'file' && content && content.remainingOperations > 0 ? <p className="review-recorded-warning">{t("Partial version ·")} {content.remainingOperations} {t("later operations are not included. Check Edits or History.")}</p> : null}
    </div><div className="review-recorded-actions">{toolbar}</div></div>
    {activeView === 'file' && content ? <RecordedSource content={content.content} path={path} />
      : allEdits ? <div className="review-recorded-patches">{records.map(({ entry, key }, index) => <SavedEdit key={key} entry={entry} index={index} path={path} split={split} fullContext={false} showHeader />)}</div>
      : selected ? <SavedEdit entry={selected.entry} index={index} path={path} split={split} fullContext={fullContext} loading={loading} />
      : <p className="review-empty">{selectedToolUseId ? t("The selected edit is unavailable. Choose another edit from History.") : t("No saved text is available for this file.")}</p>}
  </div>;
}
