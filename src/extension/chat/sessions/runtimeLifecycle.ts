import type { RuntimeLifecyclePort } from './runtimeLifecyclePort';
import type { DroidRuntime, RuntimeSessionTarget } from '../../../runtime/DroidRuntime';
import type { RuntimeAvailability } from '../../../runtime/runtimeEvents';
import { EMPTY_SESSION_TOKEN_USAGE } from '../../../shared/protocol/tokenUsage';
import type { WorkspaceContext } from '../ChatController';
import {
  createHostTranscriptState,
  type HostTranscriptState,
} from '../../recovery/hostTranscriptState';
import { createTurnActivityState } from '../turns/turnActivityState';
import { recordCreatedWorktreeSession } from '../../workspace/worktreeSessions';
import {
  isSafeBridgeId,
  isTurnActive,
  isUsableWorkspace,
  SESSION_OPERATION_BLOCKED_MESSAGE,
  type CurrentTurn,
} from '../internals';
import {
  evaluateSessionReplacement,
  type SessionReplacementEligibility,
} from '../operationEligibility';
import { SESSION_NEW_FAILED_MESSAGE } from './sessionDirectory';
import { CATALOG_ERROR_MESSAGE } from './sessionCatalog';
import {
  createSessionSwitchTimings,
  elapsedMs,
  type SessionSwitchTimings,
} from './sessionSwitchTimings';

export {
  loadHistoryTimed,
  prepareActivationTranscript,
} from '../recovery/activationTranscript';

export const SESSION_CLOSE_FAILED_MESSAGE =
  'The current Droid session could not be closed.';

export const SESSION_RESUME_FAILED_MESSAGE =
  'The selected Droid session could not be opened.';

export const WORKSPACE_CHANGED_MESSAGE =
  'The workspace changed before the Droid session could be opened.';

export interface RuntimeReplacementOptions {
  readonly preserveSessionWork?: boolean;
  readonly acknowledgeFailedTurnId?: string;
}

export async function startup(ctl: RuntimeLifecyclePort): Promise<void> {
  let recoveryLoaded = false;
  while (!ctl.sessionState.disposed) {
    const workspace = ctl.getWorkspaceContext();
    if (!isUsableWorkspace(workspace)) {
      ctl.effects.clearCatalog();
      emitWorkspaceUnavailable(ctl, workspace);
      return;
    }

    ctl.sessionState.connection = { status: 'connecting' };
    const catalogRequest = ctl.effects.beginCatalogLoad(workspace.cwd);
    const catalogPromise = ctl.effects.loadCatalog(workspace.cwd);
    if (!recoveryLoaded) {
      await ctl.recoveryStore.load();
      recoveryLoaded = true;
      if (ctl.sessionState.disposed) {
        return;
      }
    }
    const catalog = await catalogPromise;
    if (ctl.sessionState.disposed) {
      return;
    }
    if (!ctl.effects.isCurrentCatalogRequest(catalogRequest, workspace.cwd)) {
      ctl.effects.discardCatalogRequest(catalogRequest);
      continue;
    }
    ctl.catalogState.sessions = catalog;
    if (catalog.status === 'error') {
      ctl.sessionState.connection = { status: 'unavailable', message: CATALOG_ERROR_MESSAGE };
      ctl.emitSnapshot();
      return;
    }
    ctl.effects.seedBackgroundRunning(workspace.cwd);

    const selectedSessionId = ctl.recoveryStore.getSelectedSessionId();
    const resumable =
      selectedSessionId !== null &&
      ctl.effects.hasCatalogSession(selectedSessionId, workspace.cwd);
    const target: RuntimeSessionTarget = resumable
      ? {
          kind: 'resume',
          cwd: workspace.cwd,
          sessionId: selectedSessionId,
        }
      : { kind: 'new', cwd: workspace.cwd };
    await activateInitialRuntime(ctl, target, resumable ? selectedSessionId : null);
    if (isTargetWorkspaceCurrent(ctl, workspace.cwd)) {
      return;
    }
  }
}

