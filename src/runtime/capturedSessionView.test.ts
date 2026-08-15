import {
  AutonomyLevel,
  ContextStatsAccuracy,
  DroidInteractionMode,
  ReasoningEffort,
  type DroidStreamEvent,
  type SessionSettings,
} from '@factory/droid-sdk/node';
import { expect, it, vi } from 'vitest';

import { createCapturedSessionView } from './capturedSessionView';
import type { FactoryDroidSession } from './FactoryDroidRuntime';

it('uses a resumed load seed and then accepts newer live usage', async () => {
  type Listener = (notification: Record<string, unknown>) => void;
  let listener: Listener | undefined;
  const session = createSession();
  session.onNotification = vi.fn((next: Listener) => {
    listener = next;
    return vi.fn();
  });
  const captured = createCapturedSessionView(session, undefined, {
    status: 'available',
    used: 35,
  });

  await expect(captured.readContextWindowSource?.()).resolves.toEqual({
    limit: 100,
    lastCallTokenUsage: {
      status: 'available',
      used: 35,
    },
  });

  listener?.({
    jsonrpc: '2.0',
    factoryApiVersion: '1.0.0',
    type: 'notification',
    method: 'droid.session_notification',
    params: {
      sessionId: 'session-1',
      notification: {
        type: 'session_token_usage_changed',
        sessionId: 'session-1',
        tokenUsage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
          thinkingTokens: 0,
        },
        lastCallTokenUsage: {
          inputTokens: 40,
          cacheReadTokens: 50,
          outputTokens: 10,
        },
      },
    },
  });
  await expect(captured.readContextWindowSource?.()).resolves.toMatchObject({
    lastCallTokenUsage: {
      status: 'available',
      used: 100,
    },
  });
});

function createSession(): FactoryDroidSession {
  return {
    id: 'session-1',
    settings: {
      modelId: 'model-1',
      reasoningEffort: ReasoningEffort.High,
      interactionMode: DroidInteractionMode.Auto,
      autonomyLevel: AutonomyLevel.Medium,
    } as SessionSettings,
    stream: vi.fn(
      async function* (): AsyncGenerator<DroidStreamEvent> {},
    ),
    interrupt: vi.fn(async () => {}),
    updateSettings: vi.fn(async () => ({})),
    getContextStats: vi.fn(async () => ({
      used: 999,
      remaining: 0,
      limit: 100,
      accuracy: ContextStatsAccuracy.Exact,
      updatedAt: new Date().toISOString(),
    })),
    close: vi.fn(async () => {}),
  };
}
