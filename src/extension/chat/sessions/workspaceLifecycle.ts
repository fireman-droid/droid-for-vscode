import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import type { WorkspaceContext } from '../hostTypes';
import { isUsableWorkspace } from '../internals';
import { closeRuntime } from './sessionCleanup';
import { isCurrentRuntimeGeneration, isSameWorkspaceContext, isTargetWorkspaceCurrent } from './sessionGuards';
import { SESSION_CLOSE_FAILED_MESSAGE, SESSION_RESUME_FAILED_MESSAGE, WORKSPACE_CHANGED_MESSAGE } from './sessionErrors';
import type { WorkspaceLifecyclePort, WorkspaceFeedbackPort, ActiveWorkspacePort } from './runtimeLifecyclePort';

// Serializes folder/trust transitions. Starting the next session is an injected effect.

export function handleWorkspaceContextChanged(ctl: WorkspaceLifecyclePort): void {
  if (ctl.sessionState.disposed) {
    return;
  }
  const workspace = ctl.getWorkspaceContext();
  if (isSameWorkspaceContext(ctl.sessionState.workspaceContext, workspace)) {
    return;
  }
  ctl.sessionState.workspaceContext = { ...workspace };
  if (ctl.sessionState.initialization === null) {
    return;
  }
  const generation = ++ctl.sessionState.workspaceContextGeneration;
  const staleRuntimes = [...ctl.sessionState.managedRuntimes];
  ctl.sessionState.runtimeGeneration += 1;
  ctl.turnState.turnGeneration += 1;
  ctl.effects.resetSessionMetadata();
  if (
    ctl.recoveryState.recoveryCheckpointTimer !== null ||
    ctl.recoveryState.pendingRecoveryCheckpoint !== null
  ) {
    ctl.effects.checkpointRecoveryTranscript();
  }
  ctl.sessionState.runtime = null;
  ctl.sessionState.activeRuntimeCwd = null;
  ctl.turnState.turn = null;
  ctl.interactions.cancelAll();
  if (isUsableWorkspace(workspace)) {
    ctl.effects.bindCatalogViewToWorkspace(workspace.cwd);
    ctl.sessionState.connection = {
      status: 'unavailable',
      message: WORKSPACE_CHANGED_MESSAGE,
    };
    ctl.emitSnapshot();
  } else {
    ctl.effects.clearCatalog();
    emitWorkspaceUnavailable(ctl, workspace);
  }
  queueWorkspaceTransition(ctl, generation, staleRuntimes);
}

export function queueWorkspaceTransition(
  ctl: WorkspaceLifecyclePort,
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
  ctl: WorkspaceLifecyclePort,
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
  await ctl.effects.startup();
}

export async function waitForWorkspaceTransition(
  ctl: {
    readonly sessionState: Readonly<Pick<WorkspaceLifecyclePort['sessionState'], 'workspaceTransition'>>;
  },
): Promise<void> {
  while (ctl.sessionState.workspaceTransition !== null) {
    await ctl.sessionState.workspaceTransition;
  }
}

export function ensureActiveRuntimeWorkspaceCurrent(ctl: ActiveWorkspacePort): boolean {
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

export function reportWorkspaceChanged(
  ctl: WorkspaceFeedbackPort,
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
  ctl: WorkspaceFeedbackPort,
  workspace: WorkspaceContext,
): void {
  ctl.sessionState.connection =
    workspace.cwd === null
      ? {
          status: 'unavailable',
          message: 'Open a workspace folder to use Droid.',
        }
      : {
          status: 'unavailable',
          message: 'Trust this workspace to start the local Droid runtime.',
        };
  ctl.emitSnapshot();
}
