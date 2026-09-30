import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import {
  MAX_ARCHIVED_SESSION_ITEMS,
  MAX_SESSION_SEARCH_RESULTS,
} from '../../../shared/protocol/bounds';
import {
  type ArchivedSessionSummary,
  type SessionMissionSummary,
} from '../../../shared/protocol/sessions';
import type { TokenUsageBreakdown } from '../../../shared/protocol/tokenUsage';
import type { HostTranscriptState } from '../../recovery/hostTranscriptState';
import { historyWithLocalChanges } from '../../recovery/historyWithLocalChanges';
import {
  DAEMON_UNAVAILABLE_MESSAGE,
  daemonFailureMessage,
  forkTitleFromText,
  formatUnknownError,
  isSafeBridgeId,
  isUsableWorkspace,
  SESSION_OPERATION_BLOCKED_MESSAGE,
} from '../internals';
import { evaluateActiveSessionTransform } from '../operationEligibility';
import {
  activeSessionSummary,
  bindCatalogViewToWorkspace,
  clearCatalog,
  hasCatalogSession,
  loadCatalog,
  startCatalogRefresh,
  withActiveSession,
} from './sessionCatalog';
import type { SessionDirectoryPort } from './sessionDirectoryPort';

export const UNKNOWN_SESSION_MESSAGE =
  'The selected Droid session is not available in this workspace.';

export const SESSION_NEW_FAILED_MESSAGE = 'A new Droid session could not be created.';

export const WORKTREE_CREATE_UNAVAILABLE_MESSAGE =
  'Worktree sessions need the daemon runtime mode and a git workspace.';

export const RENAME_BLOCKED_MESSAGE =
  'Wait for the current session operation to finish before renaming.';

export const RENAME_UNSUPPORTED_MESSAGE = 'This session cannot be renamed.';

export const RENAME_FAILED_MESSAGE = 'Droid could not rename the session.';

export const FAVORITE_BLOCKED_MESSAGE =
  'Wait for the current session operation to finish before changing favorites.';

export const FAVORITE_UNSUPPORTED_MESSAGE =
  'Session favorites are not available in this Droid runtime.';

export const FAVORITE_FAILED_MESSAGE = 'The session favorite could not be saved.';

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

const FORK_ADOPTION_FAILED_MESSAGE =
  'The fork was created, but the chat could not switch to it. Retry to reconnect to the original session, or refresh History to open the fork.';

export function handleSessionNew(ctl: SessionDirectoryPort): void {
  const workspace = ctl.getWorkspaceContext();
  if (!ctl.effects.canReplaceSession() || !isUsableWorkspace(workspace)) {
    if (!isUsableWorkspace(workspace)) {
      ctl.effects.emitWorkspaceUnavailable(workspace);
    }
    return;
  }
  bindCatalogViewToWorkspace(ctl, workspace.cwd);
  ctl.effects.startReplacement({ kind: 'new', cwd: workspace.cwd });
}

export function handleWorktreeCreateSession(ctl: SessionDirectoryPort): void {
  const workspace = ctl.getWorkspaceContext();
  if (!ctl.effects.canReplaceSession() || !isUsableWorkspace(workspace)) {
    if (!isUsableWorkspace(workspace)) {
      ctl.effects.emitWorkspaceUnavailable(workspace);
    }
    return;
  }
  // The drawer entry never renders without the advertised
  // capability, so a request without it is stale or hostile. Fail
  // closed with a diagnostic instead of degrading to a plain
  // in-workspace session.
  if (
    ctl.worktreeSessions?.enabled !== true ||
    !ctl.catalogState.worktreeCreateAvailable
  ) {
    ctl.emitSessionDiagnostic(
      'worktree-create-unavailable',
      WORKTREE_CREATE_UNAVAILABLE_MESSAGE,
    );
    return;
  }
  bindCatalogViewToWorkspace(ctl, workspace.cwd);
  ctl.effects.startReplacement({
    kind: 'new',
    cwd: workspace.cwd,
    worktree: true,
  });
}

