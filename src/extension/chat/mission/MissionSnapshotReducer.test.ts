import { describe, expect, it } from 'vitest';

import { MissionSnapshotReducer } from './MissionSnapshotReducer';

const validator = {
  scrutinyEnabled: true,
  userTestingEnabled: true,
};
const features = [
  {
    id: 'first',
    description: 'First feature',
    status: 'in_progress' as const,
    skillName: 'worker',
  },
  {
    id: 'second',
    description: 'Second feature',
    status: 'pending' as const,
    skillName: 'worker',
  },
];

describe('MissionSnapshotReducer', () => {
  it('preserves official feature order and derives progress only from status', () => {
    const reducer = new MissionSnapshotReducer(validator);
    expect(
      reducer.apply({ type: 'mission-features', features }),
    ).toBe(true);
    const before = reducer.snapshot();
    expect(before.features.map(({ id }) => id)).toEqual(['first', 'second']);
    expect(before.completedFeatureCount).toBe(0);

    reducer.apply({
      type: 'mission-features',
      features: [
        { ...features[1]!, status: 'completed' },
        { ...features[0]!, status: 'pending' },
      ],
    });
    const after = reducer.snapshot();
    expect(after.features.map(({ id }) => id)).toEqual(['second', 'first']);
    expect(after.completedFeatureCount).toBe(1);
  });

  it('reconciles cumulative progress without duplication or rewind', () => {
    const reducer = new MissionSnapshotReducer(validator);
    const first = {
      type: 'mission_accepted' as const,
      timestamp: '2026-08-17T00:00:00.000Z',
      title: 'Mission title',
    };
    const second = {
      type: 'mission_run_started' as const,
      timestamp: '2026-08-17T00:00:01.000Z',
    };
    expect(
      reducer.apply({ type: 'mission-progress', entries: [first] }),
    ).toBe(true);
    const revision = reducer.snapshot().revision;
    expect(
      reducer.apply({ type: 'mission-progress', entries: [first] }),
    ).toBe(false);
    expect(reducer.snapshot().revision).toBe(revision);
    expect(
      reducer.apply({
        type: 'mission-progress',
        entries: [first, second],
      }),
    ).toBe(true);
    expect(
      reducer.apply({ type: 'mission-progress', entries: [] }),
    ).toBe(false);
    expect(reducer.requiresRefresh()).toBe(true);
    expect(reducer.snapshot().title).toBe('Mission title');
  });

  it('corroborates Worker and Feature identity before enabling Stop', () => {
    const reducer = new MissionSnapshotReducer(validator);
    reducer.apply({ type: 'mission-state', lifecycle: 'running' });
    reducer.apply({ type: 'mission-features', features });
    reducer.apply({
      type: 'mission-worker-started',
      workerSessionId: 'worker-a',
    });
    expect(reducer.snapshot().currentFeatureId).toBe('first');
    expect(reducer.snapshot().controls.canStopCurrentFeature).toBe(true);

    reducer.apply({
      type: 'mission-worker-started',
      workerSessionId: 'worker-b',
    });
    expect(reducer.snapshot().currentFeatureId).toBeUndefined();
    expect(reducer.snapshot().controls.canStopCurrentFeature).toBe(false);
    reducer.apply({
      type: 'mission-worker-completed',
      workerSessionId: 'worker-a',
      exitCode: 0,
    });
    expect(reducer.activeWorkerSessionId()).toBe('worker-b');
  });

  it('isolates late completion from a newer Worker', () => {
    const reducer = new MissionSnapshotReducer(validator);
    reducer.apply({
      type: 'mission-worker-started',
      workerSessionId: 'worker-a',
    });
    reducer.apply({
      type: 'mission-worker-completed',
      workerSessionId: 'worker-a',
      exitCode: 0,
    });
    reducer.apply({
      type: 'mission-worker-started',
      workerSessionId: 'worker-b',
    });
    expect(
      reducer.apply({
        type: 'mission-worker-completed',
        workerSessionId: 'worker-a',
        exitCode: 1,
      }),
    ).toBe(false);
    expect(reducer.activeWorkerSessionId()).toBe('worker-b');
  });

  it('settles Stop only when the active Worker completes', () => {
    const reducer = new MissionSnapshotReducer(validator);
    reducer.apply({
      type: 'mission-worker-started',
      workerSessionId: 'worker-a',
    });
    reducer.setBusyAction('stop');
    expect(reducer.snapshot().controls.busyAction).toBe('stop');
    expect(
      reducer.apply({
        type: 'mission-worker-completed',
        workerSessionId: 'worker-a',
        exitCode: 0,
      }),
    ).toBe(true);
    expect(reducer.snapshot().controls.busyAction).toBeUndefined();
  });

  it('rehydrates durable Mission state and hides raw Worker identity', () => {
    const reducer = new MissionSnapshotReducer(validator);
    expect(
      reducer.hydrate({
        state: 'paused',
        title: 'Recovered mission',
        features: features.map((feature) => ({
          ...feature,
          preconditions: [],
          expectedBehavior: [],
        })),
        progressLog: [],
        workerSessionIds: ['worker-a'],
        workerStates: {
          'worker-a': {
            startedAt: '2026-08-17T00:00:00.000Z',
            completedAt: '2026-08-17T00:01:00.000Z',
          },
        },
      }),
    ).toBe(true);
    const snapshot = reducer.snapshot();
    expect(snapshot.lifecycle).toBe('paused');
    expect(snapshot.title).toBe('Recovered mission');
    expect(snapshot.controls.canResume).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain('worker-a');
  });
});
