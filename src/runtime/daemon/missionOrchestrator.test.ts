import type { DaemonApi } from './api';

import { describe, expect, it, vi } from 'vitest';
import {
  cancellingRuntimeInteractionHandler,
  createRuntimeInteractionCallbacks,
} from '../events/runtimeInteractions';

import {
  createMissionOrchestrator,
  createMissionOrchestratorIdentity,
} from './missionOrchestrator';

describe('createMissionOrchestrator', () => {
  it('creates a distinct tagged orchestrator', async () => {
    const first = createMissionOrchestratorIdentity();
    const second = createMissionOrchestratorIdentity();
    expect(first).not.toBe(second);

    const create = vi.fn(async () => ({ id: 'mission-session-1' }));
    const droid = { sessions: { create } } as unknown as DaemonApi;

    const callbacks = createRuntimeInteractionCallbacks(
      cancellingRuntimeInteractionHandler,
    );
    await createMissionOrchestrator({
      callbacks,
      droid,
      cwd: 'C:\\workspace',
      modelId: 'model-orchestrator',
      reasoningEffort: 'high',
      missionId: first,
    });

    expect(create).toHaveBeenCalledExactlyOnceWith({
      ...callbacks,
      cwd: 'C:\\workspace',
      modelId: 'model-orchestrator',
      reasoningEffort: 'high',
      tags: [
        { name: 'mission-orchestrator' },
        {
          name: 'mission-session',
          metadata: { role: 'orchestrator', missionId: first },
        },
      ],
    });
  });
});
