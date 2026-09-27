import { describe, expect, it, vi } from 'vitest';
import { MissionSessionState } from './MissionSessionState';
import { recoverMissionProjection } from './recovery';
import { emitMissionSetupCapabilities } from './setupProjection';
import { replayControllerTo } from '../browserReplay';
import { handleMissionCommand } from './controls';

const initial = {
  state: 'running', title: 'Recovered task', progressLog: [],
  features: [{ id: 'feature-a', description: 'Build duration parser', status: 'in_progress',
    skillName: 'worker', preconditions: [], expectedBehavior: [], currentWorkerSessionId: 'worker-a' }],
  workerStates: { 'worker-a': { startedAt: '2026-09-22T00:00:00Z' } },
};
function fixture() {
  let value: unknown = initial;
  let listener: (() => void) | undefined;
  const unsubscribe = vi.fn();
  const runtime = {
    readMissionSnapshot: () => value,
    subscribeMissionSnapshot: vi.fn((next: () => void) => { listener = next; return unsubscribe; }),
  };
  const missionState = new MissionSessionState();
  missionState.mission = { role: 'orchestrator', state: 'running' };
  const ctl = { missionState, isCurrentSessionOperation: vi.fn(() => true), emit: vi.fn() };
  const recover = () => recoverMissionProjection(ctl as never, runtime as never, 1, 'mission-a', 'D:/repo');
  return { ctl, runtime, recover, unsubscribe, update: (next: unknown) => { value = next; listener?.(); } };
}

describe('authoritative Mission recovery', () => {
  it('restores full features and follows progress between turns without catalog queries', () => {
    const { ctl, recover, update } = fixture();
    recover();
    const mission = ctl.missionState.missionRuntime!;
    expect(mission.workerSessionIdForFeature('feature-a')).toBe('worker-a');
    expect(mission.snapshot()).toMatchObject({ title: 'Recovered task', availability: 'attached',
      features: [{ id: 'feature-a', workerViewAvailable: true }], controls: { canPause: true } });
    update({ ...initial, state: 'paused' });
    expect(mission.snapshot().controls.canResume).toBe(true);
    expect(ctl.missionState.mission?.state).toBe('paused');
    const count = ctl.emit.mock.calls.length;
    update({ ...initial, state: 'paused', tokenUsage: { inputTokens: 100 } });
    expect(ctl.emit).toHaveBeenCalledTimes(count);
  });
  it('isolates late old-owner updates and releases the previous subscription', () => {
    const { ctl, recover, update, unsubscribe } = fixture();
    recover();
    ctl.isCurrentSessionOperation.mockReturnValue(false);
    update({ ...initial, state: 'completed' });
    expect(ctl.missionState.missionRuntime!.snapshot().lifecycle).toBe('running');
    ctl.isCurrentSessionOperation.mockReturnValue(true);
    ctl.missionState.mission = null;
    recover();
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(ctl.missionState.missionRuntime).toBeNull();
    const count = ctl.emit.mock.calls.length;
    update(initial);
    expect(ctl.emit).toHaveBeenCalledTimes(count);
  });
  it('reports unavailable data honestly and adopts a later full snapshot', () => {
    const { ctl, recover, update } = fixture();
    update(null);
    recover();
    expect(ctl.missionState.missionRuntime!.snapshot().availability).toBe('detached');
    update(initial);
    expect(ctl.missionState.missionRuntime!.snapshot().availability).toBe('attached');
  });
  it('refresh reads the Runtime snapshot instead of replaying stale local state', () => {
    const { ctl, runtime, recover } = fixture();
    recover();
    const mission = ctl.missionState.missionRuntime!;
    const command = { type: 'mission.refresh', protocolVersion: 25, scope: 'selected-chat',
      requestId: 'refresh-a', snapshotRevision: mission.currentRevision() } as const;
    const port = { ...ctl, sessionState: { sessionId: 'mission-a', runtime: {
      ...runtime, readMissionSnapshot: () => ({ ...initial, state: 'completed' }),
    } } };
    handleMissionCommand(port as never, command);
    expect(mission.snapshot().lifecycle).toBe('completed');
    expect(ctl.emit).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'accepted' }));
    port.sessionState.runtime.readMissionSnapshot = () => null as never;
    handleMissionCommand(port as never, { ...command, snapshotRevision: mission.currentRevision() });
    expect(ctl.emit).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'rejected', rejectionCode: 'unavailable' }));
  });
  it('settings catalog updates preserve active Mission content and revision', () => {
    const { ctl, recover } = fixture();
    recover();
    const before = ctl.missionState.missionRuntime!.snapshot();
    const setup = { preferences: { scrutinyEnabled: true, userTestingEnabled: true } };
    emitMissionSetupCapabilities({ ...ctl,
      getWorkspaceContext: () => ({ cwd: 'D:/repo', trusted: true }),
      metadata: { settings: { value: { modelId: 'gemini', reasoningEffort: 'high' } }, modelCatalog: { status: 'ready', items: [] } },
      missionGateway: { setupCapabilitiesFor: () => setup },
    } as never);
    expect(ctl.emit).toHaveBeenLastCalledWith({ ...before, setup });
  });
  it('browser reload replays Mission after its owning chat snapshot', async () => {
    const { ctl, recover } = fixture();
    recover();
    const listener = vi.fn();
    const hostSnapshot = { type: 'host.snapshot' };
    await replayControllerTo({ ...ctl,
      sessionState: { initialization: Promise.resolve(), disposed: false, sessionId: 'mission-a' },
      effects: { waitForWorkspaceTransition: async () => {}, ensureActiveRuntimeWorkspaceCurrent: () => true,
        buildHostSnapshot: () => hostSnapshot },
      emitTo: (target: typeof listener, message: unknown) => target(message),
      interactions: { replayPendingTo: vi.fn() }, planDocuments: { replayTo: vi.fn() },
    } as never, listener);
    expect(listener.mock.calls.map(([message]) => message.type)).toEqual(['host.snapshot', 'mission.snapshot']);
    expect(listener).toHaveBeenLastCalledWith(ctl.missionState.missionRuntime!.snapshot());
  });
});