export async function handleReady(ctl: RuntimeLifecyclePort): Promise<void> {
  if (ctl.sessionState.initialization) {
    await ctl.sessionState.initialization;
    await waitForWorkspaceTransition(ctl);
    if (ctl.sessionState.disposed) {
      return;
    }
    if (!ensureActiveRuntimeWorkspaceCurrent(ctl)) {
      return;
    }
    ctl.emitSnapshot();
    if (ctl.sessionState.sessionId !== null) {
      await ctl.reviewCoordinator?.replay(ctl.sessionState.sessionId);
    }
    ctl.interactions.replayPending();
    ctl.planDocuments.replay();
    return;
  }

  ctl.sessionState.initialization = startup(ctl);
  await ctl.sessionState.initialization;
  if (ctl.sessionState.sessionId !== null) {
    await ctl.reviewCoordinator?.replay(ctl.sessionState.sessionId);
  }
}

export function sessionReplacementEligibility(
  ctl: RuntimeLifecyclePort,
): SessionReplacementEligibility {
  return evaluateSessionReplacement({
    runtime: ctl.sessionState.runtime,
    turn: ctl.turnState.turn,
    hasPendingInteractions: ctl.interactions.hasPending(),
    connectionStatus: ctl.sessionState.connection.status,
    sessionOperationInProgress: ctl.sessionState.sessionOperationInProgress,
    refreshInProgress: ctl.catalogState.refreshInProgress,
    settingsUpdateInProgress: ctl.metadata.settingsUpdate !== null,
  });
}

export function canReplaceSession(ctl: RuntimeLifecyclePort): boolean {
  if (sessionReplacementEligibility(ctl).kind === 'eligible') {
    return true;
  }
  ctl.emitSessionDiagnostic(
    'session-operation-blocked',
    SESSION_OPERATION_BLOCKED_MESSAGE,
  );
  return false;
}

export function startReplacement(
  ctl: RuntimeLifecyclePort,
  target: RuntimeSessionTarget,
  options: RuntimeReplacementOptions = {},
): void {
  ctl.sessionState.sessionOperationInProgress = true;
  ctl.sessionState.connection = { status: 'connecting' };
  ctl.emitSnapshot();
  void replaceRuntime(ctl, target, options).finally(() => {
    ctl.sessionState.sessionOperationInProgress = false;
    ctl.effects.resumeRecoveredIdeReconnect();
  });
}

