// runtimeLifecycle: moved verbatim from ChatController.ts (structure-only
// refactor; bodies unchanged except mechanical this. -> ctl.).
import type {
  DroidRuntime,
  RuntimeSessionTarget,
} from '../../runtime/DroidRuntime';
import type { RuntimeAvailability } from '../../runtime/runtimeEvents';
import type { SessionHistoryLoader } from '../../runtime/history/SessionHistory';
import {
  createHostTranscriptState,
  type HostTranscriptState,
} from '../hostTranscriptState';
import { EMPTY_SESSION_TOKEN_USAGE } from '../../shared/tokenUsage';
import { reconcileSessionHistory } from '../reconcileSessionHistory';
import { recordCreatedWorktreeSession } from '../worktreeSessions';
import type { WorkspaceContext } from '../ChatController';
import { discardQueuedPrompts, restoreQueuedPrompts } from './queue';
import { clearPendingAttachments } from './attachments';
import {
  beginCatalogLoad,
  clearCatalog,
  discardCatalogRequest,
  hasCatalogSession,
  isCurrentCatalogRequest,
  loadCatalog,
  SESSION_NEW_FAILED_MESSAGE,
  withActiveSession,
} from './sessionDirectory';
import {
  ensureBackgroundRunningPoll,
  seedBackgroundRunning,
  setSessionRunning,
} from './sessionRunning';
import {
  emitEarlyRecoverySnapshot,
  flushRecoveryCheckpoint,
  reconcileDaemonTurn,
  recoveryTurnId,
} from './recovery';
import { armReplayedSubagentWatch } from './subagentWatch';
import {
  createSessionSwitchTimings,
  elapsedMs,
  type SessionSwitchTimings,
} from './sessionSwitchTimings';
import {
  loadSessionMetadata,
  markSessionSwitchReady,
} from './sessionMetadata';
import {
  formatUnknownError,
  isSafeBridgeId,
  isTurnActive,
  isUsableWorkspace,
  SESSION_OPERATION_BLOCKED_MESSAGE,
  type ChatControllerInternals,
} from './internals';
import { recoverMissionProjection } from './mission/recovery';

export const SESSION_CLOSE_FAILED_MESSAGE =
  'The current Droid session could not be closed.';

export const SESSION_RESUME_FAILED_MESSAGE =
  'The selected Droid session could not be opened.';

export const WORKSPACE_CHANGED_MESSAGE =
  'The workspace changed before the Droid session could be opened.';

export async function startup(ctl: ChatControllerInternals): Promise<void> {
    let recoveryLoaded = false;
    while (!ctl.disposed) {
      const workspace = ctl.getWorkspaceContext();
      if (!isUsableWorkspace(workspace)) {
        clearCatalog(ctl);
        emitWorkspaceUnavailable(ctl, workspace);
        return;
      }

      ctl.connection = { status: 'connecting' };
      const catalogRequest = beginCatalogLoad(ctl, workspace.cwd);
      const catalogPromise = loadCatalog(ctl, workspace.cwd);
      if (!recoveryLoaded) {
        await ctl.recoveryStore.load();
        recoveryLoaded = true;
        if (ctl.disposed) {
          return;
        }
        emitEarlyRecoverySnapshot(ctl);
      }
      const catalog = await catalogPromise;
      if (ctl.disposed) {
        return;
      }
      if (!isCurrentCatalogRequest(ctl, catalogRequest, workspace.cwd)) {
        discardCatalogRequest(ctl, catalogRequest);
        continue;
      }
      ctl.sessions = catalog;
      seedBackgroundRunning(ctl, workspace.cwd);

      const selectedSessionId =
        ctl.recoveryStore.getSelectedSessionId();
      const resumable =
        selectedSessionId !== null &&
        hasCatalogSession(ctl, selectedSessionId, workspace.cwd);
      const target: RuntimeSessionTarget = resumable
        ? {
            kind: 'resume',
            cwd: workspace.cwd,
            sessionId: selectedSessionId,
          }
        : { kind: 'new', cwd: workspace.cwd };
      await activateInitialRuntime(ctl, 
        target,
        resumable ? selectedSessionId : null,
      );
      if (isTargetWorkspaceCurrent(ctl, workspace.cwd)) {
        return;
      }
    }
}

