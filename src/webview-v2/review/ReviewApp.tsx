import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, CheckCheck, ChevronLeft, ChevronRight, ExternalLink, GitCompareArrows, PanelLeft, RefreshCw } from 'lucide-react';
import { MAX_REVIEW_UNDO_FILES, REVIEW_SCOPE_KINDS, type ReviewScopeKind } from '../../shared/protocol/reviewProtocol';
import { Button } from '../ui/button';
import { DroidLoading } from '../ui/droid-motion';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/selection';
import { ToggleGroup, ToggleGroupItem } from '../ui/controls';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../ui/overlays';
import { DiffView } from './DiffView';
import { ReviewFiles } from './ReviewFiles';
import { ReviewCommit } from './ReviewCommit';
import { useReviewWorkbench, type ReviewPort } from './useReviewWorkbench';
import { OPERATION_UNAVAILABLE } from '../content/OperationDiff';
import { hasOperationTextChanges } from '../../shared/protocol/operationDiff';
import { operationLabel } from '../content/operationPresentation';
const labels: Record<ReviewScopeKind, string> = {
  operations: 'AI operations', turn: 'Turn workspace', workspace: 'Workspace', branch: 'Branch', unstaged: 'Unstaged', staged: 'Staged',
};
export function ReviewApp({ port }: { port: ReviewPort }) {
  const flow = useReviewWorkbench(port);
  const { target, review, current, file, actions } = flow;
  const [split, setSplit] = useState(false);
  const [showFiles, setShowFiles] = useState(true);
  const [commit, setCommit] = useState(false);
  const [operationPath, setOperationPath] = useState<string | null>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const closeCommit = useCallback(() => setCommit(false), []);
  const operation = target?.operation?.status === 'ready' ? target.operation : null;
  const operationFile = operation?.files.find((entry) => entry.path === (operationPath ?? target?.operationPath)) ?? operation?.files[0];
  const path = operationFile?.path ?? current?.path ?? null;
  const patch = operationFile?.patch ?? file?.patch ?? '';
  const files = useMemo(() => operation ? operation.files.map((entry) => ({
    path: entry.path, additions: null, deletions: null, status: 'open-only' as const, version: 'operation', restorable: false,
  })) : review?.files ?? [], [operation, review?.files]);
  const additions = files.reduce((sum, entry) => sum + (entry.additions ?? 0), 0);
  const deletions = files.reduce((sum, entry) => sum + (entry.deletions ?? 0), 0);
  const completeCounts = files.every((entry) => entry.additions !== null && entry.deletions !== null);
  const operationIndex = operationFile ? operation!.files.indexOf(operationFile) : -1;
  const selectFile = useCallback((value: string) => {
    if (operation) setOperationPath(value); else actions.onSelectFile(value);
  }, [operation, actions.onSelectFile]);
  useLayoutEffect(() => {
    scroll.current?.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [path, review?.reviewScopeId, operation?.callId]);
  const navigateFile = (direction: 'previous' | 'next') => {
    if (operation) {
      const next = operation.files[operationIndex + (direction === 'next' ? 1 : -1)];
      if (next) setOperationPath(next.path);
    } else actions.onNavigate(direction);
  };
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
    !flow.fileRefreshing && !flow.fileError &&
    file.version === current.version && current.version !== 'unavailable' && current.status !== 'reviewed' &&
    !writing;
  const hasHunks = !!patch || !!file?.recordedOperations?.some((entry) => hasOperationTextChanges(entry.patch));
  const agentRunning = flow.agent?.status === 'running' || flow.agent?.status === 'starting';
  const hunk = (direction: number) => {
    const container = scroll.current;
    if (!container) return;
    const hunks = [...container.querySelectorAll<HTMLElement>('[data-diff-hunk]')];
    const top = container.getBoundingClientRect().top;
    const next = direction > 0 ? hunks.find((entry) => entry.getBoundingClientRect().top > top + 8)
      : hunks.reverse().find((entry) => entry.getBoundingClientRect().top < top - 8);
    if (next) container.scrollBy({ top: next.getBoundingClientRect().top - top,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  return <main className="review-workbench">
    <header className="review-topbar">
      <div className="review-brand"><GitCompareArrows /><strong>Review</strong></div>
      <Select disabled={!valid || flow.scopePending} value={target?.operation ? 'operation' : review?.scopeKind ?? 'workspace'}
        onValueChange={(value) => { setOperationPath(null); flow.openScope(value as ReviewScopeKind); }}>
        <SelectTrigger aria-label="Comparison scope" className="w-36"><SelectValue /></SelectTrigger>
        <SelectContent>
          {target?.operation ? <SelectItem value="operation">This operation</SelectItem> : null}
          {REVIEW_SCOPE_KINDS.map((kind) => <SelectItem key={kind} value={kind} disabled={(kind === 'turn' || kind === 'operations') && !target?.latestTurnId && !review?.turnId}>{labels[kind]}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button variant="ghost" size="icon-sm" aria-label="Refresh review" disabled={!valid || flow.scopePending} onClick={flow.refresh}><RefreshCw /></Button>
      <span className="review-top-spacer" />
      <Button variant="ghost" size="sm" title="Runs the existing independent /review session; its own report defines the reviewed scope."
        disabled={!valid || !!target?.operation || writing || agentRunning || (review?.scopeKind !== 'workspace' && review?.scopeKind !== 'branch')}
        onClick={actions.onRunAgentReview}>{agentRunning ? 'Review running…' : 'Agent Review'}</Button>
      <Button size="sm" disabled={!valid || writing} onClick={() => setCommit(true)}>Commit…</Button>
    </header>
    <div className="review-rangebar">
      <span>{operation ? operationLabel(operation) : flow.scopePending ? 'Loading comparison…' : review?.baselineLabel ?? 'Choose a comparison'}</span>
      <span>{files.length} files{!operation ? completeCounts ? ` · +${additions} −${deletions}${operationsScope ? ' operation lines, not net changes' : ''}` : ' · line counts unavailable' : ''}
        {review && !operation && !missingSnapshot ? ` · ${review.reviewedCount}/${review.reviewableCount} reviewed` : ''}</span>
    </div>
    {!valid ? target ? <div className="review-empty" role="status">This review target is no longer active. Reopen Review from the current Chat.</div>
      : flow.error ? <div className="review-empty" role="alert">{flow.error}</div>
        : <DroidLoading label="Connecting to the workspace…" /> : <>
      {flow.error ? <p className="review-error review-notice" role="alert">{flow.error}</p> : null}
      {flow.operation?.ok && flow.operation.reviewScopeId === review?.reviewScopeId
        ? <p className="review-notice" role="status">{flow.operation.message}</p> : null}
      {review?.message && !target?.operation ? <p className="review-notice" role="status">{review.message}</p> : null}
      <div className={`review-body ${showFiles ? '' : 'files-hidden'}`}>
        {showFiles ? <ReviewFiles files={files} selected={path} onSelect={selectFile} /> : null}
        <section className="review-code">
          <div className="review-file-toolbar">
            <Button variant="ghost" size="icon-sm" className="review-files-toggle" aria-label="Toggle files" aria-pressed={showFiles} onClick={() => setShowFiles(!showFiles)}><PanelLeft /></Button>
            <span className="review-current-path" title={path ?? ''}>{path ?? 'No file selected'}</span>
            {flow.fileRefreshing && file && !operationOnly ? <span role="status" className="review-muted">Updating…</span> : null}
            <Button variant="ghost" size="icon-sm" aria-label="Open current file" disabled={!path} onClick={() => port.postMessage({ type: 'reviewPanel.openPath', path })}><ExternalLink /></Button>
            {!readOnly && !operationsScope ? <Button variant="ghost" size="sm" disabled={!current || flow.scopePending} onClick={flow.openNative}>Native Diff</Button> : null}
          </div>
          <div className="review-diff-toolbar">
            <ToggleGroup type="single" className="review-mode" aria-label="Diff layout" value={split ? 'split' : 'unified'}
              onValueChange={(value) => { if (value) setSplit(value === 'split'); }}>
              <ToggleGroupItem value="unified">Unified</ToggleGroupItem>
              <ToggleGroupItem value="split">Split</ToggleGroupItem>
            </ToggleGroup>
            {!readOnly && !operationsScope ? <Select value={String(flow.context)} onValueChange={(value) => flow.setContext(Number(value) as 3 | 20 | 100)}>
              <SelectTrigger aria-label="Context lines" className="review-context h-6 w-32 border-0 bg-transparent text-[10px]"><SelectValue /></SelectTrigger>
              <SelectContent>{[3, 20, 100].map((lines) => <SelectItem key={lines} value={String(lines)} className="text-[10px]">{lines} context lines</SelectItem>)}</SelectContent>
            </Select> : null}
            <span className="review-top-spacer" />
            <Button variant="ghost" size="icon-sm" aria-label="Previous change" disabled={!hasHunks || flow.scopePending} onClick={() => hunk(-1)}><ArrowUp /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next change" disabled={!hasHunks || flow.scopePending} onClick={() => hunk(1)}><ArrowDown /></Button>
          </div>
          {flow.fileError && !operationOnly ? <div className="review-notice review-error" role="status">
            {flow.fileError}{file && !file.error ? ' Showing the previous diff.' : ''}
            <Button variant="ghost" size="sm" onClick={flow.retryFile}>Retry</Button>
          </div> : null}
          <div className="review-code-scroll" ref={scroll}>
            {operationFile?.message ? <p className="review-notice" role="status">{operationFile.message}</p> : null}
            {target?.operation?.status === 'unavailable' ? <p className="review-empty">{OPERATION_UNAVAILABLE[target.operation.reason]}</p>
              : flow.scopePending ? <DroidLoading label="Loading comparison…" />
              : !path ? <p className="review-empty">No changes in this comparison.</p>
              : !operation && !file ? flow.fileError ? <p className="review-empty">Diff unavailable.</p> : <DroidLoading label="Reading Diff…" />
              : !operation && file?.error ? <p className="review-empty" role="status">{file.error}</p>
              : !operation && file?.recordedOperations ? file.recordedOperations.map((entry, index) => <section key={`${entry.toolUseId}:${index}`}>
                <p className="review-notice">Recorded operation {index + 1} · {entry.source === 'tool-result'
                  ? entry.outcome === 'applied' ? 'confirmed tool result' : entry.outcome === 'failed' ? 'failed file result' : 'side effects unconfirmed'
                  : entry.source === 'tool-input' ? 'proposed edit, not confirmed' : 'legacy input excerpt, not verified execution'}</p>
                {entry.message ? <p className="review-notice" role="status">{entry.message}</p> : null}
                {entry.patch && entry.patch !== '@@' ? <DiffView patch={entry.patch} path={path} split={split} />
                  : entry.message ? null : <p className="review-notice">Text changes were not retained for this operation.</p>}
              </section>)
              : patch && patch !== '@@' ? <DiffView patch={patch} path={path} split={split} />
              : operationFile?.contentRestricted ? null
              : <p className="review-empty">{operationFile ? `File ${operationFile.kind}. Text changes were not recorded.` : operationsScope ? 'No text Diff evidence is available.' : 'No net text changes.'}</p>}
            {file?.truncated && !operation ? <p className="review-notice">{file.recordedOperations
              ? 'Some saved operation excerpts exceed the preview limit.'
              : 'Preview limit reached. Open Native Diff to read the complete comparison.'}</p> : null}
          </div>
          <footer className="review-bottom">
            <div className="review-navigation">
            <Button variant="ghost" size="icon-sm" aria-label="Previous file" disabled={operation ? operationIndex <= 0 : !review || review.currentIndex === null || review.currentIndex === 0} onClick={() => navigateFile('previous')}><ChevronLeft /></Button>
            <Button variant="ghost" size="icon-sm" aria-label="Next file" disabled={operation ? operationIndex >= operation.files.length - 1 : !review || review.currentIndex === null || review.currentIndex >= review.files.length - 1} onClick={() => navigateFile('next')}><ChevronRight /></Button>
            <span className="review-muted min-w-0 truncate" role="status" title={readOnly ? readOnlyMessage : undefined}>{readOnly ? readOnlyMessage
              : writing ? 'Live changes · review actions wait for completion'
              : turnUndoTooLarge ? `Over ${MAX_REVIEW_UNDO_FILES} files · undo files individually`
              : operationsScope && current && !current.restorable ? 'Undo unavailable: complete reversible evidence is required'
              : current?.status === 'reviewed' ? 'Reviewed' : ''}</span>
            </div>
            <div className="review-actions">
            {!readOnly && current && operationsScope ? <>
              <Button variant="ghost" size="sm" disabled={writing || flow.scopePending || flow.fileRefreshing || !!flow.fileError || !current?.restorable} onClick={() => actions.onPreviewRestore('file')}>Undo file operations…</Button>
              <Button variant="ghost" size="sm" title={turnUndoTooLarge ? `Turn undo supports up to ${MAX_REVIEW_UNDO_FILES} files. Undo individual files instead.` : undefined}
                disabled={writing || flow.scopePending || turnUndoTooLarge || !review.files.length || !review.files.every((entry) => entry.restorable)} onClick={() => actions.onPreviewRestore('turn')}>Undo turn operations…</Button>
            </> : null}
            {!readOnly && current ? <>
              <Button variant="outline" size="sm" disabled={!canMark} onClick={() => actions.onMarkReviewed(false)}><CheckCheck />Reviewed</Button>
              <Button size="sm" disabled={!canMark} onClick={() => actions.onMarkReviewed(true)}>Mark &amp; next</Button>
            </> : null}
            </div>
          </footer>
        </section>
      </div>
      {flow.agent ? <div className="review-agent-status" role="status">Agent Review: {flow.agent.status}. {flow.agent.message ?? 'Report opens in its independent session tab.'}
        {flow.agent.reviewSessionId ? <Button variant="link" size="sm" onClick={() => port.postMessage({ type: 'reviewPanel.openAgent' })}>Open report</Button> : null}
      </div> : null}
    </>}
    <Dialog open={commit && valid} onOpenChange={setCommit}>
      <DialogContent className="max-w-2xl border-[var(--panel-edge)]"><DialogTitle className="review-dialog-title">Commit</DialogTitle><DialogDescription className="review-dialog-description">Choose the files to commit. Existing staged files require explicit selection.</DialogDescription>
        {target?.sessionId ? <ReviewCommit port={port} sessionId={target.sessionId} onClose={closeCommit} /> : null}
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
  </main>;
}
