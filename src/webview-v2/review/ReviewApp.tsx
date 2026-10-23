import { useI18n } from '@droidvisx/chat-ui/i18n';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewFile } from '../../shared/protocol/reviewProtocol';
import { Button } from '../ui/button';
import { DroidLoading } from '../ui/droid-motion';
import { Dialog, DialogContent, DialogDescription, DialogTitle, TooltipProvider } from '../ui/overlays';
import { useReviewHunkNavigation } from './useReviewHunkNavigation';
import { ReviewFiles, filterReviewFiles, type ReviewFileFilters } from './ReviewFiles';
import { ReviewCommit } from './ReviewCommit';
import { useReviewWorkbench, type ReviewPort } from './useReviewWorkbench';
import { OPERATION_UNAVAILABLE } from '../content/OperationDiff';
import { ReviewFileSection } from './ReviewFileSection';
import { ReviewToolbar } from './ReviewToolbar';
import { useReviewFileNavigation } from './useReviewFileNavigation';
import { VirtualReviewFiles } from './VirtualReviewFiles';
import { ReviewQuestions } from './ReviewQuestions';
import { ScrollArea } from '@droidvisx/chat-ui/ui/scroll-area';
import { UiEnvironmentProvider, useUiEnvironment } from '@droidvisx/chat-ui/environment';
import { DiffReferenceContext } from '@droidvisx/chat-ui/review/diffReference';
import type { CodeReference } from '@droidvisx/chat-ui/chat/codeReferences';