export async function handleReady(ctl: ChatControllerInternals): Promise<void> {
    if (ctl.initialization) {
      await ctl.initialization;
      await waitForWorkspaceTransition(ctl);
      if (ctl.disposed) {
        return;
      }
      if (!ensureActiveRuntimeWorkspaceCurrent(ctl)) {
        return;
      }
      ctl.emitSnapshot();
      ctl.interactions.replayPending();
      return;
    }

    ctl.initialization = startup(ctl);
    await ctl.initialization;
}

export function canReplaceSession(ctl: ChatControllerInternals): boolean {
    // A running daemon-backed turn no longer blocks switching:
    // replaceRuntime detaches it and the turn continues on the daemon
    // (the drawer row then carries the quiet running indicator). A
    // process-mode turn still blocks — disposal would kill it. An
    // unanswered interaction always blocks: it must be settled first.
    const turnBlocks =
      isTurnActive(ctl.turn) &&
      ctl.runtime?.supportsBackgroundTurns?.() !== true;
    if (
      turnBlocks ||
      ctl.interactions.hasPending() ||
      ctl.connection.status === 'connecting' ||
      ctl.sessionOperationInProgress ||
      ctl.refreshInProgress ||
      ctl.settingsUpdate !== null
    ) {
      ctl.emitSessionDiagnostic(
        'session-operation-blocked',
        SESSION_OPERATION_BLOCKED_MESSAGE,
      );
      return false;
    }
    return true;
}

export function startReplacement(
  ctl: ChatControllerInternals,
  target: RuntimeSessionTarget): void {
    ctl.sessionOperationInProgress = true;
    ctl.connection = { status: 'connecting' };
    ctl.emitSnapshot();
    void replaceRuntime(ctl, target).finally(() => {
      ctl.sessionOperationInProgress = false;
    });
}

