import { describe, expect, it, vi } from 'vitest';
import {
  createController,
  createMockRuntime,
  ready,
  waitForConnected,
} from '../chat/controllerTestHarness';
import { applyModelToChat, readModelApplyState } from './modelChatApply';

async function fixture() {
  const runtime = createMockRuntime();
  runtime.readModelCatalog.mockResolvedValue({
    status: 'available',
    items: [
      {
        id: 'actual-id',
        displayName: 'Configured model',
        supportedReasoningEfforts: ['high'],
      },
    ],
  });
  const { controller, messages } = createController(() => runtime);
  ready(controller);
  await waitForConnected(messages);
  await vi.waitFor(() => expect(readModelApplyState(controller).canApply).toBe(true));
  return { runtime, controller };
}

describe('Models current-chat selection', () => {
  it('reloads only an idle chat and waits for confirmed settings without changing its mode', async () => {
    const { controller, runtime } = await fixture();
    const settings = await runtime.readSessionSettings();
    runtime.updateSessionSetting.mockResolvedValue({ ...settings, modelId: 'actual-id' });
    try {
      await applyModelToChat(controller, 'actual-id', new AbortController().signal);
      expect(runtime.updateSessionSetting).toHaveBeenCalledWith({
        field: 'modelId',
        value: 'actual-id',
      });
      expect(controller.metadata.settings.value).toMatchObject({
        modelId: 'actual-id',
        interactionMode: settings.interactionMode,
        autonomyLevel: settings.autonomyLevel,
      });
    } finally {
      await controller.dispose();
    }
  });
  it('does not reload a busy chat and rejects an unconfirmed selection', async () => {
    const { controller, runtime } = await fixture();
    try {
      controller.sessionState.sessionOperationInProgress = true;
      await expect(
        applyModelToChat(controller, 'actual-id', new AbortController().signal),
      ).rejects.toThrow('Finish');
      expect(runtime.dispose).not.toHaveBeenCalled();
      controller.sessionState.sessionOperationInProgress = false;
      await expect(
        applyModelToChat(controller, 'actual-id', new AbortController().signal),
      ).rejects.toThrow('did not confirm');
    } finally {
      await controller.dispose();
    }
  });
});
