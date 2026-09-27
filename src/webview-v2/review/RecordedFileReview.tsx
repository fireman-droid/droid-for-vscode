import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, History, Info } from 'lucide-react';
import type { ReviewRecordedContent, ReviewRecordedEntry } from '../../shared/protocol/reviewPanelProtocol';
import { hasOperationTextChanges } from '../../shared/protocol/operationDiff';
import { inlineDiffLines } from '@droidvisx/chat-ui/review/inlineDiffLines';
import { Button } from '../ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '../ui/controls';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/selection';
import { DiffView } from './DiffView';
import { RecordedSource } from './RecordedSource';

function operationName(entry: ReviewRecordedEntry): string {
  return entry.toolName ?? (entry.submittedContent !== undefined ? 'Write file' : entry.kind === 'added' ? 'Create file' : entry.kind === 'deleted' ? 'Delete file' : 'Edit file');
}
function outcomeLabel(entry: ReviewRecordedEntry): string {
  if (entry.source !== 'tool-result') return 'Input only';
  return entry.outcome === 'applied' ? 'Applied' : entry.outcome === 'failed' ? 'Failed' : 'Unconfirmed';
}
function patchCounts(patch: string): { additions: number; deletions: number } {
  let additions = 0, deletions = 0;
  for (const line of inlineDiffLines(patch)) {
    if (line.kind === 'add') additions++;
    if (line.kind === 'remove') deletions++;
  }
  return { additions, deletions };
}
function OperationStats({ entry }: { readonly entry: ReviewRecordedEntry }) {
  if (entry.submittedContent !== undefined) return <span className="review-operation-detail">Full file · {entry.submittedContent.split('\n').length} lines</span>;
  if (!hasOperationTextChanges(entry.patch)) return <span className="review-operation-detail">No text captured</span>;
  const counts = patchCounts(entry.patch);
  return <span className="review-file-stats"><i>+{counts.additions}</i><b>−{counts.deletions}</b></span>;
}
function SavedPatch({ entry, index, path, split, showHeader }: {
  readonly entry: ReviewRecordedEntry; readonly index: number; readonly path: string; readonly split: boolean; readonly showHeader: boolean;
}) {
  return <section className="review-recorded-patch">
    {showHeader ? <header><span className="review-operation-number">Edit {index + 1}</span><strong>{operationName(entry)}</strong><OperationStats entry={entry} /></header> : null}
    {entry.message ? <p className="review-recorded-note">{entry.message}</p> : null}
    <DiffView patch={entry.patch} path={path} split={split} />
  </section>;
}
function OperationHistory({ entries, path, split, missing }: {
  readonly entries: readonly ReviewRecordedEntry[]; readonly path: string; readonly split: boolean; readonly missing: number;
}) {
  return <Collapsible className="review-history">
    <CollapsibleTrigger asChild><Button variant="plain" size="none" className="review-history-trigger">
      <History aria-hidden /><strong>History</strong><span>{entries.length} {entries.length === 1 ? 'operation' : 'operations'}{missing > 0 ? ` · ${missing} without saved text` : ''}</span><ChevronRight className="review-disclosure-chevron" aria-hidden />
    </Button></CollapsibleTrigger>
    <CollapsibleContent className="review-disclosure-content"><div className="review-history-list">
      {entries.map((entry, index) => {
        const hasText = entry.submittedContent !== undefined || hasOperationTextChanges(entry.patch);
        const summary = <><span className="review-operation-number">{index + 1}</span><strong>{operationName(entry)}</strong>
          <span className="review-operation-outcome" data-outcome={entry.outcome}>{outcomeLabel(entry)}</span><OperationStats entry={entry} /></>;
        return <Collapsible key={`${entry.toolUseId}:${index}`} className="review-history-entry">
          {hasText || entry.message ? <CollapsibleTrigger asChild><Button variant="plain" size="none" className="review-history-entry-trigger">
            {summary}<ChevronRight className="review-disclosure-chevron" aria-hidden />
          </Button></CollapsibleTrigger> : <div className="review-history-entry-trigger">{summary}</div>}
          <CollapsibleContent className="review-disclosure-content">
            {entry.message ? <p className="review-recorded-note">{entry.message}</p> : null}
            {entry.submittedContent !== undefined ? <RecordedSource content={entry.submittedContent} path={path} label="Submitted file version" />
              : hasOperationTextChanges(entry.patch) ? <DiffView patch={entry.patch} path={path} split={split} /> : null}
          </CollapsibleContent>
        </Collapsible>;
      })}
    </div></CollapsibleContent>
  </Collapsible>;
}

