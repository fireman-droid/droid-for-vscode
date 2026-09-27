import { MISSION_CONTROL_CATALOG_FILTERS, type MissionControlCatalogFilter, type MissionControlCatalogRow } from '../../shared/protocol/missionControlPanelProtocol';
import type { MissionLifecycle } from '../../shared/protocol/missionProtocol';

/** Visual emphasis for a lifecycle, shared by catalog rows and the workspace hero. */
export type MissionTone = 'active' | 'attention' | 'paused' | 'done' | 'muted';
export function lifecycleTone(lifecycle: MissionLifecycle): MissionTone {
  switch (lifecycle) {
    case 'planning':
    case 'initializing':
    case 'running':
    case 'orchestrator_turn':
      return 'active';
    case 'awaiting_input':
      return 'attention';
    case 'paused':
      return 'paused';
    case 'completed':
      return 'done';
  }
}

export type MissionCatalogState =
  | { readonly status: 'loading' | 'refreshing' | 'ready'; readonly rows: readonly MissionControlCatalogRow[] }
  | { readonly status: 'error'; readonly rows: readonly MissionControlCatalogRow[]; readonly message: string; readonly retryable: boolean };
export type MissionCatalogNavigation = { readonly route: 'catalog' | 'new-mission' } | { readonly route: 'detail'; readonly catalogId: string };
export interface MissionCatalogProps {
  readonly state: MissionCatalogState;
  readonly filter: MissionControlCatalogFilter;
  readonly navigationError?: string | null;
  readonly onFilter: (filter: MissionControlCatalogFilter) => void;
  readonly onRefresh: () => void;
  readonly onNavigate: (navigation: MissionCatalogNavigation) => void;
}
export function readRowAccessibleNames(rows: readonly MissionControlCatalogRow[]): readonly string[] {
  const names = rows.map((row) => `Open Mission “${row.title}” in ${row.workspaceLabel}`);
  const totals = new Map<string, number>(), positions = new Map<string, number>();
  for (const name of names) totals.set(name, (totals.get(name) ?? 0) + 1);
  return names.map((name) => {
    const total = totals.get(name)!;
    if (total === 1) return name;
    const position = (positions.get(name) ?? 0) + 1;
    positions.set(name, position);
    return `${name}, item ${position} of ${total}`;
  });
}
export function matchesFilter(row: MissionControlCatalogRow, filter: MissionControlCatalogFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'paused' || filter === 'completed') return row.lifecycle === filter;
  return ['planning', 'awaiting_input', 'initializing', 'running', 'orchestrator_turn'].includes(row.lifecycle);
}
export function readCatalogStatus(state: MissionCatalogState, count: number, filter: MissionControlCatalogFilter): string {
  if (state.status === 'loading') return 'Loading Missions…';
  if (state.status === 'refreshing') return 'Refreshing Missions…';
  if (state.status === 'error') return state.message;
  if (count === 0) return filter === 'all' ? 'No Missions found.' : `No ${formatFilter(filter).toLowerCase()} Missions found.`;
  return `${count} ${count === 1 ? 'Mission' : 'Missions'}`;
}
export function formatFilter(filter: MissionControlCatalogFilter): string {
  return filter[0]!.toUpperCase() + filter.slice(1);
}
export function nextFilter(current: MissionControlCatalogFilter, key: string): MissionControlCatalogFilter | null {
  const index = MISSION_CONTROL_CATALOG_FILTERS.indexOf(current);
  if (key === 'Home') return MISSION_CONTROL_CATALOG_FILTERS[0];
  if (key === 'End') return MISSION_CONTROL_CATALOG_FILTERS.at(-1)!;
  if (key === 'ArrowRight' || key === 'ArrowDown') return MISSION_CONTROL_CATALOG_FILTERS[(index + 1) % MISSION_CONTROL_CATALOG_FILTERS.length];
  if (key === 'ArrowLeft' || key === 'ArrowUp') return MISSION_CONTROL_CATALOG_FILTERS[(index - 1 + MISSION_CONTROL_CATALOG_FILTERS.length) % MISSION_CONTROL_CATALOG_FILTERS.length];
  return null;
}
export function formatLifecycle(lifecycle: MissionControlCatalogRow['lifecycle']): string {
  return lifecycle === 'awaiting_input' ? 'Awaiting input' : lifecycle === 'orchestrator_turn' ? 'Orchestrating' : lifecycle[0]!.toUpperCase() + lifecycle.slice(1);
}
export const formatProgress = (row: MissionControlCatalogRow) => row.progress === null ? '—' : `${row.progress.completed} of ${row.progress.total}`;
export const formatCreated = (createdAt: string | null) => createdAt === null ? '—' : new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(createdAt));