export async function replaceRuntime(
  ctl: RuntimeLifecyclePort,
  target: RuntimeSessionTarget,
  options: RuntimeReplacementOptions = {},
): Promise<void> {
  const phases = createSessionSwitchTimings(target.kind);
  // Captured before any state reset: a live daemon-backed turn
  // survives the switch. Disposal then detaches instead of
  // interrupting, and the old session's drawer row keeps a running
  // indicator until the daemon reports it idle.
  const detachedSessionId =
    ctl.sessionState.runtime !== null &&
    isTurnActive(ctl.turnState.turn) &&
    ctl.sessionState.runtime.supportsBackgroundTurns?.() === true
      ? ctl.sessionState.sessionId
      : null;
  const targetConversationId =
    target.kind === 'resume'
      ? ctl.recoveryStore.resolveConversationId(target.sessionId)
      : undefined;
  const preserveConversationState =
    targetConversationId !== undefined &&
    targetConversationId === ctl.sessionState.conversationId;
  const generation = ++ctl.sessionState.runtimeGeneration;
  ctl.turnState.turnGeneration += 1;
  resetSessionMetadata(ctl, preserveConversationState, options.preserveSessionWork === true);
  ctl.interactions.cancelAll();
  try {
    await ctl.effects.flushRecoveryCheckpoint();
  } catch {
    if (isCurrentRuntimeGeneration(ctl, generation)) {
      ctl.effects.markRecoveryCheckpointUnavailable(
        target.kind === 'resume'
          ? SESSION_RESUME_FAILED_MESSAGE
          : SESSION_NEW_FAILED_MESSAGE,
      );
    }
    return;
  }
  if (!isCurrentRuntimeGeneration(ctl, generation)) {
    return;
  }
  if (!isTargetWorkspaceCurrent(ctl, target.cwd)) {
    reportWorkspaceChanged(ctl, generation);
    return;
  }

  const previousRuntime = ctl.sessionState.runtime;
  if (previousRuntime) {
    try {
      await closeRuntime(ctl, previousRuntime, detachedSessionId !== null);
    } catch {
      if (
        isCurrentRuntimeGeneration(ctl, generation) &&
        isTargetWorkspaceCurrent(ctl, target.cwd)
      ) {
        ctl.sessionState.connection = {
          status: 'unavailable',
          message: SESSION_CLOSE_FAILED_MESSAGE,
        };
        ctl.emitSessionDiagnostic('session-close-failed', SESSION_CLOSE_FAILED_MESSAGE);
        ctl.emitSnapshot();
      } else if (isCurrentRuntimeGeneration(ctl, generation)) {
        reportWorkspaceChanged(ctl, generation);
      }
      return;
    }
    if (!isCurrentRuntimeGeneration(ctl, generation)) {
      return;
    }
    if (ctl.sessionState.runtime === previousRuntime) {
      ctl.sessionState.runtime = null;
    }
    if (detachedSessionId !== null) {
      // The turn now runs unattended on the daemon: drop the local
      // projection without a terminal turn.state (the turn did not
      // end) and flag the row for the background watcher.
      ctl.turnState.turn = null;
      ctl.diagnostics?.endTurnScope?.();
      ctl.effects.setSessionRunning(detachedSessionId, true);
      ctl.effects.ensureBackgroundRunningPoll();
    }
    if (!isTargetWorkspaceCurrent(ctl, target.cwd)) {
      reportWorkspaceChanged(ctl, generation);
      return;
    }
  }

  // The transcript projection and the runtime resume each spawn their
  // own droid CLI process and stay independent until activateRuntime
  // consumes both; running them serially doubled session-switch
  // latency (9-12s observed). Neither branch throws: both funnel
  // failures into their return values.
  const [transcript, activation] = await Promise.all([
    prepareHistory(ctl, target, generation, phases),
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
      await closeRuntime(ctl, activation.runtime).catch(() => undefined);
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
    ctl.sessionState.connection = {
      status: 'unavailable',
      message:
        target.kind === 'resume'
          ? SESSION_RESUME_FAILED_MESSAGE
          : SESSION_NEW_FAILED_MESSAGE,
    };
    ctl.emitSessionDiagnostic(
      target.kind === 'resume' ? 'session-resume-failed' : 'session-new-failed',
      ctl.sessionState.connection.message!,
    );
    ctl.emitSnapshot();
    return;
  }

  if (!isTargetWorkspaceCurrent(ctl, target.cwd)) {
    await closeRuntime(ctl, activation.runtime).catch(() => undefined);
    reportWorkspaceChanged(ctl, generation);
    return;
  }
  const activated = await activateRuntime(
    ctl,
    target,
    activation.runtime,
    activation.id,
    generation,
    transcript,
    phases,
    options,
  );
  if (activated) {
    ctl.effects.markSessionSwitchReady(phases);
  }
}

export async function activateInitialRuntime(
  ctl: RuntimeLifecyclePort,
  target: RuntimeSessionTarget,
  failedResumeId: string | null,
): Promise<void> {
  const generation = ++ctl.sessionState.runtimeGeneration;
  // Same parallel activation as replaceRuntime: history projection
  // and runtime resume are independent droid CLI processes.
  const [transcript, activation] = await Promise.all([
    prepareHistory(ctl, target, generation),
    createInitializedRuntime(ctl, target, generation),
  ]);
  if (
    transcript === null ||
    !isCurrentRuntimeGeneration(ctl, generation) ||
    !isTargetWorkspaceCurrent(ctl, target.cwd)
  ) {
    if (activation !== null && activation.status === 'available') {
      await closeRuntime(ctl, activation.runtime).catch(() => undefined);
    }
    return;
  }
  if (activation === null) {
    return;
  }
  if (activation.status === 'failed') {
    if (failedResumeId) {
      ctl.sessionState.conversationId =
        ctl.recoveryStore.resolveConversationId(failedResumeId) ?? null;
      ctl.sessionState.sessionId = failedResumeId;
      ctl.recoveryState.transcript = createHostTranscriptState('unavailable');
      ctl.catalogState.sessions = ctl.effects.withActiveSession(
        ctl.catalogState.sessions,
      );
    } else {
      ctl.sessionState.conversationId = null;
      ctl.sessionState.sessionId = null;
      ctl.missionState.mission = null;
      ctl.metadata.tokenUsage = EMPTY_SESSION_TOKEN_USAGE;
      ctl.recoveryState.transcript = createHostTranscriptState('unavailable');
    }
    ctl.sessionState.connection = {
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
  await activateRuntime(
    ctl,
    target,
    activation.runtime,
    activation.id,
    generation,
    transcript,
  );
}

async function prepareHistory(
  ctl: RuntimeLifecyclePort,
  target: RuntimeSessionTarget,
  generation: number,
  phases?: SessionSwitchTimings,
): Promise<HostTranscriptState | null> {
  try {
    return await ctl.effects.prepareActivationTranscript(target, generation, phases);
  } catch {
    if (isCurrentRuntimeGeneration(ctl, generation) && isTargetWorkspaceCurrent(ctl, target.cwd)) {
      if (ctl.sessionState.sessionId === null && target.kind === 'resume') {
        ctl.sessionState.sessionId = target.sessionId;
        ctl.sessionState.conversationId = ctl.recoveryStore.resolveConversationId(target.sessionId) ?? null;
      }
      ctl.sessionState.connection = {
        status: 'unavailable',
        message: 'Droid session history could not be loaded. Retry to open this session.',
      };
      ctl.emitSessionDiagnostic('session-history-failed', ctl.sessionState.connection.message!);
      ctl.emitSnapshot();
    }
    return null;
  }
}

export async function createInitializedRuntime(
  ctl: RuntimeLifecyclePort,
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
    runtime = ctl.createRuntime(ctl.interactions.createRuntimeHandler());
  } catch {
    return {
      status: 'failed',
      message: 'The local Droid runtime could not be created.',
    };
  }
  ctl.sessionState.managedRuntimes.add(runtime);
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
        ctl.effects.recoveryTurnId(generation, target.sessionId),
      );
    }
  };
  if (target.kind === 'resume') {
    ctl.interactions.beginTurn(
      target.sessionId,
      ctl.effects.recoveryTurnId(generation, target.sessionId),
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
    (target.kind === 'resume' && availability.sessionId !== target.sessionId)
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
  ctl: RuntimeLifecyclePort,
  target: RuntimeSessionTarget,
  runtime: DroidRuntime,
  sessionId: string,
  generation: number,
  transcript: HostTranscriptState,
  phases?: SessionSwitchTimings,
  options: RuntimeReplacementOptions = {},
): Promise<boolean> {
  if (!isActivationCandidateCurrent(ctl, runtime, generation, target.cwd)) {
    await closeRuntime(ctl, runtime).catch(() => undefined);
    if (
      isCurrentRuntimeGeneration(ctl, generation) &&
      !isTargetWorkspaceCurrent(ctl, target.cwd)
    ) {
      reportWorkspaceChanged(ctl, generation);
    }
    return false;
  }
  const current = () =>
    isActivationCandidateCurrent(ctl, runtime, generation, target.cwd);
  const conversationId = ctl.recoveryStore.resolveConversationId(sessionId);
  const recoveredDisplay =
    target.kind === 'resume' && conversationId !== undefined
      ? ctl.recoveryStore.readDisplay(conversationId)
      : undefined;
  // A successful explicit reconnect acknowledges the old failed turn.
  // Keep its transcript, but do not restore it as the current session failure.
  const recoveredTurn = recoveredDisplay?.turn;
  const ideStatus = ctl.nativeIde?.read(sessionId).status;
  const readyToAcknowledge = ideStatus === undefined || ideStatus === 'connected' || ideStatus === 'unavailable';
  const restoredTurn = readyToAcknowledge && recoveredTurn?.status === 'failed' &&
    recoveredTurn.turnId === options.acknowledgeFailedTurnId ? null : recoveredTurn ?? null;
  const checkpoint = await ctl.effects.persistActivationRecoveryCheckpoint(
    sessionId,
    transcript,
    restoredTurn,
    current,
  );
  if (checkpoint !== 'saved') {
    await closeRuntime(ctl, runtime).catch(() => undefined);
    if (
      checkpoint === 'stale' &&
      isCurrentRuntimeGeneration(ctl, generation) &&
      !isTargetWorkspaceCurrent(ctl, target.cwd)
    ) {
      reportWorkspaceChanged(ctl, generation);
    } else if (checkpoint === 'failed' && isCurrentRuntimeGeneration(ctl, generation)) {
      ctl.effects.markRecoveryCheckpointUnavailable(
        target.kind === 'resume'
          ? SESSION_RESUME_FAILED_MESSAGE
          : SESSION_NEW_FAILED_MESSAGE,
      );
    }
    return false;
  }

  ctl.sessionState.runtime = runtime;
  ctl.sessionState.activeRuntimeCwd = target.cwd;
  ctl.sessionState.conversationId =
    ctl.recoveryStore.resolveConversationId(sessionId) ?? sessionId;
  ctl.sessionState.sessionId = sessionId;
  ctl.turnState.turn =
    restoredTurn === null
      ? null
      : {
          ...restoredTurn,
          activity: createTurnActivityState(),
          ...(isTurnActiveStatus(restoredTurn.status)
            ? { recovery: true as const }
            : {}),
        };
  ctl.recoveryState.transcript = transcript;
  ctl.catalogState.sessions = ctl.effects.withActiveSession(
    ctl.catalogState.sessions,
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
  ctl.sessionState.connection = { status: 'connected' };
  ctl.emitSnapshot();
  ctl.effects.recoverMissionProjection(runtime, generation, sessionId, target.cwd);
  if (target.kind === 'new' && target.worktree === true) {
    bindWorktreeSessionMetadata(ctl, runtime, generation, sessionId, target.cwd);
  }
  ctl.effects.loadSessionMetadata(runtime, generation, sessionId, target.cwd, phases);
  if (target.kind === 'resume') {
    if (!options.preserveSessionWork) ctl.effects.restoreQueuedPrompts(sessionId);
    ctl.effects.reconcileDaemonTurn(runtime, generation, sessionId, target.cwd);
    // Replayed rows the ledger still reported live at load time
    // need the same post-turn ledger poll a live turn would have
    // armed — a reload otherwise freezes them at "running".
    ctl.effects.armReplayedSubagentWatch(sessionId, target.cwd, transcript);
  }
  return true;
}

function isTurnActiveStatus(status: CurrentTurn['status']): boolean {
  return status === 'submitting' || status === 'streaming' || status === 'stopping';
}

/**
 * Binds a freshly created worktree session to its worktree
 * directory (registry + git branch recovery) and annotates the
 * interim catalog row. Fail-soft: a missing binding leaves the row
 * unannotated while the session itself stays live.
 */
export function bindWorktreeSessionMetadata(
  ctl: RuntimeLifecyclePort,
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
      !ctl.isCurrentSessionOperation(runtime, generation, sessionId, workspaceCwd)
    ) {
      return;
    }
    ctl.catalogState.sessions = {
      ...ctl.catalogState.sessions,
      items: ctl.catalogState.sessions.items.map((item) =>
        item.id === sessionId ? { ...item, worktree: info } : item,
      ),
    };
    ctl.emitSnapshot();
  });
}