export async function replaceRuntime(
  ctl: ChatControllerInternals,
    target: RuntimeSessionTarget,
  ): Promise<void> {
    const phases = createSessionSwitchTimings(target.kind);
    // Captured before any state reset: a live daemon-backed turn
    // survives the switch. Disposal then detaches instead of
    // interrupting, and the old session's drawer row keeps a running
    // indicator until the daemon reports it idle.
    const detachedSessionId =
      ctl.runtime !== null &&
      isTurnActive(ctl.turn) &&
      ctl.runtime.supportsBackgroundTurns?.() === true
        ? ctl.sessionId
        : null;
    const generation = ++ctl.runtimeGeneration;
    ctl.turnGeneration += 1;
    resetSessionMetadata(ctl);
    ctl.interactions.cancelAll();
    await flushRecoveryCheckpoint(ctl);
    if (!isCurrentRuntimeGeneration(ctl, generation)) {
      return;
    }
    if (!isTargetWorkspaceCurrent(ctl, target.cwd)) {
      reportWorkspaceChanged(ctl, generation);
      return;
    }

    const previousRuntime = ctl.runtime;
    if (previousRuntime) {
      try {
        await closeRuntime(ctl, 
          previousRuntime,
          detachedSessionId !== null,
        );
      } catch {
        if (
          isCurrentRuntimeGeneration(ctl, generation) &&
          isTargetWorkspaceCurrent(ctl, target.cwd)
        ) {
          ctl.connection = {
            status: 'unavailable',
            message: SESSION_CLOSE_FAILED_MESSAGE,
          };
          ctl.emitSessionDiagnostic(
            'session-close-failed',
            SESSION_CLOSE_FAILED_MESSAGE,
          );
          ctl.emitSnapshot();
        } else if (isCurrentRuntimeGeneration(ctl, generation)) {
          reportWorkspaceChanged(ctl, generation);
        }
        return;
      }
      if (!isCurrentRuntimeGeneration(ctl, generation)) {
        return;
      }
      if (ctl.runtime === previousRuntime) {
        ctl.runtime = null;
      }
      if (detachedSessionId !== null) {
        // The turn now runs unattended on the daemon: drop the local
        // projection without a terminal turn.state (the turn did not
        // end) and flag the row for the background watcher.
        ctl.turn = null;
        ctl.diagnostics?.endTurnScope?.();
        setSessionRunning(ctl, detachedSessionId, true);
        ensureBackgroundRunningPoll(ctl);
      }
      if (!isTargetWorkspaceCurrent(ctl, target.cwd)) {
        reportWorkspaceChanged(ctl, generation);
        return;
      }
    }

    // Checkpoint-first paint (bug #37): a resumed session's recovered
    // checkpoint renders immediately while the slow history load and
    // runtime activation run. The connection stays `connecting`, which
    // keeps every mutating handler rejected until the authoritative
    // activation snapshot replaces this one in place.
    if (target.kind === 'resume') {
      const checkpoint = ctl.recoveryStore.readSession(
        target.sessionId,
      );
      if (
        checkpoint !== undefined &&
        checkpoint.transcript.length > 0
      ) {
        ctl.sessionId = target.sessionId;
        ctl.transcript = checkpoint;
        ctl.turn = null;
        ctl.mission = null;
        ctl.tokenUsage = EMPTY_SESSION_TOKEN_USAGE;
        ctl.sessions = withActiveSession(ctl, ctl.sessions);
        ctl.recordHost({
          level: 'info',
          name: 'host.perf.early-snapshot',
          attributes: {
            sessionId: target.sessionId,
            items: checkpoint.transcript.length,
            phase: 'switch',
          },
        });
        ctl.emitSnapshot();
      }
    }

    // The transcript projection and the runtime resume each spawn their
    // own droid CLI process and stay independent until activateRuntime
    // consumes both; running them serially doubled session-switch
    // latency (9-12s observed). Neither branch throws: both funnel
    // failures into their return values.
    const [transcript, activation] = await Promise.all([
      prepareActivationTranscript(
        ctl,
        target,
        generation,
        phases,
      ),
      createInitializedRuntime(ctl, target, generation, phases),
    ]);
    if (
      transcript === null ||
      !isCurrentRuntimeGeneration(ctl, generation) ||
      !isTargetWorkspaceCurrent(ctl, target.cwd)
    ) {
      // A stale switch can still hold a live runtime when the
      // invalidation landed after createInitializedRuntime's own
      // staleness checks had already passed.
      if (activation !== null && activation.status === 'available') {
        await closeRuntime(ctl, activation.runtime).catch(
          () => undefined,
        );
      }
      if (
        isCurrentRuntimeGeneration(ctl, generation) &&
        !isTargetWorkspaceCurrent(ctl, target.cwd)
      ) {
        reportWorkspaceChanged(ctl, generation);
      }
      return;
    }
    if (activation === null) {
      return;
    }
    if (activation.status === 'failed') {
      ctl.connection = {
        status: 'unavailable',
        message:
          target.kind === 'resume'
            ? SESSION_RESUME_FAILED_MESSAGE
            : SESSION_NEW_FAILED_MESSAGE,
      };
      ctl.emitSessionDiagnostic(
        target.kind === 'resume'
          ? 'session-resume-failed'
          : 'session-new-failed',
        ctl.connection.message!,
      );
      ctl.emitSnapshot();
      return;
    }

    if (!isTargetWorkspaceCurrent(ctl, target.cwd)) {
      await closeRuntime(ctl, activation.runtime).catch(() => undefined);
      reportWorkspaceChanged(ctl, generation);
      return;
    }
    await activateRuntime(ctl, 
      target,
      activation.runtime,
      activation.id,
      generation,
      transcript,
      phases,
    );
    markSessionSwitchReady(ctl, phases);
}

