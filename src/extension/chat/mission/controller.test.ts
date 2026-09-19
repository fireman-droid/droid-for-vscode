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
        closeRuntime: (runtime: typeof missionRuntime) => runtime.dispose(),
      },
      emit: vi.fn(),
      emitSessionDiagnostic: vi.fn(),
    };

    handleMissionStart(ctl as never, message);
    resolveStart({
      status: 'ready',
      sessionId: 'mission-1',
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
  });
});
