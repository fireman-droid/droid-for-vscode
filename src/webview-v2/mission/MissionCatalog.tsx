import { MISSION_CONTROL_CATALOG_FILTERS, type MissionControlCatalogRow } from '../../shared/protocol/missionControlPanelProtocol';
import { matchesFilter, readRowAccessibleNames, readCatalogStatus, formatFilter, formatLifecycle, formatProgress, formatCreated, lifecycleTone, type MissionCatalogProps } from '../../webview/missionControl/catalogPresentation';
import { formatElapsed } from '../../webview/assistant/subagents/subagentWorking';
import { Button } from '../ui/button';
import { DroidActivity, DroidLoading } from '../ui/droid-motion';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/selection';
import { CalendarPlus, ChevronRight, FolderGit2, Monitor, Plus, RefreshCw, Timer } from 'lucide-react';

export function MissionCatalog({ state, filter, navigationError, onFilter, onRefresh, onNavigate }: MissionCatalogProps) {
  const rows = state.rows.filter((row) => matchesFilter(row, filter));
  const names = readRowAccessibleNames(rows);
  const refreshing = state.status === 'loading' || state.status === 'refreshing';
  return <Tabs value={filter} onValueChange={(value) => onFilter(value as typeof filter)} asChild><main className="mx-auto min-h-full w-full max-w-3xl px-8 py-10 text-[13px] leading-5 max-[819px]:px-4 max-[819px]:py-6">
    <header className="flex flex-wrap items-end justify-between gap-4 pb-8">
      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Local workspace · Droid daemon</p>
        <h1 tabIndex={-1} className="text-[22px] font-semibold tracking-tight outline-none">Mission Control</h1>
        <p className="text-muted-foreground">Plan the outcome. Follow each feature through execution and validation.</p>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" className="h-8" onClick={onRefresh}><RefreshCw className={refreshing ? 'motion-safe:animate-spin' : ''} />Refresh</Button>
        <Button className="h-8" onClick={() => onNavigate({ route: 'new-mission' })}><Plus />New Mission</Button>
      </div>
    </header>
    <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
      <TabsList aria-label="Mission filters" className="inline-flex flex-wrap gap-0.5 rounded-lg border-0 bg-muted p-0.5">
        {MISSION_CONTROL_CATALOG_FILTERS.map((value) => <TabsTrigger key={value} value={value}
          className="flex items-center gap-1.5 rounded-md border-0 px-2.5 py-1.5 data-[state=active]:bg-background data-[state=active]:shadow-xs">{formatFilter(value)}<span aria-hidden="true" className="rounded-full border border-border px-1.5 py-0.5 text-[11px] leading-none tabular-nums text-muted-foreground">{state.rows.filter((row) => matchesFilter(row, value)).length}</span></TabsTrigger>)}
      </TabsList>
    </div>
    {state.status === 'loading' && state.rows.length === 0 ? <DroidLoading label="Loading Missions…" detail="Reading the local Droid catalog." />
      : <p role={state.status === 'error' ? 'alert' : 'status'} aria-live="polite" className={`mb-3 flex min-h-6 items-center gap-2 text-xs ${state.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
        {refreshing ? <DroidActivity phase="loading" /> : null}
        {readCatalogStatus(state, rows.length, filter)}</p>}
    <TabsContent value={filter} className="outline-none focus-visible:ring-1 focus-visible:ring-ring">
      {navigationError ? <p role="alert" className="mb-4 rounded-lg border border-destructive/30 p-3 text-xs text-destructive">{navigationError}</p> : null}
      {state.status === 'error' && state.retryable ? <Button variant="outline" onClick={onRefresh}>Retry</Button> : null}
      {!refreshing && state.status !== 'error' && rows.length === 0 ? <section className="grid justify-items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
        <span className="grid size-10 place-items-center rounded-full bg-muted"><FolderGit2 className="size-5 text-muted-foreground" aria-hidden="true" /></span>
        <h2 className="text-sm font-medium">{state.rows.length === 0 ? 'No Missions yet' : `No ${formatFilter(filter).toLowerCase()} Missions`}</h2>
        <p className="max-w-sm text-muted-foreground">{state.rows.length === 0 ? 'Start with a concrete outcome. Your Mission plan and feature progress will appear here.' : 'Choose another filter to see the other Missions in this catalog.'}</p>
        {state.rows.length === 0 ? <Button variant="outline" className="mt-1" onClick={() => onNavigate({ route: 'new-mission' })}><Plus />New Mission</Button> : null}
      </section> : null}
      <ul aria-label="Missions" className="grid gap-2.5">
        {rows.map((row, index) => <MissionCard key={row.catalogId} row={row} name={names[index]!} onOpen={() => onNavigate({ route: 'detail', catalogId: row.catalogId })} />)}
      </ul>
    </TabsContent>
  </main></Tabs>;
}

function MissionCard({ row, name, onOpen }: {
  readonly row: MissionControlCatalogRow;
  readonly name: string;
  readonly onOpen: () => void;
}) {
  const tone = lifecycleTone(row.lifecycle);
  return <li>
    <Button variant="plain" size="none" aria-label={name} onClick={onOpen} className="v2-mission-card group px-4 py-3.5">
      <span className="flex items-start gap-3">
        <span aria-hidden="true" className="v2-mission-dot mt-[7px]" data-tone={tone} data-pulse={tone === 'active' || tone === 'attention' || undefined} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-3">
            <strong className="min-w-0 whitespace-normal break-words font-medium">{row.title}</strong>
            <span className="v2-mission-pill shrink-0" data-tone={tone}><span aria-hidden="true" className="v2-mission-dot" />{formatLifecycle(row.lifecycle)}</span>
          </span>
          <span className="mt-2.5 flex items-center gap-2.5">
            {row.progress === null ? <span className="text-xs text-muted-foreground">—</span> : <>
              <span aria-hidden="true" className="h-1 w-24 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-primary" style={{ width: `${row.progress.total === 0 ? 0 : Math.min(100, row.progress.completed / row.progress.total * 100)}%` }} /></span>
              <span className="text-xs tabular-nums text-muted-foreground">{formatProgress(row)}</span>
            </>}
          </span>
          <span className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex min-w-0 items-center gap-1.5"><FolderGit2 aria-hidden="true" className="size-3.5 shrink-0" /><span className="truncate">{row.workspaceLabel}</span></span>
            <span className="inline-flex min-w-0 items-center gap-1.5"><Monitor aria-hidden="true" className="size-3.5 shrink-0" /><span className="truncate">{row.computerLabel}</span></span>
            <span className="inline-flex items-center gap-1.5"><CalendarPlus aria-hidden="true" className="size-3.5 shrink-0" />{formatCreated(row.createdAt)}</span>
            {row.elapsedMs === null ? null : <span className="inline-flex items-center gap-1.5"><Timer aria-hidden="true" className="size-3.5 shrink-0" />{formatElapsed(row.elapsedMs)}</span>}
            {row.attached ? <span className="v2-mission-pill" data-tone="active"><span aria-hidden="true" className="v2-mission-dot" />Attached</span> : null}
          </span>
        </span>
        <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-muted-foreground transition-opacity motion-reduce:transition-none max-[819px]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100" />
      </span>
    </Button>
  </li>;
}
