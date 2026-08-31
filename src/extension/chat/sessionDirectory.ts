// sessionDirectory: moved verbatim from ChatController.ts (structure-only
// refactor; bodies unchanged except mechanical this. -> ctl.).
import type {
  ArchivedSessionSummary,
  SessionCatalogState,
  SessionMissionSummary,
  SessionSummary,
} from '../../shared/bridgeMessages';
import type { DroidRuntime } from '../../runtime/DroidRuntime';
import type { HostTranscriptState } from '../hostTranscriptState';
import type { TokenUsageBreakdown } from '../../shared/tokenUsage';
import { clearPendingAttachments } from './attachments';
import {
  MAX_ARCHIVED_SESSION_ITEMS,
  MAX_SESSION_CATALOG_ITEMS as SESSION_CATALOG_LIMIT,
  MAX_SESSION_SEARCH_RESULTS,
  MAX_SESSION_TITLE_LENGTH as SESSION_TITLE_LIMIT,
} from '../../shared/bridgeMessages';
import { sanitizeSessionTitle } from '../../shared/validateMessage';
import type {
  SessionCatalogEntry,
  SessionCatalogResult,
} from '../../runtime/SessionCatalog';
import type { RuntimeSessionTarget } from '../../runtime/DroidRuntime';
import {
  appendWorktreeSessions,
  recordCreatedWorktreeSession,
} from '../worktreeSessions';
import { seedBackgroundRunning } from './sessionRunning';
import { refreshContextAfterTurn } from './turnFlow';
import {
  canReplaceSession,
  emitWorkspaceUnavailable,
  ensureActiveRuntimeWorkspaceCurrent,
  isTargetWorkspaceCurrent,
  loadHistoryTimed,
  startReplacement,
} from './runtimeLifecycle';
import { flushRecoveryCheckpointOrReport } from './recovery';
import {
  daemonFailureMessage,
  DAEMON_UNAVAILABLE_MESSAGE,
  forkTitleFromText,
  formatUnknownError,
  isSafeBridgeId,
  isTurnActive,
  isUsableWorkspace,
  SESSION_OPERATION_BLOCKED_MESSAGE,
  type ChatControllerInternals,
} from './internals';

export const CATALOG_ERROR_MESSAGE =
  'Saved Droid sessions could not be loaded.';

export const UNKNOWN_SESSION_MESSAGE =
  'The selected Droid session is not available in this workspace.';

export const SESSION_NEW_FAILED_MESSAGE =
  'A new Droid session could not be created.';

export const WORKTREE_CREATE_UNAVAILABLE_MESSAGE =
  'Worktree sessions need the daemon runtime mode and a git workspace.';

export const RENAME_BLOCKED_MESSAGE =
  'Wait for the current session operation to finish before renaming.';

export const RENAME_UNSUPPORTED_MESSAGE =
  'This session cannot be renamed.';

export const RENAME_FAILED_MESSAGE =
  'Droid could not rename the session.';

export const FAVORITE_BLOCKED_MESSAGE =
  'Wait for the current session operation to finish before changing favorites.';

export const FAVORITE_UNSUPPORTED_MESSAGE =
  'Session favorites are not available in this Droid runtime.';

export const FAVORITE_FAILED_MESSAGE =
  'The session favorite could not be saved.';

export const DAEMON_UNSUPPORTED_MESSAGE =
  'Archive and search are not available in this Droid runtime.';

export const ARCHIVE_BLOCKED_MESSAGE =
  'Wait for the current session operation to finish before archiving.';

export const ARCHIVE_ACTIVE_MESSAGE =
  'Switch to another session before archiving the active one.';

export const ARCHIVE_FAILED_MESSAGE = 'The session could not be archived.';

export const UNARCHIVE_FAILED_MESSAGE =
  'The session could not be restored from the archive.';

export const FORK_BLOCKED_MESSAGE =
  'Droid cannot fork right now. Wait for the current activity to finish.';

