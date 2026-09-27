import { UNAVAILABLE_IDE, type IdeState } from '../../shared/protocol/ideProtocol';
import type { ChatController } from './ChatController';
import { isTurnActive } from './internals';
import { evaluateActiveSessionTransform } from './operationEligibility';
import { ensureActiveRuntimeWorkspaceCurrent } from './sessions/workspaceLifecycle';
import { replaceRuntime } from './sessions/runtimeLifecycle';
import type { DroidRuntime } from '../../runtime/DroidRuntime';
import { maybeDispatchQueue, pauseQueueAsBlocked } from './queue/queue';

export interface NativeIdeBackend {
  read(sessionId: string | null): Pick<IdeState, 'status' | 'message'>;
  reconnect(sessionId: string, isCurrent: () => boolean, onClosingSource: () => void, deferIfBlocked?: boolean): Promise<boolean>;
}

interface RecoveredIdeIntent { runtime: DroidRuntime; generation: number; sessionId: string; cwd: string }
const recoveredIntents = new WeakMap<ChatController, RecoveredIdeIntent>();
const recoveredAttempts = new WeakMap<ChatController, number>();

/** Only callers that have confirmed the recovered daemon is idle may request this. */
export function reconnectRecoveredIde(ctl: ChatController, runtime: DroidRuntime, generation: number, sessionId: string, cwd: string): void {
  if (recoveredAttempts.get(ctl) === generation || !ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd) ||
      ctl.nativeIde?.read(sessionId).status !== 'reconnect-required') return;
  recoveredIntents.set(ctl, { runtime, generation, sessionId, cwd });
  resumeRecoveredIdeReconnect(ctl);
}

/** Activation owns the session lock until its explicit completion boundary. */
export function resumeRecoveredIdeReconnect(ctl: ChatController): void {
  const intent = recoveredIntents.get(ctl);
  if (!intent) return;
  if (!ctl.isCurrentSessionOperation(intent.runtime, intent.generation, intent.sessionId, intent.cwd) ||
      ctl.nativeIde?.read(intent.sessionId).status !== 'reconnect-required') {
    recoveredIntents.delete(ctl);
    return;
  }
  if (ctl.sessionState.sessionOperationInProgress) return;
  recoveredIntents.delete(ctl);
  if (!eligible(ctl) || recoveredAttempts.get(ctl) === intent.generation) return;
  recoveredAttempts.set(ctl, intent.generation);
  void reconnectControllerIde(ctl, intent.sessionId, true);
}

function eligible(ctl: ChatController): boolean {
  return ctl.nativeIde !== undefined && !ctl.sessionState.disposed &&
    ctl.sessionState.sessionId !== null && ctl.sessionState.runtime !== null &&
    ctl.sessionState.connection.status === 'connected' &&
    ctl.btwSideChat?.isBusy() !== true &&
    ctl.sessionState.workspaceTransition === null && ctl.missionState.mission === null &&
    evaluateActiveSessionTransform({
      turn: ctl.turnState.turn,
      hasPendingInteractions: ctl.interactions.hasPending(),
      sessionOperationInProgress: ctl.sessionState.sessionOperationInProgress,
      refreshInProgress: ctl.catalogState.refreshInProgress,
      settingsUpdateInProgress: ctl.metadata.settingsUpdate !== null,
    }).kind === 'eligible';
}

export function readControllerIde(ctl: ChatController): IdeState {
  if (!ctl.nativeIde) return UNAVAILABLE_IDE;
  if (ctl.ideReconnectInProgress) return {
    status: 'reconnecting', canReconnect: false,
    message: ctl.sessionState.connection.status === 'connecting'
      ? 'Restoring this conversation on its new IDE connection…'
      : 'Reconnecting this conversation to the IDE…',
  };
  if (ctl.ideReconnectError?.sessionId === ctl.sessionState.sessionId) return {
    status: 'error', canReconnect: eligible(ctl), message: ctl.ideReconnectError.message,
  };
  const state = ctl.nativeIde.read(ctl.sessionState.sessionId);
  return {
    ...state,
    canReconnect: eligible(ctl),
    ...(state.status === 'reconnect-required' && isTurnActive(ctl.turnState.turn)
      ? { message: 'The background task is still running. IDE will reconnect after it finishes.' }
      : {}),
  };
}

