import { describe, expect, it, vi } from 'vitest';

import type { ConnectedDroid } from '@factory/droid-sdk';

import {
  MissionGateway,
  type MissionGatewayRuntime,
} from './MissionGateway';
import {
  MissionPreferenceStore,
  type MissionPreferencePersistence,
} from './MissionPreferences';

const catalog = [
  {
    id: 'model-orchestrator',
    supportedReasoningEfforts: ['high', 'medium'] as const,
  },
  {
    id: 'model-worker',
    supportedReasoningEfforts: ['medium'] as const,
  },
  {
    id: 'model-validator',
    supportedReasoningEfforts: ['high'] as const,
  },
];

const message = {
  type: 'mission.start' as const,
  protocolVersion: 25 as const,
  requestId: 'mission-start-1',
  scope: 'selected-chat' as const,
  task: 'Implement the feature',
  orchestrator: {
    modelId: 'model-orchestrator',
    reasoningEffort: 'high' as const,
  },
  worker: {
    mode: 'override' as const,
    modelId: 'model-worker',
    reasoningEffort: 'medium' as const,
  },
  validator: {
    mode: 'override' as const,
    modelId: 'model-validator',
    reasoningEffort: 'high' as const,
  },
  scrutinyEnabled: false,
  userTestingEnabled: true,
};

function createPreferences(): MissionPreferenceStore {
  const values = new Map<string, unknown>();
  const persistence: MissionPreferencePersistence = {
    get: <T>(key: string) => values.get(key) as T | undefined,
    update: async (key, value) => {
      values.set(key, value);
    },
  };
  return new MissionPreferenceStore(persistence);
}

describe('MissionGateway', () => {
  it('applies and verifies official Mission settings', async () => {
    const calls: string[] = [];
    const requestedSettings = {
      workerModel: 'model-worker',
      workerReasoningEffort: 'medium',
      validationWorkerModel: 'model-validator',
      validationWorkerReasoningEffort: 'high',
      skipScrutiny: true,
      skipUserTesting: false,
    };
    const session = {
      id: 'orchestrator-1',
      settings: { missionSettings: requestedSettings },
    };
    const create = vi.fn(async () => {
      calls.push('create');
      return session;
    });
    const updateSettings = vi.fn(async () => {
      calls.push('updateSettings');
      return {};
    });
    const runtime: MissionGatewayRuntime = {
      runtime: {} as never,
      initialize: vi.fn(async () => {
        calls.push('initialize');
      }),
    };
    const createRuntime = vi.fn(() => runtime);
    const gateway = new MissionGateway({
      getDroid: async () =>
        ({
          sessions: { create, updateSettings },
        }) as unknown as ConnectedDroid,
      preferences: createPreferences(),
      createRuntime,
    });

    const result = await gateway.start({
      workspaceId: 'workspace-a',
      cwd: 'C:\\workspace-a',
      message,
      catalog,
    });

    expect(result).toMatchObject({
      status: 'ready',
      sessionId: 'orchestrator-1',
      runtime,
    });
    expect(calls).toEqual(['create', 'updateSettings', 'initialize']);
    expect(updateSettings).toHaveBeenCalledWith('orchestrator-1', {
      missionSettings: requestedSettings,
    });
    expect(createRuntime).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'orchestrator-1' }),
      expect.anything(),
      message.orchestrator,
    );
  });

  it('rejects each stale settings value before creating a Session', async () => {
    const create = vi.fn();
    const gateway = new MissionGateway({
      getDroid: async () =>
        ({ sessions: { create } }) as unknown as ConnectedDroid,
      preferences: createPreferences(),
      createRuntime: () => ({
        runtime: {} as never,
        initialize: async () => {},
      }),
    });

    const result = await gateway.start({
      workspaceId: 'workspace-a',
      cwd: 'C:\\workspace-a',
      message: {
        ...message,
        worker: {
          mode: 'override',
          modelId: 'missing-worker',
          reasoningEffort: 'medium',
        },
      },
      catalog,
    });

    expect(result).toEqual({
      status: 'rejected',
      code: 'unavailable-model',
    });
    expect(create).not.toHaveBeenCalled();
  });

  it.each([
    'workerModel',
    'workerReasoningEffort',
    'validationWorkerModel',
    'validationWorkerReasoningEffort',
    'skipScrutiny',
    'skipUserTesting',
  ] as const)(
    'blocks the task when durable settings differ by %s',
    async (property) => {
      const expected = {
        workerModel: 'model-worker',
        workerReasoningEffort: 'medium',
        validationWorkerModel: 'model-validator',
        validationWorkerReasoningEffort: 'high',
        skipScrutiny: true,
        skipUserTesting: false,
      };
      const session = {
        id: 'orchestrator-1',
        detach: vi.fn(async () => {}),
        settings: {
          missionSettings: {
            ...expected,
            [property]:
              property === 'skipScrutiny' || property === 'skipUserTesting'
                ? !expected[property]
                : 'mismatch',
          },
        },
      };
      const create = vi.fn(async () => session);
      const initialize = vi.fn(async () => {});
      const gateway = new MissionGateway({
        getDroid: async () =>
          ({
            sessions: {
              create,
              updateSettings: vi.fn(async () => ({})),
            },
          }) as unknown as ConnectedDroid,
        preferences: createPreferences(),
        createRuntime: () => ({ runtime: {} as never, initialize }),
      });

      await expect(
        gateway.start({
          workspaceId: 'workspace-a',
          cwd: 'C:\\workspace-a',
          message,
          catalog,
        }),
      ).resolves.toEqual({
        status: 'rejected',
        code: 'settings-mismatch',
      });
      expect(initialize).not.toHaveBeenCalled();
    },
  );
});
