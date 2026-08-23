import {
  MISSION_CONTROL_CATALOG_FILTERS,
  type MissionControlCatalogFilter,
  type MissionControlCatalogRow,
} from '../../shared/missionControlPanelProtocol';

export type MissionCatalogState =
  | { readonly status: 'loading'; readonly rows: readonly MissionControlCatalogRow[] }
  | { readonly status: 'refreshing'; readonly rows: readonly MissionControlCatalogRow[] }
  | { readonly status: 'ready'; readonly rows: readonly MissionControlCatalogRow[] }
  | {
      readonly status: 'error';
      readonly rows: readonly MissionControlCatalogRow[];
      readonly message: string;
      readonly retryable: boolean;
    };

export type MissionCatalogNavigation =
  | { readonly route: 'catalog' }
  | { readonly route: 'new-mission' }
  | { readonly route: 'detail'; readonly catalogId: string };

export function MissionCatalog({
  state,
  filter,
  onFilter,
  onRefresh,
  onNavigate,
}: {
  readonly state: MissionCatalogState;
  readonly filter: MissionControlCatalogFilter;
  readonly onFilter: (filter: MissionControlCatalogFilter) => void;
  readonly onRefresh: () => void;
  readonly onNavigate: (navigation: MissionCatalogNavigation) => void;
}): React.JSX.Element {
  const visibleRows = state.rows.filter((row) => matchesFilter(row, filter));
  const status = readStatus(state, visibleRows.length, filter);

  return (
    <main className="mission-control-page">
      <header className="mission-control-header">
        <div>
          <h1 tabIndex={-1}>Mission Control</h1>
          <p>Browse Missions known to your local Droid daemon.</p>
        </div>
        <button
          type="button"
          className="mission-control-primary"
          onClick={() => onNavigate({ route: 'new-mission' })}
        >
          New Mission
        </button>
      </header>

      <div className="mission-control-toolbar">
        <div
          className="mission-control-filters"
          role="tablist"
          aria-label="Mission filters"
        >
          {MISSION_CONTROL_CATALOG_FILTERS.map((value) => (
            <button
              key={value}
              id={`mission-filter-${value}`}
              type="button"
              role="tab"
              aria-selected={filter === value}
              aria-controls="mission-catalog-panel"
              tabIndex={filter === value ? 0 : -1}
              onClick={() => onFilter(value)}
              onKeyDown={(event) => {
                const next = nextFilter(value, event.key);
                if (next === null) {
                  return;
                }
                event.preventDefault();
                onFilter(next);
                queueMicrotask(() => {
                  document.getElementById(`mission-filter-${next}`)?.focus();
                });
              }}
            >
              {formatFilter(value)}
            </button>
          ))}
        </div>
        <button type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>

      <p
        className="mission-control-status"
        role={state.status === 'error' ? 'alert' : 'status'}
        aria-live="polite"
      >
        {status}
      </p>

      <section
        id="mission-catalog-panel"
        role="tabpanel"
        aria-labelledby={`mission-filter-${filter}`}
      >
        {state.status === 'error' && state.retryable ? (
          <button
            type="button"
            className="mission-control-retry"
            onClick={onRefresh}
          >
            Retry
          </button>
        ) : null}
        {visibleRows.length === 0 ? null : (
          <>
            <div className="mission-control-columns" aria-hidden="true">
              <span>Mission</span>
              <span>Repository</span>
              <span>Computer</span>
              <span>Progress</span>
              <span>Created</span>
            </div>
            <ul className="mission-control-list" aria-label="Missions">
              {visibleRows.map((row) => (
                <li key={row.catalogId}>
                  <button
                    type="button"
                    className="mission-control-row"
                    aria-label={`Open Mission “${row.title}”`}
                    onClick={() =>
                      onNavigate({
                        route: 'detail',
                        catalogId: row.catalogId,
                      })
                    }
                  >
                    <span className="mission-control-title">
                      <strong>{row.title}</strong>
                      <small>{formatLifecycle(row.lifecycle)}</small>
                    </span>
                    <MissionValue label="Repository" value={row.workspaceLabel} />
                    <MissionValue label="Computer" value={row.computerLabel} />
                    <MissionValue label="Progress" value={formatProgress(row)} />
                    <MissionValue label="Created" value={formatCreated(row.createdAt)} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </main>
  );
}

function MissionValue({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}): React.JSX.Element {
  return (
    <span className="mission-control-value">
      <small>{label}</small>
      <span>{value}</span>
    </span>
  );
}

function matchesFilter(
  row: MissionControlCatalogRow,
  filter: MissionControlCatalogFilter,
): boolean {
  if (filter === 'all') {
    return true;
  }
  if (filter === 'paused' || filter === 'completed') {
    return row.lifecycle === filter;
  }
  return (
    row.lifecycle === 'planning' ||
    row.lifecycle === 'awaiting_input' ||
    row.lifecycle === 'initializing' ||
    row.lifecycle === 'running' ||
    row.lifecycle === 'orchestrator_turn'
  );
}

function readStatus(
  state: MissionCatalogState,
  count: number,
  filter: MissionControlCatalogFilter,
): string {
  if (state.status === 'loading') {
    return 'Loading Missions…';
  }
  if (state.status === 'refreshing') {
    return 'Refreshing Missions…';
  }
  if (state.status === 'error') {
    return state.message;
  }
  if (count === 0) {
    return filter === 'all'
      ? 'No Missions found.'
      : `No ${formatFilter(filter).toLowerCase()} Missions found.`;
  }
  return `${count} ${count === 1 ? 'Mission' : 'Missions'}`;
}

function formatFilter(filter: MissionControlCatalogFilter): string {
  return filter[0]!.toUpperCase() + filter.slice(1);
}

function nextFilter(
  current: MissionControlCatalogFilter,
  key: string,
): MissionControlCatalogFilter | null {
  const index = MISSION_CONTROL_CATALOG_FILTERS.indexOf(current);
  if (key === 'Home') {
    return MISSION_CONTROL_CATALOG_FILTERS[0];
  }
  if (key === 'End') {
    return MISSION_CONTROL_CATALOG_FILTERS.at(-1) ?? null;
  }
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return MISSION_CONTROL_CATALOG_FILTERS[
      (index + 1) % MISSION_CONTROL_CATALOG_FILTERS.length
    ];
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return MISSION_CONTROL_CATALOG_FILTERS[
      (index - 1 + MISSION_CONTROL_CATALOG_FILTERS.length) %
        MISSION_CONTROL_CATALOG_FILTERS.length
    ];
  }
  return null;
}

function formatLifecycle(
  lifecycle: MissionControlCatalogRow['lifecycle'],
): string {
  switch (lifecycle) {
    case 'awaiting_input':
      return 'Awaiting input';
    case 'orchestrator_turn':
      return 'Orchestrating';
    default:
      return lifecycle[0]!.toUpperCase() + lifecycle.slice(1);
  }
}

function formatProgress(row: MissionControlCatalogRow): string {
  return row.progress === null
    ? '—'
    : `${row.progress.completed} of ${row.progress.total}`;
}

function formatCreated(createdAt: string | null): string {
  if (createdAt === null) {
    return '—';
  }
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(createdAt));
}
