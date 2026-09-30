import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Check, ChevronLeft, ChevronRight, Columns2, History, Info, Rows3 } from 'lucide-react';
import type { ReviewRecordedContent, ReviewRecordedEntry } from '../../shared/protocol/reviewPanelProtocol';
import { hasOperationTextChanges } from '../../shared/protocol/operationDiff';
import { inlineDiffLines } from '@droidvisx/chat-ui/review/inlineDiffLines';
import { Button } from '../ui/button';
import { ToggleGroup, ToggleGroupItem } from '../ui/controls';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { DiffView } from './DiffView';
import { RecordedSource } from './RecordedSource';

function operationName(entry: ReviewRecordedEntry): string {
  return entry.toolName ?? (entry.submittedContent !== undefined ? 'Write file' : entry.kind === 'added' ? 'Create file' : entry.kind === 'deleted' ? 'Delete file' : 'Edit file');
}
function outcomeLabel(entry: ReviewRecordedEntry): string {
  if (entry.source !== 'tool-result') return 'Input only';
  return entry.outcome === 'applied' ? 'Applied' : entry.outcome === 'failed' ? 'Failed' : 'Unconfirmed';
}
function OperationStats({ entry }: { readonly entry: ReviewRecordedEntry }) {
  const counts = useMemo(() => {
    let additions = 0, deletions = 0;
    for (const line of inlineDiffLines(entry.patch)) {
      if (line.kind === 'add') additions++;
      if (line.kind === 'remove') deletions++;
    }
    return { additions, deletions };
  }, [entry.patch]);
  if (entry.submittedContent !== undefined) return <span className="review-operation-detail">Full file · {entry.submittedContent.split('\n').length} lines</span>;
  if (!hasOperationTextChanges(entry.fullPatch ?? entry.patch)) return <span className="review-operation-detail">No saved text</span>;
  return <span className="review-file-stats"><i>+{counts.additions}</i><b>−{counts.deletions}</b></span>;
}
function SavedEdit({ entry, index, path, split, showHeader = false }: {
  readonly entry: ReviewRecordedEntry; readonly index: number; readonly path: string; readonly split: boolean; readonly showHeader?: boolean;
}) {
  return <section className="review-recorded-patch">
    {showHeader ? <header><span className="review-operation-number">Edit {index + 1}</span><strong>{operationName(entry)}</strong><OperationStats entry={entry} /></header> : null}
    {entry.message ? <p className="review-recorded-note">{entry.message}</p> : null}
    {entry.fullPatch !== undefined ? <DiffView patch={entry.fullPatch} path={path} split={split} />
      : entry.submittedContent !== undefined ? <RecordedSource content={entry.submittedContent} path={path} label="Submitted file version" />
      : hasOperationTextChanges(entry.fullPatch ?? entry.patch) ? <DiffView patch={entry.patch} path={path} split={split} />
      : <div className="review-recorded-empty"><Info aria-hidden /><div><strong>No saved text for this operation</strong><p>The operation result is retained; its code changes are unavailable.</p></div></div>}
  </section>;
}

