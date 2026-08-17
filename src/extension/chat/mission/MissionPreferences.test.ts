import { describe, expect, it } from 'vitest';

import {
  MissionPreferenceStore,
  type MissionPreferencePersistence,
} from './MissionPreferences';

const orchestrator = {
  modelId: 'model-orchestrator',
  reasoningEffort: 'high' as const,
};

describe('MissionPreferenceStore', () => {
  it('keeps Mission preferences scoped and advisory', async () => {
    const values = new Map<string, unknown>();
    const persistence: MissionPreferencePersistence = {
      get: <T>(key: string) => values.get(key) as T | undefined,
      update: async (key, value) => {
        values.set(key, value);
      },
    };
    const preferences = new MissionPreferenceStore(persistence);

    await preferences.save('workspace-a', {
      worker: {
        mode: 'override',
        modelId: 'model-worker',
        reasoningEffort: 'medium',
      },
      validator: {
        mode: 'same-as-orchestrator',
        ...orchestrator,
      },
      scrutinyEnabled: false,
      userTestingEnabled: true,
    });

    expect(preferences.read('workspace-a', orchestrator)).toEqual({
      worker: {
        mode: 'override',
        modelId: 'model-worker',
        reasoningEffort: 'medium',
      },
      validator: {
        mode: 'same-as-orchestrator',
        ...orchestrator,
      },
      scrutinyEnabled: false,
      userTestingEnabled: true,
    });
    expect(preferences.read('workspace-b', orchestrator)).toEqual({
      worker: { mode: 'same-as-orchestrator', ...orchestrator },
      validator: { mode: 'same-as-orchestrator', ...orchestrator },
      scrutinyEnabled: true,
      userTestingEnabled: true,
    });

    expect(
      preferences.validate('workspace-a', orchestrator, [
        {
          id: 'model-orchestrator',
          supportedReasoningEfforts: ['high'],
        },
      ]),
    ).toEqual({ valid: false, reason: 'unavailable-model' });
  });
});