export async function activateInitialRuntime(
  ctl: ChatControllerInternals,
    target: RuntimeSessionTarget,
    failedResumeId: string | null,
  ): Promise<void> {
    const generation = ++ctl.runtimeGeneration;
    // Same parallel activation as replaceRuntime: history projection
    // and runtime resume are independent droid CLI processes.
    const [transcript, activation] = await Promise.all([
      prepareActivationTranscript(ctl, target, generation),
      createInitializedRuntime(ctl, target, generation),
    ]);
    if (
      transcript === null ||
      !isCurrentRuntimeGeneration(ctl, generation) ||
      !isTargetWorkspaceCurrent(ctl, target.cwd)
    ) {
      if (activation !== null && activation.status === 'available') {
        await closeRuntime(ctl, activation.runtime).catch(
          () => undefined,
        );
      }
      return;
    }
    if (activation === null) {
      return;
    }
    if (activation.status === 'failed') {
      if (failedResumeId) {
        ctl.sessionId = failedResumeId;
        ctl.transcript =
          ctl.recoveryStore.readSession(failedResumeId) ??
          createHostTranscriptState('unavailable');
        ctl.sessions = withActiveSession(ctl, ctl.sessions);
      } else {
        ctl.sessionId = null;
        ctl.mission = null;
        ctl.tokenUsage = EMPTY_SESSION_TOKEN_USAGE;
        ctl.transcript = createHostTranscriptState('unavailable');
      }
      ctl.connection = {
        status: 'unavailable',
        message: activation.message,
      };
      ctl.emitSnapshot();
      return;
    }
    if (!isTargetWorkspaceCurrent(ctl, target.cwd)) {
      await closeRuntime(ctl, activation.runtime).catch(() => undefined);
      return;
    }
    await activateRuntime(ctl, 
      target,
      activation.runtime,
      activation.id,
      generation,
      transcript,
    );
}

export async function prepareActivationTranscript(
  ctl: ChatControllerInternals,
    target: RuntimeSessionTarget,
    generation: number,
    phases?: SessionSwitchTimings,
  ): Promise<HostTranscriptState | null> {
    if (target.kind === 'new') {
      ctl.mission = null;
      ctl.tokenUsage = EMPTY_SESSION_TOKEN_USAGE;
      return createHostTranscriptState('complete');
    }

    const recovered = ctl.recoveryStore.readSession(target.sessionId);
    const historyStartedAt = performance.now();
    const loaded = await loadHistoryTimed(
      ctl,
      target.cwd,
      target.sessionId,
    );
    if (phases !== undefined) {
      phases.historyMs = elapsedMs(historyStartedAt);
    }
    if (
      !isCurrentRuntimeGeneration(ctl, generation) ||
      !isTargetWorkspaceCurrent(ctl, target.cwd)
    ) {
      return null;
    }
    ctl.mission =
      loaded?.status === 'available' ? (loaded.mission ?? null) : null;
    // Cumulative usage persists in the session file; `lastTurn` does
    // not (history carries no per-turn usage), so it starts null.
    ctl.tokenUsage = {
      cumulative:
        loaded?.status === 'available'
          ? (loaded.tokenUsage ?? null)
          : null,
      lastTurn: null,
    };
    if (loaded?.status === 'available') {
      const reconcileStart = performance.now();
      const reconciled = reconcileSessionHistory(
        loaded.state,
        recovered,
        { authoritativeLoaded: true },
      );
      // Recovery reconciliation accounting (P7): a merge that degrades
      // to concatenation (reconciled ≈ recovered + loaded) is the
      // signature of the duplicate-transcript / duplicate-toolUseId
      // class of bugs.
      ctl.recordHost({
        level: 'info',
        name: 'host.perf.recovery',
        attributes: {
          sessionId: target.sessionId,
          recovered: recovered?.transcript.length ?? 0,
          loaded: loaded.state.transcript.length,
          reconciled: reconciled.transcript.length,
          reconcileMs: Math.round(
            performance.now() - reconcileStart,
          ),
        },
      });
      return reconciled;
    }
    return recovered ?? createHostTranscriptState('unavailable');
}

/** Timed history load with a structured log record (P6). */
export async function loadHistoryTimed(
  ctl: ChatControllerInternals,
    cwd: string,
    sessionId: string,
  ): Promise<Awaited<
    ReturnType<SessionHistoryLoader['loadHistory']>
  > | null> {
    const startedAt = performance.now();
    try {
      const loaded = await ctl.sessionHistory.loadHistory({
        cwd,
        sessionId,
      });
      ctl.recordHost({
        level: 'info',
        name: 'runtime.history.finished',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: loaded.status,
          sessionId,
          ...(loaded.status === 'available'
            ? {
                items: loaded.state.transcript.length,
                historyStatus: loaded.state.historyStatus,
              }
            : {}),
        },
      });
      return loaded;
    } catch (error) {
      ctl.recordHost({
        level: 'error',
        name: 'runtime.history.finished',
        attributes: {
          durationMs: Math.round(performance.now() - startedAt),
          outcome: 'failed',
          sessionId,
        },
        detail: formatUnknownError(error),
      });
      return null;
    }
}

