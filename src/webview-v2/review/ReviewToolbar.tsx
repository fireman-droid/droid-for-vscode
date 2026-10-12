import { useI18n } from '@droidvisx/chat-ui/i18n';
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
  const { t } = useI18n();
  const { review, target, scopePending } = flow;
  const findOnClose = useRef(false);
  const valid = target?.valid === true;
  const files = review?.files ?? [];
  const counts = files.length > 0 && files.every(file => file.additions !== null && file.deletions !== null);
  const agentRunning = flow.agent?.status === 'running' || flow.agent?.status === 'starting';
  return <header className="review-topbar">
    <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm" className="review-scope-button" disabled={!valid || scopePending} title={review?.baselineLabel}>
      <GitCompare aria-hidden /><span>{target?.operation ? t("This Operation") : review ? labels[review.scopeKind] : t("Review Changes")}</span>
      {counts && !target?.operation ? <span className="review-range-counts"><i>+{files.reduce((total, file) => total + (file.additions ?? 0), 0)}</i><b>−{files.reduce((total, file) => total + (file.deletions ?? 0), 0)}</b></span> : null}<ChevronDown aria-hidden />
    </Button></DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="review-menu review-scope-menu">
        <DropdownMenuRadioGroup value={target?.operation ? 'operation' : review?.scopeKind ?? ''} onValueChange={kind => flow.openScope(kind as ReviewScopeKind)}>
          {REVIEW_SCOPE_KINDS.map(kind => <DropdownMenuRadioItem key={kind} value={kind}
            disabled={(kind === 'turn' || kind === 'operations') && !target?.latestTurnId && !review?.turnId}>
            {t(labels[kind])}<DropdownMenuItemIndicator className="review-menu-check"><Check /></DropdownMenuItemIndicator>
          </DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
    {flow.choosingBranch || review?.scopeKind === 'branch' ? <Select disabled={scopePending || !flow.branches?.refs.length}
      value={review?.scopeKind === 'branch' ? review.baseBranch ?? flow.branches?.defaultBranch : undefined}
      onValueChange={value => flow.openScope('branch', value)}>
      <SelectTrigger aria-label={t("Base branch")} className="review-scope-trigger h-7 text-xs"><SelectValue placeholder={t("Choose base branch")} /></SelectTrigger>
      <SelectContent className="review-menu" align="start">{flow.branches?.refs.map(ref => <SelectItem key={ref} value={ref}>{ref.replace(/^refs\/(heads|remotes)\//, '')}</SelectItem>)}</SelectContent>
    </Select> : null}
    <span className="review-top-spacer" />
    <DropdownMenu><DropdownMenuTrigger asChild><ReviewIconButton variant="ghost" size="icon-sm" aria-label={t("Review options")}><MoreHorizontal /></ReviewIconButton></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="review-menu review-options-menu" onCloseAutoFocus={event => {
        if (!findOnClose.current) return;
        findOnClose.current = false;
        event.preventDefault();
        onFind();
      }}>
        <p className="review-menu-label">{t("Layout")}</p>
        <DropdownMenuRadioGroup value={split ? 'split' : 'unified'} onValueChange={value => onSplit(value === 'split')}>
          {['unified', 'split'].map(value => <DropdownMenuRadioItem key={value} value={value}>{value === 'split' ? t("Split") : t("Unified")}<DropdownMenuItemIndicator className="review-menu-check"><Check /></DropdownMenuItemIndicator></DropdownMenuRadioItem>)}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => { findOnClose.current = true; }}><Search />{t("Find file…")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={onCollapse}>{allCollapsed ? t("Expand all files") : t("Collapse all files")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onHunk(-1)}><ArrowUp />{t("Previous change")}</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onHunk(1)}><ArrowDown />{t("Next change")}</DropdownMenuItem>
        <DropdownMenuItem disabled={!valid || scopePending} onSelect={flow.refresh}><RefreshCw />{t("Refresh changes")}</DropdownMenuItem>
        {!target?.operation && review?.scopeKind !== 'operations' && !review?.recordedOnly ? <>
          <DropdownMenuSeparator /><p className="review-menu-label">{t("Context")}</p>
          <DropdownMenuRadioGroup value={String(flow.context)} onValueChange={value => flow.setContext(value === 'all' ? 'all' : Number(value) as 3 | 20 | 100)}>
            {[3, 20, 100, 'all'].map(value => <DropdownMenuRadioItem key={value} value={String(value)}>{value === 'all' ? t("Full file") : t("{p0} lines", { p0: value })}<DropdownMenuItemIndicator className="review-menu-check"><Check /></DropdownMenuItemIndicator></DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </> : null}
        {review?.scopeKind === 'workspace' || review?.scopeKind === 'branch' || agentRunning ? <>
          <DropdownMenuSeparator /><DropdownMenuItem disabled={!valid || !!target?.operation || review?.lifecycle === 'writing' || agentRunning}
            onSelect={flow.actions.onRunAgentReview}>{agentRunning ? t("Agent review running…") : t("Run Agent Review…")}</DropdownMenuItem>
        </> : null}
      </DropdownMenuContent>
    </DropdownMenu>
    <Button variant="outline" size="sm" className="review-commit-button" disabled={!valid || scopePending || review?.lifecycle === 'writing'} onClick={onCommit}>{t("Commit…")}</Button>
    <ReviewIconButton variant="ghost" size="icon-sm" className="review-files-toggle" aria-label={showFiles ? t("Collapse files") : t("Show files")} aria-pressed={showFiles} onClick={onFiles}><PanelRight /></ReviewIconButton>
  </header>;
}