export function resetSessionMetadata(
  ctl: RuntimeLifecyclePort,
  preserveConversationState = false,
  preserveSessionWork = false,
): void {
  ctl.missionState.missionRuntime = null;
  if (ctl.customModelState.customModelsDiscoveryAbort !== null) {
    ctl.customModelState.customModelsDiscoveryAbort.abort();
    ctl.customModelState.customModelsDiscoveryAbort = null;
    ctl.customModelState.customModelsOp = false;
  }
  ctl.metadata.reset();
  ctl.turnState.specHandoff = null;
  if (!preserveConversationState) {
    ctl.effects.clearPendingAttachments();
  }
  // Runs while sessionId still names the old session, so the
  // discard diagnostic lands on the session that owned the queue.
  if (!preserveSessionWork) ctl.effects.discardQueuedPrompts();
  // Discard-on-close: any session rebind abandons the hidden fork.
  if (!preserveSessionWork) ctl.btwSideChat?.reset();
}

export function closeRuntime(ctl: RuntimeLifecyclePort, runtime: DroidRuntime, preserveBackendTurn = false): Promise<void> {
  if (ctl.sessionState.runtime === runtime) ctl.turnState.turn?.changesLedger?.cancel();
  return ctl.sessionState.closeRuntime(runtime, preserveBackendTurn);
}