export async function createInitializedRuntime(
  ctl: ChatControllerInternals,
    target: RuntimeSessionTarget,
    generation: number,
    phases?: SessionSwitchTimings,
  ): Promise<
    | {
        readonly status: 'available';
        readonly runtime: DroidRuntime;
        readonly id: string;
      }
    | { readonly status: 'failed'; readonly message: string }
    | null
  > {
    let runtime: DroidRuntime;
    try {
      runtime = ctl.createRuntime(
        ctl.interactions.createRuntimeHandler(),
      );
    } catch {
      return {
        status: 'failed',
        message: 'The local Droid runtime could not be created.',
      };
    }
    ctl.managedRuntimes.add(runtime);
    // A daemon resume replays permission/ask-user requests that were
    // pending when the previous window died. Without an active
    // interaction context the coordinator would answer them with an
    // automatic cancel, killing the daemon-side turn. The synthesized
    // recovery turn holds them until reload reconciliation
    // (reconcileDaemonTurn) decides whether the turn is still live.
    const releaseRecoveryContext = (): void => {
      if (target.kind === 'resume') {
        ctl.interactions.endTurn(
          target.sessionId,
          recoveryTurnId(generation),
        );
      }
    };
    if (target.kind === 'resume') {
      ctl.interactions.beginTurn(
        target.sessionId,
        recoveryTurnId(generation),
      );
    }

    let availability: RuntimeAvailability;
    const initializeStartedAt = performance.now();
    try {
      availability = await runtime.initialize(target);
    } catch {
      if (phases !== undefined) {
        phases.initializeMs = elapsedMs(initializeStartedAt);
      }
      releaseRecoveryContext();
      await closeRuntime(ctl, runtime).catch(() => undefined);
      return isCurrentRuntimeGeneration(ctl, generation) &&
        isTargetWorkspaceCurrent(ctl, target.cwd)
        ? {
            status: 'failed',
            message: 'The local Droid runtime could not be initialized.',
          }
        : null;
    }
    if (phases !== undefined) {
      phases.initializeMs = elapsedMs(initializeStartedAt);
    }

    if (
      !isCurrentRuntimeGeneration(ctl, generation) ||
      !isTargetWorkspaceCurrent(ctl, target.cwd)
    ) {
      releaseRecoveryContext();
      await closeRuntime(ctl, runtime).catch(() => undefined);
      return null;
    }
    if (
      availability.status === 'unavailable' ||
      !isSafeBridgeId(availability.sessionId) ||
      (target.kind === 'resume' &&
        availability.sessionId !== target.sessionId)
    ) {
      releaseRecoveryContext();
      await closeRuntime(ctl, runtime).catch(() => undefined);
      if (
        !isCurrentRuntimeGeneration(ctl, generation) ||
        !isTargetWorkspaceCurrent(ctl, target.cwd)
      ) {
        return null;
      }
      return {
        status: 'failed',
        message:
          availability.status === 'unavailable'
            ? unavailableMessage(availability.reason)
            : target.kind === 'resume'
              ? SESSION_RESUME_FAILED_MESSAGE
              : SESSION_NEW_FAILED_MESSAGE,
      };
    }

    return {
      status: 'available',
      runtime,
      id: availability.sessionId,
    };
}

