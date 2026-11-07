import { describe, expect, it, vi } from 'vitest';
import type { MissionGatewayResult } from './mission/MissionGateway';
import type { MissionStartMessage } from '../../shared/protocol/missionProtocol';
import { createController, createMockRuntime, deferred, ready, send, waitForConnected } from './controllerTestHarness';

const message: MissionStartMessage = {
  type: 'mission.start', protocolVersion: 25, requestId: 'start-1', scope: 'selected-chat', task: 'Build the feature',
  orchestrator: { modelId: 'model-a', reasoningEffort: 'high' },
  worker: { mode: 'same-as-orchestrator', modelId: 'model-a', reasoningEffort: 'high' },
  validator: { mode: 'same-as-orchestrator', modelId: 'model-a', reasoningEffort: 'high' },
  scrutinyEnabled: true, userTestingEnabled: true,
};

async function fixture() {
  const start = deferred<MissionGatewayResult>();
  const gateway = {
    start: vi.fn(() => start.promise),
    setupCapabilitiesFor: () => ({ preferences: { scrutinyEnabled: true, userTestingEnabled: true } }),
  };
  const runtime = createMockRuntime();
  runtime.readModelCatalog.mockResolvedValue({ status: 'available', items: [{
    id: 'model-a', displayName: 'Model A', supportedReasoningEfforts: ['high'], defaultReasoningEffort: 'high',
    isCustom: false, supportsImages: false, supportsImageGeneration: false, disabled: false,
  }] });
  const workspace = { cwd: 'C:\\workspace', trusted: true };
  const { controller, messages } = createController(() => runtime, workspace);
  ready(controller);
  await waitForConnected(messages);
  await vi.waitFor(() => expect(controller.metadata.modelCatalog.status).toBe('ready'));
  Object.defineProperty(controller, 'missionGateway', { value: gateway });
  const candidate = createMockRuntime();
  const activateInteractions = vi.fn();
  const result: MissionGatewayResult = {
    status: 'ready', sessionId: 'mission-1', runtime: { runtime: candidate, initialize: async () => {} },
    activateInteractions,
    settings: { workerModel: 'model-a', workerReasoningEffort: 'high', validationWorkerModel: 'model-a',
      validationWorkerReasoningEffort: 'high', skipScrutiny: false, skipUserTesting: false },
  };
  return {
    controller, messages, runtime, workspace, gateway, start, result, candidate, activateInteractions,
    async close() {
      start.reject(new Error('Cancelled test preparation'));
      await vi.waitFor(() => expect(controller.missionState.missionStartInProgress).toBe(false));
      await controller.dispose();
    },
  };
}

describe('Mission creation owns session admission', () => {
  it('rejects ordinary sends while creation is pending, then sends the Mission task once', async () => {
    const f = await fixture();
    try {
      f.controller.handleMessage(message);
      expect(f.gateway.start).toHaveBeenCalledOnce();
      send(f.controller, 'session-1', 'ordinary-turn', 'Keep my ordinary draft');
      expect(f.controller.turnState.turn).toBeNull();
      expect(f.controller.recoveryState.transcript.transcript).toEqual([]);
      f.start.resolve(f.result);
      await vi.waitFor(() => expect(f.candidate.sendTurn).toHaveBeenCalledExactlyOnceWith(message.task, undefined));
      expect(f.runtime.sendTurn).not.toHaveBeenCalled();
      expect(f.controller.sessionState.sessionOperationInProgress).toBe(false);
      expect(f.activateInteractions).toHaveBeenCalledOnce();
    } finally { await f.close(); }
  });

  it('releases admission after creation fails without replacing the chat or replaying a rejected send', async () => {
    const f = await fixture();
    try {
      f.controller.handleMessage(message);
      send(f.controller, 'session-1', 'rejected-turn', 'Do not replay me');
      f.start.reject(new Error('Creation failed'));
      await vi.waitFor(() => expect(f.controller.missionState.missionStartInProgress).toBe(false));
      expect(f.controller.sessionState.sessionOperationInProgress).toBe(false);
      expect(f.controller.sessionState.runtime).toBe(f.runtime);
      expect(f.runtime.sendTurn).not.toHaveBeenCalled();
      send(f.controller, 'session-1', 'next-turn', 'Explicit new send');
      await vi.waitFor(() => expect(f.runtime.sendTurn).toHaveBeenCalledExactlyOnceWith('Explicit new send', undefined));
    } finally { await f.close(); }
  });

  it('disposes an unused candidate after a trust change and releases admission', async () => {
    const f = await fixture();
    try {
      f.controller.handleMessage(message);
      expect(f.controller.sessionState.sessionOperationInProgress).toBe(true);
      f.workspace.trusted = false;
      f.controller.handleWorkspaceContextChanged();
      f.start.resolve(f.result);
      await vi.waitFor(() => expect(f.candidate.dispose).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(f.controller.sessionState.sessionOperationInProgress).toBe(false));
      expect(f.activateInteractions).not.toHaveBeenCalled();
      expect(f.candidate.sendTurn).not.toHaveBeenCalled();
      expect(f.controller.sessionState.sessionId).not.toBe('mission-1');
    } finally { await f.close(); }
  });
});
