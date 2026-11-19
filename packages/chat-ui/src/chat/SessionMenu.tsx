import { useI18n } from '../i18n';
import { useUiEnvironment } from '../environment';
import { groupSessions } from './sessionGroups';
import type { SessionMenuState, SessionActions, SessionSummary } from './sessions';
import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Archive, CheckCircle, ChevronRight, GitBranch, History, LoaderCircle, Pencil, Search, Star } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlays';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';
import { ScrollArea } from '../ui/scroll-area';

export function SessionMenu({ state, actions, disabled, open, openSignal, onOpenChange, maxSearchLength, maxTitleLength, trigger, align = 'end' }: {
  readonly maxSearchLength?: number;
  readonly maxTitleLength?: number;
  readonly trigger?: ReactNode;
  readonly align?: ComponentProps<typeof PopoverContent>['align'];
  readonly state: SessionMenuState;
  readonly actions: SessionActions;
  readonly disabled: boolean;
  readonly open: boolean;
  readonly openSignal?: number;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { t } = useI18n();
  const { assistantName } = useUiEnvironment();
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) searchInput.current?.focus({ preventScroll: true });
  }, [open, openSignal]);
  const [archived, setArchived] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  useEffect(() => {
    pendingRef.current = false;
    setPending(false);
  }, [state.sessions, state.archived]);
  const normalized = search.trim().toLocaleLowerCase();
  const groups = useMemo(() => groupSessions(state.sessions.items.filter((item) =>
    item.title.toLocaleLowerCase().includes(normalized) || item.id.toLocaleLowerCase().includes(normalized))), [normalized, state.sessions.items]);
  const catalogIds = useMemo(() => new Set(state.sessions.items.map((item) => item.id)), [state.sessions.items]);
  const archivedEntries = state.archived.items;
  const controlsDisabled = disabled || pending || state.sessions.status === 'loading';
  const runOnce = (action: () => void) => {
    if (controlsDisabled || pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    action();
  };
  const select = (id: string) => runOnce(() => { actions.handleSelectSession(id); onOpenChange(false); });
  const searchContent = () => {
    const query = search.trim();
    if (query && !disabled) actions.handleSearchContent?.(query);
  };
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger ?? <Button variant="ghost" size="icon-sm" className="data-[state=open]:bg-[var(--control-surface-active)] data-[state=open]:text-foreground" aria-label={t("Sessions")}><History className="size-3.5" /></Button>}</PopoverTrigger>
      <PopoverContent align={align} sideOffset={4} aria-label={t("Session history")} className="flex w-[240px] max-w-[calc(100vw-16px)] flex-col overflow-hidden border-[var(--panel-edge)] p-0">
        <div className="grid h-7 min-w-0 shrink-0 grid-cols-[14px_minmax(0,1fr)] items-center gap-1.5 border-b border-[var(--panel-edge)] px-2 text-muted-foreground">
          <Search aria-hidden="true" className="pointer-events-none size-3 justify-self-center" />
          <Input ref={searchInput} className="h-7 min-w-0 appearance-none rounded-none border-0 bg-transparent p-0 text-[11.5px] text-foreground shadow-none outline-none placeholder:text-[11px] focus-visible:border-transparent focus-visible:ring-0" type="search" aria-label={t("Search sessions")} placeholder={actions.handleSearchContent ? t("Search chats · Enter searches content") : t("Search chats")}
            maxLength={maxSearchLength} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); searchContent(); }
          }} />
        </div>
        {state.sessions.message ? <p data-ui-notice="" role={state.sessions.status === 'error' ? 'alert' : 'status'} className="select-none border-b border-[var(--panel-edge)] px-2.5 py-1 text-[11px] text-muted-foreground">{state.sessions.message}</p> : null}
        {pending || state.sessions.status === 'loading' ? <p data-ui-notice="" role="status" className="select-none border-b border-[var(--panel-edge)] px-2.5 py-1 text-[11px] text-muted-foreground">{pending ? t("Waiting for {p0}…", { p0: assistantName }) : t("Loading sessions…")}</p> : null}
        <ScrollArea className="dvx-session-scroll" viewportClassName="dvx-session-viewport"
          nonce={typeof document !== 'undefined' ? document.querySelector<HTMLScriptElement>('script[nonce]')?.nonce : undefined}>
          <div className="space-y-0.5 p-1">
            {groups.map((group) => <section key={group.key} aria-label={group.label ? t(group.label) : undefined}>
              <h3 className="px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">{group.label ? t(group.label) : null}</h3>
              {group.items.map((entry) => <SessionRow key={entry.id} entry={entry} maxTitleLength={maxTitleLength} disabled={controlsDisabled} actions={actions} runOnce={runOnce} onSelect={() => select(entry.id)} />)}
            </section>)}
            {groups.length === 0 && state.sessions.status !== 'loading' ? <p data-ui-notice="" className="px-1.5 py-1.5 text-[11.5px] text-muted-foreground">{search.trim() ? t("No sessions match your search.") : state.sessions.status === 'ready' ? t("No {p0} sessions found.", { p0: assistantName }) : t("Session history has not loaded yet.")}</p> : null}
          {state.sessionSearch === null ? null : <section aria-label={t("Content matches")} className="space-y-1 border-t border-[var(--panel-edge)] pt-1.5 text-[11.5px]">
            <h3 className="px-1.5 font-medium">{t("Content matches · “")}{state.sessionSearch.query}”</h3>
            {state.sessionSearch.status === 'error' ? <p role="alert" className="px-1.5 text-destructive">{state.sessionSearch.message}</p> : state.sessionSearch.items.length === 0 ? <p data-ui-notice="" className="px-1.5 text-muted-foreground">{t("No content matches.")}</p> : state.sessionSearch.items.map((hit) => {
              const body = <><span>{hit.title}</span>{hit.snippet === null ? null : <span className="line-clamp-3 text-[11px] text-muted-foreground">{hit.snippet}</span>}</>;
              return catalogIds.has(hit.id) ? <Button key={hit.id} variant="ghost" className="h-auto w-full flex-col items-start gap-0.5 whitespace-normal px-1.5 py-1.5 text-left text-[11.5px]" disabled={controlsDisabled} onClick={() => select(hit.id)}>{body}</Button>
                : <div key={hit.id} title={t("This session belongs to another workspace")} className="space-y-0.5 px-1.5 py-1.5">{body}<p data-ui-notice="" className="text-[11px] text-muted-foreground">{t("Other workspace")}</p></div>;
            })}
          </section>}
          {state.worktreeCreateAvailable && actions.handleCreateWorktreeSession ? <Button variant="ghost" size="sm" className="h-6 w-full justify-start px-1.5 text-[11.5px] font-normal text-muted-foreground" disabled={controlsDisabled} onClick={() => runOnce(() => { actions.handleCreateWorktreeSession?.(); onOpenChange(false); })}>{t("New session in a worktree…")}</Button> : null}
          {actions.handleRefreshArchived ? <Collapsible open={archived} onOpenChange={(open) => {
            setArchived(open);
            if (open && state.archived.status === 'idle') actions.handleRefreshArchived?.();
          }} asChild><section aria-label={t("Archived sessions")} className="mt-0.5 border-t border-[var(--panel-edge)] pt-1">
            <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="h-6 w-full justify-start gap-1 px-1.5 text-[11.5px] font-normal text-muted-foreground"><ChevronRight className={`size-3 transition-transform motion-reduce:transition-none ${archived ? 'rotate-90' : ''}`} />{t("Archived")}{state.archived.status === 'ready' && archivedEntries.length ? ` (${archivedEntries.length})` : ''}</Button></CollapsibleTrigger>
            <CollapsibleContent>
              {state.archived.status === 'error' ? <p data-ui-notice="" role="alert" className="select-none px-1.5 py-1 text-[11px] text-destructive">{state.archived.message}</p> : null}
              {state.archived.status === 'loading' || state.archived.status === 'idle' ? <p data-ui-notice="" role="status" className="select-none px-1.5 py-1 text-[11px] text-muted-foreground">{t("Loading archived sessions…")}</p> : null}
              {archivedEntries.map((entry) => <div key={entry.id} className="group flex min-h-6 items-center gap-1.5 px-1.5 text-[11.5px]">
                <span className="min-w-0 flex-1 truncate" title={entry.archivedTime}>{entry.title}</span>
                {actions.handleUnarchiveSession ? <Button variant="ghost" size="sm" className="h-5 px-1.5 text-[10.5px]" aria-label={t("Restore {p0}", { p0: entry.title })} disabled={controlsDisabled || state.archived.status === 'loading'} onClick={() => runOnce(() => actions.handleUnarchiveSession?.(entry.id))}>{t("Restore")}</Button> : null}
              </div>)}
              {state.archived.status === 'ready' && archivedEntries.length === 0 ? <p data-ui-notice="" className="px-1.5 py-1 text-[11px] text-muted-foreground">{t("No archived sessions.")}</p> : null}
            </CollapsibleContent>
          </section></Collapsible> : null}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function SessionRow({ entry, maxTitleLength, disabled, actions, runOnce, onSelect }: {
  readonly maxTitleLength?: number;
  readonly entry: SessionSummary;
  readonly disabled: boolean;
  readonly actions: SessionActions;
  readonly runOnce: (action: () => void) => void;
  readonly onSelect: () => void;
}) {
  const { t } = useI18n();
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(entry.title);
  useEffect(() => { setRenaming(false); setTitle(entry.title); }, [entry.title]);
  const submitRename = () => {
    setRenaming(false);
    if (title.trim() && title.trim() !== entry.title) actions.handleRenameSession?.(entry.id, title.trim());
    else setTitle(entry.title);
  };
  return <div className="v2-session-row group relative flex min-h-6 min-w-0 items-center rounded-[5px] [&_svg]:size-3" data-current={entry.active || undefined}>
    {renaming ? <form className="flex w-full gap-1 p-0.5" onSubmit={(event) => {
      event.preventDefault();
      submitRename();
    }}>
      <Input aria-label={t("Session title")} autoFocus maxLength={maxTitleLength} value={title} onBlur={submitRename} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenaming(false); setTitle(entry.title); }
        if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
      }} />
    </form> : <>
      <Button variant="plain" size="none" className={`flex h-6 min-w-0 flex-1 items-center justify-start gap-1.5 rounded-[5px] pl-1.5 ${entry.isFavorite ? 'pr-6' : 'pr-1.5'} text-left text-[11.5px] ${entry.active ? 'font-medium text-foreground disabled:opacity-100' : 'text-foreground/90'}`} aria-current={entry.active ? 'true' : undefined} title={entry.modifiedTime} disabled={disabled || entry.active} onClick={onSelect}>
        {entry.running ? <><LoaderCircle className="size-3 shrink-0 motion-safe:animate-spin text-muted-foreground" /><span className="sr-only">{t("Turn still running.")} </span></> : <CheckCircle className={`size-3 shrink-0 ${entry.active ? 'text-foreground/80' : 'text-muted-foreground'}`} />}
        <span className="truncate">{entry.title}</span>
        {entry.worktree ? <span title={entry.worktree.path} className="truncate text-[10.5px] font-normal text-muted-foreground">{t("worktree")}{entry.worktree.branch ? ` · ${entry.worktree.branch}` : ''}</span> : null}
        {entry.badge ? <span className="font-normal text-[10.5px] text-muted-foreground">{entry.badge}</span> : null}
      </Button>
      <div className="v2-session-row-actions pointer-events-none absolute inset-y-0 right-0 flex items-center gap-0.5 rounded-r-[5px] pr-0.5 [&>button]:pointer-events-none [&>button]:size-5 [&>button]:text-muted-foreground [&>button]:opacity-0 group-hover:pointer-events-auto group-hover:[&>button]:pointer-events-auto group-hover:[&>button]:opacity-100 group-focus-within:pointer-events-auto group-focus-within:[&>button]:pointer-events-auto group-focus-within:[&>button]:opacity-100 [&>button[aria-pressed=true]]:pointer-events-auto [&>button[aria-pressed=true]]:opacity-100">
      {entry.active ? <>
        {actions.handleRenameSession ? <Button variant="ghost" size="icon-sm" aria-label={t("Rename {p0}", { p0: entry.title })} title={t("Rename")} disabled={disabled} onClick={() => { setTitle(entry.title); setRenaming(true); }}><Pencil /></Button> : null}
        {actions.handleForkSession ? <Button variant="ghost" size="icon-sm" aria-label={t("Fork {p0}", { p0: entry.title })} title={t("Fork chat")} disabled={disabled} onClick={() => runOnce(() => actions.handleForkSession?.(entry.id))}><GitBranch /></Button> : null}
      </> : actions.handleArchiveSession ? <Button variant="ghost" size="icon-sm" aria-label={t("Archive {p0}", { p0: entry.title })} title={t("Archive")} disabled={disabled} onClick={() => runOnce(() => actions.handleArchiveSession?.(entry.id))}><Archive /></Button> : null}
      {actions.handleToggleFavorite ? <Button variant="ghost" size="icon-sm" aria-label={t("Favorite {p0}", { p0: entry.title })} title={entry.isFavorite ? t("Unfavorite") : t("Favorite")} aria-pressed={entry.isFavorite} disabled={disabled} onClick={() => runOnce(() => actions.handleToggleFavorite?.(entry.id, !entry.isFavorite))}><Star className={entry.isFavorite ? 'fill-current' : undefined} /></Button> : null}
      </div>
    </>}
  </div>;
}