export function emitIdeState(ctl: ChatController): void {
  if (ctl.sessionState.disposed) return;
  ctl.emit({
    type: 'host.ide', conversationId: ctl.sessionState.conversationId,
    sessionId: ctl.sessionState.sessionId, ide: readControllerIde(ctl),
  });
}

export async function reconnectControllerIde(ctl: ChatController, sessionId: string, deferIfBlocked = false): Promise<void> {
  if (sessionId !== ctl.sessionState.sessionId || !eligible(ctl) ||
      !ensureActiveRuntimeWorkspaceCurrent(ctl)) {
    emitIdeState(ctl);
    return;
  }
  const backend = ctl.nativeIde!;
  const runtime = ctl.sessionState.runtime!;
  const generation = ctl.sessionState.runtimeGeneration;
  let closingSource = false;
  let restored = false;
  const cwd = ctl.sessionState.activeRuntimeCwd!;
  const current = () => !ctl.sessionState.disposed && ctl.sessionState.runtime === runtime &&
    ctl.sessionState.runtimeGeneration === generation && ctl.sessionState.sessionId === sessionId &&
    ctl.sessionState.workspaceTransition === null && ctl.btwSideChat?.isBusy() !== true &&
    ctl.getWorkspaceContext().cwd === ctl.sessionState.workspaceContext.cwd;
  ctl.sessionState.sessionOperationInProgress = true;
  ctl.ideReconnectInProgress = true;
  ctl.ideReconnectError = null;
  emitIdeState(ctl);
  try {
    await ctl.effects.flushRecoveryCheckpoint();
    if (await backend.reconnect(sessionId, current, () => { closingSource = true; }, deferIfBlocked) === false) return;
    if (!current()) return;
    ctl.sessionState.connection = { status: 'connecting' };
    ctl.emitSnapshot();
    await replaceRuntime(ctl, { kind: 'resume', sessionId, cwd }, { preserveSessionWork: true });
    restored = ctl.sessionState.sessionId === sessionId && ctl.sessionState.connection.status === 'connected';
    if (ctl.sessionState.sessionId === sessionId && ctl.sessionState.connection.status !== 'connected') {
      ctl.ideReconnectError = { sessionId, message: 'IDE reconnection could not restore this session. History is retained; use Retry.' };
    }
  } catch (error) {
    ctl.recordHost({ level: 'warn', name: 'ide.native.reconnect-failed',
      detail: error instanceof Error ? error.message : 'IDE reconnection failed.' });
    if (ctl.sessionState.sessionId === sessionId) {
      ctl.ideReconnectError = { sessionId, message: 'IDE reconnection was not completed. Finish background tasks and close managed terminals, then retry. See Droid Logs for details.' };
      if (closingSource && current()) {
        ctl.sessionState.connection = {
          status: 'unavailable', message: 'IDE reconnection could not finish. Retry to restore the saved session.',
        };
        ctl.emitSnapshot();
      }
    }
  } finally {
    ctl.ideReconnectInProgress = false;
    // This call owns the operation lock until it settles. A workspace change
    // replaces the runtime generation, but cannot start another locked operation.
    ctl.sessionState.sessionOperationInProgress = false;
    emitIdeState(ctl);
    resumeRecoveredIdeReconnect(ctl);
    if (ctl.sessionState.sessionId === sessionId && ctl.getWorkspaceContext().cwd === cwd) {
      if (restored) maybeDispatchQueue(ctl);
      else if (ctl.queueState.queuedPrompts.items.length > 0) pauseQueueAsBlocked(ctl);
    }
  }
}