export function handleSessionRename(
  ctl: SessionDirectoryPort,
  sessionId: string,
  title: string,
): void {
  const runtime = ctl.sessionState.runtime;
  if (runtime !== null && !ctl.effects.ensureActiveRuntimeWorkspaceCurrent()) {
    return;
  }
  const trimmedTitle = title.trim();
  if (
    runtime === null ||
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId ||
    trimmedTitle.length === 0
  ) {
    return;
  }
  if (ctl.sessionState.sessionOperationInProgress || ctl.catalogState.refreshInProgress) {
    ctl.emitSessionDiagnostic('session-rename-blocked', RENAME_BLOCKED_MESSAGE);
    return;
  }
  if (typeof runtime.rename !== 'function') {
    ctl.emitSessionDiagnostic('session-rename-unsupported', RENAME_UNSUPPORTED_MESSAGE);
    return;
  }

  const generation = ctl.sessionState.runtimeGeneration;
  const cwd = ctl.sessionState.activeRuntimeCwd;
  if (cwd === null) {
    return;
  }
  void runtime.rename(trimmedTitle).then(
    () => {
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        return;
      }
      ctl.catalogState.sessions = {
        ...ctl.catalogState.sessions,
        items: ctl.catalogState.sessions.items.map((item) =>
          item.id === sessionId ? { ...item, title: trimmedTitle } : item,
        ),
      };
      ctl.emitSnapshot();
    },
    () => {
      if (ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        ctl.emitSessionDiagnostic('session-rename-failed', RENAME_FAILED_MESSAGE);
      }
    },
  );
}

