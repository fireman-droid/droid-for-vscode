import { describe, expect, it, vi } from 'vitest';

import { FactorySessionHistoryLoader } from './FactorySessionHistoryLoader';

describe('FactorySessionHistoryLoader.loadSubagentSummaries', () => {
  it('loads and projects the subagent invocation ledger', async () => {
    const close = vi.fn(async () => undefined);
    const loadSession = vi.fn(async () => ({
      result: {
        session: { messages: [] },
        subagentInvocations: [
          {
            childSessionId: 'child-1',
            subagentType: 'worker',
            description: 'Review bridge code reuse',
            status: 'completed',
            toolUseCount: 4,
            durationMs: 62000,
          },
        ],
      },
    }));
    const loader = new FactorySessionHistoryLoader({
      createClient: async () => ({ loadSession, close }),
    });

    await expect(
      loader.loadSubagentSummaries({
        cwd: 'C:\\workspace',
        sessionId: 'session-1',
      }),
    ).resolves.toEqual([
      {
        type: 'worker',
        description: 'Review bridge code reuse',
        status: 'completed',
        toolUseCount: 4,
        durationMs: 62000,
      },
    ]);
    expect(loadSession).toHaveBeenCalledWith({ sessionId: 'session-1' });
    expect(close).toHaveBeenCalledOnce();
  });

  it('resolves an empty list when the session has no ledger', async () => {
    const loader = new FactorySessionHistoryLoader({
      createClient: async () => ({
        loadSession: async () => ({
          result: { session: { messages: [] } },
        }),
        close: async () => undefined,
      }),
    });

    await expect(
      loader.loadSubagentSummaries({
        cwd: 'C:\\workspace',
        sessionId: 'session-1',
      }),
    ).resolves.toEqual([]);
  });

  it('resolves null instead of throwing when the load fails', async () => {
    const close = vi.fn(async () => undefined);
    const loader = new FactorySessionHistoryLoader({
      createClient: async () => ({
        loadSession: async () => {
          throw new Error('C:\\Users\\person\\.factory\\sensitive.jsonl');
        },
        close,
      }),
    });

    await expect(
      loader.loadSubagentSummaries({
        cwd: 'C:\\workspace',
        sessionId: 'session-1',
      }),
    ).resolves.toBeNull();
    expect(close).toHaveBeenCalledOnce();
  });
});
