import { describe, expect, it } from 'vitest';
import { MissionSnapshotReducer } from './MissionSnapshotReducer';

const validator = { scrutinyEnabled: true, userTestingEnabled: true };
const feature = {
  id: 'duration-library', description: 'Build the library', status: 'in_progress',
  skillName: 'worker', preconditions: [], expectedBehavior: [],
};
const fixture = (overrides: Record<string, unknown> = {}) => ({
  state: 'running', title: 'Duration mission', features: [feature], progressLog: [],
  ...overrides,
});

describe('Mission snapshot replacement and recovery', () => {
  it('replaces stale workers and progress with the authoritative snapshot before accepting new events', () => {
    const reducer = new MissionSnapshotReducer(validator);
    expect(reducer.hydrate(fixture({
      features: [{ ...feature, id: 'old-feature', currentWorkerSessionId: 'old-worker' }],
      progressLog: [{ type: 'worker_selected_feature', timestamp: '2026-09-22T03:00:00Z',
        workerSessionId: 'old-worker', featureId: 'old-feature' }],
    }))).toBe(true);
    reducer.apply({ type: 'mission-progress', entries: [] });
    expect(reducer.requiresRefresh()).toBe(true);

    expect(reducer.hydrate(fixture({
      features: [{ ...feature, currentWorkerSessionId: 'new-worker' }],
    }))).toBe(true);
    expect(reducer.requiresRefresh()).toBe(false);
    expect(reducer.activeWorkerSessionId()).toBe('new-worker');
    expect(reducer.workerSessionIdForFeature('old-feature')).toBeNull();
    expect(reducer.workerSessionIdForFeature(feature.id)).toBe('new-worker');
    expect(reducer.snapshot().controls.canStopCurrentFeature).toBe(true);

    expect(reducer.apply({ type: 'mission-progress', entries: [{
      type: 'mission_accepted', timestamp: '2026-09-22T03:02:00Z', title: 'Corrected plan',
    }] })).toBe(true);
    expect(reducer.requiresRefresh()).toBe(false);
    expect(reducer.snapshot().title).toBe('Corrected plan');
  });

  it('does not change revision or clear a pending control on a duplicate snapshot', () => {
    const reducer = new MissionSnapshotReducer(validator);
    const value = fixture({ features: [{ ...feature, currentWorkerSessionId: 'worker-active' }] });
    reducer.hydrate(value);
    reducer.setBusyAction('pause');
    const before = reducer.snapshot();
    expect(reducer.hydrate(value)).toBe(true);
    expect(reducer.snapshot()).toEqual(before);
    expect(reducer.currentRevision()).toBe(before.revision);
    expect(reducer.snapshot().controls.busyAction).toBe('pause');
  });

  it.each([
    ['pause', 'running', 'paused'],
    ['stop', 'running', 'paused'],
    ['resume', 'paused', 'running'],
  ] as const)('settles %s only when the refreshed lifecycle changes from %s to %s', (action, from, to) => {
    const reducer = new MissionSnapshotReducer(validator);
    reducer.hydrate(fixture({ state: from }));
    reducer.setBusyAction(action);
    const revision = reducer.currentRevision();
    reducer.hydrate(fixture({ state: from }));
    expect(reducer.currentRevision()).toBe(revision);
    expect(reducer.snapshot().controls.busyAction).toBe(action);
    reducer.hydrate(fixture({ state: to }));
    expect(reducer.currentRevision()).toBeGreaterThan(revision);
    expect(reducer.snapshot().controls.busyAction).toBeUndefined();
  });

  it.each(['pause', 'resume', 'stop'] as const)(
    'clears pending %s when a refreshed Mission is completed', action => {
      const reducer = new MissionSnapshotReducer(validator);
      reducer.hydrate(fixture({
        features: [{ ...feature, currentWorkerSessionId: 'worker-active' }],
      }));
      reducer.setBusyAction(action);
      reducer.hydrate(fixture({ state: 'completed', features: [{ ...feature, status: 'completed',
        currentWorkerSessionId: null, completedWorkerSessionId: 'worker-active' }] }));
      expect(reducer.snapshot()).toMatchObject({ lifecycle: 'completed', completedFeatureCount: 1 });
      expect(reducer.snapshot().controls.busyAction).toBeUndefined();
      expect(reducer.activeWorkerSessionId()).toBeNull();
    },
  );

  it('projects multiline SDK prose into a single line feature title', () => {
    const reducer = new MissionSnapshotReducer(validator);
    expect(reducer.hydrate(fixture({ features: [{ ...feature,
      description: 'Build the library\r\n\tThen verify the CLI',
      preconditions: ['Repository ready\nNo dependencies'],
      expectedBehavior: ['Valid input\nReturns a duration'],
    }] }))).toBe(true);
    expect(reducer.snapshot().features[0]?.title).toBe('Build the library Then verify the CLI');
  });

  it('does not reuse a lone old progress binding after a live feature update reports multiple workers', () => {
    const reducer = new MissionSnapshotReducer(validator);
    reducer.hydrate(fixture({ progressLog: [{ type: 'worker_selected_feature',
      timestamp: '2026-09-22T03:00:00Z', workerSessionId: 'old-worker', featureId: feature.id }] }));
    expect(reducer.workerSessionIdForFeature(feature.id)).toBe('old-worker');

    const updated = { ...feature, status: 'in_progress' as const,
      workerSessionIds: ['old-worker', 'new-worker'] };
    reducer.apply({ type: 'mission-features', features: [updated] });
    expect(reducer.workerSessionIdForFeature(feature.id)).toBeNull();
    expect(reducer.snapshot().features[0]?.workerViewAvailable).toBeUndefined();

    reducer.apply({ type: 'mission-features',
      features: [{ ...updated, currentWorkerSessionId: 'new-worker' }] });
    expect(reducer.workerSessionIdForFeature(feature.id)).toBe('new-worker');
    expect(reducer.snapshot().features[0]?.workerViewAvailable).toBe(true);
  });

  it.each([
    [{ currentWorkerSessionId: 'current-worker', completedWorkerSessionId: 'completed-worker',
      workerSessionIds: ['old-worker', 'current-worker'] }, 'current-worker'],
    [{ currentWorkerSessionId: null, completedWorkerSessionId: 'completed-worker',
      workerSessionIds: ['old-worker', 'completed-worker'] }, 'completed-worker'],
    [{ currentWorkerSessionId: null, completedWorkerSessionId: null,
      workerSessionIds: ['only-worker'] }, 'only-worker'],
    [{ workerSessionIds: ['old-worker', 'another-worker'] }, null],
  ] as const)('resolves Viewer from explicit bindings without guessing from multiple historical workers: %o',
    (bindings, workerId) => {
      const reducer = new MissionSnapshotReducer(validator);
      expect(reducer.hydrate(fixture({ features: [{ ...feature, ...bindings }] }))).toBe(true);
      expect(reducer.workerSessionIdForFeature(feature.id)).toBe(workerId);
      expect(reducer.snapshot().features[0]?.workerViewAvailable).toBe(workerId === null ? undefined : true);
      expect(JSON.stringify(reducer.snapshot())).not.toContain('workerSession');
      for (const id of bindings.workerSessionIds)
        expect(JSON.stringify(reducer.snapshot())).not.toContain(id);
    },
  );
});
