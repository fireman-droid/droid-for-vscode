import { describe, expect, it, vi } from 'vitest';

import type { MissionStartMessage } from '../../../shared/protocol/missionProtocol';
import { handleMissionStart } from './controller';
import { commitSessionBinding } from '../sessions/sessionBinding';
import { withActiveSession } from '../sessions/sessionCatalog';

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
    const activateInteractions = vi.fn();
    const missionRuntime = { dispose: vi.fn(async () => {}) };
    const ctl = {
      getWorkspaceContext: () => ({ cwd: 'D:/repo', trusted: true }),
      missionGateway: {
        start: vi.fn(() =>
          new Promise((resolve) => {
            resolveStart = resolve;
          })),
      },
      sessionState: {
        connection: { status: 'connected' },
        runtime: { dispose: vi.fn(async () => {}) },
        sessionId: 'chat-1',
        runtimeGeneration: 1,
        disposed: false,
      },
      metadata: { modelCatalog: { status: 'ready', items: [{ id: 'model-a', disabled: true }] } },
      turnState: { turn: null },
      interactions: { hasPending: () => false },
      missionState: { missionStartInProgress: false },
      isCurrentSessionOperation: () => false,
      effects: {
        loadSessionMetadata: vi.fn(),
        closeRuntime: (runtime: typeof missionRuntime) => runtime.dispose(),
      },
      emit: vi.fn(),
      emitSnapshot: vi.fn(),
      emitSessionDiagnostic: vi.fn(),
    };

    handleMissionStart(ctl as never, message);
    expect(ctl.missionGateway.start).toHaveBeenCalledWith(expect.objectContaining({ catalog: [] }));
    resolveStart({
      status: 'ready',
      sessionId: 'mission-1',
      activateInteractions,
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
      expect(ctl.missionState.missionStartInProgress).toBe(false);
    });
    expect(ctl.sessionState.runtime.dispose).not.toHaveBeenCalled();
    expect(ctl.emitSnapshot).toHaveBeenCalledOnce();
    expect(activateInteractions).not.toHaveBeenCalled();
  });

  it.each(['ready', 'close-failed', 'owner-changed', 'recovery-rejected'] as const)(
    'adopts Mission identity only after preparation and releases an unused candidate (%s)', async outcome => {
    const order: string[] = [];
    let ownerCurrent = true;
    const oldRuntime = { dispose: vi.fn(async () => {}) };
    const missionRuntime = { dispose: vi.fn(async () => {}) };
    const activateInteractions = vi.fn(() => { order.push('activate'); });
    const handleSend = vi.fn(() => { order.push('send'); });
    const ctl = {
      getWorkspaceContext: () => ({ cwd: 'D:/repo', trusted: true }),
      missionGateway: {
        start: async () => ({
          status: 'ready', sessionId: 'mission-1', activateInteractions,
          runtime: { runtime: missionRuntime },
          settings: { skipScrutiny: false, skipUserTesting: false },
        }),
      },
      sessionState: {
        connection: { status: 'connected' }, runtime: oldRuntime, sessionId: 'chat-1',
        conversationId: 'chat-conversation', activeRuntimeCwd: 'D:/repo',
        runtimeGeneration: 1, disposed: false, managedRuntimes: new Set(),
      },
      metadata: { modelCatalog: { status: 'ready', items: [] } },
      turnState: { turn: null },
      interactions: { hasPending: () => false },
      missionState: { missionStartInProgress: false },
      recoveryState: {},
      catalogState: { sessions: { status: 'ready', items: [] }, catalogCwd: 'D:/repo' },
      recoveryStore: {
        createConversation: () => outcome === 'recovery-rejected' ? undefined : 'conversation-1',
        discardConversation: vi.fn(), selectConversation: vi.fn(), flush: async () => {},
      },
      isCurrentSessionOperation: () => ownerCurrent,
      effects: {
        loadSessionMetadata: vi.fn(),
        commitSessionBinding: (binding: Parameters<typeof commitSessionBinding>[1]) => commitSessionBinding(ctl as never, binding),
        withActiveSession: (sessions: Parameters<typeof withActiveSession>[1], entry?: Parameters<typeof withActiveSession>[2]) =>
          withActiveSession(ctl as never, sessions, entry),
        closeRuntime: async (runtime: typeof oldRuntime) => {
          if (runtime === oldRuntime) {
            order.push('close');
            if (outcome === 'close-failed') throw new Error('close failed');
            if (outcome === 'owner-changed') ownerCurrent = false;
          }
          await runtime.dispose();
        },
        handleSend,
      },
      emit: vi.fn(), emitSnapshot: vi.fn(), emitSessionDiagnostic: vi.fn(),
    };
    handleMissionStart(ctl as never, message);
    await vi.waitFor(() => expect(ctl.missionState.missionStartInProgress).toBe(false));
    const adopted = outcome === 'ready';
    expect(order).toEqual(adopted ? ['close', 'activate', 'send'] : outcome === 'recovery-rejected' ? [] : ['close']);
    expect(ctl.sessionState.runtime).toBe(adopted ? missionRuntime : oldRuntime);
    expect(ctl.sessionState).toMatchObject(adopted
      ? { sessionId: 'mission-1', conversationId: 'conversation-1' }
      : { sessionId: 'chat-1', conversationId: 'chat-conversation' });
    expect(missionRuntime.dispose).toHaveBeenCalledTimes(adopted ? 0 : 1);
    expect(ctl.recoveryStore.discardConversation).toHaveBeenCalledTimes(
      outcome === 'close-failed' || outcome === 'owner-changed' ? 1 : 0,
    );
  });
});