/** Recorded evidence stays separate from the current worktree and Git's net diff. */
export function RecordedFileReview({ entries, content, path, split, onSplit, onHunk }: {
  readonly entries: readonly ReviewRecordedEntry[]; readonly content?: ReviewRecordedContent; readonly path: string;
  readonly split: boolean; readonly onSplit: (split: boolean) => void; readonly onHunk: (direction: number) => void;
}) {
  const [view, setView] = useState('file');
  const [editKey, setEditKey] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const patches = useMemo(() => entries.flatMap((entry, index) => entry.source === 'tool-result' && entry.outcome === 'applied' && hasOperationTextChanges(entry.patch) ? [{ entry, key: `${entry.toolUseId}:${index}` }] : []), [entries]);
  const missing = entries.filter((entry) => entry.submittedContent === undefined && !hasOperationTextChanges(entry.patch)).length;
  const activeView = content ? view : 'patches';
  const selectedIndex = editKey === null ? patches.length - 1 : patches.findIndex(({ key }) => key === editKey);
  const effectiveIndex = selectedIndex < 0 ? patches.length - 1 : selectedIndex;
  const selected = patches[effectiveIndex];
  const allEdits = editKey === 'all' && patches.length > 1;
  const selectEdit = (index: number) => setEditKey(index === patches.length - 1 ? null : patches[index]!.key);
  useLayoutEffect(() => {
    root.current?.closest('.review-code-scroll')?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [editKey, activeView, path]);
  const patchContent = selected ? <div className="review-recorded-patches">
    {allEdits ? patches.map(({ entry, key }, index) => <SavedPatch key={key} entry={entry} index={index} path={path} split={split} showHeader />)
      : <SavedPatch key={selected.key} entry={selected.entry} index={effectiveIndex} path={path} split={split} showHeader={false} />}
  </div> : <div className="review-recorded-empty"><Info aria-hidden /><div><strong>No saved text diff</strong><p>{content ? 'The tool wrote a full file. Open File version to read it.' : 'Open History to inspect the available operation results.'}</p></div></div>;
  return <Tabs ref={root} className="review-recorded" value={activeView} onValueChange={setView}>
    <div className="review-recorded-toolbar">
      <div className="review-recorded-toolbar-main">
      {content ? <TabsList aria-label="Recorded file view" className="review-recorded-tabs border-0">
        <TabsTrigger className="border-0 text-[13px]" value="file">File version</TabsTrigger><TabsTrigger className="border-0 text-[13px]" value="patches">Edits <span>{patches.length}</span></TabsTrigger>
      </TabsList> : <strong className="review-recorded-heading">Edits <span>{patches.length}</span></strong>}
      <span className="review-top-spacer" />
      {activeView === 'patches' && patches.length > 0 ? <>
        <ToggleGroup type="single" className="review-mode" aria-label="Diff layout" value={split ? 'split' : 'unified'} onValueChange={(value) => { if (value) onSplit(value === 'split'); }}>
          <ToggleGroupItem className="h-8 text-[13px]" value="unified">Unified</ToggleGroupItem><ToggleGroupItem className="h-8 text-[13px]" value="split">Split</ToggleGroupItem>
        </ToggleGroup>
        <Button variant="ghost" size="icon-sm" aria-label="Previous change" onClick={() => onHunk(-1)}><ArrowUp /></Button>
        <Button variant="ghost" size="icon-sm" aria-label="Next change" onClick={() => onHunk(1)}><ArrowDown /></Button>
      </> : null}
      </div>
      {activeView === 'patches' && selected ? <div className="review-edit-nav">
        <div className="review-edit-picker">
          <Button variant="ghost" size="icon-sm" className="size-8" aria-label="Previous recorded edit" disabled={allEdits || effectiveIndex === 0} onClick={() => selectEdit(effectiveIndex - 1)}><ChevronLeft /></Button>
          <Select value={allEdits ? 'all' : selected.key} onValueChange={(key) => setEditKey(key === patches.at(-1)?.key ? null : key)}>
            <SelectTrigger aria-label="Choose recorded edit" className="review-edit-select h-8 bg-[var(--review-record-chrome)]"><SelectValue>{allEdits ? 'All edits' : `Edit ${effectiveIndex + 1} of ${patches.length}`}</SelectValue></SelectTrigger>
            <SelectContent className="min-w-[220px]">
              {patches.map(({ entry, key }, index) => <SelectItem key={key} value={key}>Edit {index + 1} · {operationName(entry)}{index === patches.length - 1 ? ' · Latest' : ''}</SelectItem>)}
              {patches.length > 1 ? <SelectItem value="all">All edits</SelectItem> : null}
            </SelectContent>
          </Select>
          <Button variant="ghost" size="icon-sm" className="size-8" aria-label="Next recorded edit" disabled={allEdits || effectiveIndex === patches.length - 1} onClick={() => selectEdit(effectiveIndex + 1)}><ChevronRight /></Button>
        </div>
        {allEdits ? <span className="review-edit-description">{patches.length} separate edits in order</span> : <div className="review-edit-description">
          <strong title={operationName(selected.entry)}>{operationName(selected.entry)}</strong>
          {effectiveIndex === patches.length - 1 ? <span className="review-edit-latest">Latest</span> : null}
          <OperationStats entry={selected.entry} />
        </div>}
      </div> : null}
    </div>
    <div className="review-recorded-summary">
      <Info aria-hidden /><div>
        <p>{activeView === 'file' && content ? `Saved file${content.appliedEdits ? ` with ${content.appliedEdits} later ${content.appliedEdits === 1 ? 'edit' : 'edits'}` : ''}; the original baseline is unavailable. It may differ from your workspace.`
          : 'Each edit is a saved tool result, not the file’s combined changes.'}</p>
        {activeView === 'file' && content && content.remainingOperations > 0 ? <p className="review-recorded-warning"><strong>Partial version.</strong> {content.remainingOperations} later {content.remainingOperations === 1 ? 'operation is' : 'operations are'} missing from this view. Open Edits or History to inspect them.</p> : null}
      </div>
    </div>
    {content ? <TabsContent value="file" className="review-recorded-panel"><RecordedSource content={content.content} path={path} /></TabsContent> : null}
    {content ? <TabsContent value="patches" className="review-recorded-panel">{patchContent}</TabsContent>
      : <div className="review-recorded-panel">{patchContent}</div>}
    <OperationHistory entries={entries} path={path} split={split} missing={missing} />
  </Tabs>;
}
