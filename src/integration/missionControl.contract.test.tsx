import { describe, expect, it, vi } from 'vitest';

import type { MissionGateway } from '../extension/chat/mission/MissionGateway';
import {
  createController,
  createMockRuntime,
  ready,
  waitForConnected,
} from '../extension/controllerTestHarness';

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
    controller.modelCatalog = {
      status: 'ready',
      items: [
        {
          id: 'model-orchestrator',
          displayName: 'Orchestrator',
          supportedReasoningEfforts: ['high'],
        },
      ],
    };

    controller.handleMessage(startMessage);

    await vi.waitFor(() => {
      expect(gateway.start).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          message: startMessage,
          workspaceId: 'C:\\workspace',
        }),
      );
      expect(controller.sessionId).toBe('orchestrator-2');
      expect(controller.recoveryStore.getSelectedSessionId()).toBe(
        'orchestrator-2',
      );
      expect(controller.managedRuntimes.has(missionRuntime)).toBe(true);
    });
    expect(
      messages.find(
        (message) =>
          message.type === 'mission.controlResult' &&
          message.status === 'accepted',
      ),
    ).toMatchObject({
      requestId: 'mission-start-1',
      action: 'start',
    });
    expect(controller.transcript.transcript[0]).toMatchObject({
      kind: 'user',
      text: startMessage.task,
    });
  });
});
