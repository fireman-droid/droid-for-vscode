import { describe, expect, it, vi } from 'vitest';
import { available, createController, createMemoryPersistence, createMockRuntime, lastMessage, ready, waitForConnected } from './controllerTestHarness';
import type { RuntimeModelCatalogItem } from '../../runtime/DroidRuntime';
import type { SavedModel } from '../../runtime/models/modelManagement';
import { DisabledModelsStore } from '../models/DisabledModelsStore';
import { ChatController, type ControllerHostMessage } from './ChatController';

const blocked: RuntimeModelCatalogItem = {
  id: 'model-1', displayName: 'Unavailable model', supportedReasoningEfforts: ['high'],
  defaultReasoningEffort: 'high', isCustom: false, supportsImages: false,
  supportsImageGeneration: false, disabled: true, disabledReason: 'Disabled by account policy',
};
async function fixture(model: RuntimeModelCatalogItem = blocked) {
  const runtime = createMockRuntime();
  runtime.readModelCatalog.mockResolvedValue({ status: 'available', items: [model] });
  const result = createController(() => runtime);
  ready(result.controller);
  await waitForConnected(result.messages);
  await vi.waitFor(() => expect(lastMessage(result.messages, 'session.model-catalog')).toMatchObject({ modelCatalog: { status: 'ready' } }));
  return { ...result, runtime };
}

describe('model availability enforcement', () => {
  it('refreshes shared model availability in both chats and keeps the parent subscribed after the child closes', async () => {
    const model: RuntimeModelCatalogItem = {
      ...blocked, displayName: 'Shared custom model', isCustom: true,
      disabled: false, disabledReason: undefined,
    };
    const saved: SavedModel = {
      rawIndex: 0, model: 'synthetic-model', displayName: model.displayName,
      provider: 'openai', baseUrl: 'https://models.example.test/v1',
      hasApiKey: false, hasBedrockConfig: false, isValid: true,
    };
    const availability = new DisabledModelsStore(createMemoryPersistence(), {
      list: async () => [saved],
      loaded: async () => [{ id: model.id, displayName: model.displayName, provider: saved.provider, disabledReason: null }],
    });
    const parentRuntime = createMockRuntime();
    const childRuntime = createMockRuntime();
    parentRuntime.readModelCatalog.mockResolvedValue({ status: 'available', items: [model] });
    childRuntime.readModelCatalog.mockResolvedValue({ status: 'available', items: [model] });
    childRuntime.initialize.mockResolvedValue(available('child-session'));
    const getWorkspaceContext = () => ({ cwd: 'C:\\workspace', trusted: true });
    const parent = new ChatController({
      createRuntime: () => parentRuntime, getWorkspaceContext,
      sharedServices: { modelAvailability: availability },
    });
    const child = new ChatController({
      createRuntime: () => childRuntime, getWorkspaceContext,
      childSession: { sessionId: 'child-session', cwd: 'C:\\workspace' },
      sharedServices: parent.sharedServices,
      sessionHistory: { loadHistory: async () => ({
        status: 'available', state: { transcript: [], historyStatus: 'complete', truncated: false },
      }) },
    });
    const parentMessages: ControllerHostMessage[] = [];
    const childMessages: ControllerHostMessage[] = [];
    parent.subscribe((message) => parentMessages.push(message));
    child.subscribe((message) => childMessages.push(message));
    try {
      ready(parent);
      ready(child);
      await Promise.all([waitForConnected(parentMessages), waitForConnected(childMessages)]);
      await vi.waitFor(() => {
        for (const messages of [parentMessages, childMessages]) {
          expect(lastMessage(messages, 'session.model-catalog')).toMatchObject({
            modelCatalog: { status: 'ready', items: [expect.objectContaining({ id: model.id })] },
          });
        }
      });

      await availability.setDisabled(saved, true);
      await vi.waitFor(() => {
        for (const messages of [parentMessages, childMessages]) {
          expect(lastMessage(messages, 'session.model-catalog')).toMatchObject({
            modelCatalog: { status: 'ready', items: [] },
          });
        }
      });

      await child.dispose();
      childRuntime.readModelCatalog.mockClear();
      const closedChildMessages = childMessages.length;
      await availability.setDisabled(saved, false);
      await vi.waitFor(() => expect(lastMessage(parentMessages, 'session.model-catalog')).toMatchObject({
        modelCatalog: { status: 'ready', items: [expect.objectContaining({ id: model.id })] },
      }));
      expect(childRuntime.readModelCatalog).not.toHaveBeenCalled();
      expect(childMessages).toHaveLength(closedChildMessages);
      expect(parentRuntime.dispose).not.toHaveBeenCalled();
    } finally {
      await Promise.all([child.dispose(), parent.dispose()]);
    }
  });

  it('blocks disabled main, Spec and reasoning changes before the runtime', async () => {
    const { controller, runtime, messages } = await fixture();
    try {
      for (const field of ['modelId', 'specModeModelId'] as const) {
        controller.handleMessage({ type: 'session.setting.update', sessionId: 'session-1', field, value: 'model-1' });
        expect(messages.at(-1)).toMatchObject({ type: 'runtime.diagnostic', message: 'Disabled by account policy' });
      }
      controller.handleMessage({ type: 'session.setting.update', sessionId: 'session-1', field: 'reasoningEffort', value: 'high' });
      expect(runtime.updateSessionSetting).not.toHaveBeenCalled();
    } finally { await controller.dispose(); }
  });

  it('refuses disabled models and unsupported images before starting a side question', async () => {
    const { controller, messages } = await fixture();
    try {
      controller.handleMessage({ type: 'btw.ask', sessionId: 'session-1', text: 'Question', modelId: 'model-1' });
      expect(messages.at(-1)).toMatchObject({ type: 'runtime.diagnostic', message: 'Disabled by account policy' });
      controller.metadata.modelCatalog = { status: 'ready', items: [{ ...blocked, disabled: false, disabledReason: undefined }] };
      controller.handleMessage({ type: 'btw.ask', sessionId: 'session-1', text: 'Question', modelId: 'model-1', images: [{ id: 'image-1', name: 'image.png', mediaType: 'image/png', dataBase64: 'YQ==' }] });
      expect(messages.at(-1)).toMatchObject({ type: 'runtime.diagnostic', message: expect.stringContaining('does not support images') });
    } finally { await controller.dispose(); }
  });
});
