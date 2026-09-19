import { UNAVAILABLE_IDE, type IdeState } from '../../shared/protocol/ideProtocol';
import type { ChatController } from './ChatController';
import { isTurnActive } from './internals';
import { evaluateActiveSessionTransform } from './operationEligibility';
import { ensureActiveRuntimeWorkspaceCurrent, replaceRuntime } from './sessions/runtimeLifecycle';

export interface NativeIdeBackend {
  read(sessionId: string | null): Pick<IdeState, 'status' | 'message'>;
  reconnect(sessionId: string, isCurrent: () => boolean, onClosingSource: () => void): Promise<void>;
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
    status: 'reconnecting', canReconnect: false, message: 'Preparing native IDE reconnection. Conversation history is retained.',
  };
  if (ctl.ideReconnectError?.sessionId === ctl.sessionState.sessionId) return {
    status: 'error', canReconnect: eligible(ctl), message: ctl.ideReconnectError.message,
  };
  const state = ctl.nativeIde.read(ctl.sessionState.sessionId);
  return {
    ...state,
    canReconnect: eligible(ctl),
    ...(state.status === 'reconnect-required' && isTurnActive(ctl.turnState.turn)
      ? { message: 'The background task continues on its original daemon. Reconnect IDE after it finishes.' }
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

export async function reconnectControllerIde(ctl: ChatController, sessionId: string): Promise<void> {
  if (sessionId !== ctl.sessionState.sessionId || !eligible(ctl) ||
      !ensureActiveRuntimeWorkspaceCurrent(ctl)) {
    emitIdeState(ctl);
    return;
  }
  const backend = ctl.nativeIde!;
  const runtime = ctl.sessionState.runtime!;
  const generation = ctl.sessionState.runtimeGeneration;
  let operationGeneration = generation;
  let closingSource = false;
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
    await backend.reconnect(sessionId, current, () => { closingSource = true; });
    if (!current()) return;
    ctl.sessionState.connection = { status: 'connecting' };
    ctl.emitSnapshot();
    operationGeneration = generation + 1;
    await replaceRuntime(ctl, { kind: 'resume', sessionId, cwd }, { preserveSessionWork: true });
    if (ctl.sessionState.sessionId === sessionId && ctl.sessionState.connection.status !== 'connected') {
      ctl.ideReconnectError = { sessionId, message: 'IDE reconnection could not restore this session. History is retained; use Retry.' };
    }
  } catch (error) {
    ctl.recordHost({ level: 'warn', name: 'ide.native.reconnect-failed',
      detail: error instanceof Error ? error.message : 'IDE reconnection failed.' });
    if (ctl.sessionState.sessionId === sessionId) {
      ctl.ideReconnectError = { sessionId, message: 'IDE reconnection was not completed. Finish background tasks and close managed terminals, then retry. See DroidVisX Logs for details.' };
      if (closingSource && current()) {
        ctl.sessionState.connection = {
          status: 'unavailable', message: 'IDE reconnection could not finish. Retry to restore the saved session.',
        };
        ctl.emitSnapshot();
      }
    }
  } finally {
    ctl.ideReconnectInProgress = false;
    if (ctl.sessionState.runtimeGeneration === operationGeneration) ctl.sessionState.sessionOperationInProgress = false;
    emitIdeState(ctl);
  }
}