/**
 * Dispose-time close of every managed runtime. Reload must not kill a
 * daemon-side turn (reconcileDaemonTurn re-adopts it): an active
 * background-capable runtime is detached instead of interrupted. */
export async function closeAllRuntimesForDispose(
  ctl: RuntimeLifecyclePort,
): Promise<void> {
  const keepTurn =
    isTurnActive(ctl.turnState.turn) &&
    ctl.sessionState.runtime?.supportsBackgroundTurns?.() === true;
  const preserved = keepTurn ? ctl.sessionState.runtime : null;
  ctl.sessionState.runtime = null;
  const results = await Promise.allSettled([
    ...[...ctl.sessionState.managedRuntimes].map((runtime) =>
      closeRuntime(ctl, runtime, runtime === preserved),
    ),
    ctl.recoveryStore.dispose(),
  ]);
  const recoveryResult = results.at(-1);
  if (recoveryResult?.status === 'rejected') throw recoveryResult.reason;
}

export function queueWorkspaceTransition(
  ctl: RuntimeLifecyclePort,
  generation: number,
  staleRuntimes: readonly DroidRuntime[],
): void {
  const previous = ctl.sessionState.workspaceTransition ?? Promise.resolve();
  const transition = previous
    .catch(() => undefined)
    .then(() => reconcileWorkspaceContext(ctl, generation, staleRuntimes))
    .catch(() => {
      if (
        ctl.sessionState.disposed ||
        generation !== ctl.sessionState.workspaceContextGeneration
      ) {
        return;
      }
      ctl.sessionState.connection = {
        status: 'unavailable',
        message: WORKSPACE_CHANGED_MESSAGE,
      };
      ctl.emitSnapshot();
    });
  ctl.sessionState.workspaceTransition = transition;
  void transition.finally(() => {
    if (ctl.sessionState.workspaceTransition === transition) {
      ctl.sessionState.workspaceTransition = null;
    }
  });
}

