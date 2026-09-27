import { describe, expect, it, vi } from 'vitest';

import type { MissionStartMessage } from '../../../shared/protocol/missionProtocol';
import { handleMissionStart } from './controller';

const message: MissionStartMessage = {
  type: 'mission.start',
  protocolVersion: 25,
  requestId: 'start-1',
  scope: 'selected-chat',
  task: 'Build the feature',
  orchestrator: { modelId: 'model-a', reasoningEffort: 'high' },
  worker: {
    mode: 'same-as-orchestrator',
    modelId: 'model-a',
    reasoningEffort: 'high',
  },
  validator: {
    mode: 'same-as-orchestrator',
    modelId: 'model-a',
    reasoningEffort: 'high',
  },
  scrutinyEnabled: true,
  userTestingEnabled: true,
};

describe('handleMissionStart', () => {
  it('disposes an initialized Mission Runtime when ownership changed', async () => {
    let resolveStart!: (value: unknown) => void;
    const activateInteractions = vi.fn();
    const missionRuntime = { dispose: vi.fn(async () => {}) };
    const ctl = {
      getWorkspaceContext: () => ({ cwd: 'D:/repo', trusted: true }),
      missionGateway: {
        start: () =>
          new Promise((resolve) => {
            resolveStart = resolve;
          }),
      },
      sessionState: {
        connection: { status: 'connected' },
        runtime: { dispose: vi.fn(async () => {}) },
        sessionId: 'chat-1',
        runtimeGeneration: 1,
        disposed: false,
      },
      metadata: { modelCatalog: { status: 'ready', items: [] } },
      turnState: { turn: null },
      interactions: { hasPending: () => false },
      missionState: { missionStartInProgress: false },
      isCurrentSessionOperation: () => false,
      effects: {
        loadSessionMetadata: vi.fn(),
        closeRuntime: (runtime: typeof missionRuntime) => runtime.dispose(),
      },
      emit: vi.fn(),
      emitSnapshot: vi.fn(),
      emitSessionDiagnostic: vi.fn(),
    };

    handleMissionStart(ctl as never, message);
    resolveStart({
      status: 'ready',
      sessionId: 'mission-1',
      activateInteractions,
      runtime: { runtime: missionRuntime },
      settings: {
        workerModel: 'model-a',
        workerReasoningEffort: 'high',
        validationWorkerModel: 'model-a',
        validationWorkerReasoningEffort: 'high',
        skipScrutiny: false,
        skipUserTesting: false,
      },
    });
    await vi.waitFor(() => {
      expect(missionRuntime.dispose).toHaveBeenCalledOnce();
      expect(ctl.missionState.missionStartInProgress).toBe(false);
    });
    expect(ctl.sessionState.runtime.dispose).not.toHaveBeenCalled();
    expect(ctl.emitSnapshot).toHaveBeenCalledOnce();
    expect(activateInteractions).not.toHaveBeenCalled();
  });

  it.each([false, true])('activates Mission interactions only after adoption (previous close fails: %s)', async closeFails => {
    const order: string[] = [];
    const oldRuntime = { dispose: vi.fn(async () => {}) };
    const missionRuntime = { dispose: vi.fn(async () => {}) };
    const activateInteractions = vi.fn(() => { order.push('activate'); });
    const handleSend = vi.fn(() => { order.push('send'); });
    const ctl = {
      getWorkspaceContext: () => ({ cwd: 'D:/repo', trusted: true }),
      missionGateway: {
        start: async () => ({
          status: 'ready', sessionId: 'mission-1', activateInteractions,
          runtime: { runtime: missionRuntime },
          settings: { skipScrutiny: false, skipUserTesting: false },
        }),
      },
      sessionState: {
        connection: { status: 'connected' }, runtime: oldRuntime, sessionId: 'chat-1',
        runtimeGeneration: 1, disposed: false, managedRuntimes: new Set(),
      },
      metadata: { modelCatalog: { status: 'ready', items: [] } },
      turnState: { turn: null },
      interactions: { hasPending: () => false },
      missionState: { missionStartInProgress: false },
      recoveryState: {},
      catalogState: { sessions: { status: 'ready', items: [] } },
      recoveryStore: {
        createConversation: () => 'conversation-1', selectConversation: vi.fn(), flush: async () => {},
      },
      isCurrentSessionOperation: () => true,
      effects: {
        loadSessionMetadata: vi.fn(),
        closeRuntime: async (runtime: typeof oldRuntime) => {
          if (runtime === oldRuntime) {
            order.push('close');
            if (closeFails) throw new Error('close failed');
          }
          await runtime.dispose();
        },
        handleSend,
      },
      emit: vi.fn(), emitSnapshot: vi.fn(), emitSessionDiagnostic: vi.fn(),
    };
    handleMissionStart(ctl as never, message);
    await vi.waitFor(() => expect(ctl.missionState.missionStartInProgress).toBe(false));
    expect(order).toEqual(closeFails ? ['close'] : ['close', 'activate', 'send']);
    expect(ctl.sessionState.runtime).toBe(closeFails ? oldRuntime : missionRuntime);
    expect(missionRuntime.dispose).toHaveBeenCalledTimes(closeFails ? 1 : 0);
  });
});
