import { describe, expect, it, vi } from 'vitest';

import type { MissionGateway } from '../extension/chat/mission/MissionGateway';
import { emitMissionSetupCapabilities } from '../extension/chat/mission/setupProjection';
import {
  createController,
  createMockRuntime,
  ready,
  waitForConnected,
} from '../extension/chat/controllerTestHarness';

const startMessage = {
  type: 'mission.start' as const,
  protocolVersion: 25 as const,
  requestId: 'mission-start-1',
  scope: 'selected-chat' as const,
  task: 'Implement the Mission entry gateway',
  orchestrator: {
    modelId: 'model-orchestrator',
    reasoningEffort: 'high' as const,
  },
  worker: {
    mode: 'same-as-orchestrator' as const,
    modelId: 'model-orchestrator',
    reasoningEffort: 'high' as const,
  },
  validator: {
    mode: 'same-as-orchestrator' as const,
    modelId: 'model-orchestrator',
    reasoningEffort: 'high' as const,
  },
  scrutinyEnabled: true,
  userTestingEnabled: true,
};

describe('Mission entry contract', () => {
  it('direct starts through official Mission gates', async () => {
    const missionRuntime = createMockRuntime();
    const gateway = {
      setupCapabilitiesFor: vi.fn(
        (
          _workspaceId: string,
          orchestrator: typeof startMessage.orchestrator,
          catalog: {
            readonly status: 'loading' | 'ready' | 'error' | 'unsupported';
            readonly items: readonly {
              readonly id: string;
              readonly displayName: string;
              readonly supportedReasoningEfforts: readonly string[];
            }[];
          },
        ) => ({
          currentChat: orchestrator,
          catalogStatus: catalog.status,
          catalog: catalog.items,
          preferences: {
            worker: {
              mode: 'same-as-orchestrator' as const,
              ...orchestrator,
            },
            validator: {
              mode: 'same-as-orchestrator' as const,
              ...orchestrator,
            },
            scrutinyEnabled: true,
            userTestingEnabled: true,
          },
        }),
      ),
      start: vi.fn(async () => ({
        status: 'ready' as const,
        sessionId: 'orchestrator-2',
        runtime: {
          runtime: missionRuntime,
          initialize: async () => {},
        },
        settings: {
          workerModel: 'model-orchestrator',
          workerReasoningEffort: 'high' as const,
          validationWorkerModel: 'model-orchestrator',
          validationWorkerReasoningEffort: 'high' as const,
          skipScrutiny: false,
          skipUserTesting: false,
        },
      })),
    } as unknown as MissionGateway;
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      gateway,
    );
    ready(controller);
    await waitForConnected(messages);
    controller.metadata.modelCatalog = {
      status: 'ready',
      items: [
        {
          id: 'model-orchestrator',
          displayName: 'Orchestrator',
          supportedReasoningEfforts: ['high'],
        },
      ],
    };
    controller.metadata.settings = {
      status: 'ready',
      value: {
        interactionMode: 'auto',
        modelId: 'model-orchestrator',
        reasoningEffort: 'high',
        autonomyLevel: 'medium',
        specModeModelId: null,
        specModeReasoningEffort: null,
      },
    };
    emitMissionSetupCapabilities(controller);

    expect(
      messages.find(
        (candidate) =>
          candidate.type === 'mission.snapshot' &&
          candidate.setup?.catalogStatus === 'ready',
      ),
    ).toMatchObject({
      setup: {
        currentChat: startMessage.orchestrator,
        catalog: [
          {
            id: 'model-orchestrator',
            supportedReasoningEfforts: ['high'],
          },
        ],
        preferences: {
          worker: {
            mode: 'same-as-orchestrator',
            ...startMessage.orchestrator,
          },
          validator: {
            mode: 'same-as-orchestrator',
            ...startMessage.orchestrator,
          },
        },
      },
    });

    controller.handleMessage(startMessage);

    await vi.waitFor(() => {
      expect(gateway.start).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: startMessage,
          workspaceId: 'C:\\workspace',
        }),
      );
      expect(controller.sessionState.sessionId).toBe('orchestrator-2');
      expect(controller.recoveryStore.getSelectedSessionId()).toBe('orchestrator-2');
      expect(controller.sessionState.managedRuntimes.has(missionRuntime)).toBe(true);
    });
    expect(
      messages.find(
        (message) =>
          message.type === 'mission.controlResult' && message.status === 'accepted',
      ),
    ).toMatchObject({
      requestId: 'mission-start-1',
      action: 'start',
    });
    expect(controller.recoveryState.transcript.transcript[0]).toMatchObject({
      kind: 'user',
      text: startMessage.task,
    });
  });
});
