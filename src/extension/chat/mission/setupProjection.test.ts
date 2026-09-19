import { describe, expect, it, vi } from 'vitest';

import { createMissionControlSetupProjection } from './setupProjection';

describe('Mission Control setup projection', () => {
  it('advances owner authority only when setup inputs change', () => {
    const controllerListeners: Array<() => void> = [];
    const capabilities = {
      currentChat: {
        modelId: 'orchestrator-model',
        reasoningEffort: 'high' as const,
      },
      catalogStatus: 'ready' as const,
      catalog: [],
      preferences: {
        worker: {
          mode: 'same-as-orchestrator' as const,
          modelId: 'orchestrator-model',
          reasoningEffort: 'high' as const,
        },
        validator: {
          mode: 'same-as-orchestrator' as const,
          modelId: 'orchestrator-model',
          reasoningEffort: 'high' as const,
        },
        scrutinyEnabled: true,
        userTestingEnabled: true,
      },
    };
    const controller = {
      sessionState: {
        workspaceContextGeneration: 2,
        runtimeGeneration: 3,
        workspaceContext: { cwd: 'D:\\workspace', trusted: true },
        connection: { status: 'connected' },
        runtime: {},
        sessionId: 'session-private',
        sessionOperationInProgress: false,
      },
      metadata: {
        settings: {
          status: 'ready',
          value: {
            modelId: 'orchestrator-model',
            reasoningEffort: 'high',
          },
        },
        modelCatalog: { status: 'ready', items: [] },
        settingsUpdate: null,
      },
      catalogState: { refreshInProgress: false },
      missionState: { missionStartInProgress: false },
      turnState: { turn: null },
      missionGateway: {
        setupCapabilitiesFor: vi.fn(() => capabilities),
      },
      subscribe: (listener: () => void) => {
        controllerListeners.push(listener);
        return { dispose: () => undefined };
      },
    };
    const projection = createMissionControlSetupProjection(controller as never);
    const onChange = vi.fn();
    projection.subscribe(onChange);

    expect(projection.read()).toMatchObject({
      workspaceAuthorityRevision: 2,
      chatOwnerRevision: 0,
      availability: 'ready',
      reason: null,
    });
    controllerListeners[0]?.();
    expect(onChange).not.toHaveBeenCalled();

    controller.turnState.turn = {} as never;
    controllerListeners[0]?.();
    expect(onChange).toHaveBeenCalledOnce();
    expect(projection.read()).toMatchObject({
      chatOwnerRevision: 1,
      availability: 'busy',
      reason: 'chat-busy',
    });
  });
});
