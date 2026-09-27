import type { DroidRuntime } from '../../../runtime/DroidRuntime';
import type { WorkspaceContext } from '../hostTypes';
import { isUsableWorkspace } from '../internals';
import type { SessionGuardPort } from './runtimeLifecyclePort';

// Identity checks are shared by async completion paths; they do not change state.

export function isCurrentRuntime(
  ctl: SessionGuardPort,
  runtime: DroidRuntime,
  generation: number,
): boolean {
  return (
    isCurrentRuntimeGeneration(ctl, generation) && ctl.sessionState.runtime === runtime
  );
}

export function isCurrentRuntimeGeneration(
  ctl: SessionGuardPort,
  generation: number,
): boolean {
  return !ctl.sessionState.disposed && ctl.sessionState.runtimeGeneration === generation;
}

export function isActivationCandidateCurrent(
  ctl: SessionGuardPort,
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

export function isTargetWorkspaceCurrent(
  ctl: SessionGuardPort,
  cwd: string,
): boolean {
  const workspace = ctl.getWorkspaceContext();
  return isUsableWorkspace(workspace) && workspace.cwd === cwd;
}

export function isSameWorkspaceContext(
  left: WorkspaceContext,
  right: WorkspaceContext,
): boolean {
  return left.cwd === right.cwd && left.trusted === right.trusted;
}