export async function reconcileWorkspaceContext(
  ctl: RuntimeLifecyclePort,
  generation: number,
  staleRuntimes: readonly DroidRuntime[],
): Promise<void> {
  const results = await Promise.allSettled([
    ctl.recoveryStore.flush(),
    ...staleRuntimes.map((runtime) => closeRuntime(ctl, runtime)),
  ]);
  if (
    ctl.sessionState.disposed ||
    generation !== ctl.sessionState.workspaceContextGeneration
  ) {
    return;
  }
  if (results[0]?.status === 'rejected') {
    ctl.effects.markRecoveryCheckpointUnavailable(SESSION_RESUME_FAILED_MESSAGE);
    return;
  }
  if (results.slice(1).some((result) => result.status === 'rejected')) {
    ctl.sessionState.connection = {
      status: 'unavailable',
      message: SESSION_CLOSE_FAILED_MESSAGE,
    };
    ctl.emitSessionDiagnostic('session-close-failed', SESSION_CLOSE_FAILED_MESSAGE);
    ctl.emitSnapshot();
    return;
  }

  const workspace = ctl.getWorkspaceContext();
  if (!isSameWorkspaceContext(ctl.sessionState.workspaceContext, workspace)) {
    ctl.handleWorkspaceContextChanged();
    return;
  }
  if (!isUsableWorkspace(workspace)) {
    return;
  }
  if (
    ctl.sessionState.runtime !== null &&
    ctl.sessionState.activeRuntimeCwd === workspace.cwd
  ) {
    return;
  }

  const initialStartup = ctl.sessionState.initialization;
  if (initialStartup !== null) {
    await initialStartup;
  }
  if (
    ctl.sessionState.disposed ||
    generation !== ctl.sessionState.workspaceContextGeneration
  ) {
    return;
  }
  if (
    ctl.sessionState.runtime !== null &&
    ctl.sessionState.activeRuntimeCwd === workspace.cwd
  ) {
    return;
  }
  if (!isTargetWorkspaceCurrent(ctl, workspace.cwd)) {
    ctl.handleWorkspaceContextChanged();
    return;
  }
  await startup(ctl);
}

