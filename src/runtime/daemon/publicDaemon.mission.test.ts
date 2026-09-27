import { EventEmitter } from 'node:events';
import {
  AutonomyLevel,
  DroidInteractionMode,
  FeatureStatus,
  MissionState,
  MultiMissionStateManager,
  ProgressLogEntryType,
  ReasoningEffort,
  type DaemonSessionController,
  type SessionSettings,
} from '@factory/droid-sdk';
import { describe, expect, it, vi } from 'vitest';

import { FactoryDroidRuntime } from '../FactoryDroidRuntime';
import {
  cancellingRuntimeInteractionHandler,
  createRuntimeInteractionCallbacks,
} from '../events/runtimeInteractions';
import { adaptConnectedDaemonSession } from './createDaemonDroidSession';
import { retainDaemonController } from './connectPublicDaemon';

function setup(populateOnLoad = true) {
  const missions = new MultiMissionStateManager();
  const settings = {
    modelId: 'gemini-test', autonomyLevel: AutonomyLevel.Low,
    interactionMode: DroidInteractionMode.Auto, reasoningEffort: ReasoningEffort.High,
  } as SessionSettings;
  const state = { clear: vi.fn() };
  const controller = Object.assign(new EventEmitter(), {
    loadSession: vi.fn(async ({ sessionId }: { sessionId: string }) => {
      if (populateOnLoad) {
        const store = missions.getMissionStore(sessionId);
        store.setState(MissionState.Running);
        store.setTitle(`Mission ${sessionId}`);
        store.setFeatures([{
          id: 'duration', description: 'Format duration', skillName: 'worker',
          status: FeatureStatus.InProgress, workerSessionIds: ['worker-1'],
          preconditions: [], expectedBehavior: [],
        }]);
        store.setProgressLog([{ type: ProgressLogEntryType.MissionRunStarted, timestamp: '2026-09-22T01:00:00.000Z' }]);
        store.addWorkerWithState('worker-1', { startedAt: '2026-09-22T01:00:01.000Z' });
      }
      return { settings, cwd: 'C:/mission' };
    }),
    getSessionStateManager: () => state,
    forkSession: vi.fn(async () => ({ newSessionId: 'fork-1' })),
    addUserMessage: vi.fn(), interruptSession: vi.fn(), closeSession: vi.fn(), destroy: vi.fn(),
  });
  const api = retainDaemonController(
    controller as unknown as DaemonSessionController,
    { url: 'ws://127.0.0.1:1', auth: { apiKey: 'test-only' } },
    missions,
  );
  const lease = { acquire: () => ({ acquired: true }) as const, release: vi.fn() };
  const callbacks = createRuntimeInteractionCallbacks(cancellingRuntimeInteractionHandler);
  const runtime = new FactoryDroidRuntime({
    interactionHandler: cancellingRuntimeInteractionHandler,
    createSdkSession: async () => adaptConnectedDaemonSession(
      api, await api.sessions.resume('orchestrator', callbacks), callbacks, lease,
    ),
  });
  const initialize = () => runtime.initialize({ kind: 'resume', cwd: 'C:/mission', sessionId: 'orchestrator' });
  return { missions, api, controller, runtime, initialize };
}