export const FORK_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not support session forking.';

export const FORK_FAILED_MESSAGE = 'Droid could not fork this session.';

export function handleSessionNew(ctl: ChatControllerInternals): void {
    const workspace = ctl.getWorkspaceContext();
    if (!canReplaceSession(ctl) || !isUsableWorkspace(workspace)) {
      if (!isUsableWorkspace(workspace)) {
        emitWorkspaceUnavailable(ctl, workspace);
      }
      return;
    }
    bindCatalogViewToWorkspace(ctl, workspace.cwd);
    startReplacement(ctl, { kind: 'new', cwd: workspace.cwd });
}

export function handleWorktreeCreateSession(ctl: ChatControllerInternals): void {
    const workspace = ctl.getWorkspaceContext();
    if (!canReplaceSession(ctl) || !isUsableWorkspace(workspace)) {
      if (!isUsableWorkspace(workspace)) {
        emitWorkspaceUnavailable(ctl, workspace);
      }
      return;
    }
    // The drawer entry never renders without the advertised
    // capability, so a request without it is stale or hostile. Fail
    // closed with a diagnostic instead of degrading to a plain
    // in-workspace session.
    if (
      ctl.worktreeSessions?.enabled !== true ||
      !ctl.worktreeCreateAvailable
    ) {
      ctl.emitSessionDiagnostic(
        'worktree-create-unavailable',
        WORKTREE_CREATE_UNAVAILABLE_MESSAGE,
      );
      return;
    }
    bindCatalogViewToWorkspace(ctl, workspace.cwd);
    startReplacement(ctl, {
      kind: 'new',
      cwd: workspace.cwd,
      worktree: true,
    });
}

