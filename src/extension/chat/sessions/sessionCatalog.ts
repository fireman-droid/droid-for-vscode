import type { SessionCatalogResult } from '../../../runtime/catalog/SessionCatalog';
import { MAX_SESSION_CATALOG_ITEMS as SESSION_CATALOG_LIMIT } from '../../../shared/protocol/bounds';
import {
  type SessionCatalogState,
  type SessionSummary,
} from '../../../shared/protocol/sessions';
import { appendWorktreeSessions } from '../../workspace/worktreeSessions';
import { isUsableWorkspace } from '../internals';
import {
  collapseStoredConversationCatalog,
  projectCatalogEntries,
} from './sessionCatalogProjection';
import type { SessionDirectoryPort } from './sessionDirectoryPort';

export const CATALOG_ERROR_MESSAGE = 'Saved Droid sessions could not be loaded.';

export function startCatalogRefresh(ctl: SessionDirectoryPort, cwd: string): void {
  const previousActive = activeSessionSummary(ctl);
  const catalogRequest = beginCatalogLoad(ctl, cwd);
  ctl.catalogState.refreshInProgress = true;
  ctl.emitSnapshot();
  void refreshCatalog(ctl, cwd, catalogRequest, previousActive).finally(() => {
    ctl.catalogState.refreshInProgress = false;
  });
}

export async function refreshCatalog(
  ctl: SessionDirectoryPort,
  cwd: string,
  catalogRequest: number,
  previousActive: SessionSummary | undefined,
): Promise<void> {
  const result = await loadCatalog(ctl, cwd);
  if (ctl.sessionState.disposed) {
    return;
  }
  if (!isCurrentCatalogRequest(ctl, catalogRequest, cwd)) {
    discardCatalogRequest(ctl, catalogRequest);
    return;
  }
  if (result.status === 'error') {
    ctl.catalogState.sessions = {
      status: 'error',
      items: markActive(ctl, ctl.catalogState.sessions.items),
      message: CATALOG_ERROR_MESSAGE,
    };
  } else {
    ctl.catalogState.sessions = withActiveSession(ctl, result, previousActive);
    ctl.effects.seedBackgroundRunning(cwd);
  }
  ctl.emitSnapshot();
}

export async function loadCatalog(
  ctl: SessionDirectoryPort,
  cwd: string,
): Promise<SessionCatalogState> {
  let result: SessionCatalogResult;
  try {
    result = await ctl.sessionCatalog.listSessions(cwd);
  } catch {
    result = {
      status: 'unavailable',
      reason: 'catalog-failed',
      message: CATALOG_ERROR_MESSAGE,
    };
  }
  if (result.status === 'unavailable') {
    return {
      status: 'error',
      items: [],
      message: CATALOG_ERROR_MESSAGE,
    };
  }
  let items: readonly SessionSummary[] = projectCatalogEntries(result.sessions);
  const feature = ctl.worktreeSessions;
  if (feature?.enabled === true) {
    // Worktree sessions list under their worktree cwd, never under the
    // workspace cwd (probe: artifacts/probe-worktree-catalog.mjs), so
    // the registry re-attaches them here.
    items = await appendWorktreeSessions({
      cwd,
      items,
      store: feature.store,
      listSessions: (worktreeCwd) => ctl.sessionCatalog.listSessions(worktreeCwd),
      project: projectCatalogEntries,
    });
  }
  return collapseStoredConversationCatalog({ status: 'ready', items }, ctl.recoveryStore);
}

export function hasCatalogSession(
  ctl: SessionDirectoryPort,
  sessionId: string,
  cwd: string,
): boolean {
  return (
    ctl.catalogState.catalogCwd === cwd &&
    ctl.catalogState.sessions.status === 'ready' &&
    ctl.catalogState.sessions.items.some(({ id }) => id === sessionId)
  );
}

export function activeSessionSummary(
  ctl: SessionDirectoryPort,
): SessionSummary | undefined {
  return ctl.sessionState.sessionId === null
    ? undefined
    : ctl.catalogState.sessions.items.find(({ id }) => id === ctl.sessionState.sessionId);
}

