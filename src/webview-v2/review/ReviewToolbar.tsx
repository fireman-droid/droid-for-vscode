import { useRef } from 'react';
import { ArrowDown, ArrowUp, Check, ChevronDown, GitCompare, MoreHorizontal, PanelRight, RefreshCw, Search } from 'lucide-react';
import { REVIEW_SCOPE_KINDS, type ReviewScopeKind } from '../../shared/protocol/reviewProtocol';
import { Button } from '../ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../ui/selection';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuItemIndicator, DropdownMenuSeparator } from '../ui/dropdown-menu';
import { ReviewIconButton } from './ReviewIconButton';
import type { ReviewWorkbench } from './ReviewFileSection';
const labels: Record<ReviewScopeKind, string> = {
  operations: 'Recorded Edits', turn: 'Agent Turn', workspace: 'Uncommitted', branch: 'Branch Comparison', unstaged: 'Unstaged', staged: 'Staged',
};
export function ReviewToolbar({ flow, split, onSplit, showFiles, onFiles, onFind, onCollapse, allCollapsed, onHunk, onCommit }: {
  flow: ReviewWorkbench; split: boolean; onSplit(value: boolean): void; showFiles: boolean; onFiles(): void;
  onFind(): void; onCollapse(): void; allCollapsed: boolean; onHunk(direction: number): void; onCommit(): void;
}) {
  const { review, target, scopePending } = flow;
  const findOnClose = useRef(false);
  const valid = target?.valid === true;
  const files = review?.files ?? [];
  const counts = files.length > 0 && files.every(file => file.additions !== null && file.deletions !== null);
  const agentRunning = flow.agent?.status === 'running' || flow.agent?.status === 'starting';
  return <header className="review-topbar">
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="review-scope-button" disabled={!valid || scopePending} title={review?.baselineLabel}>
      <GitCompare aria-hidden /><span>{target?.operation ? 'This Operation' : review ? labels[review.scopeKind] : 'Review Changes'}</span>
      {counts && !target?.operation ? <span className="review-range-counts"><i>+{files.reduce((total, file) => total + (file.additions ?? 0), 0)}</i><b>−{files.reduce((total, file) => total + (file.deletions ?? 0), 0)}</b></span> : null}<ChevronDown aria-hidden />
    </Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="review-menu review-scope-menu">
        <DropdownMenuRadioGroup value={target?.operation ? 'operation' : review?.scopeKind ?? ''} onValueChange={kind => flow.openScope(kind as ReviewScopeKind)}>
          {REVIEW_SCOPE_KINDS.map(kind => <DropdownMenuRadioItem key={kind} value={kind}
            disabled={(kind === 'turn' || kind === 'operations') && !target?.latestTurnId && !review?.turnId}>
            {labels[kind]}<DropdownMenuItemIndicator className="review-menu-check"><Check /></DropdownMenuItemIndicator>
          </DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    {flow.choosingBranch || review?.scopeKind === 'branch' ? <Select disabled={scopePending || !flow.branches?.refs.length}
      value={review?.scopeKind === 'branch' ? review.baseBranch ?? flow.branches?.defaultBranch : undefined}
      onValueChange={value => flow.openScope('branch', value)}>
      <SelectTrigger aria-label="Base branch" className="review-scope-trigger h-7 text-xs"><SelectValue placeholder="Choose base branch" /></SelectTrigger>
      <SelectContent className="review-menu" align="start">{flow.branches?.refs.map(ref => <SelectItem key={ref} value={ref}>{ref.replace(/^refs\/(heads|remotes)\//, '')}</SelectItem>)}</SelectContent>
    </Select> : null}
    <span className="review-top-spacer" />
    <DropdownMenu><DropdownMenuTrigger asChild><ReviewIconButton variant="ghost" size="icon-sm" aria-label="Review options"><MoreHorizontal /></ReviewIconButton></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="review-menu review-options-menu" onCloseAutoFocus={event => {
        if (!findOnClose.current) return;
        findOnClose.current = false;
        event.preventDefault();
        onFind();
      }}>
        <p className="review-menu-label">Layout</p>
        <DropdownMenuRadioGroup value={split ? 'split' : 'unified'} onValueChange={value => onSplit(value === 'split')}>
          {['unified', 'split'].map(value => <DropdownMenuRadioItem key={value} value={value}>{value === 'split' ? 'Split' : 'Unified'}<DropdownMenuItemIndicator className="review-menu-check"><Check /></DropdownMenuItemIndicator></DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { findOnClose.current = true; }}><Search />Find file…</DropdownMenuItem>
        <DropdownMenuItem onSelect={onCollapse}>{allCollapsed ? 'Expand all files' : 'Collapse all files'}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onHunk(-1)}><ArrowUp />Previous change</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onHunk(1)}><ArrowDown />Next change</DropdownMenuItem>
        <DropdownMenuItem disabled={!valid || scopePending} onSelect={flow.refresh}><RefreshCw />Refresh changes</DropdownMenuItem>
        {!target?.operation && review?.scopeKind !== 'operations' && !review?.recordedOnly ? <>
          <DropdownMenuSeparator /><p className="review-menu-label">Context</p>
          <DropdownMenuRadioGroup value={String(flow.context)} onValueChange={value => flow.setContext(value === 'all' ? 'all' : Number(value) as 3 | 20 | 100)}>
            {[3, 20, 100, 'all'].map(value => <DropdownMenuRadioItem key={value} value={String(value)}>{value === 'all' ? 'Full file' : `${value} lines`}<DropdownMenuItemIndicator className="review-menu-check"><Check /></DropdownMenuItemIndicator></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </> : null}
        {review?.scopeKind === 'workspace' || review?.scopeKind === 'branch' || agentRunning ? <>
          <DropdownMenuSeparator /><DropdownMenuItem disabled={!valid || !!target?.operation || review?.lifecycle === 'writing' || agentRunning}
            onSelect={flow.actions.onRunAgentReview}>{agentRunning ? 'Agent review running…' : 'Run Agent Review…'}</DropdownMenuItem>
        </> : null}
      </DropdownMenuContent>
    </DropdownMenu>
    <Button variant="outline" size="sm" className="review-commit-button" disabled={!valid || scopePending || review?.lifecycle === 'writing'} onClick={onCommit}>Commit…</Button>
    <ReviewIconButton variant="ghost" size="icon-sm" className="review-files-toggle" aria-label={showFiles ? 'Collapse files' : 'Show files'} aria-pressed={showFiles} onClick={onFiles}><PanelRight /></ReviewIconButton>
  </header>;
}
