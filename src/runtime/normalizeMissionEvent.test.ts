import { describe, expect, it } from 'vitest';

import { normalizeMissionEvent } from './normalizeMissionEvent';

const feature = {
  id: 'feature-1',
  description: 'Build the control panel',
  status: 'in_progress',
  skillName: 'worker',
  preconditions: [],
  expectedBehavior: [],
};

describe('normalizeMissionEvent', () => {
  it('normalizes the six official Mission notification shapes', () => {
    expect(
      normalizeMissionEvent({
        type: 'mission_state_changed',
        state: 'running',
        updatedAt: '2026-08-17T00:00:00.000Z',
      }),
    ).toEqual({ type: 'mission-state', lifecycle: 'running' });
    expect(
      normalizeMissionEvent({
        type: 'mission_features_changed',
        features: [feature],
      }),
    ).toEqual({
      type: 'mission-features',
      features: [
        {
          id: 'feature-1',
          description: 'Build the control panel',
          status: 'in_progress',
          skillName: 'worker',
        },
      ],
    });
    expect(
      normalizeMissionEvent({
        type: 'mission_progress_entry',
        progressLog: [
          {
            type: 'worker_selected_feature',
            timestamp: '2026-08-17T00:00:00.000Z',
            workerSessionId: 'worker-1',
            featureId: 'feature-1',
          },
        ],
      }),
    ).toEqual({
      type: 'mission-progress',
      entries: [
        {
          type: 'worker_selected_feature',
          timestamp: '2026-08-17T00:00:00.000Z',
          workerSessionId: 'worker-1',
          featureId: 'feature-1',
        },
      ],
    });
    expect(
      normalizeMissionEvent({
        type: 'mission_heartbeat',
        timestamp: '2026-08-17T00:00:00.000Z',
      }),
    ).toEqual({
      type: 'mission-heartbeat',
      timestamp: '2026-08-17T00:00:00.000Z',
    });
    expect(
      normalizeMissionEvent({
        type: 'mission_worker_started',
        workerSessionId: 'worker-1',
      }),
    ).toEqual({
      type: 'mission-worker-started',
      workerSessionId: 'worker-1',
    });
    expect(
      normalizeMissionEvent({
        type: 'mission_worker_completed',
        workerSessionId: 'worker-1',
        exitCode: 0,
      }),
    ).toEqual({
      type: 'mission-worker-completed',
      workerSessionId: 'worker-1',
      exitCode: 0,
    });
  });

  it('drops malformed, enriched, duplicate, and unknown notifications', () => {
    expect(
      normalizeMissionEvent({
        type: 'mission_state_changed',
        state: 'failed',
      }),
    ).toBeUndefined();
    expect(
      normalizeMissionEvent({
        type: 'mission_worker_started',
        workerSessionId: 'worker-1',
        featureId: 'invented',
      }),
    ).toBeUndefined();
    expect(
      normalizeMissionEvent({
        type: 'mission_features_changed',
        features: [feature, feature],
      }),
    ).toBeUndefined();
    expect(
      normalizeMissionEvent({
        type: 'mission_progress_entry',
        progressLog: [
          {
            type: 'worker_selected_feature',
            timestamp: 'not-a-date',
            workerSessionId: 'worker-1',
            featureId: 'feature-1',
          },
        ],
      }),
    ).toBeUndefined();
    expect(
      normalizeMissionEvent({ type: 'mission_worker_retried' }),
    ).toBeUndefined();
  });
});