export async function waitForWorkspaceTransition(
  ctl: RuntimeLifecyclePort,
): Promise<void> {
  while (ctl.sessionState.workspaceTransition !== null) {
    await ctl.sessionState.workspaceTransition;
  }
}

export function isCurrentRuntime(
  ctl: RuntimeLifecyclePort,
  runtime: DroidRuntime,
  generation: number,
): boolean {
  return (
    isCurrentRuntimeGeneration(ctl, generation) && ctl.sessionState.runtime === runtime
  );
}

export function isCurrentRuntimeGeneration(
  ctl: RuntimeLifecyclePort,
  generation: number,
): boolean {
  return !ctl.sessionState.disposed && ctl.sessionState.runtimeGeneration === generation;
}

export function isActivationCandidateCurrent(
  ctl: RuntimeLifecyclePort,
  runtime: DroidRuntime,
  generation: number,
  cwd: string,
): boolean {
  return (
    isCurrentRuntimeGeneration(ctl, generation) &&
    ctl.sessionState.managedRuntimes.has(runtime) &&
    isTargetWorkspaceCurrent(ctl, cwd)
  );
}

export function ensureActiveRuntimeWorkspaceCurrent(ctl: RuntimeLifecyclePort): boolean {
  if (
    ctl.sessionState.runtime === null ||
    (ctl.sessionState.activeRuntimeCwd !== null &&
      isTargetWorkspaceCurrent(ctl, ctl.sessionState.activeRuntimeCwd))
  ) {
    return true;
  }
  ctl.handleWorkspaceContextChanged();
  return false;
}

export function isTargetWorkspaceCurrent(
  ctl: RuntimeLifecyclePort,
  cwd: string,
): boolean {
  const workspace = ctl.getWorkspaceContext();
  return isUsableWorkspace(workspace) && workspace.cwd === cwd;
}

export function reportWorkspaceChanged(
  ctl: RuntimeLifecyclePort,
  generation: number,
): void {
  if (!isCurrentRuntimeGeneration(ctl, generation)) {
    return;
  }
  ctl.sessionState.connection = {
    status: 'unavailable',
    message: WORKSPACE_CHANGED_MESSAGE,
  };
  ctl.emitSessionDiagnostic('workspace-changed', WORKSPACE_CHANGED_MESSAGE);
  ctl.emitSnapshot();
}

export function emitWorkspaceUnavailable(
  ctl: RuntimeLifecyclePort,
  workspace: WorkspaceContext,
): void {
  ctl.sessionState.connection =
    workspace.cwd === null
      ? {
          status: 'unavailable',
          message: 'Open a workspace folder to use DroidVisX.',
        }
      : {
          status: 'unavailable',
          message: 'Trust this workspace to start the local Droid runtime.',
        };
  ctl.emitSnapshot();
}

export function unavailableMessage(
  reason: Extract<RuntimeAvailability, { status: 'unavailable' }>['reason'],
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
