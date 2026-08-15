import { describe, expect, it, vi } from 'vitest';

import {
  available,
  createController,
  createMemoryPersistence,
  createMockRuntime,
  deferred,
  lastMessage,
  ready,
  type RuntimeInteractionHandler,
  send,
  SessionRecoveryStore,
  snapshots,
  successfulTurn,
  turnStates,
  waitForConnected,
  waitForInteraction,
} from './controllerTestHarness';

describe('ChatController', () => {
  it('loads settings, context, and the fail-closed model catalog after activation and snapshots them on reload', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: {
            modelId: 'model-1',
            interactionMode: 'auto',
          },
        },
      });
      expect(
        lastMessage(messages, 'session.context'),
      ).toMatchObject({
        context: {
          status: 'ready',
          value: {
            availability: 'available',
            used: 40,
            remaining: 60,
            limit: 100,
          },
        },
      });
      expect(
        lastMessage(messages, 'session.model-catalog'),
      ).toMatchObject({
        modelCatalog: { status: 'unsupported', items: [] },
      });
    });

    ready(controller);
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)).toMatchObject({
        settings: { status: 'ready' },
        context: { status: 'ready' },
        modelCatalog: { status: 'unsupported', items: [] },
      });
    });
  });

  it('updates stable settings from the authoritative reread and refuses model updates without a catalog', async () => {
    const runtime = createMockRuntime();
    runtime.updateSessionSetting.mockResolvedValue({
      interactionMode: 'mission',
      modelId: 'model-1',
      reasoningEffort: 'high',
      autonomyLevel: 'medium',
      specModeModelId: null,
      specModeReasoningEffort: null,
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readSessionSettings).toHaveBeenCalledOnce();
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'modelId',
      value: 'unverified-model',
    });
    expect(runtime.updateSessionSetting).not.toHaveBeenCalled();
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'settings-update-unsupported',
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'interactionMode',
      value: 'spec',
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenCalledWith({
        field: 'interactionMode',
        value: 'spec',
      });
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: { interactionMode: 'mission' },
        },
      });
    });
  });

  it('allows model and reasoning updates only from the projected Droid catalog', async () => {
    const runtime = createMockRuntime();
    runtime.readModelCatalog.mockResolvedValue({
      status: 'available',
      items: [
        {
          id: 'model-1',
          displayName: 'Model One',
          supportedReasoningEfforts: ['high'],
        },
        {
          id: 'model-2',
          displayName: 'Model Two',
          supportedReasoningEfforts: ['low', 'medium'],
        },
      ],
    });
    runtime.updateSessionSetting
      .mockResolvedValueOnce({
        interactionMode: 'auto',
        modelId: 'model-2',
        reasoningEffort: 'medium',
        autonomyLevel: 'medium',
        specModeModelId: null,
        specModeReasoningEffort: null,
      })
      .mockResolvedValueOnce({
        interactionMode: 'auto',
        modelId: 'model-2',
        reasoningEffort: 'low',
        autonomyLevel: 'medium',
        specModeModelId: null,
        specModeReasoningEffort: null,
      });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'session.model-catalog'),
      ).toMatchObject({
        modelCatalog: {
          status: 'ready',
          items: [
            { id: 'model-1', displayName: 'Model One' },
            { id: 'model-2', displayName: 'Model Two' },
          ],
        },
      });
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'modelId',
      value: 'model-2',
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenNthCalledWith(1, {
        field: 'modelId',
        value: 'model-2',
      });
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: { modelId: 'model-2', reasoningEffort: 'medium' },
        },
      });
    });
    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'reasoningEffort',
      value: 'low',
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenNthCalledWith(2, {
        field: 'reasoningEffort',
        value: 'low',
      });
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: { modelId: 'model-2', reasoningEffort: 'low' },
        },
      });
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'reasoningEffort',
      value: 'max',
    });
    expect(runtime.updateSessionSetting).toHaveBeenCalledTimes(2);
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'settings-update-unsupported',
    });
  });

  it('applies spec drafting overrides from the catalog and accepts null resets', async () => {
    const runtime = createMockRuntime();
    runtime.readModelCatalog.mockResolvedValue({
      status: 'available',
      items: [
        {
          id: 'model-1',
          displayName: 'Model One',
          supportedReasoningEfforts: ['high'],
        },
        {
          id: 'model-2',
          displayName: 'Model Two',
          supportedReasoningEfforts: ['low', 'medium'],
        },
      ],
    });
    runtime.updateSessionSetting
      .mockResolvedValueOnce({
        interactionMode: 'auto',
        modelId: 'model-1',
        reasoningEffort: 'high',
        autonomyLevel: 'medium',
        specModeModelId: 'model-2',
        specModeReasoningEffort: null,
      })
      .mockResolvedValueOnce({
        interactionMode: 'auto',
        modelId: 'model-1',
        reasoningEffort: 'high',
        autonomyLevel: 'medium',
        specModeModelId: 'model-2',
        specModeReasoningEffort: 'low',
      })
      .mockResolvedValueOnce({
        interactionMode: 'auto',
        modelId: 'model-1',
        reasoningEffort: 'high',
        autonomyLevel: 'medium',
        specModeModelId: null,
        specModeReasoningEffort: null,
      });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'session.model-catalog'),
      ).toMatchObject({ modelCatalog: { status: 'ready' } });
    });

    // Unknown drafting models are refused before the runtime.
    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeModelId',
      value: 'unverified-model',
    });
    expect(runtime.updateSessionSetting).not.toHaveBeenCalled();
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'settings-update-unsupported',
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeModelId',
      value: 'model-2',
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenNthCalledWith(1, {
        field: 'specModeModelId',
        value: 'model-2',
      });
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: { specModeModelId: 'model-2' },
        },
      });
    });

    // Spec reasoning effort is validated against the drafting model,
    // not the session model.
    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeReasoningEffort',
      value: 'low',
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenNthCalledWith(2, {
        field: 'specModeReasoningEffort',
        value: 'low',
      });
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: { specModeReasoningEffort: 'low' },
        },
      });
    });

    // A null reset needs no catalog knowledge.
    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'specModeModelId',
      value: null,
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenNthCalledWith(3, {
        field: 'specModeModelId',
        value: null,
      });
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'ready',
          value: { specModeModelId: null },
        },
      });
    });
  });

  it('adopts the implementation session after an approved spec handoff turn completes', async () => {
    let interactionHandler!: RuntimeInteractionHandler;
    const planning = createMockRuntime(async function* () {
      const result = await interactionHandler.requestPermission({
        options: [
          {
            label: 'Approve and start',
            value: 'proceed_new_session',
            requiresEditedSpec: false,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'ExitSpecMode',
            confirmationKind: 'exit_spec_mode',
            title: 'Ready to build',
            detail: '# Plan',
            editableSpecContent: '# Plan',
          },
        ],
      });
      expect(result.selectedOption).toBe('proceed_new_session');
      yield {
        type: 'spec-handoff' as const,
        implementationSessionId: 'session-impl',
      };
      yield successfulTurn();
    });
    const implementation = createMockRuntime();
    implementation.initialize.mockResolvedValue(
      available('session-impl'),
    );
    const createRuntime = vi.fn(
      (handler: RuntimeInteractionHandler) => {
        interactionHandler = handler;
        return createRuntime.mock.calls.length === 1
          ? planning
          : implementation;
      },
    );
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Draft a plan');
    const permission = await waitForInteraction(messages, 'permission');
    controller.handleMessage({
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: permission.request.requestId,
      selectedOption: 'proceed_new_session',
    });

    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessionId).toBe(
        'session-impl',
      );
    });
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'runtime.diagnostic',
          severity: 'info',
          code: 'spec-handoff-detected',
        }),
      ]),
    );
    expect(planning.dispose).toHaveBeenCalledOnce();
    expect(implementation.initialize).toHaveBeenCalledWith({
      kind: 'resume',
      cwd: 'C:\\workspace',
      sessionId: 'session-impl',
    });
  });

  it('warns visibly when an approved spec handoff never identifies the implementation session', async () => {
    let interactionHandler!: RuntimeInteractionHandler;
    const runtime = createMockRuntime(async function* () {
      await interactionHandler.requestPermission({
        options: [
          {
            label: 'Approve and start',
            value: 'proceed_new_session_high',
            requiresEditedSpec: false,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'ExitSpecMode',
            confirmationKind: 'exit_spec_mode',
            title: 'Ready to build',
            detail: '# Plan',
          },
        ],
      });
      yield successfulTurn();
    });
    const createRuntime = vi.fn(
      (handler: RuntimeInteractionHandler) => {
        interactionHandler = handler;
        return runtime;
      },
    );
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Draft a plan');
    const permission = await waitForInteraction(messages, 'permission');
    controller.handleMessage({
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: permission.request.requestId,
      selectedOption: 'proceed_new_session_high',
    });

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'runtime.diagnostic'),
      ).toMatchObject({ code: 'spec-handoff-not-detected' });
    });
    // No replacement happens without an identified session.
    expect(createRuntime).toHaveBeenCalledOnce();
  });

  it('rejects wrong-session and duplicate setting updates and retains confirmed values on failure', async () => {
    const update = deferred<never>();
    const runtime = createMockRuntime();
    runtime.updateSessionSetting.mockReturnValue(update.promise);
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readSessionSettings).toHaveBeenCalledOnce();
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'wrong-session',
      field: 'autonomyLevel',
      value: 'high',
    });
    expect(runtime.updateSessionSetting).not.toHaveBeenCalled();

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'autonomyLevel',
      value: 'high',
    });
    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'interactionMode',
      value: 'spec',
    });
    expect(runtime.updateSessionSetting).toHaveBeenCalledOnce();
    expect(messages.at(-1)).toMatchObject({
      type: 'runtime.diagnostic',
      code: 'settings-update-blocked',
    });

    update.reject(new Error('sensitive SDK failure'));
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'session.settings'),
      ).toMatchObject({
        settings: {
          status: 'error',
          value: { autonomyLevel: 'medium' },
          message: 'Droid session settings could not be updated.',
        },
      });
    });
  });

  it('applies an authoritative setting update while a turn is active', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      await release.promise;
      yield successfulTurn();
    });
    runtime.updateSessionSetting.mockResolvedValue({
      interactionMode: 'auto',
      modelId: 'model-1',
      reasoningEffort: 'high',
      autonomyLevel: 'high',
      specModeModelId: null,
      specModeReasoningEffort: null,
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readSessionSettings).toHaveBeenCalledOnce();
    });

    send(controller, 'session-1', 'active-turn', 'Keep working');
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledOnce();
    });
    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'autonomyLevel',
      value: 'high',
    });

    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenCalledWith({
        field: 'autonomyLevel',
        value: 'high',
      });
      expect(lastMessage(messages, 'session.settings')).toMatchObject({
        settings: {
          status: 'ready',
          value: { autonomyLevel: 'high' },
        },
      });
    });
    release.resolve();
  });

  it('rereads authoritative settings when the SDK reports a settings change', async () => {
    const runtime = createMockRuntime(async function* () {
      yield { type: 'settings-updated' };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readSessionSettings).toHaveBeenCalledOnce();
    });
    runtime.readSessionSettings.mockResolvedValue({
      interactionMode: 'auto',
      modelId: 'model-1',
      reasoningEffort: 'high',
      autonomyLevel: 'medium',
      specModeModelId: null,
      specModeReasoningEffort: null,
    });

    send(controller, 'session-1', 'settings-event', 'Implement the plan');

    await vi.waitFor(() => {
      expect(runtime.readSessionSettings).toHaveBeenCalledTimes(2);
      expect(lastMessage(messages, 'session.settings')).toMatchObject({
        settings: {
          status: 'ready',
          value: { interactionMode: 'auto' },
        },
      });
    });
  });

  it('refreshes context on activation, explicit refresh, and terminal turn completion', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readContextWindow).toHaveBeenCalledTimes(1);
    });

    controller.handleMessage({
      type: 'session.context.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(runtime.readContextWindow).toHaveBeenCalledTimes(2);
    });

    send(controller, 'session-1', 'turn-context', 'Continue');
    await vi.waitFor(() => {
      expect(runtime.readContextWindow).toHaveBeenCalledTimes(3);
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
  });

  it('retains confirmed context across a failed refresh and retries once', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'session.context')).toMatchObject({
        context: {
          status: 'ready',
          value: {
            availability: 'available',
            used: 40,
            remaining: 60,
            limit: 100,
          },
        },
      });
    });
    runtime.readContextWindow.mockRejectedValueOnce(
      new Error('sensitive SDK failure'),
    );

    controller.handleMessage({
      type: 'session.context.refresh',
      sessionId: 'session-1',
    });
    controller.handleMessage({
      type: 'session.context.refresh',
      sessionId: 'session-1',
    });

    await vi.waitFor(() => {
      expect(runtime.readContextWindow).toHaveBeenCalledTimes(2);
      expect(lastMessage(messages, 'session.context')).toMatchObject({
        context: {
          status: 'error',
          value: {
            availability: 'available',
            used: 40,
            remaining: 60,
            limit: 100,
          },
          message: expect.stringContaining('DroidVisX Logs'),
        },
      });
    });
    runtime.readContextWindow.mockResolvedValueOnce({
      availability: 'unavailable',
      reason: 'invalid-last-call',
    });
    controller.handleMessage({
      type: 'session.context.refresh',
      sessionId: 'session-1',
    });

    await vi.waitFor(() => {
      expect(runtime.readContextWindow).toHaveBeenCalledTimes(3);
      expect(lastMessage(messages, 'session.context')).toMatchObject({
        context: {
          status: 'ready',
          value: {
            availability: 'unavailable',
            reason: 'invalid-last-call',
          },
        },
      });
    });
  });

  it('discards a stale Context response after a workspace generation change', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a' as string | null,
      trusted: true,
    };
    const refresh = deferred<{
      availability: 'available';
      used: number;
      remaining: number;
      limit: number;
    }>();
    const runtime = createMockRuntime();
    const { controller, messages } = createController(
      () => runtime,
      workspace,
    );
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readContextWindow).toHaveBeenCalledOnce();
    });
    runtime.readContextWindow.mockReturnValueOnce(refresh.promise);

    controller.handleMessage({
      type: 'session.context.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(runtime.readContextWindow).toHaveBeenCalledTimes(2);
    });
    const changedAt = messages.length;
    workspace.trusted = false;
    controller.handleWorkspaceContextChanged();
    refresh.resolve({
      availability: 'available',
      used: 99,
      remaining: 1,
      limit: 100,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      messages.slice(changedAt).some(
        (message) =>
          message.type === 'session.context' &&
          message.context.status === 'ready' &&
          message.context.value.availability === 'available' &&
          message.context.value.used === 99,
      ),
    ).toBe(false);
    expect(snapshots(messages).at(-1)?.context).toEqual({
      status: 'loading',
      value: null,
    });
  });

  it('discards a stale setting update after a workspace generation change', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a' as string | null,
      trusted: true,
    };
    const update = deferred<{
      interactionMode: 'mission';
      modelId: 'stale-model';
      reasoningEffort: 'max';
      autonomyLevel: 'high';
      specModeModelId: null;
      specModeReasoningEffort: null;
    }>();
    const runtime = createMockRuntime();
    runtime.updateSessionSetting.mockReturnValue(update.promise);
    const { controller, messages } = createController(
      () => runtime,
      workspace,
    );
    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readSessionSettings).toHaveBeenCalledOnce();
    });

    controller.handleMessage({
      type: 'session.setting.update',
      sessionId: 'session-1',
      field: 'interactionMode',
      value: 'mission',
    });
    await vi.waitFor(() => {
      expect(runtime.updateSessionSetting).toHaveBeenCalledOnce();
    });
    const changedAt = messages.length;
    workspace.trusted = false;
    controller.handleWorkspaceContextChanged();
    update.resolve({
      interactionMode: 'mission',
      modelId: 'stale-model',
      reasoningEffort: 'max',
      autonomyLevel: 'high',
      specModeModelId: null,
      specModeReasoningEffort: null,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      messages.slice(changedAt).some(
        (message) =>
          message.type === 'session.settings' &&
          message.settings.status === 'ready' &&
          message.settings.value.modelId === 'stale-model',
      ),
    ).toBe(false);
    expect(snapshots(messages).at(-1)?.settings).toEqual({
      status: 'loading',
      value: null,
    });
  });

  it('flushes and disposes recovery state with the runtime exactly once', async () => {
    const recovery = new SessionRecoveryStore(
      createMemoryPersistence(),
      'recovery',
      0,
    );
    const flush = vi.spyOn(recovery, 'flush');
    const disposeRecovery = vi.spyOn(recovery, 'dispose');
    const runtime = createMockRuntime();
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);

    const disposal = controller.dispose();
    expect(controller.dispose()).toBe(disposal);
    await disposal;

    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalled();
    expect(disposeRecovery).toHaveBeenCalledOnce();
  });
});
