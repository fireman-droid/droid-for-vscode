import type { DroidRuntime, RuntimeSessionTarget } from '../../../runtime/DroidRuntime';
import type { RuntimeAvailability } from '../../../runtime/runtimeEvents';
import type { HostTranscriptState } from '../../recovery/hostTranscriptState';
import { recordCreatedWorktreeSession } from '../../workspace/worktreeSessions';
import { isSafeBridgeId, type CurrentTurn } from '../internals';
import { createRestoredTurn } from '../turns/turnLifecycle';
import { SESSION_NEW_FAILED_MESSAGE } from './sessionDirectory';
import { SESSION_RESUME_FAILED_MESSAGE, unavailableMessage } from './sessionErrors';
import { closeRuntime } from './sessionCleanup';
import { isCurrentRuntimeGeneration, isActivationCandidateCurrent, isTargetWorkspaceCurrent } from './sessionGuards';
import { reportWorkspaceChanged } from './workspaceLifecycle';
import { elapsedMs, type SessionSwitchTimings } from './sessionSwitchTimings';
import type { RuntimeActivationPort, RuntimeReplacementOptions } from './runtimeLifecyclePort';

// Prepares runtime/history, then publishes one ready session after its checkpoint is saved.

export async function prepareHistory(
  ctl: RuntimeActivationPort,
  target: RuntimeSessionTarget,
  generation: number,
  phases?: SessionSwitchTimings,
): Promise<HostTranscriptState | null> {
  try {
    const transcript = await ctl.effects.prepareActivationTranscript(target, generation, phases);
    if (transcript !== null && target.kind === 'resume' &&
        isCurrentRuntimeGeneration(ctl, generation) && isTargetWorkspaceCurrent(ctl, target.cwd) &&
        ctl.sessionState.connection.status === 'connecting') {
      // Show verified history while the native handshake continues. No runtime
      // ownership or recovery checkpoint is committed at this display boundary.
      ctl.effects.showSessionHistory({
        sessionId: target.sessionId,
        conversationId: ctl.recoveryStore.resolveConversationId(target.sessionId) ?? target.sessionId,
      }, transcript);
      ctl.recordHost({ level: 'info', name: 'host.perf.history-visible', attributes: {
        sessionId: target.sessionId, items: transcript.transcript.length,
        durationMs: phases ? elapsedMs(phases.startedAt) : 0,
      } });
      ctl.emitSnapshot();
    }
    return transcript;
  } catch {
    if (isCurrentRuntimeGeneration(ctl, generation) && isTargetWorkspaceCurrent(ctl, target.cwd)) {
      if (ctl.sessionState.sessionId === null && target.kind === 'resume') {
        ctl.effects.bindSessionIdentity({
          sessionId: target.sessionId,
          conversationId: ctl.recoveryStore.resolveConversationId(target.sessionId) ?? null,
        });
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
  ctl: RuntimeActivationPort,
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
  ctl: RuntimeActivationPort,
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
  // Explicit reconnect keeps transcript but acknowledges the old failed turn.
  const recoveredTurn = recoveredDisplay?.turn;
  // A child observes its owner's IDE; restoring its chat does not reconnect that shared channel.
  const ideStatus = target.kind === 'resume' && target.child === true ? undefined : ctl.nativeIde?.read(sessionId).status;
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
  ctl.effects.commitSessionBinding({
    conversationId: ctl.recoveryStore.resolveConversationId(sessionId) ?? sessionId,
    sessionId,
    transcript,
    turn: createRestoredTurn(restoredTurn === null ? null : {
      ...restoredTurn,
      ...(isTurnActiveStatus(restoredTurn.status) ? { recovery: true as const } : {}),
    }),
    ...(target.kind === 'new' ? {
      catalogEntry: {
        id: sessionId,
        title: 'New session',
        messageCount: 0,
        modifiedTime: new Date().toISOString(),
        active: true,
        isFavorite: false,
      },
    } : {}),
  });
  ctl.sessionState.connection = { status: 'connected' };
  if (phases) ctl.recordHost({ level: 'info', name: 'host.perf.activation-ready', attributes: {
    kind: target.kind, sessionId, durationMs: elapsedMs(phases.startedAt),
    initializeMs: phases.initializeMs ?? 0, historyMs: phases.historyMs ?? 0,
  } });
  ctl.emitSnapshot();
  ctl.effects.recoverMissionProjection(runtime, generation, sessionId, target.cwd, target.kind === 'resume');
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
 * Binds a newly created worktree to its registry and git branch and annotates the
 * interim catalog row. Fail-soft: a missing binding leaves the row
 * unannotated while the session itself stays live.
 */
export function bindWorktreeSessionMetadata(
  ctl: RuntimeActivationPort,
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