export function withActiveSession(
  ctl: SessionDirectoryPort,
  sessions: SessionCatalogState,
  fallback?: SessionSummary,
): SessionCatalogState {
  if (
    ctl.sessionState.sessionId === null ||
    ctl.catalogState.catalogCwd === null ||
    ctl.sessionState.activeRuntimeCwd !== ctl.catalogState.catalogCwd
  ) {
    return {
      ...sessions,
      items: sessions.items.map((item) => ({
        ...item,
        active: false,
      })),
    };
  }
  const existing = sessions.items.find(({ id }) => id === ctl.sessionState.sessionId);
  const active = existing ??
    fallback ??
    activeSessionSummary(ctl) ?? {
      id: ctl.sessionState.sessionId,
      title: 'Current session',
      messageCount: 0,
      modifiedTime: new Date().toISOString(),
      active: true,
      isFavorite: false,
    };
  const items = sessions.items
    .filter(({ id }) => id !== ctl.sessionState.sessionId)
    .map((item) => ({ ...item, active: false }));
  if (items.length >= SESSION_CATALOG_LIMIT) {
    items.length = SESSION_CATALOG_LIMIT - 1;
  }
  items.push({ ...active, active: true });
  return { ...sessions, items };
}

export function markActive(
  ctl: SessionDirectoryPort,
  items: readonly SessionSummary[],
): readonly SessionSummary[] {
  return withActiveSession(ctl, {
    status: ctl.catalogState.sessions.status,
    items,
  }).items;
}

export function beginCatalogLoad(ctl: SessionDirectoryPort, cwd: string): number {
  const generation = ++ctl.catalogState.catalogGeneration;
  ctl.catalogState.catalogCwd = cwd;
  ctl.catalogState.sessions = { status: 'loading', items: [] };
  refreshWorktreeAvailability(ctl, cwd);
  return generation;
}

export function bindCatalogViewToWorkspace(ctl: SessionDirectoryPort, cwd: string): void {
  if (ctl.catalogState.catalogCwd === cwd) {
    return;
  }
  ctl.catalogState.catalogGeneration += 1;
  ctl.catalogState.catalogCwd = cwd;
  ctl.catalogState.sessions = { status: 'idle', items: [] };
  refreshWorktreeAvailability(ctl, cwd);
}

export function clearCatalog(ctl: SessionDirectoryPort): void {
  ctl.catalogState.catalogGeneration += 1;
  ctl.catalogState.catalogCwd = null;
  ctl.catalogState.sessions = { status: 'idle', items: [] };
  ctl.catalogState.worktreeAvailabilityCwd = null;
  ctl.catalogState.worktreeCreateAvailable = false;
  // No catalog, no rows to indicate; the poll loop ends itself.
  ctl.catalogState.runningSessionIds.clear();
}

/**
 * Recomputes the worktree-create capability for a workspace binding.
 * One git check per cwd: the async result only lands while the
 * binding is unchanged, and a later snapshot broadcasts it.
 */
export function refreshWorktreeAvailability(
  ctl: SessionDirectoryPort,
  cwd: string,
): void {
  const feature = ctl.worktreeSessions;
  if (feature?.enabled !== true || ctl.catalogState.worktreeAvailabilityCwd === cwd) {
    return;
  }
  ctl.catalogState.worktreeAvailabilityCwd = cwd;
  ctl.catalogState.worktreeCreateAvailable = false;
  void feature.isGitWorkspace(cwd).then((isGit) => {
    if (
      ctl.sessionState.disposed ||
      ctl.catalogState.worktreeAvailabilityCwd !== cwd ||
      !isGit
    ) {
      return;
    }
    ctl.catalogState.worktreeCreateAvailable = true;
    ctl.emitSnapshot();
  });
}

export function isCurrentCatalogRequest(
  ctl: SessionDirectoryPort,
  generation: number,
  cwd: string,
): boolean {
  return (
    !ctl.sessionState.disposed &&
    ctl.catalogState.catalogGeneration === generation &&
    ctl.catalogState.catalogCwd === cwd &&
    ctl.effects.isTargetWorkspaceCurrent(cwd)
  );
}

export function discardCatalogRequest(
  ctl: SessionDirectoryPort,
  generation: number,
): void {
  if (ctl.sessionState.disposed || ctl.catalogState.catalogGeneration !== generation) {
    return;
  }
  const workspace = ctl.getWorkspaceContext();
  ctl.catalogState.catalogGeneration += 1;
  ctl.catalogState.catalogCwd = isUsableWorkspace(workspace) ? workspace.cwd : null;
  ctl.catalogState.sessions = { status: 'idle', items: [] };
  if (isUsableWorkspace(workspace)) {
    ctl.emitSnapshot();
  } else {
    ctl.effects.emitWorkspaceUnavailable(workspace);
  }
}

export function touchActiveSession(ctl: SessionDirectoryPort): void {
  if (ctl.sessionState.sessionId === null) {
    return;
  }
  const modifiedTime = new Date().toISOString();
  ctl.catalogState.sessions = {
    ...ctl.catalogState.sessions,
    items: ctl.catalogState.sessions.items.map((item) =>
      item.id === ctl.sessionState.sessionId ? { ...item, modifiedTime } : item,
    ),
  };
}
