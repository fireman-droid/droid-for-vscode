import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ReviewFile } from '../../shared/protocol/reviewProtocol';
import { Button } from '../ui/button';
import { DroidLoading } from '../ui/droid-motion';
import { Dialog, DialogContent, DialogDescription, DialogTitle, TooltipProvider } from '../ui/overlays';
import { findDiffChange } from './DiffView';
import { ReviewFiles, filterReviewFiles, type ReviewFileFilters } from './ReviewFiles';
import { ReviewCommit } from './ReviewCommit';
import { useReviewWorkbench, type ReviewPort } from './useReviewWorkbench';
import { OPERATION_UNAVAILABLE } from '../content/OperationDiff';
import { ReviewFileSection } from './ReviewFileSection';
import { ReviewToolbar } from './ReviewToolbar';
import { useReviewFileNavigation } from './useReviewFileNavigation';

export function ReviewApp({ port }: { port: ReviewPort }) {
  const flow = useReviewWorkbench(port);
  const { target, review, current, actions } = flow;
  const [split, setSplit] = useState(true);
  const [showFiles, setShowFiles] = useState(false);
  const [commit, setCommit] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [filters, setFilters] = useState<ReviewFileFilters>({ query: '', unreviewed: false });
  const [jump, setJump] = useState<{ path: string } | null>(null);
  const [findRequest, setFindRequest] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const closeCommit = useCallback(() => setCommit(false), []);
  const operation = target?.operation?.status === 'ready' ? target.operation : null;
  const files = useMemo<readonly ReviewFile[]>(() => operation ? operation.files.map(entry => ({
    path: entry.path, additions: null, deletions: null, status: 'open-only', version: 'operation', restorable: false,
  })) : review?.files ?? [], [operation, review?.files]);
  const filtered = useMemo(() => filterReviewFiles(files, filters), [files, filters]);
  const scopeKey = JSON.stringify([target?.sessionId, review?.reviewScopeId, operation?.callId, target?.operationPath]);
  const valid = target?.valid === true;
  const selectedPath = jump?.path ?? current?.path ?? target?.operationPath ?? files[0]?.path ?? null;
  const reveal = useCallback((path: string) => {
    setCollapsed(previous => { const next = new Set(previous); next.delete(path); return next; });
    setJump({ path });
  }, []);
  useEffect(() => { setCollapsed(new Set()); setFilters({ query: '', unreviewed: false }); }, [scopeKey]);
  const hostPath = operation ? target?.operationPath ?? files[0]?.path : current?.path;
  useEffect(() => { if (hostPath) reveal(hostPath); }, [scopeKey, hostPath, reveal]);
  useLayoutEffect(() => {
    const container = scroll.current;
    if (!jump || !container) return;
    const element = [...container.querySelectorAll<HTMLElement>('[data-review-path]')].find(element => element.dataset.reviewPath === jump.path);
    if (element) container.scrollTop += element.getBoundingClientRect().top - container.getBoundingClientRect().top;
  }, [jump]);
  useEffect(() => {
    if (findRequest && showFiles) root.current?.querySelector<HTMLInputElement>('.review-file-search input')?.focus();
  }, [findRequest, showFiles]);
  const selectFile = (path: string) => {
    if (flow.scopePending) return;
    reveal(path);
    if (!operation) actions.onSelectFile(path);
    if (window.innerWidth <= 700) setShowFiles(false);
  };
  const navigation = useReviewFileNavigation(review, filtered.map(file => file.path), selectedPath, selectFile, actions);
  const navigate = (path: string, direction: number) => {
    const index = filtered.findIndex(file => file.path === path);
    const next = filtered[index + direction];
    if (next) selectFile(next.path);
  };
  const hunk = (direction: number) => {
    const container = scroll.current;
    if (!container) return;
    const top = container.getBoundingClientRect().top + 36;
    const next = findDiffChange(container, top + direction * 8, direction);
    if (next !== null) container.scrollBy({ top: next - top,
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
  };
  const allCollapsed = filtered.length > 0 && filtered.every(file => collapsed.has(file.path));
  return <TooltipProvider><main ref={root} className="review-workbench">
    <ReviewToolbar flow={flow} split={split} onSplit={setSplit} showFiles={showFiles} onFiles={() => setShowFiles(value => !value)}
      onFind={() => { setShowFiles(true); setFindRequest(value => value + 1); }} onHunk={hunk} onCommit={() => setCommit(true)}
      allCollapsed={allCollapsed} onCollapse={() => setCollapsed(allCollapsed ? new Set() : new Set(filtered.map(file => file.path)))} />
    {!valid ? target ? <div className="review-empty" role="status">This review target is no longer active. Reopen Review from the current Chat.</div>
      : flow.error ? <div className="review-empty" role="alert">{flow.error}</div>
        : <DroidLoading label="Connecting to the workspace…" /> : <>
      {flow.error ? <p className="review-error review-notice" role="alert">{flow.error}</p> : null}
      {flow.scopePending ? <p className="review-notice" role="status">Loading comparison…{review ? ' The previous comparison remains visible.' : ''}</p> : null}
      {flow.choosingBranch && !flow.scopePending && flow.branches && review?.scopeKind !== 'branch' ? <p className="review-notice" role="status">{flow.branches.refs.length ? 'Choose a base branch to compare local changes.' : 'No local branch references are available.'}</p> : null}
      {flow.operation?.ok && flow.operation.reviewScopeId === review?.reviewScopeId ? <p className="review-notice" role="status">{flow.operation.message}</p> : null}
      {review?.message && !target?.operation ? <p className="review-notice" role="status">{review.message}</p> : null}
      <div className={`review-body ${showFiles ? '' : 'files-hidden'}`}>
        <section className="review-code" aria-label="File comparisons">
          <div className="review-code-scroll review-stream" ref={scroll}>
            {target?.operation?.status === 'unavailable' ? <p className="review-empty">{OPERATION_UNAVAILABLE[target.operation.reason]}</p>
              : !files.length ? <p className="review-empty">{flow.scopePending ? 'Reading comparison…' : 'No changes in this comparison.'}</p>
              : !filtered.length ? <p className="review-empty">No matching files. <Button variant="link" size="sm" onClick={() => setFilters({ query: '', unreviewed: false })}>Clear filters</Button></p>
              : filtered.map((entry, index) => <ReviewFileSection key={`${scopeKey}:${entry.path}`} entry={entry} flow={flow} port={port} split={split}
                open={!collapsed.has(entry.path)} onOpenChange={open => setCollapsed(previous => {
                  const next = new Set(previous); if (open) next.delete(entry.path); else next.add(entry.path); return next;
                })} onNavigate={navigate} onMarkAndNext={navigation.markAndNext} hasPrevious={index > 0} hasNext={index < filtered.length - 1} />)}
          </div>
        </section>
        {showFiles ? <ReviewFiles side="right" files={files} selected={selectedPath} onSelect={selectFile} filters={filters} onFiltersChange={setFilters} /> : null}
      </div>
      <footer className="review-statusbar">
        <span>{operation ? 'Recorded operation' : review?.lifecycle === 'writing' ? 'Live changes'
          : review?.scopeKind === 'operations' ? 'Recorded edits · saved evidence'
          : review?.recordedOnly ? 'Saved excerpts · turn snapshot unavailable' : review?.baselineLabel}</span>
        {review && !operation ? <span>{review.reviewedCount} / {review.reviewableCount} reviewed</span> : null}
      </footer>
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
      <DialogContent className="border-[var(--panel-edge)]"><DialogTitle className="review-dialog-title">Undo confirmed AI operations?</DialogTitle><DialogDescription className="review-dialog-description">Reverses recorded edits and deletes confirmed new files whose contents still match. Conversation history stays unchanged. Unsaved edits, conflicting content or incomplete evidence block undo.</DialogDescription>
        {flow.preview ? <><ul className="review-restore-files">{flow.preview.restorable.map(path => <li key={path}>{path}{flow.preview!.deleted.includes(path) ? ' · delete new file' : ' · reverse edits'}</li>)}
          {(flow.preview.issues ?? flow.preview.conflicted.map(path => ({ path, status: 'conflicted', reason: 'The file has conflicting changes.' }))).map(issue => <li key={issue.path} data-conflict="true">{issue.path} · {issue.reason}</li>)}
        </ul>
          <div className="review-dialog-actions"><Button variant="ghost" onClick={() => flow.setPreview(null)}>Cancel</Button>
            <Button disabled={!!flow.preview.conflicted.length || !!flow.preview.issues?.length || !flow.preview.restorable.length} onClick={() => actions.onConfirmRestore(flow.preview!.target, flow.preview!.previewId)}>Confirm undo</Button>
          </div></> : null}
      </DialogContent>
    </Dialog>
  </main></TooltipProvider>;
}
