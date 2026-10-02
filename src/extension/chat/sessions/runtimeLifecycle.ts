import type { RuntimeSessionTarget } from '../../../runtime/DroidRuntime';
import { EMPTY_SESSION_TOKEN_USAGE } from '../../../shared/protocol/tokenUsage';
import { createHostTranscriptState } from '../../recovery/hostTranscriptState';
import { isTurnActive, isUsableWorkspace, SESSION_OPERATION_BLOCKED_MESSAGE } from '../internals';
import { evaluateSessionReplacement, type SessionReplacementEligibility } from '../operationEligibility';
import { CATALOG_ERROR_MESSAGE } from './sessionCatalog';
import { SESSION_NEW_FAILED_MESSAGE } from './sessionDirectory';
import { SESSION_CLOSE_FAILED_MESSAGE, SESSION_RESUME_FAILED_MESSAGE } from './sessionErrors';
import { resolveStartupTarget } from './startupTarget';
import { createSessionSwitchTimings } from './sessionSwitchTimings';
import { prepareHistory, createInitializedRuntime, activateRuntime } from './runtimeActivation';
import { closeRuntime } from './sessionCleanup';
import { isCurrentRuntimeGeneration, isTargetWorkspaceCurrent } from './sessionGuards';
import { emitWorkspaceUnavailable, ensureActiveRuntimeWorkspaceCurrent, reportWorkspaceChanged, waitForWorkspaceTransition } from './workspaceLifecycle';
import type { RuntimeLifecyclePort, RuntimeReplacementOptions } from './runtimeLifecyclePort';

// Session entry points: startup, webview readiness and explicit replacement.
// Runtime preparation/commit, workspace transitions and feature cleanup have separate owners.

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
    if (ctl.childSession) {
      // Delegated sessions are intentionally absent from the main chat catalog.
      // Open the verified child directly; catalog failures must not create a chat.
      await ctl.recoveryStore.load();
      if (ctl.sessionState.disposed) return;
      const target = await resolveStartupTarget(ctl, workspace.cwd);
      await activateInitialRuntime(ctl, target, ctl.childSession.sessionId);
      return;
    }
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

    const target = await resolveStartupTarget(ctl, workspace.cwd);
    if (!ctl.effects.isCurrentCatalogRequest(catalogRequest, workspace.cwd)) {
      ctl.effects.discardCatalogRequest(catalogRequest);
      continue;
    }
    await activateInitialRuntime(ctl, target, target.kind === 'resume' ? target.sessionId : null);
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
    if (ctl.missionState.missionRuntime) ctl.emit(ctl.missionState.missionRuntime.snapshot());
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
  if (ctl.childSession) target = { kind: 'resume', ...ctl.childSession, child: true };
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
  ctl.effects.resetSessionMetadata(preserveConversationState, options.preserveSessionWork === true);
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

  // Read persisted history alongside the native session handshake. Activation
  // owns their common ready/checkpoint boundary; history may appear read-only
  // while the native handshake continues.
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
      message: activation.message,
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
  const phases = createSessionSwitchTimings(target.kind);
  const generation = ++ctl.sessionState.runtimeGeneration;
  // History reading and the session's native handshake run independently.
  const [transcript, activation] = await Promise.all([
    prepareHistory(ctl, target, generation, phases),
    createInitializedRuntime(ctl, target, generation, phases),
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
        ctl.recoveryStore.resolveConversationId(failedResumeId) ?? failedResumeId;
      ctl.sessionState.sessionId = failedResumeId;
      ctl.recoveryState.transcript = transcript;
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
    phases,
  );
}