describe('retained daemon Mission snapshots', () => {
  it('reads the complete SDK load snapshot and forwards idle worker updates without starting or reloading a turn', async () => {
    const value = setup();
    await expect(value.initialize()).resolves.toMatchObject({ status: 'available' });
    const initial = value.missions.getMissionStoreIfKnown('orchestrator')!;
    expect(value.runtime.readMissionSnapshot()).toEqual(initial.getSnapshot());
    expect(value.runtime.readMissionSnapshot()).toMatchObject({
      state: 'running', title: 'Mission orchestrator',
      features: [{ id: 'duration', status: 'in_progress' }],
      progressLog: [{ type: 'mission_run_started' }],
      workerStates: { 'worker-1': { startedAt: '2026-09-22T01:00:01.000Z' } },
    });
    const snapshots = vi.fn();
    value.runtime.subscribeMissionSnapshot(snapshots);
    expect(snapshots).not.toHaveBeenCalled();
    initial.completeWorker('worker-1', 0);
    initial.setState(MissionState.Completed);
    expect(snapshots).toHaveBeenLastCalledWith(expect.objectContaining({
      state: 'completed', workerStates: { 'worker-1': expect.objectContaining({ exitCode: 0 }) },
    }));
    expect(value.controller.loadSession).toHaveBeenCalledOnce();
    expect(value.controller.addUserMessage).not.toHaveBeenCalled();
    await value.runtime.dispose();
    const count = snapshots.mock.calls.length;
    initial.setTitle('Late update');
    value.missions.associateSessionWithMission('orchestrator', 'another-mission');
    expect(snapshots).toHaveBeenCalledTimes(count);
    expect(value.runtime.readMissionSnapshot()).toBeNull();
    value.api.disconnect();
  });

  it('subscribes when a Mission first appears and follows reassociation instead of a stale provisional store', async () => {
    const value = setup(false);
    await value.initialize();
    expect(value.runtime.readMissionSnapshot()).toBeNull();
    const snapshots = vi.fn();
    const unsubscribe = value.runtime.subscribeMissionSnapshot(snapshots);
    const provisional = value.missions.getMissionStore('orchestrator');
    provisional.setTitle('Provisional title');
    expect(snapshots).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Provisional title' }));

    const canonical = value.missions.associateSessionWithMission('orchestrator', 'canonical-mission');
    canonical.setState(MissionState.Paused);
    expect(snapshots).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'paused' }));
    const count = snapshots.mock.calls.length;
    provisional.setTitle('Outdated source');
    expect(snapshots).toHaveBeenCalledTimes(count);
    value.missions.associateWorkerWithParentMission('orchestrator', 'worker-1')
      .setTitle('Shared Mission');
    expect(snapshots).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Shared Mission' }));

    unsubscribe();
    const stoppedAt = snapshots.mock.calls.length;
    canonical.setState(MissionState.Completed);
    value.missions.associateSessionWithMission('orchestrator', 'next-mission');
    expect(snapshots).toHaveBeenCalledTimes(stoppedAt);
    await value.runtime.dispose();
    value.api.disconnect();
  });

  it('retains the runtime subscription when a session replacement is adopted', async () => {
    const value = setup();
    await value.initialize();
    const snapshots = vi.fn();
    value.runtime.subscribeMissionSnapshot(snapshots);
    const previous = value.missions.getMissionStoreIfKnown('orchestrator')!;
    await expect(value.runtime.fork('Mission branch')).resolves.toEqual({ sessionId: 'fork-1' });
    expect(snapshots).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Mission fork-1' }));
    const replacement = value.missions.getMissionStoreIfKnown('fork-1')!;
    replacement.setState(MissionState.Completed);
    const count = snapshots.mock.calls.length;
    previous.setState(MissionState.Paused);
    expect(snapshots).toHaveBeenCalledTimes(count);
    expect(value.runtime.readMissionSnapshot()).toMatchObject({ state: 'completed', title: 'Mission fork-1' });
    await value.runtime.dispose();
    value.api.disconnect();
  });

  it('removes both association and store listeners when an attached handle detaches', async () => {
    const value = setup();
    const handle = await value.api.sessions.resume('detachable');
    const snapshots = vi.fn();
    handle.subscribeMissionSnapshot(snapshots);
    const store = value.missions.getMissionStoreIfKnown(handle.id)!;
    await handle.detach();
    store.setState(MissionState.Completed);
    value.missions.associateSessionWithMission(handle.id, 'another');
    expect(snapshots).not.toHaveBeenCalled();
    expect(() => handle.readMissionSnapshot()).toThrow('Session handle is detached');
    value.api.disconnect();
  });
});
