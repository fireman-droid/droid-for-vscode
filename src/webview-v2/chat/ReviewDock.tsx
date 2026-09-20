import { useEffect, useState } from 'react';
import type { ComponentProps } from 'react';
import type { ChangesTranscriptItem } from '../../shared/protocol/transcript';
import type { ChatPort } from '../../webview/assistant/shell/chatIntent';
import { useReviewScopeFlow, type ReviewDockProps } from '../../webview/assistant/changes/useReviewScopeFlow';
import { Tool, ToolContent } from '../ai-elements/tool';
import { Button } from '../ui/button';
import { CollapsibleTrigger } from '../ui/collapsible';
import { ToggleGroup, ToggleGroupItem } from '../ui/controls';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlays';
import { ChangesCommitEntry } from './GitCommitPanel';
import { cn } from '../ui/cn';
import { ChevronDown, ChevronRight, FileDiff } from 'lucide-react';
import { MAX_CHANGED_FILES_PER_TURN } from '../../shared/protocol/bounds';

export function ReviewDock(props: ReviewDockProps) {
  const { changes, review, restorePreview, operation, agent } = props;
  const [expanded, setExpanded] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const { pendingScope, openNoticeSequence, openScope } = useReviewScopeFlow(review, operation, props.onOpenScope);
  useEffect(() => { if (!expanded) setMoreOpen(false); }, [expanded]);
  if (changes.files.length === 0) return null;
  const ownsLatest = review?.scopeKind === 'turn' && review.turnId === changes.turnId;
  const newerChanges = review?.scopeKind === 'turn' && review.turnId !== changes.turnId;
  const current = review?.currentIndex == null ? null : review.files[review.currentIndex] ?? null;
  const writing = changes.writing === true || review?.lifecycle === 'writing';
  const preview = restorePreview?.reviewScopeId === review?.reviewScopeId ? restorePreview : null;
  const showOpenNotice = operation?.operation === 'open' && operation.ok && operation.sequence === openNoticeSequence && operation.reviewScopeId === review?.reviewScopeId;
  const selected = pendingScope?.kind ?? (ownsLatest ? 'turn' : review?.scopeKind === 'workspace' || review?.scopeKind === 'branch' ? review.scopeKind : 'none');
  const agentRunning = agent?.reviewScopeId === review?.reviewScopeId && (agent?.status === 'starting' || agent?.status === 'running');
  const locked = writing || current === null || current.status === 'open-only' || current.status === 'reviewed';
  return <section aria-label="Review changes" className="overflow-hidden rounded-xl border border-[var(--panel-edge)] bg-input-background">
    <Tool open={expanded} onOpenChange={setExpanded}>
      <div className="flex min-h-[34px] min-w-0 items-center gap-2 py-[3px] pr-2 pl-2.5">
        <CollapsibleTrigger asChild><Button variant="plain" size="none" className="v2-chat-disclosure flex h-6 min-w-0 flex-1 items-center gap-[7px] text-left">
          <ChevronDown className={`size-[13px] shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
          <span className="truncate text-[11.5px] font-semibold">{changes.files.length} {changes.files.length === 1 ? 'file' : 'files'} changed</span>
          <span className="truncate text-[10.5px] text-muted-foreground">{showOpenNotice ? operation.message : writing ? 'Writing changes' : review?.lifecycle === 'complete' ? 'Review complete' : 'Ready to review'}</span>
          {writing ? <span className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"><span className="size-1 rounded-full bg-primary" />writing</span> : null}
        </Button></CollapsibleTrigger>
        <Button size="sm" className="h-6 rounded-[7px] px-3 text-[11px]" disabled={pendingScope !== null} onClick={() => { setExpanded(true); openScope('turn', changes.turnId, true); }}>{writing ? 'View live' : 'Review'}</Button>
      </div>
      <ToolContent className="max-h-[45vh] space-y-2 overflow-auto border-t border-[var(--panel-edge)] px-2.5 pt-[7px] pb-2 text-[11px]">
        <ToggleGroup type="single" value={selected} onValueChange={(value) => {
          if (value) { const kind = value as 'turn' | 'workspace' | 'branch'; openScope(kind, kind === 'turn' ? changes.turnId : undefined); }
        }} className="grid grid-cols-3 gap-0.5" aria-label="Review scope">
          {(['turn', 'workspace', 'branch'] as const).map((kind) => <ToggleGroupItem key={kind} value={kind}
            className={`h-6 min-w-0 px-1 text-[10.5px] ${selected === kind ? 'bg-[var(--control-surface-active)] text-foreground' : 'text-muted-foreground'}`}
            disabled={pendingScope !== null}>
            {kind === 'turn' ? 'Latest Turn' : kind === 'workspace' ? 'Workspace' : 'Branch'}
          </ToggleGroupItem>)}
        </ToggleGroup>
        {review === null ? <p>Choose Review to open the latest Turn.</p>
          : review.lifecycle === 'unavailable' || review.lifecycle === 'stale' ? <p role="status">{review.message ?? 'This review scope is unavailable.'}</p>
          : <>
            <div className="flex items-start justify-between gap-3 border-y border-[var(--panel-edge)] py-2">
              <div className="min-w-0"><span className="text-[10px] text-muted-foreground">{review.baselineLabel}</span><p className="truncate" title={current?.path}>{current?.path ?? 'No comparable files'}</p></div>
              <div className="shrink-0 text-right"><span className="text-[10px] text-muted-foreground">{newerChanges ? 'Newer changes available' : `${review.scopeKind === 'branch' && review.branchCommitCount !== undefined ? `${review.branchCommitCount} ${review.branchCommitCount === 1 ? 'commit' : 'commits'} · ` : ''}${review.reviewedCount} / ${review.reviewableCount} reviewed`}</span>
            {review.files.length > 1 ? <div className="flex justify-end gap-1">
              <Button variant="ghost" size="sm" disabled={review.currentIndex === null || review.currentIndex === 0} onClick={() => props.onNavigate('previous')}>Previous</Button>
              <Button variant="ghost" size="sm" disabled={review.currentIndex === null || review.currentIndex >= review.files.length - 1} onClick={() => props.onNavigate('next')}>Next</Button>
            </div> : null}</div></div>
            <ul className="max-h-48 space-y-1 overflow-auto">
              {review.files.map((file, index) => <li key={file.path}>
                <Button variant="plain" size="none" aria-label={`Open diff for ${file.path}`} onClick={() => props.onSelectFile(file.path)}
                  className={cn('flex w-full min-w-0 items-center gap-2 rounded px-1 py-1 text-left outline-none hover:bg-[var(--control-surface-hover)] focus-visible:ring-1 focus-visible:ring-ring', index === review.currentIndex && 'bg-[var(--control-surface-active)]')}>
                  <span role="img" aria-label={file.status} title={file.status} className={`size-1.5 shrink-0 rounded-full ${file.status === 'reviewed' ? 'bg-muted-foreground' : file.status === 'open-only' ? 'border border-muted-foreground' : 'bg-primary'}`} />
                  <span className="min-w-0 flex-1 truncate" title={file.path}>{file.path}</span>
                  <span className="flex shrink-0 gap-1.5 text-[11px]"><span className="text-[var(--vscode-gitDecoration-addedResourceForeground,#3f9d5f)]">{file.additions === null ? '' : `+${file.additions}`}</span><span className="text-destructive">{file.deletions === null ? '' : `−${file.deletions}`}</span></span>
                </Button>
              </li>)}
            </ul>
            <div className="flex flex-wrap items-center gap-1 border-t border-[var(--panel-edge)] pt-2 [&>button]:h-6 [&>button]:px-2 [&>button]:text-[10.5px]">
              <Button variant="outline" size="sm" disabled={locked} onClick={() => props.onMarkReviewed(false)}>Mark reviewed</Button>
              <Button variant="outline" size="sm" disabled={locked} onClick={() => props.onMarkReviewed(true)}>Mark &amp; Next</Button>
              <Popover open={moreOpen} onOpenChange={setMoreOpen}>
                <PopoverTrigger asChild><Button variant="ghost" size="sm" className="ml-auto">More</Button></PopoverTrigger>
                <PopoverContent align="end" className="w-80 space-y-1">
                  {!writing && ownsLatest ? <ChangesCommitEntry key={changes.turnId} turnId={changes.turnId} /> : null}
                  {!writing && review.scopeKind === 'operations' && current?.restorable ? <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setMoreOpen(false); props.onPreviewRestore('file'); }}>Undo file operations</Button> : null}
                  {!writing && review.scopeKind === 'operations' && review.files.length > 0 && review.files.every((file) => file.restorable) ? <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => { setMoreOpen(false); props.onPreviewRestore('turn'); }}>Undo turn operations</Button> : null}
                  {review.scopeKind === 'workspace' || review.scopeKind === 'branch' ? <Button variant="ghost" size="sm" disabled={writing || agentRunning} onClick={() => { setMoreOpen(false); props.onRunAgentReview(); }}>{agentRunning ? 'Agent Review running' : 'Agent Review'}</Button> : null}
                </PopoverContent>
              </Popover>
            </div>
            {agentRunning ? <p role="status">{agent?.message ?? 'Agent Review running'}</p> : null}
            {preview !== null ? <div role="status" className="space-y-2 border-t border-[var(--panel-edge)] pt-2">
              <p>{preview.conflicted.length > 0 ? `${preview.conflicted.length} conflict(s), restore is blocked.` : `${preview.restorable.length} file(s) can be restored.`}</p>
              <Button variant="outline" size="sm" disabled={preview.conflicted.length > 0} onClick={() => props.onConfirmRestore(preview.target, preview.previewId)}>Confirm restore</Button>
            </div> : null}
            {operation?.reviewScopeId === review.reviewScopeId && (operation.operation !== 'open' || !operation.ok) ? <p role="status" className={!operation.ok ? 'text-destructive' : undefined}>{operation.message}</p> : null}
          </>}
      </ToolContent>
    </Tool>
  </section>;
}

export function ReviewDockSlot({ changes, currentTurnId, sessionId, vscode, ...state }: {
  readonly changes: ChangesTranscriptItem | null;
  readonly currentTurnId: string | null;
  readonly sessionId: string | null;
  readonly vscode: ChatPort;
} & Pick<ComponentProps<typeof ReviewDock>, 'review' | 'restorePreview' | 'operation' | 'agent'>) {
  if (changes === null || changes.files.length === 0 ||
    (currentTurnId !== null && currentTurnId !== changes.turnId)) return null;
  const count = changes.files.length;
  const matchingReview = state.review?.sessionId === sessionId && state.review.scopeKind === 'turn' &&
    state.review.turnId === changes.turnId;
  const status = changes.writing ? 'Updating…' : matchingReview && state.review?.lifecycle === 'complete' ? 'Review complete' : null;
  return <Button variant="plain" size="none" className="review-launcher" aria-label="Open Review" disabled={sessionId === null} onClick={() => vscode.postMessage({
    type: 'review.panel.open', sessionId: sessionId!, scopeKind: 'turn', turnId: changes.turnId,
  })}>
    <FileDiff className="review-launcher-icon" aria-hidden="true" />
    <span className="review-launcher-summary">
      <strong>Review workspace changes</strong>
      <span role={status ? 'status' : undefined} title={`${count} ${count === 1 ? 'file' : 'files'} ${count === MAX_CHANGED_FILES_PER_TURN ? 'shown' : 'changed'}${status ? ` · ${status}` : ''}`}>{count} {count === 1 ? 'file' : 'files'} {count === MAX_CHANGED_FILES_PER_TURN ? 'shown' : 'changed'}{status ? ` · ${status}` : ''}</span>
    </span>
    <ChevronRight className="review-launcher-chevron" aria-hidden="true" />
  </Button>;
}
