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
    expect(normalizeMissionEvent({ type: 'mission_worker_retried' })).toBeUndefined();
  });

  it.each(['description', 'preconditions', 'expectedBehavior'] as const)(
    'accepts SDK feature prose with line breaks and tabs in %s', field => {
      const prose = 'Build the library\n\tThen verify the CLI\r\nKeep the existing API';
      const value = { ...feature, [field]: field === 'description' ? prose : [prose] };
      expect(normalizeMissionEvent({ type: 'mission_features_changed', features: [value] }))
        .toMatchObject({ type: 'mission-features', features: [{ id: feature.id,
          description: field === 'description' ? prose : feature.description }] });
    },
  );

  it.each([
    { currentWorkerSessionId: 'worker-active', completedWorkerSessionId: null },
    { currentWorkerSessionId: null, completedWorkerSessionId: 'worker-completed' },
  ])('preserves explicit current, completed, and past worker bindings: %o', bindings => {
    const workers = { workerSessionIds: ['worker-previous', 'worker-active'], ...bindings };
    expect(normalizeMissionEvent({ type: 'mission_features_changed',
      features: [{ ...feature, ...workers }] }))
      .toEqual({ type: 'mission-features', features: [{ id: feature.id,
        description: feature.description, status: feature.status, skillName: feature.skillName,
        ...workers }] });
  });

  it.each([
    { description: 'invalid\u0000text' },
    { preconditions: ['invalid\u001btext'] },
    { expectedBehavior: ['invalid\u0008text'] },
    { skillName: 'worker\nname' },
    { workerSessionIds: ['worker-valid', 'worker\ninvalid'] },
    { currentWorkerSessionId: '' },
    { completedWorkerSessionId: '../other' },
  ])('still rejects invalid feature text or worker identity: %o', invalid => {
    expect(normalizeMissionEvent({ type: 'mission_features_changed',
      features: [{ ...feature, ...invalid }] })).toBeUndefined();
  });
});
