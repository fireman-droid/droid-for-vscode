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

describe('FactorySessionHistoryLoader spawn observability', () => {
  it('records a timed spawn event when the history client comes up', async () => {
    const record = vi.fn();
    const loader = new FactorySessionHistoryLoader({
      createClient: async () => ({
        loadSession: async () => ({
          result: { session: { messages: [] } },
        }),
        close: async () => undefined,
      }),
      diagnostics: { record },
    });

    await loader.loadHistory({
      cwd: 'C:\\workspace',
      sessionId: 'session-1',
    });

    expect(record).toHaveBeenCalledWith({
      level: 'info',
      name: 'runtime.history.spawn',
      attributes: {
        durationMs: expect.any(Number),
        outcome: 'ok',
        sessionId: 'session-1',
      },
    });
  });

  it('records a failed spawn with the error detail', async () => {
    const record = vi.fn();
    const loader = new FactorySessionHistoryLoader({
      createClient: async () => {
        throw new Error('droid executable not found');
      },
      diagnostics: { record },
    });

    await expect(
      loader.loadHistory({
        cwd: 'C:\\workspace',
        sessionId: 'session-1',
      }),
    ).resolves.toMatchObject({ status: 'unavailable' });
    expect(record).toHaveBeenCalledWith({
      level: 'warn',
      name: 'runtime.history.spawn',
      attributes: {
        durationMs: expect.any(Number),
        outcome: 'failed',
        sessionId: 'session-1',
      },
      detail: expect.stringContaining('droid executable not found'),
    });
  });

  it('does not record a spawn failure when only the load fails', async () => {
    const record = vi.fn();
    const loader = new FactorySessionHistoryLoader({
      createClient: async () => ({
        loadSession: async () => {
          throw new Error('load exploded');
        },
        close: async () => undefined,
      }),
      diagnostics: { record },
    });

    await loader.loadHistory({
      cwd: 'C:\\workspace',
      sessionId: 'session-1',
    });

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'runtime.history.spawn',
        attributes: expect.objectContaining({ outcome: 'ok' }),
      }),
    );
  });
});
