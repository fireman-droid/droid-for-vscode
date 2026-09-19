import {
  MISSION_CONTROL_CATALOG_FILTERS,
  type MissionControlCatalogFilter,
  type MissionControlCatalogRow,
} from '../../shared/protocol/missionControlPanelProtocol';
import { matchesFilter, readRowAccessibleNames, readCatalogStatus as readStatus, formatFilter, nextFilter, formatLifecycle, formatProgress, formatCreated, type MissionCatalogState, type MissionCatalogNavigation } from './catalogPresentation';
export type { MissionCatalogState, MissionCatalogNavigation } from './catalogPresentation';

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
  const rowNames = readRowAccessibleNames(visibleRows);
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
          <button type="button" className="mission-control-retry" onClick={onRefresh}>
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
              {visibleRows.map((row, index) => (
                <li key={row.catalogId}>
                  <button
                    type="button"
                    className="mission-control-row"
                    aria-label={rowNames[index]}
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