export async function activateRuntime(
  ctl: ChatControllerInternals,
    target: RuntimeSessionTarget,
    runtime: DroidRuntime,
    sessionId: string,
    generation: number,
    transcript: HostTranscriptState,
    phases?: SessionSwitchTimings,
  ): Promise<void> {
    if (
      !isActivationCandidateCurrent(ctl, 
        runtime,
        generation,
        target.cwd,
      )
    ) {
      await closeRuntime(ctl, runtime).catch(() => undefined);
      if (
        isCurrentRuntimeGeneration(ctl, generation) &&
        !isTargetWorkspaceCurrent(ctl, target.cwd)
      ) {
        reportWorkspaceChanged(ctl, generation);
      }
      return;
    }
    const checkpointAccepted = ctl.recoveryStore.writeSession(
      sessionId,
      transcript,
    );
    if (!checkpointAccepted) {
      ctl.recordHost({
        level: 'warn',
        name: 'host.recovery.checkpoint-rejected',
        attributes: {
          sessionId,
          items: transcript.transcript.length,
          historyStatus: transcript.historyStatus,
        },
      });
    }
    await ctl.recoveryStore.flush();
    if (
      !isActivationCandidateCurrent(ctl, 
        runtime,
        generation,
        target.cwd,
      )
    ) {
      await closeRuntime(ctl, runtime).catch(() => undefined);
      if (
        isCurrentRuntimeGeneration(ctl, generation) &&
        !isTargetWorkspaceCurrent(ctl, target.cwd)
      ) {
        reportWorkspaceChanged(ctl, generation);
      }
      return;
    }

    ctl.runtime = runtime;
    ctl.activeRuntimeCwd = target.cwd;
    ctl.sessionId = sessionId;
    ctl.turn = null;
    ctl.transcript = transcript;
    ctl.sessions = withActiveSession(ctl, 
      ctl.sessions,
      target.kind === 'new'
        ? {
            id: sessionId,
            title: 'New session',
            messageCount: 0,
            modifiedTime: new Date().toISOString(),
            active: true,
            isFavorite: false,
          }
        : undefined,
    );
    ctl.connection = { status: 'connected' };
    ctl.recoveryStore.selectSession(sessionId);
    void ctl.recoveryStore.flush();
    ctl.emitSnapshot();
    recoverMissionProjection(ctl, runtime, generation, sessionId, target.cwd);
    if (target.kind === 'new' && target.worktree === true) {
      bindWorktreeSessionMetadata(ctl, 
        runtime,
        generation,
        sessionId,
        target.cwd,
      );
    }
    loadSessionMetadata(ctl, 
      runtime,
      generation,
      sessionId,
      target.cwd,
      phases,
    );
    if (target.kind === 'resume') {
      restoreQueuedPrompts(ctl, sessionId);
      reconcileDaemonTurn(ctl, runtime, generation, sessionId, target.cwd);
      // Replayed rows the ledger still reported live at load time
      // need the same post-turn ledger poll a live turn would have
      // armed — a reload otherwise freezes them at "running".
      armReplayedSubagentWatch(ctl, sessionId, target.cwd, transcript);
    }
}

/**
 * Binds a freshly created worktree session to its worktree
 * directory (registry + git branch recovery) and annotates the
 * interim catalog row. Fail-soft: a missing binding leaves the row
 * unannotated while the session itself stays live.
 */
export function bindWorktreeSessionMetadata(
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    workspaceCwd: string,
  ): void {
    const feature = ctl.worktreeSessions;
    if (feature === undefined) {
      return;
    }
    void recordCreatedWorktreeSession({
      workspaceCwd,
      sessionId,
      sessionCwd: runtime.getSessionCwd?.() ?? null,
      feature,
    }).then((info) => {
      if (
        info === null ||
        !ctl.isCurrentSessionOperation(
          runtime,
          generation,
          sessionId,
          workspaceCwd,
        )
      ) {
        return;
      }
      ctl.sessions = {
        ...ctl.sessions,
        items: ctl.sessions.items.map((item) =>
          item.id === sessionId ? { ...item, worktree: info } : item,
        ),
      };
      ctl.emitSnapshot();
    });
}

export function resetSessionMetadata(ctl: ChatControllerInternals): void {
    ctl.missionRuntime = null;
    if (ctl.customModelsDiscoveryAbort !== null) {
      ctl.customModelsDiscoveryAbort.abort();
      ctl.customModelsDiscoveryAbort = null;
      ctl.customModelsOp = false;
    }
    ctl.contextGeneration += 1;
    ctl.specHandoff = null;
    ctl.settingsUpdate = null;
    ctl.settings = { status: 'loading', value: null };
    ctl.context = { status: 'loading', value: null };
    ctl.modelCatalog = { status: 'loading', items: [] };
    clearPendingAttachments(ctl);
    // Runs while sessionId still names the old session, so the
    // discard diagnostic lands on the session that owned the queue.
    discardQueuedPrompts(ctl);
    // Discard-on-close: any session rebind abandons the hidden fork.
    ctl.btwSideChat?.reset();
}