export function handleSessionFavorite(
  ctl: SessionDirectoryPort,
  sessionId: string,
  favorite: boolean,
): void {
  const workspace = ctl.getWorkspaceContext();
  if (!isUsableWorkspace(workspace)) {
    return;
  }
  if (ctl.sessionState.sessionOperationInProgress || ctl.catalogState.refreshInProgress) {
    ctl.emitSessionDiagnostic('session-favorite-blocked', FAVORITE_BLOCKED_MESSAGE);
    return;
  }
  if (
    ctl.catalogState.sessions.status !== 'ready' ||
    !hasCatalogSession(ctl, sessionId, workspace.cwd)
  ) {
    ctl.emitSessionDiagnostic('session-favorite-invalid', UNKNOWN_SESSION_MESSAGE);
    return;
  }
  const writeFavorite = ctl.sessionCatalog.writeFavorite?.bind(ctl.sessionCatalog);
  if (writeFavorite === undefined) {
    ctl.emitSessionDiagnostic(
      'session-favorite-unsupported',
      FAVORITE_UNSUPPORTED_MESSAGE,
    );
    return;
  }

  // Blocks concurrent catalog reads/writes for the duration of the
  // file write and the follow-up re-list.
  ctl.catalogState.refreshInProgress = true;
  void (async () => {
    let written = false;
    try {
      written = await writeFavorite(sessionId, favorite);
    } catch {
      written = false;
    }
    if (ctl.sessionState.disposed) {
      return;
    }
    if (!written) {
      ctl.catalogState.refreshInProgress = false;
      ctl.emitSessionDiagnostic('session-favorite-failed', FAVORITE_FAILED_MESSAGE);
      return;
    }

    // Close the loop through the public listSessions() readback so
    // the drawer shows what the SDK actually reports.
    const previousActive = activeSessionSummary(ctl);
    const catalogGeneration = ctl.catalogState.catalogGeneration;
    const result = await loadCatalog(ctl, workspace.cwd);
    ctl.catalogState.refreshInProgress = false;
    if (
      ctl.sessionState.disposed ||
      ctl.catalogState.catalogGeneration !== catalogGeneration ||
      ctl.catalogState.catalogCwd !== workspace.cwd ||
      !ctl.effects.isTargetWorkspaceCurrent(workspace.cwd)
    ) {
      return;
    }
    if (result.status === 'ready') {
      ctl.catalogState.sessions = withActiveSession(ctl, result, previousActive);
      ctl.effects.seedBackgroundRunning(workspace.cwd);
    } else {
      // The write succeeded but the re-list failed; reflect the
      // write locally so the toggle does not look ignored.
      ctl.catalogState.sessions = {
        ...ctl.catalogState.sessions,
        items: ctl.catalogState.sessions.items.map((item) =>
          item.id === sessionId ? { ...item, isFavorite: favorite } : item,
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
export function handleSessionArchive(ctl: SessionDirectoryPort, sessionId: string): void {
  const workspace = ctl.getWorkspaceContext();
  if (!isUsableWorkspace(workspace)) {
    return;
  }
  if (ctl.sessionState.sessionOperationInProgress || ctl.catalogState.refreshInProgress) {
    ctl.emitSessionDiagnostic('session-archive-blocked', ARCHIVE_BLOCKED_MESSAGE);
    return;
  }
  if (
    ctl.catalogState.sessions.status !== 'ready' ||
    !hasCatalogSession(ctl, sessionId, workspace.cwd)
  ) {
    ctl.emitSessionDiagnostic('session-archive-invalid', UNKNOWN_SESSION_MESSAGE);
    return;
  }
  if (sessionId === ctl.sessionState.sessionId) {
    ctl.emitSessionDiagnostic('session-archive-active', ARCHIVE_ACTIVE_MESSAGE);
    return;
  }
  const daemonSessions = ctl.daemonSessions;
  if (daemonSessions === undefined) {
    ctl.emitSessionDiagnostic('session-archive-unsupported', DAEMON_UNSUPPORTED_MESSAGE);
    return;
  }

  ctl.catalogState.refreshInProgress = true;
  void (async () => {
    let archived = false;
    let failure = ARCHIVE_FAILED_MESSAGE;
    try {
      archived = await (await daemonSessions()).archive(sessionId);
    } catch (error) {
      failure = daemonFailureMessage(error, ARCHIVE_FAILED_MESSAGE);
    }
    if (ctl.sessionState.disposed) {
      return;
    }
    if (!archived) {
      ctl.catalogState.refreshInProgress = false;
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
  ctl: SessionDirectoryPort,
  sessionId: string,
): void {
  const workspace = ctl.getWorkspaceContext();
  if (!isUsableWorkspace(workspace)) {
    return;
  }
  if (ctl.sessionState.sessionOperationInProgress || ctl.catalogState.refreshInProgress) {
    ctl.emitSessionDiagnostic('session-unarchive-blocked', ARCHIVE_BLOCKED_MESSAGE);
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

  ctl.catalogState.refreshInProgress = true;
  void (async () => {
    let restored = false;
    let failure = UNARCHIVE_FAILED_MESSAGE;
    try {
      restored = await (await daemonSessions()).unarchive(sessionId);
    } catch (error) {
      failure = daemonFailureMessage(error, UNARCHIVE_FAILED_MESSAGE);
    }
    if (ctl.sessionState.disposed) {
      return;
    }
    if (!restored) {
      ctl.catalogState.refreshInProgress = false;
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
  ctl: SessionDirectoryPort,
  cwd: string,
): Promise<void> {
  const previousActive = activeSessionSummary(ctl);
  const catalogGeneration = ctl.catalogState.catalogGeneration;
  const result = await loadCatalog(ctl, cwd);
  ctl.catalogState.refreshInProgress = false;
  if (ctl.sessionState.disposed) {
    return;
  }
  if (
    ctl.catalogState.catalogGeneration === catalogGeneration &&
    ctl.catalogState.catalogCwd === cwd &&
    ctl.effects.isTargetWorkspaceCurrent(cwd) &&
    result.status === 'ready'
  ) {
    ctl.catalogState.sessions = withActiveSession(ctl, result, previousActive);
    ctl.effects.seedBackgroundRunning(cwd);
    ctl.emitSnapshot();
  }
  await refreshArchived(ctl, cwd);
}

export function handleArchivedRefresh(ctl: SessionDirectoryPort): void {
  const workspace = ctl.getWorkspaceContext();
  if (!isUsableWorkspace(workspace)) {
    return;
  }
  void refreshArchived(ctl, workspace.cwd);
}

export async function refreshArchived(
  ctl: SessionDirectoryPort,
  cwd: string,
): Promise<void> {
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
    ctl.recordPanelFailure('archived-load-failed', formatUnknownError(error));
    if (!ctl.sessionState.disposed) {
      ctl.emit({
        type: 'session.archived',
        archived: {
          status: 'error',
          items: [],
          message: daemonFailureMessage(error, DAEMON_UNAVAILABLE_MESSAGE),
        },
      });
    }
    return;
  }
  if (ctl.sessionState.disposed || !ctl.effects.isTargetWorkspaceCurrent(cwd)) {
    return;
  }
  ctl.emit({
    type: 'session.archived',
    archived: { status: 'ready', items },
  });
}

export function handleSessionSearch(ctl: SessionDirectoryPort, query: string): void {
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
      const matches = (await (await daemonSessions()).search(query)).slice(
        0,
        MAX_SESSION_SEARCH_RESULTS,
      );
      if (ctl.sessionState.disposed) {
        return;
      }
      ctl.emit({
        type: 'session.searchResults',
        search: { status: 'ready', query, items: matches },
      });
    } catch (error) {
      if (ctl.sessionState.disposed) {
        return;
      }
      ctl.emit({
        type: 'session.searchResults',
        search: {
          status: 'error',
          query,
          items: [],
          message: daemonFailureMessage(error, DAEMON_UNAVAILABLE_MESSAGE),
        },
      });
    }
  })();
}

export function handleSessionSelect(ctl: SessionDirectoryPort, sessionId: string): void {
  const workspace = ctl.getWorkspaceContext();
  if (!isUsableWorkspace(workspace)) {
    clearCatalog(ctl);
    ctl.effects.emitWorkspaceUnavailable(workspace);
    return;
  }
  if (!ctl.effects.canReplaceSession()) {
    return;
  }
  if (ctl.catalogState.catalogCwd !== workspace.cwd) {
    ctl.emitSessionDiagnostic('session-selection-invalid', UNKNOWN_SESSION_MESSAGE);
    startCatalogRefresh(ctl, workspace.cwd);
    return;
  }
  const conversationId = ctl.recoveryStore.resolveConversationId(sessionId);
  const targetSessionId =
    conversationId === undefined
      ? sessionId
      : (ctl.recoveryStore.readConversation(conversationId)?.activeSessionId ??
        sessionId);
  if (
    ctl.catalogState.sessions.status !== 'ready' ||
    !hasCatalogSession(ctl, targetSessionId, workspace.cwd)
  ) {
    ctl.emitSessionDiagnostic('session-selection-invalid', UNKNOWN_SESSION_MESSAGE);
    return;
  }
  if (
    targetSessionId === ctl.sessionState.sessionId &&
    ctl.sessionState.activeRuntimeCwd === workspace.cwd
  ) {
    ctl.emitSnapshot();
    return;
  }
  ctl.effects.startReplacement({
    kind: 'resume',
    cwd: workspace.cwd,
    sessionId: targetSessionId,
  });
}

export function handleRefresh(ctl: SessionDirectoryPort): void {
  if (
    ctl.sessionState.connection.status === 'connecting' ||
    ctl.catalogState.refreshInProgress ||
    ctl.sessionState.sessionOperationInProgress
  ) {
    ctl.emitSessionDiagnostic(
      'session-operation-blocked',
      SESSION_OPERATION_BLOCKED_MESSAGE,
    );
    return;
  }
  const workspace = ctl.getWorkspaceContext();
  if (!isUsableWorkspace(workspace)) {
    ctl.effects.emitWorkspaceUnavailable(workspace);
    return;
  }

  startCatalogRefresh(ctl, workspace.cwd);
}

export function handleSessionFork(ctl: SessionDirectoryPort, sessionId: string): void {
  const runtime = ctl.sessionState.runtime;
  if (runtime !== null && !ctl.effects.ensureActiveRuntimeWorkspaceCurrent()) {
    return;
  }
  if (
    runtime === null ||
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  if (
    evaluateActiveSessionTransform({
      turn: ctl.turnState.turn,
      hasPendingInteractions: ctl.interactions.hasPending(),
      sessionOperationInProgress: ctl.sessionState.sessionOperationInProgress,
      refreshInProgress: ctl.catalogState.refreshInProgress,
      settingsUpdateInProgress: ctl.metadata.settingsUpdate !== null,
    }).kind !== 'eligible'
  ) {
    ctl.emitSessionDiagnostic('session-fork-blocked', FORK_BLOCKED_MESSAGE);
    return;
  }
  if (typeof runtime.fork !== 'function') {
    ctl.emitSessionDiagnostic('session-fork-unsupported', FORK_UNSUPPORTED_MESSAGE);
    return;
  }

  ctl.sessionState.sessionOperationInProgress = true;
  void performFork(ctl, runtime, sessionId).finally(() => {
    ctl.sessionState.sessionOperationInProgress = false;
  });
}

/**
 * Forks the active session and adopts the copy that Droid returns.
 * The original session stays in the catalog so the user can go back
 * to it; the current transcript carries over unchanged.
 */
export async function performFork(
  ctl: SessionDirectoryPort,
  runtime: DroidRuntime,
  sessionId: string,
): Promise<void> {
  const generation = ctl.sessionState.runtimeGeneration;
  const cwd = ctl.sessionState.activeRuntimeCwd;
  if (cwd === null) {
    return;
  }
  const sourceConversationId = ctl.sessionState.conversationId;
  if (sourceConversationId === null) {
    ctl.emitSessionDiagnostic('session-fork-failed', FORK_FAILED_MESSAGE);
    return;
  }

  const previousTitle = activeSessionSummary(ctl)?.title ?? 'Current session';
  const forkTitle = forkTitleFromText(`${previousTitle} (fork)`);

  let forkedSessionId: string;
  try {
    const result = await runtime.fork!(forkTitle);
    forkedSessionId = result.sessionId;
  } catch {
    if (ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
      ctl.emitSessionDiagnostic('session-fork-failed', FORK_FAILED_MESSAGE);
    }
    return;
  }
  if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
    return;
  }
  if (!isSafeBridgeId(forkedSessionId) || forkedSessionId === sessionId) {
    ctl.emitSessionDiagnostic('session-fork-failed', FORK_FAILED_MESSAGE);
    return;
  }

  const forkedConversationId = await ctl.effects.createDurableForkConversation(
    sourceConversationId,
    sessionId,
    forkedSessionId,
    'fork',
    ctl.recoveryState.transcript,
  );
  if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
    return;
  }
  if (forkedConversationId === null) {
    // Runtime already adopted the fork. Do not let another send use the old
    // Host identity until an explicit reconnect restores a matching binding.
    ctl.sessionState.connection = { status: 'unavailable', message: FORK_ADOPTION_FAILED_MESSAGE };
    ctl.emitSessionDiagnostic('session-fork-failed', FORK_ADOPTION_FAILED_MESSAGE);
    ctl.emitSnapshot();
    return;
  }

  // Unlike compaction, the forked-from session remains valid and
  // stays in the catalog; only the active marker moves to the fork.
  ctl.sessionState.conversationId = forkedConversationId;
  ctl.sessionState.sessionId = forkedSessionId;
  ctl.turnState.turn = null;
  ctl.effects.clearPendingAttachments();
  ctl.catalogState.sessions = withActiveSession(ctl, ctl.catalogState.sessions, {
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
    const loaded = await ctl.effects.loadHistoryTimed(cwd, forkedSessionId);
    if (loaded?.status === 'available') {
      transcript = historyWithLocalChanges(loaded.state,
        ctl.recoveryStore.readConversation(forkedConversationId));
      mission = loaded.mission ?? null;
      tokenUsage = loaded.tokenUsage ?? null;
    }
  }
  if (!ctl.isCurrentSessionOperation(runtime, generation, forkedSessionId, cwd)) {
    return;
  }
  ctl.missionState.mission = mission;
  // The fork is a new session; its counters restart.
  ctl.metadata.tokenUsage = { cumulative: tokenUsage, lastTurn: null };
  ctl.recoveryState.transcript = transcript ?? {
    ...ctl.recoveryState.transcript,
    historyStatus: 'partial',
  };
  ctl.recoveryStore.writeActiveDisplay(
    forkedConversationId,
    forkedSessionId,
    ctl.recoveryState.transcript,
    null,
  );
  const checkpointSaved = await ctl.effects.flushRecoveryCheckpointOrReport();
  if (!ctl.isCurrentSessionOperation(runtime, generation, forkedSessionId, cwd)) return;
  if (!checkpointSaved) {
    ctl.sessionState.connection = {
      status: 'unavailable',
      message: 'The fork is active, but its chat state could not be saved. Retry to reconnect to the fork.',
    };
    ctl.emitSnapshot();
    return;
  }
  ctl.effects.armReplayedSubagentWatch(forkedSessionId, cwd, ctl.recoveryState.transcript);
  ctl.emitSnapshot();
  ctl.emit({
    type: 'runtime.diagnostic',
    sessionId: forkedSessionId,
    turnId: null,
    severity: 'info',
    code: 'session-forked',
    message: 'Session forked. You are now on the copy.',
  });
  ctl.effects.refreshContextAfterTurn(forkedSessionId);
}

export {
  activeSessionSummary,
  beginCatalogLoad,
  bindCatalogViewToWorkspace,
  CATALOG_ERROR_MESSAGE,
  clearCatalog,
  discardCatalogRequest,
  hasCatalogSession,
  isCurrentCatalogRequest,
  loadCatalog,
  markActive,
  refreshCatalog,
  refreshWorktreeAvailability,
  startCatalogRefresh,
  touchActiveSession,
  withActiveSession,
} from './sessionCatalog';
