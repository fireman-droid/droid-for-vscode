import { expect, it, vi } from 'vitest';
import {
  createController, createMockRuntime, ready, send, successfulTurn,
  turnStates, waitForConnected, waitForInteraction,
  type RuntimeInteractionHandler, type RuntimePermissionResult,
} from './controllerTestHarness';

it('uses the active session confirmed autonomy for its default plan approval', async () => {
  let handler!: RuntimeInteractionHandler;
  let result: RuntimePermissionResult | undefined;
  const runtime = createMockRuntime(async function* () {
    result = await handler.requestPermission({
      options: ['proceed_once', 'proceed_auto_run_low', 'proceed_auto_run_medium', 'proceed_auto_run_high']
        .map((value) => ({ label: value, value, requiresEditedSpec: false })),
      toolUses: [{ toolUseId: 'plan', toolName: 'ExitSpecMode',
        confirmationKind: 'exit_spec_mode', title: 'Review plan', editableSpecContent: '# Plan' }],
    });
    yield successfulTurn();
  });
  runtime.readSessionSettings.mockResolvedValue({
    interactionMode: 'spec', modelId: 'model-1', reasoningEffort: 'high',
    autonomyLevel: 'medium', specModeModelId: null, specModeReasoningEffort: null,
  });
  const { controller, messages } = createController((interactionHandler) => {
    handler = interactionHandler;
    return runtime;
  });
  try {
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => expect(controller.metadata.settings.value?.autonomyLevel).toBe('medium'));
    send(controller, 'session-1', 'turn-1', 'Plan');
    const pending = await waitForInteraction(messages, 'permission');
    if (pending.request.kind !== 'permission') throw new Error('Expected permission');
    const selectedOption = pending.request.options[0]!.value;
    expect(selectedOption).toBe('proceed_auto_run_medium');
    controller.handleMessage({ type: 'permission.respond', sessionId: 'session-1',
      turnId: 'turn-1', requestId: pending.request.requestId, selectedOption });
    await vi.waitFor(() => expect(turnStates(messages).at(-1)?.status).toBe('completed'));
    expect(result).toEqual({ selectedOption: 'proceed_auto_run_medium' });
    expect(runtime.updateSessionSetting).not.toHaveBeenCalled();
  } finally {
    await controller.dispose();
  }
});