export function handleSessionRename(
  ctl: ChatControllerInternals,
  sessionId: string, title: string): void {
    const runtime = ctl.runtime;
    if (
      runtime !== null &&
      !ensureActiveRuntimeWorkspaceCurrent(ctl)
    ) {
      return;
    }
    const trimmedTitle = title.trim();
    if (
      runtime === null ||
      ctl.connection.status !== 'connected' ||
      sessionId !== ctl.sessionId ||
      trimmedTitle.length === 0
    ) {
      return;
    }
    if (
      ctl.sessionOperationInProgress ||
      ctl.refreshInProgress
    ) {
      ctl.emitSessionDiagnostic(
        'session-rename-blocked',
        RENAME_BLOCKED_MESSAGE,
      );
      return;
    }
    if (typeof runtime.rename !== 'function') {
      ctl.emitSessionDiagnostic(
        'session-rename-unsupported',
        RENAME_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    const generation = ctl.runtimeGeneration;
    const cwd = ctl.activeRuntimeCwd;
    if (cwd === null) {
      return;
    }
    void runtime.rename(trimmedTitle).then(
      () => {
        if (
          !ctl.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          return;
        }
        ctl.sessions = {
          ...ctl.sessions,
          items: ctl.sessions.items.map((item) =>
            item.id === sessionId
              ? { ...item, title: trimmedTitle }
              : item,
          ),
        };
        ctl.emitSnapshot();
      },
      () => {
        if (
          ctl.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          ctl.emitSessionDiagnostic(
            'session-rename-failed',
            RENAME_FAILED_MESSAGE,
          );
        }
      },
    );
}

export function handleSessionFavorite(
  ctl: ChatControllerInternals,
    sessionId: string,
    favorite: boolean,
  ): void {
    const workspace = ctl.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      return;
    }
    if (ctl.sessionOperationInProgress || ctl.refreshInProgress) {
      ctl.emitSessionDiagnostic(
        'session-favorite-blocked',
        FAVORITE_BLOCKED_MESSAGE,
      );
      return;
    }
    if (
      ctl.sessions.status !== 'ready' ||
      !hasCatalogSession(ctl, sessionId, workspace.cwd)
    ) {
      ctl.emitSessionDiagnostic(
        'session-favorite-invalid',
        UNKNOWN_SESSION_MESSAGE,
      );
      return;
    }
    const writeFavorite = ctl.sessionCatalog.writeFavorite?.bind(
      ctl.sessionCatalog,
    );
    if (writeFavorite === undefined) {
      ctl.emitSessionDiagnostic(
        'session-favorite-unsupported',
        FAVORITE_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    // Blocks concurrent catalog reads/writes for the duration of the
    // file write and the follow-up re-list.
    ctl.refreshInProgress = true;
    void (async () => {
      let written = false;
      try {
        written = await writeFavorite(sessionId, favorite);
      } catch {
        written = false;
      }
      if (ctl.disposed) {
        return;
      }
      if (!written) {
        ctl.refreshInProgress = false;
        ctl.emitSessionDiagnostic(
          'session-favorite-failed',
          FAVORITE_FAILED_MESSAGE,
        );
        return;
      }

      // Close the loop through the public listSessions() readback so
      // the drawer shows what the SDK actually reports.
      const previousActive = activeSessionSummary(ctl);
      const catalogGeneration = ctl.catalogGeneration;
      const result = await loadCatalog(ctl, workspace.cwd);
      ctl.refreshInProgress = false;
      if (
        ctl.disposed ||
        ctl.catalogGeneration !== catalogGeneration ||
        ctl.catalogCwd !== workspace.cwd ||
        !isTargetWorkspaceCurrent(ctl, workspace.cwd)
      ) {
        return;
      }
      if (result.status === 'ready') {
        ctl.sessions = withActiveSession(ctl, result, previousActive);
        seedBackgroundRunning(ctl, workspace.cwd);
      } else {
        // The write succeeded but the re-list failed; reflect the
        // write locally so the toggle does not look ignored.
        ctl.sessions = {
          ...ctl.sessions,
          items: ctl.sessions.items.map((item) =>
            item.id === sessionId
              ? { ...item, isFavorite: favorite }
              : item,
          ),
        };
      }
      ctl.emitSnapshot();
    })();
}

/**
 * Archives a non-active catalog session through the daemon sidecar,
 * then closes the loop with a catalog re-list (the process-path
 * `listSessions` skips archived sessions) and an archived-list
 * refresh.
 */
export function handleSessionArchive(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    const workspace = ctl.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      return;
    }
    if (ctl.sessionOperationInProgress || ctl.refreshInProgress) {
      ctl.emitSessionDiagnostic(
        'session-archive-blocked',
        ARCHIVE_BLOCKED_MESSAGE,
      );
      return;
    }
    if (
      ctl.sessions.status !== 'ready' ||
      !hasCatalogSession(ctl, sessionId, workspace.cwd)
    ) {
      ctl.emitSessionDiagnostic(
        'session-archive-invalid',
        UNKNOWN_SESSION_MESSAGE,
      );
      return;
    }
    if (sessionId === ctl.sessionId) {
      ctl.emitSessionDiagnostic(
        'session-archive-active',
        ARCHIVE_ACTIVE_MESSAGE,
      );
      return;
    }
    const daemonSessions = ctl.daemonSessions;
    if (daemonSessions === undefined) {
      ctl.emitSessionDiagnostic(
        'session-archive-unsupported',
        DAEMON_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    ctl.refreshInProgress = true;
    void (async () => {
      let archived = false;
      let failure = ARCHIVE_FAILED_MESSAGE;
      try {
        archived = await (await daemonSessions()).archive(sessionId);
      } catch (error) {
        failure = daemonFailureMessage(error, ARCHIVE_FAILED_MESSAGE);
      }
      if (ctl.disposed) {
        return;
      }
      if (!archived) {
        ctl.refreshInProgress = false;
        ctl.emitSessionDiagnostic('session-archive-failed', failure);
        return;
      }
      await reloadCatalogAfterDaemonWrite(ctl, workspace.cwd);
    })();
}

/**
 * Restores an archived session. The id is not required to be in the
 * live catalog (archived sessions left it), only shape-validated by
 * the Bridge.
 */
export function handleSessionUnarchive(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    const workspace = ctl.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      return;
    }
    if (ctl.sessionOperationInProgress || ctl.refreshInProgress) {
      ctl.emitSessionDiagnostic(
        'session-unarchive-blocked',
        ARCHIVE_BLOCKED_MESSAGE,
      );
      return;
    }
    const daemonSessions = ctl.daemonSessions;
    if (daemonSessions === undefined) {
      ctl.emitSessionDiagnostic(
        'session-unarchive-unsupported',
        DAEMON_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    ctl.refreshInProgress = true;
    void (async () => {
      let restored = false;
      let failure = UNARCHIVE_FAILED_MESSAGE;
      try {
        restored = await (await daemonSessions()).unarchive(sessionId);
      } catch (error) {
        failure = daemonFailureMessage(error, UNARCHIVE_FAILED_MESSAGE);
      }
      if (ctl.disposed) {
        return;
      }
      if (!restored) {
        ctl.refreshInProgress = false;
        ctl.emitSessionDiagnostic('session-unarchive-failed', failure);
        return;
      }
      await reloadCatalogAfterDaemonWrite(ctl, workspace.cwd);
    })();
}

/**
 * Shared readback after a successful daemon archive/unarchive:
 * re-list the regular catalog, emit the snapshot, then refresh the
 * archived section. Clears `refreshInProgress`.
 */
export async function reloadCatalogAfterDaemonWrite(
  ctl: ChatControllerInternals,
    cwd: string,
  ): Promise<void> {
    const previousActive = activeSessionSummary(ctl);
    const catalogGeneration = ctl.catalogGeneration;
    const result = await loadCatalog(ctl, cwd);
    ctl.refreshInProgress = false;
    if (ctl.disposed) {
      return;
    }
    if (
      ctl.catalogGeneration === catalogGeneration &&
      ctl.catalogCwd === cwd &&
      isTargetWorkspaceCurrent(ctl, cwd) &&
      result.status === 'ready'
    ) {
      ctl.sessions = withActiveSession(ctl, result, previousActive);
      seedBackgroundRunning(ctl, cwd);
      ctl.emitSnapshot();
    }
    await refreshArchived(ctl, cwd);
}

export function handleArchivedRefresh(ctl: ChatControllerInternals): void {
    const workspace = ctl.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      return;
    }
    void refreshArchived(ctl, workspace.cwd);
}

export async function refreshArchived(
  ctl: ChatControllerInternals,
  cwd: string): Promise<void> {
    const daemonSessions = ctl.daemonSessions;
    if (daemonSessions === undefined) {
      ctl.emit({
        type: 'session.archived',
        archived: {
          status: 'error',
          items: [],
          message: DAEMON_UNSUPPORTED_MESSAGE,
        },
      });
      return;
    }
    ctl.emit({
      type: 'session.archived',
      archived: { status: 'loading', items: [] },
    });
    let items: readonly ArchivedSessionSummary[];
    try {
      items = (await (await daemonSessions()).listArchived(cwd)).slice(
        0,
        MAX_ARCHIVED_SESSION_ITEMS,
      );
    } catch (error) {
      // The unavailable copy renders only inside the drawer; without
      // this record a failed daemon acquire leaves no local-log trace.
      ctl.recordPanelFailure(
        'archived-load-failed',
        formatUnknownError(error),
      );
      if (!ctl.disposed) {
        ctl.emit({
          type: 'session.archived',
          archived: {
            status: 'error',
            items: [],
            message: daemonFailureMessage(
              error,
              DAEMON_UNAVAILABLE_MESSAGE,
            ),
          },
        });
      }
      return;
    }
    if (ctl.disposed || !isTargetWorkspaceCurrent(ctl, cwd)) {
      return;
    }
    ctl.emit({
      type: 'session.archived',
      archived: { status: 'ready', items },
    });
}

export function handleSessionSearch(
  ctl: ChatControllerInternals,
  query: string): void {
    const workspace = ctl.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      return;
    }
    const daemonSessions = ctl.daemonSessions;
    if (daemonSessions === undefined) {
      ctl.emit({
        type: 'session.searchResults',
        search: {
          status: 'error',
          query,
          items: [],
          message: DAEMON_UNSUPPORTED_MESSAGE,
        },
      });
      return;
    }
    void (async () => {
      try {
        const matches = (
          await (await daemonSessions()).search(query)
        ).slice(0, MAX_SESSION_SEARCH_RESULTS);
        if (ctl.disposed) {
          return;
        }
        ctl.emit({
          type: 'session.searchResults',
          search: { status: 'ready', query, items: matches },
        });
      } catch (error) {
        if (ctl.disposed) {
          return;
        }
        ctl.emit({
          type: 'session.searchResults',
          search: {
            status: 'error',
            query,
            items: [],
            message: daemonFailureMessage(
              error,
              DAEMON_UNAVAILABLE_MESSAGE,
            ),
          },
        });
      }
    })();
}

export function handleSessionSelect(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    const workspace = ctl.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      clearCatalog(ctl);
      emitWorkspaceUnavailable(ctl, workspace);
      return;
    }
    if (!canReplaceSession(ctl)) {
      return;
    }
    if (ctl.catalogCwd !== workspace.cwd) {
      ctl.emitSessionDiagnostic(
        'session-selection-invalid',
        UNKNOWN_SESSION_MESSAGE,
      );
      startCatalogRefresh(ctl, workspace.cwd);
      return;
    }
    if (
      ctl.sessions.status !== 'ready' ||
      !hasCatalogSession(ctl, sessionId, workspace.cwd)
    ) {
      ctl.emitSessionDiagnostic(
        'session-selection-invalid',
        UNKNOWN_SESSION_MESSAGE,
      );
      return;
    }
    if (
      sessionId === ctl.sessionId &&
      ctl.activeRuntimeCwd === workspace.cwd
    ) {
      ctl.emitSnapshot();
      return;
    }
    startReplacement(ctl, {
      kind: 'resume',
      cwd: workspace.cwd,
      sessionId,
    });
}

export function handleRefresh(ctl: ChatControllerInternals): void {
    if (
      ctl.connection.status === 'connecting' ||
      ctl.refreshInProgress ||
      ctl.sessionOperationInProgress
    ) {
      ctl.emitSessionDiagnostic(
        'session-operation-blocked',
        SESSION_OPERATION_BLOCKED_MESSAGE,
      );
      return;
    }
    const workspace = ctl.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      emitWorkspaceUnavailable(ctl, workspace);
      return;
    }

    startCatalogRefresh(ctl, workspace.cwd);
}

export function handleSessionFork(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    const runtime = ctl.runtime;
    if (
      runtime !== null &&
      !ensureActiveRuntimeWorkspaceCurrent(ctl)
    ) {
      return;
    }
    if (
      runtime === null ||
      ctl.connection.status !== 'connected' ||
      sessionId !== ctl.sessionId
    ) {
      return;
    }
    if (
      isTurnActive(ctl.turn) ||
      ctl.interactions.hasPending() ||
      ctl.sessionOperationInProgress ||
      ctl.refreshInProgress ||
      ctl.settingsUpdate !== null
    ) {
      ctl.emitSessionDiagnostic(
        'session-fork-blocked',
        FORK_BLOCKED_MESSAGE,
      );
      return;
    }
    if (typeof runtime.fork !== 'function') {
      ctl.emitSessionDiagnostic(
        'session-fork-unsupported',
        FORK_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    ctl.sessionOperationInProgress = true;
    void performFork(ctl, runtime, sessionId).finally(() => {
      ctl.sessionOperationInProgress = false;
    });
}

/**
 * Forks the active session and adopts the copy that Droid returns.
 * The original session stays in the catalog so the user can go back
 * to it; the current transcript carries over unchanged.
 */
export async function performFork(
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    sessionId: string,
  ): Promise<void> {
    const generation = ctl.runtimeGeneration;
    const cwd = ctl.activeRuntimeCwd;
    if (cwd === null) {
      return;
    }

    const previousTitle =
      activeSessionSummary(ctl)?.title ?? 'Current session';
    const forkTitle = forkTitleFromText(`${previousTitle} (fork)`);

    let forkedSessionId: string;
    try {
      const result = await runtime.fork!(forkTitle);
      forkedSessionId = result.sessionId;
    } catch {
      if (
        ctl.isCurrentSessionOperation(
          runtime,
          generation,
          sessionId,
          cwd,
        )
      ) {
        ctl.emitSessionDiagnostic(
          'session-fork-failed',
          FORK_FAILED_MESSAGE,
        );
      }
      return;
    }
    if (
      !ctl.isCurrentSessionOperation(
        runtime,
        generation,
        sessionId,
        cwd,
      )
    ) {
      return;
    }
    if (
      !isSafeBridgeId(forkedSessionId) ||
      forkedSessionId === sessionId
    ) {
      ctl.emitSessionDiagnostic(
        'session-fork-failed',
        FORK_FAILED_MESSAGE,
      );
      return;
    }

    // Unlike compaction, the forked-from session remains valid and
    // stays in the catalog; only the active marker moves to the fork.
    ctl.sessionId = forkedSessionId;
    ctl.turn = null;
    clearPendingAttachments(ctl);
    ctl.sessions = withActiveSession(ctl, ctl.sessions, {
      id: forkedSessionId,
      title: forkTitle,
      messageCount: 0,
      modifiedTime: new Date().toISOString(),
      active: true,
      isFavorite: false,
    });

    // The fork copies the conversation, but message IDs may differ, so
    // reload its history; keep the current transcript if that fails.
    let transcript: HostTranscriptState | null = null;
    let mission: SessionMissionSummary | null = null;
    let tokenUsage: TokenUsageBreakdown | null = null;
    {
      const loaded = await loadHistoryTimed(ctl, cwd, forkedSessionId);
      if (loaded?.status === 'available') {
        transcript = loaded.state;
        mission = loaded.mission ?? null;
        tokenUsage = loaded.tokenUsage ?? null;
      }
    }
    if (
      !ctl.isCurrentSessionOperation(
        runtime,
        generation,
        forkedSessionId,
        cwd,
      )
    ) {
      return;
    }
    ctl.mission = mission;
    // The fork is a new session; its counters restart.
    ctl.tokenUsage = { cumulative: tokenUsage, lastTurn: null };
    ctl.transcript =
      transcript ?? { ...ctl.transcript, historyStatus: 'partial' };
    ctl.recoveryStore.writeSession(forkedSessionId, ctl.transcript);
    ctl.recoveryStore.selectSession(forkedSessionId);
    if (!await flushRecoveryCheckpointOrReport(ctl)) return;
    ctl.emitSnapshot();
    ctl.emit({
      type: 'runtime.diagnostic',
      sessionId: forkedSessionId,
      turnId: null,
      severity: 'info',
      code: 'session-forked',
      message: 'Session forked. You are now on the copy.',
    });
    refreshContextAfterTurn(ctl, forkedSessionId);
}

export function startCatalogRefresh(
  ctl: ChatControllerInternals,
  cwd: string): void {
    const previousActive = activeSessionSummary(ctl);
    const catalogRequest = beginCatalogLoad(ctl, cwd);
    ctl.refreshInProgress = true;
    ctl.emitSnapshot();
    void refreshCatalog(ctl, 
      cwd,
      catalogRequest,
      previousActive,
    ).finally(() => {
      ctl.refreshInProgress = false;
    });
}

export async function refreshCatalog(
  ctl: ChatControllerInternals,
    cwd: string,
    catalogRequest: number,
    previousActive: SessionSummary | undefined,
  ): Promise<void> {
    const result = await loadCatalog(ctl, cwd);
    if (ctl.disposed) {
      return;
    }
    if (!isCurrentCatalogRequest(ctl, catalogRequest, cwd)) {
      discardCatalogRequest(ctl, catalogRequest);
      return;
    }
    if (result.status === 'error') {
      ctl.sessions = {
        status: 'error',
        items: markActive(ctl, ctl.sessions.items),
        message: CATALOG_ERROR_MESSAGE,
      };
    } else {
      ctl.sessions = withActiveSession(ctl, 
        result,
        previousActive,
      );
      seedBackgroundRunning(ctl, cwd);
    }
    ctl.emitSnapshot();
}

export async function loadCatalog(
  ctl: ChatControllerInternals,
  cwd: string): Promise<SessionCatalogState> {
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
    const items = projectCatalogEntries(result.sessions);
    const feature = ctl.worktreeSessions;
    if (feature?.enabled !== true) {
      return { status: 'ready', items };
    }
    // Worktree sessions list under their worktree cwd, never under the
    // workspace cwd (probe: artifacts/probe-worktree-catalog.mjs), so
    // the registry re-attaches them here.
    return {
      status: 'ready',
      items: await appendWorktreeSessions({
        cwd,
        items,
        store: feature.store,
        listSessions: (worktreeCwd) =>
          ctl.sessionCatalog.listSessions(worktreeCwd),
        project: projectCatalogEntries,
      }),
    };
}

export function hasCatalogSession(
  ctl: ChatControllerInternals,
  sessionId: string, cwd: string): boolean {
    return (
      ctl.catalogCwd === cwd &&
      ctl.sessions.status === 'ready' &&
      ctl.sessions.items.some(({ id }) => id === sessionId)
    );
}

export function activeSessionSummary(ctl: ChatControllerInternals): SessionSummary | undefined {
    return ctl.sessionId === null
      ? undefined
      : ctl.sessions.items.find(({ id }) => id === ctl.sessionId);
}

export function withActiveSession(
  ctl: ChatControllerInternals,
    sessions: SessionCatalogState,
    fallback?: SessionSummary,
  ): SessionCatalogState {
    if (
      ctl.sessionId === null ||
      ctl.catalogCwd === null ||
      ctl.activeRuntimeCwd !== ctl.catalogCwd
    ) {
      return {
        ...sessions,
        items: sessions.items.map((item) => ({
          ...item,
          active: false,
        })),
      };
    }
    const existing = sessions.items.find(
      ({ id }) => id === ctl.sessionId,
    );
    const active =
      existing ??
      fallback ??
      activeSessionSummary(ctl) ?? {
        id: ctl.sessionId,
        title: 'Current session',
        messageCount: 0,
        modifiedTime: new Date().toISOString(),
        active: true,
        isFavorite: false,
      };
    const items = sessions.items
      .filter(({ id }) => id !== ctl.sessionId)
      .map((item) => ({ ...item, active: false }));
    if (items.length >= SESSION_CATALOG_LIMIT) {
      items.length = SESSION_CATALOG_LIMIT - 1;
    }
    items.push({ ...active, active: true });
    return { ...sessions, items };
}

export function markActive(
  ctl: ChatControllerInternals,
    items: readonly SessionSummary[],
  ): readonly SessionSummary[] {
    return withActiveSession(ctl, {
      status: ctl.sessions.status,
      items,
    }).items;
}

export function beginCatalogLoad(
  ctl: ChatControllerInternals,
  cwd: string): number {
    const generation = ++ctl.catalogGeneration;
    ctl.catalogCwd = cwd;
    ctl.sessions = { status: 'loading', items: [] };
    refreshWorktreeAvailability(ctl, cwd);
    return generation;
}

export function bindCatalogViewToWorkspace(
  ctl: ChatControllerInternals,
  cwd: string): void {
    if (ctl.catalogCwd === cwd) {
      return;
    }
    ctl.catalogGeneration += 1;
    ctl.catalogCwd = cwd;
    ctl.sessions = { status: 'idle', items: [] };
    refreshWorktreeAvailability(ctl, cwd);
}

export function clearCatalog(ctl: ChatControllerInternals): void {
    ctl.catalogGeneration += 1;
    ctl.catalogCwd = null;
    ctl.sessions = { status: 'idle', items: [] };
    ctl.worktreeAvailabilityCwd = null;
    ctl.worktreeCreateAvailable = false;
    // No catalog, no rows to indicate; the poll loop ends itself.
    ctl.runningSessionIds.clear();
}

/**
 * Recomputes the worktree-create capability for a workspace binding.
 * One git check per cwd: the async result only lands while the
 * binding is unchanged, and a later snapshot broadcasts it.
 */
export function refreshWorktreeAvailability(
  ctl: ChatControllerInternals,
  cwd: string): void {
    const feature = ctl.worktreeSessions;
    if (
      feature?.enabled !== true ||
      ctl.worktreeAvailabilityCwd === cwd
    ) {
      return;
    }
    ctl.worktreeAvailabilityCwd = cwd;
    ctl.worktreeCreateAvailable = false;
    void feature.isGitWorkspace(cwd).then((isGit) => {
      if (
        ctl.disposed ||
        ctl.worktreeAvailabilityCwd !== cwd ||
        !isGit
      ) {
        return;
      }
      ctl.worktreeCreateAvailable = true;
      ctl.emitSnapshot();
    });
}

export function isCurrentCatalogRequest(
  ctl: ChatControllerInternals,
    generation: number,
    cwd: string,
  ): boolean {
    return (
      !ctl.disposed &&
      ctl.catalogGeneration === generation &&
      ctl.catalogCwd === cwd &&
      isTargetWorkspaceCurrent(ctl, cwd)
    );
}

export function discardCatalogRequest(
  ctl: ChatControllerInternals,
  generation: number): void {
    if (
      ctl.disposed ||
      ctl.catalogGeneration !== generation
    ) {
      return;
    }
    const workspace = ctl.getWorkspaceContext();
    ctl.catalogGeneration += 1;
    ctl.catalogCwd = isUsableWorkspace(workspace)
      ? workspace.cwd
      : null;
    ctl.sessions = { status: 'idle', items: [] };
    if (isUsableWorkspace(workspace)) {
      ctl.emitSnapshot();
    } else {
      emitWorkspaceUnavailable(ctl, workspace);
    }
}

export function touchActiveSession(ctl: ChatControllerInternals): void {
    if (ctl.sessionId === null) {
      return;
    }
    const modifiedTime = new Date().toISOString();
    ctl.sessions = {
      ...ctl.sessions,
      items: ctl.sessions.items.map((item) =>
        item.id === ctl.sessionId
          ? { ...item, modifiedTime }
          : item,
      ),
    };
}

export function projectCatalogEntries(
  entries: readonly SessionCatalogEntry[],
): SessionSummary[] {
  const items: SessionSummary[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (
      items.length >= SESSION_CATALOG_LIMIT ||
      !isSafeBridgeId(entry.id) ||
      ids.has(entry.id) ||
      !Number.isSafeInteger(entry.messageCount) ||
      entry.messageCount < 0
    ) {
      continue;
    }
    const modified = new Date(entry.modifiedTime);
    if (!Number.isFinite(modified.getTime())) {
      continue;
    }
    ids.add(entry.id);
    items.push({
      id: entry.id,
      title: sanitizeSessionTitle(entry.title, SESSION_TITLE_LIMIT),
      messageCount: entry.messageCount,
      modifiedTime: modified.toISOString(),
      active: false,
      isFavorite: entry.isFavorite === true,
      ...(entry.missionRole === undefined
        ? {}
        : { missionRole: entry.missionRole }),
    });
  }
  return items;
}