import { AutonomyLevel, DroidInteractionMode, ReasoningEffort, type SessionSettings } from '@factory/droid-sdk/node';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FactoryDroidRuntime } from '../FactoryDroidRuntime';
import { cancellingRuntimeInteractionHandler } from '../events/runtimeInteractions';
import type { FactoryDroidSession } from '../session/sessionTypes';
import { createLocalDroidSession, type LocalSessionDependencies } from './createLocalDroidSession';

const historyClient = vi.hoisted(() => ({
  loadSession: vi.fn(async () => ({ result: {} })),
  appendMessages: vi.fn(async () => ({ result: {} })),
  close: vi.fn(async () => {}),
}));

vi.mock('./appendProcessHistory', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./appendProcessHistory')>();
  return { ...actual, appendProcessHistory: (options: Parameters<typeof actual.appendProcessHistory>[0]) =>
    actual.appendProcessHistory({ ...options, createClient: async () => historyClient }) };
});

function session(id: string): FactoryDroidSession {
  return {
    id, cwd: `C:/synthetic/${id}`,
    settings: { modelId: 'synthetic-model', reasoningEffort: ReasoningEffort.Low,
      interactionMode: DroidInteractionMode.Auto, autonomyLevel: AutonomyLevel.Medium } as SessionSettings,
    stream: vi.fn(async function* () {}), interrupt: vi.fn(async () => {}),
    updateSettings: vi.fn(async () => ({})), getContextStats: vi.fn(), close: vi.fn(async () => {}),
  };
}

function withReplacement(current: FactoryDroidSession, next: FactoryDroidSession): void {
  current.compact = vi.fn(async () => ({ session: next, removedCount: 1 }));
  current.fork = vi.fn(async () => next);
  current.rewind = vi.fn(async () => ({ session: next }));
}

describe('history notes after Process session replacement', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['compact', 'fork', 'rewind'] as const)('saves only to the latest session after repeated %s', async (operation) => {
    const original = session('original');
    const first = session('first');
    const latest = session('latest');
    withReplacement(original, first);
    withReplacement(first, latest);
    const dependencies: LocalSessionDependencies = {
      createTransport: vi.fn(() => ({ isConnected: true, connect: vi.fn(async () => {}), close: vi.fn(async () => {}),
        send: vi.fn(async () => {}), onMessage: vi.fn(), onError: vi.fn() })),
      createSession: vi.fn(async () => original), resumeSession: vi.fn(async (id) => session(id)),
      listModels: vi.fn(async () => []),
    };
    const runtime = new FactoryDroidRuntime({ interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: (options) => createLocalDroidSession(options, dependencies) });
    await runtime.initialize('C:/synthetic');
    for (let count = 0; count < 2; count++) {
      if (operation === 'fork') await runtime.fork('Synthetic fork');
      else if (operation === 'rewind') await runtime.rewind({ messageId: 'synthetic-anchor', forkTitle: 'Synthetic rewind' });
      else await runtime.compact();
      expect(runtime.supportsHistoryAppend()).toBe(true);
    }
    await expect(runtime.appendHistoryMessage('Synthetic history-only note')).resolves.toMatchObject({ messageId: expect.any(String) });
    expect(latest.close).toHaveBeenCalledOnce();
    expect(original.close).not.toHaveBeenCalled();
    expect(first.close).not.toHaveBeenCalled();
    expect(historyClient.loadSession).toHaveBeenCalledExactlyOnceWith({ sessionId: 'latest' });
    expect(historyClient.appendMessages).toHaveBeenCalledOnce();
    expect(dependencies.resumeSession).toHaveBeenCalledWith('latest', expect.any(Object));
    expect(dependencies.createTransport).toHaveBeenLastCalledWith({ cwd: 'C:/synthetic/latest' });
    expect(runtime.supportsHistoryAppend()).toBe(true);
    expect(original.stream).not.toHaveBeenCalled();
    expect(latest.stream).not.toHaveBeenCalled();
    await runtime.dispose();
  });
});
