import { setTimeout as delay } from 'node:timers/promises';
import type { ChatController } from '../chat/ChatController';
import { handleSettingUpdate } from '../chat/capabilities/settings';
import { isTurnActive } from '../chat/internals';
import { ModelManagerError, type ModelApplyState } from './ModelManager';

export function readModelApplyState(ctl: ChatController): ModelApplyState {
  const activeModelId = ctl.metadata.settings.value?.modelId ?? null;
  const unavailable =
    ctl.sessionState.disposed ||
    ctl.sessionState.connection.status !== 'connected' ||
    ctl.sessionState.sessionId === null ||
    ctl.sessionState.activeRuntimeCwd === null;
  const busy =
    isTurnActive(ctl.turnState.turn) ||
    ctl.hasPendingInteractions() ||
    ctl.sessionState.sessionOperationInProgress ||
    ctl.catalogState.refreshInProgress ||
    ctl.metadata.settingsUpdate !== null ||
    ctl.queueState.queuedPrompts.items.length > 0 ||
    ctl.metadata.settings.status !== 'ready' ||
    ctl.missionState.mission !== null;
  return {
    activeModelId,
    canApply: !unavailable && !busy,
    message: unavailable
      ? 'Connect a chat before selecting a model here.'
      : busy
        ? 'Finish the current task, queued messages or interaction before changing the chat model.'
        : 'Using a model refreshes the idle chat and waits for Droid to confirm the selection.',
  };
}

export async function applyModelToChat(
  ctl: ChatController,
  runtimeId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const state = readModelApplyState(ctl);
  if (!state.canApply) throw new ModelManagerError(state.message);
  if (!ctl.ensureWorkspaceCurrent())
    throw new ModelManagerError('The workspace changed. Reconnect the chat first.');
  const sessionId = ctl.sessionState.sessionId!;
  const cwd = ctl.sessionState.activeRuntimeCwd!;
  ctl.effects.startReplacement({ kind: 'resume', cwd, sessionId });
  const generation = ctl.sessionState.runtimeGeneration;
  const requireCurrent = (): void => {
    if (
      ctl.sessionState.disposed ||
      ctl.sessionState.runtimeGeneration !== generation ||
      ctl.sessionState.sessionId !== sessionId ||
      ctl.sessionState.activeRuntimeCwd !== cwd
    ) {
      throw new ModelManagerError(
        'The chat changed while loading the model. No selection was confirmed.',
      );
    }
  };
  // Metadata loading and the settings write settle after their final emitted
  // snapshot, so observe the owned state rather than an optimistic UI event.
  await waitFor(() => {
    requireCurrent();
    if (ctl.sessionState.sessionOperationInProgress) return false;
    if (
      ctl.sessionState.connection.status !== 'connected' ||
      ctl.metadata.settings.status === 'error' ||
      ctl.metadata.modelCatalog.status === 'error'
    ) {
      throw new ModelManagerError(
        'The chat could not reload its model catalog. Reconnect and retry.',
      );
    }
    return (
      ctl.metadata.settings.status === 'ready' &&
      ctl.metadata.modelCatalog.status === 'ready'
    );
  }, signal);
  const refreshed = readModelApplyState(ctl);
  if (!refreshed.canApply) throw new ModelManagerError(refreshed.message);
  const model = ctl.metadata.modelCatalog.items.find((item) => item.id === runtimeId);
  if (model === undefined) {
    throw new ModelManagerError(
      'This model is saved but is not loaded in the chat catalog.',
    );
  }
  if (model.disabled) throw new ModelManagerError(model.disabledReason!);
  handleSettingUpdate(ctl, {
    type: 'session.setting.update',
    sessionId,
    field: 'modelId',
    value: runtimeId,
  });
  await waitFor(() => {
    requireCurrent();
    return ctl.metadata.settingsUpdate === null;
  }, signal);
  if (
    ctl.metadata.settings.status !== 'ready' ||
    ctl.metadata.settings.value?.modelId !== runtimeId
  ) {
    throw new ModelManagerError('Droid did not confirm this model in the current chat.');
  }
}

async function waitFor(ready: () => boolean, signal: AbortSignal): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (!ready()) {
    if (Date.now() >= deadline)
      throw new ModelManagerError(
        'The chat update timed out. Refresh to see the actual selection.',
      );
    await delay(75, undefined, { signal });
  }
  signal.throwIfAborted();
}
