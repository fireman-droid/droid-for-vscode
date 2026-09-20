import { useUiEnvironment } from '../environment';
import { groupSessions } from './sessionGroups';
import type { SessionMenuState, SessionActions, SessionSummary } from './sessions';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, CheckCircle, ChevronRight, GitBranch, History, LoaderCircle, Pencil, Star } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/overlays';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '../ui/collapsible';

export function SessionMenu({ state, actions, disabled, open, openSignal, onOpenChange, maxSearchLength, maxTitleLength }: {
  readonly maxSearchLength?: number;
  readonly maxTitleLength?: number;
  readonly state: SessionMenuState;
  readonly actions: SessionActions;
  readonly disabled: boolean;
  readonly open: boolean;
  readonly openSignal?: number;
  readonly onOpenChange: (open: boolean) => void;
}) {
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
      <PopoverTrigger asChild><Button variant="outline" size="icon" className="size-7 rounded-full bg-input-background text-muted-foreground" aria-label="Sessions"><History className="size-4" /></Button></PopoverTrigger>
      <PopoverContent align="end" aria-label="Session history" className="w-72 space-y-2 p-1.5">
        <div className="flex items-center gap-1">
          <Input ref={searchInput} type="search" aria-label="Search sessions" placeholder={actions.handleSearchContent ? 'Search chats · Enter searches content' : 'Search chats'}
            maxLength={maxSearchLength} value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); searchContent(); }
          }} />
        </div>
        {state.sessions.message ? <p role={state.sessions.status === 'error' ? 'alert' : 'status'} className="text-xs text-muted-foreground">{state.sessions.message}</p> : null}
        {pending || state.sessions.status === 'loading' ? <p role="status" className="text-xs text-muted-foreground">{pending ? `Waiting for ${assistantName}…` : 'Loading sessions…'}</p> : null}
        <div className="max-h-80 space-y-3 overflow-y-auto">
            {groups.map((group) => <section key={group.key} aria-label={group.label ?? undefined}>
              <h3 className="px-1 py-1 text-[11px] text-muted-foreground">{group.label}</h3>
              {group.items.map((entry) => <SessionRow key={entry.id} entry={entry} maxTitleLength={maxTitleLength} disabled={controlsDisabled} actions={actions} runOnce={runOnce} onSelect={() => select(entry.id)} />)}
            </section>)}
            {groups.length === 0 && state.sessions.status !== 'loading' ? <p className="p-2 text-xs text-muted-foreground">{search.trim() ? 'No sessions match your search.' : state.sessions.status === 'ready' ? `No ${assistantName} sessions found.` : 'Session history has not loaded yet.'}</p> : null}
          {state.sessionSearch === null ? null : <section aria-label="Content matches" className="space-y-2 border-t border-border pt-2 text-xs">
            <h3 className="font-medium">Content matches · “{state.sessionSearch.query}”</h3>
            {state.sessionSearch.status === 'error' ? <p role="alert" className="text-destructive">{state.sessionSearch.message}</p> : state.sessionSearch.items.length === 0 ? <p className="text-muted-foreground">No content matches.</p> : state.sessionSearch.items.map((hit) => {
              const body = <><span>{hit.title}</span>{hit.snippet === null ? null : <span className="line-clamp-3 text-xs text-muted-foreground">{hit.snippet}</span>}</>;
              return catalogIds.has(hit.id) ? <Button key={hit.id} variant="ghost" className="h-auto w-full flex-col items-start gap-1 whitespace-normal py-2 text-left" disabled={controlsDisabled} onClick={() => select(hit.id)}>{body}</Button>
                : <div key={hit.id} title="This session belongs to another workspace" className="space-y-1 px-2 py-2">{body}<p className="text-muted-foreground">Other workspace</p></div>;
            })}
          </section>}
          {state.worktreeCreateAvailable && actions.handleCreateWorktreeSession ? <Button variant="ghost" size="sm" className="w-full justify-start text-[11px] text-muted-foreground" disabled={controlsDisabled} onClick={() => runOnce(() => { actions.handleCreateWorktreeSession?.(); onOpenChange(false); })}>New session in a worktree…</Button> : null}
          {actions.handleRefreshArchived ? <Collapsible open={archived} onOpenChange={(open) => {
            setArchived(open);
            if (open && state.archived.status === 'idle') actions.handleRefreshArchived?.();
          }} asChild><section aria-label="Archived sessions" className="border-t border-border pt-1">
            <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="h-7 w-full justify-start px-1 text-[11px] text-muted-foreground"><ChevronRight className={`size-3 transition-transform ${archived ? 'rotate-90' : ''}`} />Archived{state.archived.status === 'ready' && archivedEntries.length ? ` (${archivedEntries.length})` : ''}</Button></CollapsibleTrigger>
            <CollapsibleContent>
              {state.archived.status === 'error' ? <p role="alert" className="text-xs text-destructive">{state.archived.message}</p> : null}
              {state.archived.status === 'loading' || state.archived.status === 'idle' ? <p role="status" className="text-xs text-muted-foreground">Loading archived sessions…</p> : null}
              {archivedEntries.map((entry) => <div key={entry.id} className="group flex items-center gap-2 px-1 text-xs">
                <span className="min-w-0 flex-1 truncate" title={entry.archivedTime}>{entry.title}</span>
                {actions.handleUnarchiveSession ? <Button variant="ghost" size="sm" className="h-7 text-[11px]" aria-label={`Restore ${entry.title}`} disabled={controlsDisabled || state.archived.status === 'loading'} onClick={() => runOnce(() => actions.handleUnarchiveSession?.(entry.id))}>Restore</Button> : null}
              </div>)}
              {state.archived.status === 'ready' && archivedEntries.length === 0 ? <p className="p-2 text-xs text-muted-foreground">No archived sessions.</p> : null}
            </CollapsibleContent>
          </section></Collapsible> : null}
        </div>
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
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(entry.title);
  useEffect(() => { setRenaming(false); setTitle(entry.title); }, [entry.title]);
  const submitRename = () => {
    setRenaming(false);
    if (title.trim() && title.trim() !== entry.title) actions.handleRenameSession?.(entry.id, title.trim());
    else setTitle(entry.title);
  };
  return <div className="group relative flex min-h-7 min-w-0 items-center rounded hover:bg-accent [&_svg]:size-3">
    {renaming ? <form className="flex w-full gap-1 p-1" onSubmit={(event) => {
      event.preventDefault();
      submitRename();
    }}>
      <Input aria-label="Session title" autoFocus maxLength={maxTitleLength} value={title} onBlur={submitRename} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setRenaming(false); setTitle(entry.title); }
        if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault();
      }} />
    </form> : <>
      <Button variant="ghost" className="h-7 min-w-0 flex-1 justify-start pl-1 pr-8 hover:bg-transparent" aria-current={entry.active ? 'true' : undefined} title={entry.modifiedTime} disabled={disabled || entry.active} onClick={onSelect}>
        {entry.running ? <><LoaderCircle className="size-3 animate-spin" /><span className="sr-only">Turn still running. </span></> : <CheckCircle className="size-3 shrink-0 text-muted-foreground" />}
        <span className="truncate">{entry.title}</span>
        {entry.worktree ? <span title={entry.worktree.path} className="truncate text-[11px] text-muted-foreground">worktree{entry.worktree.branch ? ` · ${entry.worktree.branch}` : ''}</span> : null}
        {entry.badge ? <span className="text-[11px] text-muted-foreground">{entry.badge}</span> : null}
      </Button>
      <div className="absolute inset-y-0 right-0 flex items-center gap-0.5 rounded group-hover:bg-accent group-focus-within:bg-accent [&>button]:pointer-events-none [&>button]:opacity-0 group-hover:[&>button]:pointer-events-auto group-hover:[&>button]:opacity-100 group-focus-within:[&>button]:pointer-events-auto group-focus-within:[&>button]:opacity-100 [&>button[aria-pressed=true]]:pointer-events-auto [&>button[aria-pressed=true]]:opacity-100">
      {entry.active ? <>
        {actions.handleRenameSession ? <Button variant="ghost" size="icon-sm" aria-label={`Rename ${entry.title}`} disabled={disabled} onClick={() => { setTitle(entry.title); setRenaming(true); }}><Pencil /></Button> : null}
        {actions.handleForkSession ? <Button variant="ghost" size="icon-sm" aria-label={`Fork ${entry.title}`} disabled={disabled} onClick={() => runOnce(() => actions.handleForkSession?.(entry.id))}><GitBranch /></Button> : null}
      </> : actions.handleArchiveSession ? <Button variant="ghost" size="icon-sm" aria-label={`Archive ${entry.title}`} disabled={disabled} onClick={() => runOnce(() => actions.handleArchiveSession?.(entry.id))}><Archive /></Button> : null}
      {actions.handleToggleFavorite ? <Button variant="ghost" size="icon-sm" aria-label={`Favorite ${entry.title}`} aria-pressed={entry.isFavorite} disabled={disabled} onClick={() => runOnce(() => actions.handleToggleFavorite?.(entry.id, !entry.isFavorite))}><Star className={entry.isFavorite ? 'fill-current' : undefined} /></Button> : null}
      </div>
    </>}
  </div>;
}