/** Displays saved evidence without treating it as a net workspace diff. */
export function RecordedFileReview({ entries, content, fullContext = true, path, split, onSplit, onHunk, toolbarTarget }: {
  readonly fullContext?: boolean;
  readonly entries: readonly ReviewRecordedEntry[]; readonly content?: ReviewRecordedContent; readonly path: string;
  readonly split: boolean; readonly onSplit: (split: boolean) => void; readonly onHunk: (direction: number) => void;
  readonly toolbarTarget: HTMLElement | null;
}) {
  const [view, setView] = useState('edits');
  const [editKey, setEditKey] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const records = useMemo(() => entries.map((entry, index) => ({ entry, key: `${entry.toolUseId}:${index}` })), [entries]);
  const latestPatch = records.reduce((latest, { entry }, index) => entry.source === 'tool-result' && entry.outcome === 'applied' && hasOperationTextChanges(entry.fullPatch ?? entry.patch) ? index : latest, -1);
  const defaultIndex = latestPatch >= 0 ? latestPatch : records.length - 1;
  const selectedIndex = editKey === null ? defaultIndex : records.findIndex(({ key }) => key === editKey);
  const index = selectedIndex < 0 ? defaultIndex : selectedIndex;
  const selected = records[index];
  const activeView = content ? view : 'edits';
  const allEdits = editKey === 'all' && records.length > 1;
  const hasPatch = activeView === 'edits' && (allEdits ? entries.some((entry) => hasOperationTextChanges(entry.fullPatch ?? entry.patch)) : !!selected && hasOperationTextChanges(selected.entry.fullPatch ?? selected.entry.patch));
  const selectEdit = (next: number) => { setEditKey(records[next]!.key); setView('edits'); };
  useLayoutEffect(() => {
    root.current?.closest('.review-code-scroll')?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [editKey, activeView, path]);
  const toolbar = <>
    {content && entries.length > 0 ? <ToggleGroup type="single" className="review-mode review-recorded-tabs" aria-label="Recorded file view" value={activeView} onValueChange={(value) => { if (value) setView(value); }}>
      <ToggleGroupItem className="h-7 text-xs" value="file">File</ToggleGroupItem><ToggleGroupItem className="h-7 text-xs" value="edits">Edits</ToggleGroupItem>
    </ToggleGroup> : null}
    {activeView === 'edits' && records.length > 1 ? <div className="review-edit-picker">
      <Button variant="ghost" size="icon-sm" aria-label="Previous recorded edit" disabled={allEdits || index <= 0} onClick={() => selectEdit(index - 1)}><ChevronLeft /></Button>
      <span className="review-edit-position">{allEdits ? 'All edits' : `Edit ${index + 1} of ${records.length}`}</span>
      <Button variant="ghost" size="icon-sm" aria-label="Next recorded edit" disabled={allEdits || index >= records.length - 1} onClick={() => selectEdit(index + 1)}><ChevronRight /></Button>
    </div> : null}
    {records.length > 0 ? <DropdownMenu>
      <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="Edit history" title="Edit history"><History /></Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="review-menu review-history-menu" data-motion="anchored" sideOffset={6}>
        <p className="review-history-heading">Edit history · {records.length}</p>
        {records.map(({ entry, key }, recordIndex) => <DropdownMenuItem key={key} className="review-history-item" data-selected={activeView === 'edits' && !allEdits && index === recordIndex} onSelect={() => selectEdit(recordIndex)}>
          <span className="review-operation-number">{recordIndex + 1}</span>
          <span className="review-history-description"><strong>{operationName(entry)}</strong><small>{outcomeLabel(entry)} · {entry.submittedContent !== undefined ? 'Saved file' : hasOperationTextChanges(entry.fullPatch ?? entry.patch) ? 'Saved patch' : 'No saved text'}</small></span>
          {activeView === 'edits' && !allEdits && index === recordIndex ? <Check aria-label="Selected edit" /> : null}
        </DropdownMenuItem>)}
        {records.length > 1 ? <DropdownMenuItem onSelect={() => { setEditKey('all'); setView('edits'); }}>Show all edits in order</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu> : null}
    {hasPatch ? <>
      <ToggleGroup type="single" className="review-mode" aria-label="Diff layout" value={split ? 'split' : 'unified'} onValueChange={(value) => { if (value) onSplit(value === 'split'); }}>
        <ToggleGroupItem className="h-7 w-7 p-1.5" value="unified" aria-label="Unified view" title="Unified view"><Rows3 /></ToggleGroupItem>
        <ToggleGroupItem className="h-7 w-7 p-1.5" value="split" aria-label="Split view" title="Split view"><Columns2 /></ToggleGroupItem>
      </ToggleGroup>
      <Button variant="ghost" size="icon-sm" aria-label="Previous change" onClick={() => onHunk(-1)}><ArrowUp /></Button>
      <Button variant="ghost" size="icon-sm" aria-label="Next change" onClick={() => onHunk(1)}><ArrowDown /></Button>
    </> : null}
  </>;
  return <div className="review-recorded" ref={root}>
    {toolbarTarget ? createPortal(toolbar, toolbarTarget) : null}
    <div className="review-recorded-summary"><Info aria-hidden /><div>
      <p>{activeView === 'file' && content ? `Saved file${content.appliedEdits ? ` · ${content.appliedEdits} later edits included` : ''}. May differ from your current workspace.`
        : allEdits ? 'Saved operations in order · these are separate edits, not a combined diff.'
          : selected ? `Edit ${index + 1} · ${operationName(selected.entry)} · ${outcomeLabel(selected.entry)}. ${selected.entry.fullPatch !== undefined ? 'Full file comparison from saved versions.' : fullContext ? 'Saved excerpt · full file versions unavailable.' : 'Saved change excerpt.'}` : 'No saved operations.'}</p>
      {activeView === 'file' && content && content.remainingOperations > 0 ? <p className="review-recorded-warning">Partial version · {content.remainingOperations} later operations are not included. Check Edits or History.</p> : null}
    </div></div>
    {activeView === 'file' && content ? <RecordedSource content={content.content} path={path} />
      : allEdits ? <div className="review-recorded-patches">{records.map(({ entry, key }, index) => <SavedEdit key={key} entry={entry} index={index} path={path} split={split} showHeader />)}</div>
      : selected ? <SavedEdit entry={selected.entry} index={index} path={path} split={split} />
      : <p className="review-empty">No saved text is available for this file.</p>}
  </div>;
}