export function closeRuntime(
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    preserveBackendTurn = false,
  ): Promise<void> {
    if (ctl.closedRuntimes.has(runtime)) {
      return Promise.resolve();
    }
    const existing = ctl.runtimeClosures.get(runtime);
    if (existing) {
      return existing;
    }
    const closure = Promise.resolve()
      .then(() =>
        runtime.dispose(
          preserveBackendTurn ? { preserveBackendTurn: true } : undefined,
        ),
      )
      .then(() => {
        ctl.closedRuntimes.add(runtime);
        ctl.managedRuntimes.delete(runtime);
      })
      .finally(() => {
        if (ctl.runtimeClosures.get(runtime) === closure) {
          ctl.runtimeClosures.delete(runtime);
        }
      });
    ctl.runtimeClosures.set(runtime, closure);
    return closure;
}

/**
 * Dispose-time close of every managed runtime. Reload must not kill a
 * daemon-side turn (reconcileDaemonTurn re-adopts it): an active
 * background-capable runtime is detached instead of interrupted. */
export async function closeAllRuntimesForDispose(
  ctl: ChatControllerInternals,
): Promise<void> {
    const keepTurn =
      isTurnActive(ctl.turn) &&
      ctl.runtime?.supportsBackgroundTurns?.() === true;
    const preserved = keepTurn ? ctl.runtime : null;
    ctl.runtime = null;
    await Promise.allSettled([
      ...[...ctl.managedRuntimes].map((runtime) =>
        closeRuntime(ctl, runtime, runtime === preserved),
      ),
      ctl.recoveryStore.flush(),
    ]);
    await ctl.recoveryStore.dispose();
}

export function queueWorkspaceTransition(
  ctl: ChatControllerInternals,
    generation: number,
    staleRuntimes: readonly DroidRuntime[],
  ): void {
    const previous =
      ctl.workspaceTransition ?? Promise.resolve();
    const transition = previous
      .catch(() => undefined)
      .then(() =>
        reconcileWorkspaceContext(ctl, 
          generation,
          staleRuntimes,
        ),
      )
      .catch(() => {
        if (
          ctl.disposed ||
          generation !== ctl.workspaceContextGeneration
        ) {
          return;
        }
        ctl.connection = {
          status: 'unavailable',
          message: WORKSPACE_CHANGED_MESSAGE,
        };
        ctl.emitSnapshot();
      });
    ctl.workspaceTransition = transition;
    void transition.finally(() => {
      if (ctl.workspaceTransition === transition) {
        ctl.workspaceTransition = null;
      }
    });
}

export async function reconcileWorkspaceContext(
  ctl: ChatControllerInternals,
    generation: number,
    staleRuntimes: readonly DroidRuntime[],
  ): Promise<void> {
    const results = await Promise.allSettled([
      ctl.recoveryStore.flush(),
      ...staleRuntimes.map((runtime) => closeRuntime(ctl, runtime)),
    ]);
    if (
      ctl.disposed ||
      generation !== ctl.workspaceContextGeneration
    ) {
      return;
    }
    if (results.slice(1).some((result) => result.status === 'rejected')) {
      ctl.connection = {
        status: 'unavailable',
        message: SESSION_CLOSE_FAILED_MESSAGE,
      };
      ctl.emitSessionDiagnostic(
        'session-close-failed',
        SESSION_CLOSE_FAILED_MESSAGE,
      );
      ctl.emitSnapshot();
      return;
    }

    const workspace = ctl.getWorkspaceContext();
    if (!isSameWorkspaceContext(ctl.workspaceContext, workspace)) {
      ctl.handleWorkspaceContextChanged();
      return;
    }
    if (!isUsableWorkspace(workspace)) {
      return;
    }
    if (
      ctl.runtime !== null &&
      ctl.activeRuntimeCwd === workspace.cwd
    ) {
      return;
    }

    const initialStartup = ctl.initialization;
    if (initialStartup !== null) {
      await initialStartup;
    }
    if (
      ctl.disposed ||
      generation !== ctl.workspaceContextGeneration
    ) {
      return;
    }
    if (
      ctl.runtime !== null &&
      ctl.activeRuntimeCwd === workspace.cwd
    ) {
      return;
    }
    if (!isTargetWorkspaceCurrent(ctl, workspace.cwd)) {
      ctl.handleWorkspaceContextChanged();
      return;
    }
    await startup(ctl);
}