export function ReviewApp({ port }: { port: ReviewPort }) {
  const { t } = useI18n();
  const flow = useReviewWorkbench(port);
  const { target, review, current, actions } = flow;
  const environment = useUiEnvironment();
  const [reference, setReference] = useState<(CodeReference & { request: number }) | null>(null);
  const [referenceNotice, setReferenceNotice] = useState<string | null>(null);
  const codeReferencePath = useCallback((path: string) => /^(?:[a-z]:[\\/]|\/)/i.test(path) || !target?.workspaceRoot
    ? path : `${target.workspaceRoot.replace(/[\\/]$/, '')}/${path}`, [target?.workspaceRoot]);
  const [split, setSplit] = useState(true);
  const [showFiles, setShowFiles] = useState(false);
  const [commit, setCommit] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [filters, setFilters] = useState<ReviewFileFilters>({ query: '', unreviewed: false });
  const [jump, setJump] = useState<{ path: string } | null>(null);
  const [findRequest, setFindRequest] = useState(0);
  const scroll = useRef<HTMLDivElement>(null);
  const pendingReveal = useRef<string | null>(null);
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
    const read = flow.fileReads.get(path);
    pendingReveal.current = read.file && !read.pending ? null : path;
    setCollapsed(previous => previous.has(path) ? new Set([...previous].filter(item => item !== path)) : previous);
    setJump({ path });
  }, [flow.fileReads]);
  useEffect(() => { setCollapsed(new Set()); setFilters({ query: '', unreviewed: false }); setReference(null); setReferenceNotice(null); }, [scopeKey]);
  const hostPath = operation ? target?.operationPath ?? files[0]?.path : current?.path;
  useEffect(() => { if (hostPath) reveal(hostPath); }, [scopeKey, hostPath, flow.context, reveal]);
  useEffect(() => {
    const path = pendingReveal.current;
    if (!path) return;
    const read = flow.fileReads.get(path);
    if (read.file && !read.pending) { pendingReveal.current = null; setJump({ path }); }
  });
  useEffect(() => {
    if (findRequest && showFiles) root.current?.querySelector<HTMLInputElement>('.review-file-search input')?.focus();
  }, [findRequest, showFiles]);
  const selectFile = (path: string) => {
    if (flow.scopePending) return;
    reveal(path);
    flow.fileReads.prioritize(path);
    if (!operation) actions.onSelectFile(path);
    if (window.innerWidth <= 700) setShowFiles(false);
  };
  const navigation = useReviewFileNavigation(review, filtered.map(file => file.path), selectedPath, selectFile, actions);
  const referenceEnvironment = { ...environment, codeReferencePath, codeReferenceAction: 'reveal' as const, openCodeReference: (next: CodeReference) => {
    const normalize = (path: string) => {
      const slashes = path.replace(/\\/g, '/');
      return /^[a-z]:/i.test(slashes) ? slashes.toLowerCase() : slashes;
    };
    const file = files.find(file => normalize(file.path) === normalize(next.path) || normalize(codeReferencePath(file.path)) === normalize(next.path));
    if (!file) { setReferenceNotice(t('This file is not in the current comparison.')); return; }
    setReferenceNotice(null); setFilters(previous => previous.query || previous.unreviewed ? { query: '', unreviewed: false } : previous);
    const mounted = [...scroll.current?.querySelectorAll<HTMLElement>('[data-review-path]') ?? []].some(item => item.dataset.reviewPath === file.path);
    if (!mounted || collapsed.has(file.path) || filters.query || filters.unreviewed) reveal(file.path);
    flow.fileReads.prioritize(file.path);
    setReference({ ...next, path: file.path, request: Date.now() });
  } };
  const navigate = (path: string, direction: number) => {
    const index = filtered.findIndex(file => file.path === path);
    const next = filtered[index + direction];
    if (next) selectFile(next.path);
  };
  const hunk = useReviewHunkNavigation(scroll, filtered.map(file => file.path), selectFile, scopeKey);
  const allCollapsed = filtered.length > 0 && filtered.every(file => collapsed.has(file.path));
  return <UiEnvironmentProvider value={referenceEnvironment}><DiffReferenceContext.Provider value={reference}><TooltipProvider><ReviewQuestions scopeKey={`${scopeKey}:${split}:${valid}`} port={port} sessionId={valid ? target.sessionId : null} enabled={valid && !flow.scopePending}><main ref={root} className="review-workbench">
    <ReviewToolbar flow={flow} split={split} onSplit={setSplit} showFiles={showFiles} onFiles={() => setShowFiles(value => !value)}
      onFind={() => { setShowFiles(true); setFindRequest(value => value + 1); }} onHunk={hunk} onCommit={() => setCommit(true)}
      allCollapsed={allCollapsed} onCollapse={() => setCollapsed(allCollapsed ? new Set() : new Set(filtered.map(file => file.path)))} />
    {!valid ? target ? <div className="review-empty" role="status">{t("This review target is no longer active. Reopen Review from the current Chat.")}</div>
      : flow.error ? <div className="review-empty" role="alert">{flow.error}</div>
        : <DroidLoading label={t("Connecting to the workspace…")} /> : <>
      {flow.error ? <p className="review-error review-notice" role="alert">{flow.error}</p> : null}
      {referenceNotice ? <p className="review-notice" role="status">{referenceNotice}</p> : null}
      {flow.scopePending ? <p className="review-notice" role="status">{t("Loading comparison…")}{review ? t("The previous comparison remains visible.") : ''}</p> : null}
      {flow.choosingBranch && !flow.scopePending && flow.branches && review?.scopeKind !== 'branch' ? <p className="review-notice" role="status">{flow.branches.refs.length ? t("Choose a base branch to compare local changes.") : t("No local branch references are available.")}</p> : null}
      {flow.operation?.ok && flow.operation.reviewScopeId === review?.reviewScopeId ? <p className="review-notice" role="status">{flow.operation.message}</p> : null}
      {review?.message && !target?.operation ? <p className="review-notice" role="status">{review.message}</p> : null}
      <div className={`review-body ${showFiles ? '' : 'files-hidden'}`}>
        <section className="review-code" aria-label={t("File comparisons")}>
          <ScrollArea className="review-code-area" viewportClassName="review-code-scroll review-stream" viewportRef={scroll}
            aria-label={t("File comparisons")} onWheelCapture={() => { pendingReveal.current = null; }}>
            {target?.operation?.status === 'unavailable' ? <p className="review-empty">{OPERATION_UNAVAILABLE[target.operation.reason]}</p>
              : !files.length ? <p className="review-empty">{flow.scopePending ? t("Reading comparison…") : t("No changes in this comparison.")}</p>
              : !filtered.length ? <p className="review-empty">{t("No matching files.")} <Button variant="link" size="sm" onClick={() => setFilters({ query: '', unreviewed: false })}>{t("Clear filters")}</Button></p>
              : <VirtualReviewFiles key={`${scopeKey}:${flow.context}:${allCollapsed}`} files={filtered} scroll={scroll} jump={jump} collapsed={collapsed} render={(entry, index) => <ReviewFileSection entry={entry} flow={flow} port={port} split={split}
                open={!collapsed.has(entry.path)} onOpenChange={open => setCollapsed(previous => {
                  const next = new Set(previous); if (open) next.delete(entry.path); else next.add(entry.path); return next;
                })} onNavigate={navigate} onMarkAndNext={navigation.markAndNext} hasPrevious={index > 0} hasNext={index < filtered.length - 1} />} />}
          </ScrollArea>
        </section>
        {showFiles ? <ReviewFiles side="right" files={files} selected={selectedPath} onSelect={selectFile} filters={filters} onFiltersChange={setFilters} /> : null}
      </div>
      <footer className="review-statusbar">
        <span>{operation ? t("Recorded operation") : review?.lifecycle === 'writing' ? t("Live changes")
          : review?.scopeKind === 'operations' ? t("Recorded edits · saved evidence")
          : review?.recordedOnly ? t("Saved excerpts · turn snapshot unavailable") : review?.baselineLabel}</span>
        {review && !operation ? <span>{review.reviewedCount} / {review.reviewableCount} {t("reviewed")}</span> : null}
      </footer>
      {flow.agent ? <div className="review-agent-status" role="status">{t("Agent Review:")} {flow.agent.status}. {flow.agent.message ?? t("Report opens in its independent session tab.")}
        {flow.agent.reviewSessionId ? <Button variant="link" size="sm" onClick={() => port.postMessage({ type: 'reviewPanel.openAgent' })}>{t("Open report")}</Button> : null}
      </div> : null}
    </>}
    <Dialog open={commit && valid} onOpenChange={setCommit}>
      <DialogContent className="max-w-2xl border-[var(--panel-edge)]"><DialogTitle className="review-dialog-title">{t("Commit")}</DialogTitle><DialogDescription className="review-dialog-description">{t("Choose the files to commit. Existing staged files require explicit selection.")}</DialogDescription>
        {target?.sessionId ? <ReviewCommit port={port} sessionId={target.sessionId} initialMode={review?.scopeKind === 'staged' ? 'staged' : 'files'} onClose={closeCommit} /> : null}
      </DialogContent>
    </Dialog>
    <Dialog open={!!flow.preview && flow.preview.reviewScopeId === review?.reviewScopeId && valid} onOpenChange={(open) => { if (!open) flow.setPreview(null); }}>
      <DialogContent className="border-[var(--panel-edge)]"><DialogTitle className="review-dialog-title">{t("Undo confirmed AI operations?")}</DialogTitle><DialogDescription className="review-dialog-description">{t("Reverses recorded edits and deletes confirmed new files whose contents still match. Conversation history stays unchanged. Unsaved edits, conflicting content or incomplete evidence block undo.")}</DialogDescription>
        {flow.preview ? <><ul className="review-restore-files">{flow.preview.restorable.map(path => <li key={path}>{path}{flow.preview!.deleted.includes(path) ? t("· delete new file") : t("· reverse edits")}</li>)}
          {(flow.preview.issues ?? flow.preview.conflicted.map(path => ({ path, status: 'conflicted', reason: 'The file has conflicting changes.' }))).map(issue => <li key={issue.path} data-conflict="true">{issue.path} · {issue.reason}</li>)}
        </ul>
          <div className="review-dialog-actions"><Button variant="ghost" onClick={() => flow.setPreview(null)}>{t("Cancel")}</Button>
            <Button disabled={!!flow.preview.conflicted.length || !!flow.preview.issues?.length || !flow.preview.restorable.length} onClick={() => actions.onConfirmRestore(flow.preview!.target, flow.preview!.previewId)}>{t("Confirm undo")}</Button>
          </div></> : null}
      </DialogContent>
    </Dialog>
  </main></ReviewQuestions></TooltipProvider></DiffReferenceContext.Provider></UiEnvironmentProvider>;
}
