import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCheck, Columns2, Rows3, MoreHorizontal, ChevronLeft, ChevronRight, ExternalLink, FileCode2, GitCommitHorizontal, PanelLeft, RefreshCw, Undo2 } from 'lucide-react';
import { MAX_REVIEW_UNDO_FILES, REVIEW_SCOPE_KINDS, type ReviewScopeKind } from '../../shared/protocol/reviewProtocol';
import { Button } from '../ui/button';
import { DroidLoading } from '../ui/droid-motion';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/selection';
import { ToggleGroup, ToggleGroupItem } from '../ui/controls';
import { Dialog, DialogContent, DialogDescription, DialogTitle, Tooltip, TooltipProvider } from '../ui/overlays';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '../ui/dropdown-menu';
import { DiffView, findDiffChange } from './DiffView';
import { ReviewFiles, filterReviewFiles, type ReviewFileFilters } from './ReviewFiles';
import { ReviewCommit } from './ReviewCommit';
import { useReviewWorkbench, type ReviewPort } from './useReviewWorkbench';
import { OPERATION_UNAVAILABLE } from '../content/OperationDiff';
import { hasOperationTextChanges } from '../../shared/protocol/operationDiff';
import { operationLabel } from '../content/operationPresentation';
import { RecordedFileReview } from './RecordedFileReview';
import type { ReviewRecordedEntry } from '../../shared/protocol/reviewPanelProtocol';
import { ReviewIconButton } from './ReviewIconButton';
import { useReviewReadingPosition, type ReviewReadingPositions } from './useReviewReadingPosition';
import { useReviewFileNavigation } from './useReviewFileNavigation';
const labels: Record<ReviewScopeKind, string> = {
  operations: 'Recorded edits', turn: 'Turn workspace', workspace: 'Workspace', branch: 'Branch', unstaged: 'Unstaged', staged: 'Staged',
};
export function ReviewApp({ port }: { port: ReviewPort }) {
  const flow = useReviewWorkbench(port);
  const { target, review, current, file, actions } = flow;
  const [split, setSplit] = useState(false);
  const [filesOpen, setFilesOpen] = useState<boolean | null>(null);
  const [recordedToolbar, setRecordedToolbar] = useState<HTMLDivElement | null>(null);
  const [commit, setCommit] = useState(false);
  const [operationPath, setOperationPath] = useState<string | null>(null);
  const [filters, setFilters] = useState<ReviewFileFilters>({ query: '', unreviewed: false });
  const positions = useRef<ReviewReadingPositions>(new Map());
  const scroll = useRef<HTMLDivElement>(null);
  const closeCommit = useCallback(() => setCommit(false), []);
  const operation = target?.operation?.status === 'ready' ? target.operation : null;
  const operationFile = operation?.files.find((entry) => entry.path === (operationPath ?? target?.operationPath)) ?? operation?.files[0];
  const path = operationFile?.path ?? current?.path ?? null;
  const patch = operationFile?.patch ?? file?.patch ?? '';
  const recordedEntries = useMemo<readonly ReviewRecordedEntry[] | undefined>(() => operationFile && operation ? [{
    ...operationFile, toolUseId: operation.callId ?? 'operation', source: operation.source,
  }] : file?.recordedOperations, [operationFile, operation, file?.recordedOperations]);
  const selectedRecordedEntry = flow.selectedToolUseId ? recordedEntries?.find((entry) => entry.toolUseId === flow.selectedToolUseId)
    : recordedEntries?.reduce<ReviewRecordedEntry | undefined>((latest, entry) => entry.source === 'tool-result' && entry.outcome === 'applied' &&
      (entry.bodyRef || entry.submittedContent !== undefined || hasOperationTextChanges(entry.patch)) ? entry : latest, undefined) ?? recordedEntries?.at(-1);
  const nativeUnavailable = selectedRecordedEntry?.fullPatchUnavailableReason === 'unavailable';
  const recordedContent = operation ? operationFile?.submittedContent !== undefined ? {
    content: operationFile.submittedContent, sourceToolUseId: operation?.callId ?? 'operation', appliedEdits: 0, remainingOperations: 0,
  } : undefined : file?.recordedContent;
  const files = useMemo(() => operation ? operation.files.map((entry) => ({
    path: entry.path, additions: null, deletions: null, status: 'open-only' as const, version: 'operation', restorable: false,
  })) : review?.files ?? [], [operation, review?.files]);
  const showFiles = filesOpen ?? (files.length > 1 && window.innerWidth > 700);
  const additions = files.reduce((sum, entry) => sum + (entry.additions ?? 0), 0);
  const deletions = files.reduce((sum, entry) => sum + (entry.deletions ?? 0), 0);
  const completeCounts = files.every((entry) => entry.additions !== null && entry.deletions !== null);
  const operationIndex = operationFile ? operation!.files.indexOf(operationFile) : -1;
  const fileIndex = operation ? operationIndex : review?.currentIndex ?? -1;
  const fileName = path?.split('/').at(-1);
  const directory = path?.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const selectFile = useCallback((value: string) => {
    if (operation) setOperationPath(value); else actions.onSelectFile(value);
    if (window.innerWidth <= 700) setFilesOpen(false);
  }, [operation, actions.onSelectFile]);
  const readingKey = JSON.stringify([target?.sessionId, review?.reviewScopeId ?? operation?.callId, path]);
  const readingRevision = useMemo(() => ({ patch, split }), [patch, split]);
  useReviewReadingPosition(() => scroll.current, !recordedEntries && path && file ? readingKey : null,
    readingRevision, positions.current);
  const visiblePaths = useMemo(() => filterReviewFiles(files, filters).map(file => file.path), [files, filters]);
  const navigation = useReviewFileNavigation(review, visiblePaths, path, selectFile, actions);
  const valid = target?.valid === true;
  const writing = review?.lifecycle === 'writing';
  const operationOnly = target?.operation != null;
  const operationsScope = review?.scopeKind === 'operations';
  const turnUndoTooLarge = operationsScope && files.length > MAX_REVIEW_UNDO_FILES;
  const missingSnapshot = !operationOnly && !operationsScope && review?.recordedOnly === true;
  const readOnly = operationOnly || missingSnapshot || current?.status === 'open-only';
  const readOnlyMessage = missingSnapshot ? 'Saved operation excerpts · full turn snapshot unavailable'
    : operationOnly ? operationLabel(target!.operation!) : 'This file cannot be compared.';
  const canMark = valid && !readOnly && !flow.scopePending && review?.lifecycle !== 'stale' && !!current && !!file && !file.error &&
    !flow.fileRefreshing && !flow.fileError && !file.truncated &&
    file.version === current.version && current.version !== 'unavailable' && current.status !== 'reviewed' &&
    !writing;
  const hasHunks = !!patch || !!file?.recordedOperations?.some((entry) => hasOperationTextChanges(entry.fullPatch ?? entry.patch));
  const agentRunning = flow.agent?.status === 'running' || flow.agent?.status === 'starting';
  const hunk = (direction: number) => {
    const container = scroll.current;
    if (!container) return;
    const labelHeight = split ? container.querySelector('.review-split-labels')?.getBoundingClientRect().height ?? 0 : 0;
    const top = container.getBoundingClientRect().top + labelHeight;
    const next = findDiffChange(container, top + direction * 8, direction);
    if (next !== null) container.scrollBy({ top: next - top,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  return <TooltipProvider><main className="review-workbench">
    <header className="review-topbar">
      <ReviewIconButton variant="ghost" size="icon-sm" className="review-files-toggle" aria-label={showFiles ? 'Collapse files' : 'Show files'} aria-pressed={showFiles} onClick={() => setFilesOpen(!showFiles)}><PanelLeft /></ReviewIconButton>
      <h1 className="review-title" title={review?.baselineLabel ?? 'Review changes'}>Review</h1>
      <div className="review-scope-control">
      <Select disabled={!valid || flow.scopePending} value={target?.operation ? 'operation' : review?.scopeKind ?? 'workspace'}
        onValueChange={(value) => { setOperationPath(null); flow.openScope(value as ReviewScopeKind); }}>
        <SelectTrigger aria-label="Comparison scope" className="review-scope-trigger h-7 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent className="review-menu review-scope-menu" data-motion="anchored" align="start" sideOffset={6}>
          {target?.operation ? <SelectItem value="operation">This operation</SelectItem> : null}
          {REVIEW_SCOPE_KINDS.map((kind) => <SelectItem key={kind} value={kind} disabled={(kind === 'turn' || kind === 'operations') && !target?.latestTurnId && !review?.turnId}>{labels[kind]}</SelectItem>)}
        </SelectContent>
      </Select>
      </div>
      {flow.choosingBranch || review?.scopeKind === 'branch' ? <Select disabled={flow.scopePending || !flow.branches?.refs.length}
        value={review?.scopeKind === 'branch' ? review.baseBranch ?? flow.branches?.defaultBranch : undefined}
        onValueChange={value => flow.openScope('branch', value)}>
        <SelectTrigger aria-label="Base branch" className="review-scope-trigger h-7 text-xs"><SelectValue placeholder="Choose base branch" /></SelectTrigger>
        <SelectContent className="review-menu" align="start">{flow.branches?.refs.map(ref => <SelectItem key={ref} value={ref}>{ref.replace(/^refs\/(heads|remotes)\//, '')}</SelectItem>)}</SelectContent>
      </Select> : null}
      <span className="review-top-spacer" />
      {review && !operation && !missingSnapshot ? <span className="review-progress">{review.reviewedCount} / {review.reviewableCount} reviewed</span> : <span className="review-progress">{files.length} {files.length === 1 ? 'file' : 'files'}</span>}
      {!operation && !operationsScope && completeCounts ? <span className="review-range-counts"><i>+{additions}</i><b>−{deletions}</b></span> : null}
      <ReviewIconButton variant="ghost" size="icon-sm" aria-label="Refresh review" disabled={!valid || flow.scopePending} aria-busy={flow.scopePending || flow.fileRefreshing} onClick={flow.refresh}><RefreshCw /></ReviewIconButton>
      {review?.scopeKind === 'workspace' || review?.scopeKind === 'branch' || agentRunning ? <Button variant="ghost" size="sm" title="Runs the existing independent /review session; its own report defines the reviewed scope."
        disabled={!valid || !!target?.operation || writing || agentRunning || (review?.scopeKind !== 'workspace' && review?.scopeKind !== 'branch')}
        onClick={actions.onRunAgentReview}>{agentRunning ? 'Review running…' : 'Agent Review'}</Button> : null}
      <Button variant="outline" size="sm" disabled={!valid || writing} onClick={() => setCommit(true)}><GitCommitHorizontal aria-hidden />Commit…</Button>
    </header>
    {!valid ? target ? <div className="review-empty" role="status">This review target is no longer active. Reopen Review from the current Chat.</div>
      : flow.error ? <div className="review-empty" role="alert">{flow.error}</div>
        : <DroidLoading label="Connecting to the workspace…" /> : <>
      {flow.error ? <p className="review-error review-notice" role="alert">{flow.error}</p> : null}
      {flow.scopePending ? <p className="review-notice" role="status">Loading comparison…{review ? ' The previous comparison remains visible.' : ''}</p> : null}
      {flow.choosingBranch && !flow.scopePending && flow.branches && review?.scopeKind !== 'branch' ? <p className="review-notice" role="status">{flow.branches.refs.length ? 'Choose a base branch to compare local changes.' : 'No local branch references are available.'}</p> : null}
      {flow.operation?.ok && flow.operation.reviewScopeId === review?.reviewScopeId
        ? <p className="review-notice" role="status">{flow.operation.message}</p> : null}
      {review?.message && !target?.operation ? <p className="review-notice" role="status">{review.message}</p> : null}
      {review && !operationOnly && !flow.scopePending ? <p className="review-notice" role="status">
        {writing ? operationsScope ? 'Live run · confirmed edits appear after each tool finishes.' : 'Live workspace comparison · updates as files change.'
          : operationsScope ? 'Recorded operations · inspect each edit and its result.'
            : review.scopeKind === 'turn' && !missingSnapshot ? 'Completed turn · before → after.' : review.baselineLabel}
      </p> : null}
      <div className={`review-body ${showFiles ? '' : 'files-hidden'}`}>
        {showFiles ? <ReviewFiles files={files} selected={path} onSelect={value => { if (!flow.scopePending) selectFile(value); }} filters={filters} onFiltersChange={setFilters} /> : null}
        <section className="review-code">
          <div className="review-file-toolbar">
            <FileCode2 className="review-current-icon" aria-hidden />
            <div className="review-current-path" title={path ?? ''}>{directory ? <span>{directory} /</span> : null}<strong>{fileName ?? 'No file selected'}</strong></div>
            {flow.fileRefreshing && file && !operationOnly ? <span role="status" className="review-muted">Updating…</span> : null}
            <div className="review-recorded-controls" ref={setRecordedToolbar} />
            {!recordedEntries ? <>
              <ToggleGroup type="single" className="review-mode" aria-label="Diff layout" value={split ? 'split' : 'unified'} onValueChange={(value) => { if (value) setSplit(value === 'split'); }}>
                <ToggleGroupItem className="h-7 w-7 p-1.5" value="unified" aria-label="Unified view" title="Unified view"><Rows3 /></ToggleGroupItem>
                <ToggleGroupItem className="h-7 w-7 p-1.5" value="split" aria-label="Split view" title="Split view"><Columns2 /></ToggleGroupItem>
              </ToggleGroup>
              <ReviewIconButton variant="ghost" size="icon-sm" aria-label="Previous change" disabled={!hasHunks || flow.scopePending} onClick={() => hunk(-1)}><ArrowUp /></ReviewIconButton>
              <ReviewIconButton variant="ghost" size="icon-sm" aria-label="Next change" disabled={!hasHunks || flow.scopePending} onClick={() => hunk(1)}><ArrowDown /></ReviewIconButton>
            </> : null}
            {!readOnly && current ? <Tooltip content={operationsScope ? 'Marks all saved edits for this file at the current version.' : 'Marks this file comparison at the current version.'}><Button variant="ghost" size="sm" className="review-viewed" data-reviewed={current.status === 'reviewed'} disabled={!canMark} onClick={() => actions.onMarkReviewed(false)}><CheckCheck aria-hidden /><span>{current.status === 'reviewed' ? 'Viewed' : operationsScope ? 'Mark all file edits viewed' : 'Mark viewed'}</span></Button></Tooltip> : null}
            <ReviewIconButton variant="ghost" size="icon-sm" aria-label="Open current file" disabled={!path} onClick={() => port.postMessage({ type: 'reviewPanel.openPath', path })}><ExternalLink /></ReviewIconButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><ReviewIconButton variant="ghost" size="icon-sm" aria-label="More file actions"><MoreHorizontal /></ReviewIconButton></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="review-menu review-undo-menu" data-motion="anchored" sideOffset={6}>
                <p className="review-undo-hint" role="status">{readOnly ? readOnlyMessage : writing ? 'Live changes · review actions wait for completion' : `File ${fileIndex + 1} of ${files.length}`}</p>
                <DropdownMenuItem disabled={flow.scopePending || !navigation.previous} onSelect={() => navigation.navigate('previous')}><ChevronLeft />Previous file</DropdownMenuItem>
                <DropdownMenuItem disabled={flow.scopePending || !navigation.next} onSelect={() => navigation.navigate('next')}><ChevronRight />Next file</DropdownMenuItem>
                {!readOnly && current && files.length > 1 ? <DropdownMenuItem disabled={!canMark || !navigation.next} onSelect={navigation.markAndNext}><CheckCheck />{operationsScope ? 'Mark all file edits viewed & next' : 'Mark viewed & next'}</DropdownMenuItem> : null}
                {!operationOnly ? <>
                  <DropdownMenuItem disabled={!current || flow.scopePending || nativeUnavailable}
                    title={nativeUnavailable ? 'The complete versions for this edit are unavailable.' : undefined} onSelect={flow.openNative}>Open Native Diff</DropdownMenuItem>
                </> : null}
                {!operationOnly && !recordedEntries ? <>
                  <DropdownMenuItem onSelect={() => flow.setContext('all')}>Full file{flow.context === 'all' ? ' ✓' : ''}</DropdownMenuItem>
                  {[3, 20, 100].map((lines) => <DropdownMenuItem key={lines} onSelect={() => flow.setContext(lines as 3 | 20 | 100)}>{lines} context lines{flow.context === lines ? ' ✓' : ''}</DropdownMenuItem>)}
                </> : null}
                {!readOnly && current && operationsScope ? <>
                {!current.restorable ? <p className="review-undo-hint">Undo needs a complete, reversible record. This file does not have one.</p> : null}
                {turnUndoTooLarge ? <p className="review-undo-hint">Undo individual files when a turn exceeds {MAX_REVIEW_UNDO_FILES} files.</p> : null}
                <DropdownMenuItem disabled={writing || flow.scopePending || flow.fileRefreshing || !!flow.fileError || !current.restorable} onSelect={() => actions.onPreviewRestore('file')}><Undo2 />Undo this file…</DropdownMenuItem>
                <DropdownMenuItem disabled={writing || flow.scopePending || turnUndoTooLarge || !review.files.length || !review.files.every((entry) => entry.restorable)} onSelect={() => actions.onPreviewRestore('turn')}>Undo all files in this turn…</DropdownMenuItem>
                </> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          {flow.fileError && !operationOnly ? <div className="review-notice review-error" role="status">
            {flow.fileError}{file && !file.error ? ' Showing the previous diff.' : ''}
            <Button variant="ghost" size="sm" onClick={flow.retryFile}>Retry</Button>
          </div> : null}
          <div className="review-code-scroll" ref={scroll}>
            {target?.operation?.status === 'unavailable' ? <p className="review-empty">{OPERATION_UNAVAILABLE[target.operation.reason]}</p>
              : flow.scopePending && !file && !operation ? <DroidLoading label="Reading comparison…" />
              : !path ? <p className="review-empty">No changes in this comparison.</p>
              : !operation && !file ? flow.fileError ? <p className="review-empty">Diff unavailable.</p> : <DroidLoading label="Reading Diff…" />
              : !operation && file?.error ? <p className="review-empty" role="status">{file.error}</p>
              : recordedEntries ? <RecordedFileReview key={`${path}:${review?.reviewScopeId ?? operation?.callId ?? ''}`} entries={recordedEntries}
                content={recordedContent} path={path} split={split} onSplit={setSplit} onHunk={hunk} toolbarTarget={recordedToolbar}
                readingKey={readingKey} positions={positions.current} loading={flow.fileRefreshing}
                selectedToolUseId={flow.selectedToolUseId} onSelectEdit={flow.selectRecordedEdit} />
              : patch && patch !== '@@' ? <DiffView patch={patch} path={path} split={split} />
              : operationFile?.contentRestricted ? null
              : <p className="review-empty">{operationFile ? `File ${operationFile.kind}. Text changes were not recorded.` : operationsScope ? 'No text Diff evidence is available.' : 'No net text changes.'}</p>}
            {file?.truncated && !operation ? <p className="review-notice">{file.recordedOperations
              ? 'Some recorded content exceeds the preview limit. Open Native Diff for the selected edit.'
              : 'Preview limit reached. Open Native Diff to read the complete comparison.'}</p> : null}
          </div>

        </section>
      </div>
      {flow.agent ? <div className="review-agent-status" role="status">Agent Review: {flow.agent.status}. {flow.agent.message ?? 'Report opens in its independent session tab.'}
        {flow.agent.reviewSessionId ? <Button variant="link" size="sm" onClick={() => port.postMessage({ type: 'reviewPanel.openAgent' })}>Open report</Button> : null}
      </div> : null}
    </>}
    <Dialog open={commit && valid} onOpenChange={setCommit}>
      <DialogContent className="max-w-2xl border-[var(--panel-edge)]"><DialogTitle className="review-dialog-title">Commit</DialogTitle><DialogDescription className="review-dialog-description">Choose the files to commit. Existing staged files require explicit selection.</DialogDescription>
        {target?.sessionId ? <ReviewCommit port={port} sessionId={target.sessionId} initialMode={review?.scopeKind === 'staged' ? 'staged' : 'files'} onClose={closeCommit} /> : null}
      </DialogContent>
    </Dialog>
    <Dialog open={!!flow.preview && flow.preview.reviewScopeId === review?.reviewScopeId && valid} onOpenChange={(open) => { if (!open) flow.setPreview(null); }}>
      <DialogContent className="border-[var(--panel-edge)]"><DialogTitle className="review-dialog-title">Undo confirmed AI operations?</DialogTitle><DialogDescription className="review-dialog-description">Applies exact inverse changes from recorded tool results. Unrelated edits are preserved. Unsaved edits, ambiguous context or conflicting changes block undo. Workspace snapshots and legacy excerpts are not undo evidence.</DialogDescription>
        {flow.preview ? <><ul className="review-restore-files">{[...flow.preview.restorable, ...flow.preview.conflicted].map((path) => <li key={path} data-conflict={flow.preview!.conflicted.includes(path)}>{path}{flow.preview!.conflicted.includes(path) ? ' · conflict' : ''}</li>)}</ul>
          <div className="review-dialog-actions"><Button variant="ghost" onClick={() => flow.setPreview(null)}>Cancel</Button>
            <Button disabled={!!flow.preview.conflicted.length || !flow.preview.restorable.length} onClick={() => actions.onConfirmRestore(flow.preview!.target, flow.preview!.previewId)}>Confirm restore</Button>
          </div></> : null}
      </DialogContent>
    </Dialog>
  </main></TooltipProvider>;
}