export async function waitForWorkspaceTransition(ctl: ChatControllerInternals): Promise<void> {
    while (ctl.workspaceTransition !== null) {
      await ctl.workspaceTransition;
    }
}

export function isCurrentRuntime(
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    generation: number,
  ): boolean {
    return (
      isCurrentRuntimeGeneration(ctl, generation) &&
      ctl.runtime === runtime
    );
}

export function isCurrentRuntimeGeneration(
  ctl: ChatControllerInternals,
  generation: number): boolean {
    return !ctl.disposed && ctl.runtimeGeneration === generation;
}

export function isActivationCandidateCurrent(
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    generation: number,
    cwd: string,
  ): boolean {
    return (
      isCurrentRuntimeGeneration(ctl, generation) &&
      ctl.managedRuntimes.has(runtime) &&
      isTargetWorkspaceCurrent(ctl, cwd)
    );
}

export function ensureActiveRuntimeWorkspaceCurrent(ctl: ChatControllerInternals): boolean {
    if (
      ctl.runtime === null ||
      (ctl.activeRuntimeCwd !== null &&
        isTargetWorkspaceCurrent(ctl, ctl.activeRuntimeCwd))
    ) {
      return true;
    }
    ctl.handleWorkspaceContextChanged();
    return false;
}

export function isTargetWorkspaceCurrent(
  ctl: ChatControllerInternals,
  cwd: string): boolean {
    const workspace = ctl.getWorkspaceContext();
    return isUsableWorkspace(workspace) && workspace.cwd === cwd;
}

export function reportWorkspaceChanged(
  ctl: ChatControllerInternals,
  generation: number): void {
    if (!isCurrentRuntimeGeneration(ctl, generation)) {
      return;
    }
    ctl.connection = {
      status: 'unavailable',
      message: WORKSPACE_CHANGED_MESSAGE,
    };
    ctl.emitSessionDiagnostic(
      'workspace-changed',
      WORKSPACE_CHANGED_MESSAGE,
    );
    ctl.emitSnapshot();
}

export function emitWorkspaceUnavailable(
  ctl: ChatControllerInternals,
  workspace: WorkspaceContext): void {
    ctl.connection =
      workspace.cwd === null
        ? {
            status: 'unavailable',
            message: 'Open a workspace folder to use DroidVisX.',
          }
        : {
            status: 'unavailable',
            message:
              'Trust this workspace to start the local Droid runtime.',
          };
    ctl.emitSnapshot();
}

export function unavailableMessage(
  reason: Extract<
    RuntimeAvailability,
    { status: 'unavailable' }
  >['reason'],
): string {
  switch (reason) {
    case 'cli-not-found':
      return 'Install the Droid CLI and sign in before using DroidVisX.';
    case 'invalid-cwd':
      return 'Droid could not use the selected workspace folder.';
    case 'daemon-not-logged-in':
      return 'Sign in with the droid CLI, then Retry the daemon connection.';
    case 'daemon-credentials-unreadable':
      return 'DroidVisX could not read the current Droid CLI sign-in.';
    case 'daemon-refresh-failed':
      return 'The Droid CLI sign-in could not authenticate the local daemon. Sign in again, then Retry.';
    case 'daemon-unavailable':
      return 'The local droid daemon could not be reached. Retry the connection.';
    case 'initialization-failed':
      return 'The local Droid runtime could not be initialized.';
  }
}

export function isSameWorkspaceContext(
  left: WorkspaceContext,
  right: WorkspaceContext,
): boolean {
  return left.cwd === right.cwd && left.trusted === right.trusted;
}
