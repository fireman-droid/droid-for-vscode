import { describe, expect, it, vi } from 'vitest';
import { createController, createMockRuntime, lastMessage, ready, waitForConnected } from './controllerTestHarness';
import type { RuntimeModelCatalogItem } from '../../runtime/DroidRuntime';

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
