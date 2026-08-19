import { describe, expect, it, vi } from 'vitest';

import type { MissionStartMessage } from '../../../shared/missionProtocol';
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
      connection: { status: 'connected' },
      runtime: { dispose: vi.fn(async () => {}) },
      sessionId: 'chat-1',
      modelCatalog: { status: 'ready', items: [] },
      turn: null,
      interactions: { hasPending: () => false },
      missionStartInProgress: false,
      runtimeGeneration: 1,
      disposed: false,
      isCurrentSessionOperation: () => false,
      closedRuntimes: new WeakSet(),
      runtimeClosures: new Map(),
      managedRuntimes: new Set(),
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
      expect(ctl.missionStartInProgress).toBe(false);
    });
    expect(ctl.runtime.dispose).not.toHaveBeenCalled();
  });
});
