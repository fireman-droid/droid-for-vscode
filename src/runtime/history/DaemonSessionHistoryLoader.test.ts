import type { DaemonApi } from '../daemon/api';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createDaemonFirstHistoryLoader,
  readTaskInvocationLedger,
} from './DaemonSessionHistoryLoader';
import type { SessionHistoryLoader } from './SessionHistory';
import { unavailableSessionHistory } from './SessionHistory';

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const root = mkdtempSync(path.join(os.tmpdir(), 'dvx-daemon-history-'));
  tempRoots.push(root);
  return root;
}

function droidWithMessages(
  getMessages: (
    sessionId: string,
    options?: { limit?: number; cursor?: string },
  ) => Promise<unknown[]>,
): () => Promise<DaemonApi> {
  return async () => ({ sessions: { getMessages } }) as unknown as DaemonApi;
}

function textMessage(
  id: string,
  role: string,
  text: string,
  createdAt = 0,
  parentId?: string,
) {
  return {
    id,
    role,
    content: [{ type: 'text', text }],
    createdAt,
    updatedAt: createdAt,
    ...(parentId === undefined ? {} : { parentId }),
  };
}

function fallbackLoader(
  overrides: Partial<SessionHistoryLoader> = {},
): SessionHistoryLoader {
  return {
    loadHistory: vi.fn(async () => unavailableSessionHistory()),
    ...overrides,
  };
}

describe('createDaemonFirstHistoryLoader.loadHistory', () => {
  it('projects a single-page daemon message read', async () => {
    const getMessages = vi.fn(async () => [
      textMessage('m1', 'user', 'hello'),
      textMessage('m2', 'assistant', 'world'),
    ]);
    const loader = createDaemonFirstHistoryLoader({
      getDroid: droidWithMessages(getMessages),
      isDaemonActive: () => true,
      fallback: fallbackLoader(),
      sessionsDirectory: tempDir(),
      taskInvocationsFile: path.join(tempDir(), 'missing.json'),
    });

    const loaded = await loader.loadHistory({
      cwd: 'C:\\workspace',
      sessionId: 'session-1',
    });
    expect(loaded.status).toBe('available');
    if (loaded.status !== 'available') {
      return;
    }
    expect(loaded.state.transcript.map((item) => item.kind)).toEqual([
      'user',
      'assistant',
    ]);
    expect(loaded.state.historyStatus).toBe('complete');
    expect(getMessages).toHaveBeenCalledTimes(1);
    expect(getMessages).toHaveBeenCalledWith('session-1', {
      limit: 100,
    });
  });

  it('normalizes newest-first daemon messages before projection', async () => {
    const chronological = [
      textMessage('m1', 'user', 'oldest question', 1),
      textMessage('m2', 'assistant', 'oldest answer', 2, 'm1'),
      textMessage('m3', 'user', 'latest question', 3, 'm2'),
      textMessage('m4', 'assistant', 'latest answer', 4, 'm3'),
    ];
    const loader = createDaemonFirstHistoryLoader({
      getDroid: droidWithMessages(async () => chronological.slice().reverse()),
      isDaemonActive: () => true,
      fallback: fallbackLoader(),
      sessionsDirectory: tempDir(),
      taskInvocationsFile: path.join(tempDir(), 'missing.json'),
    });

    const loaded = await loader.loadHistory({
      cwd: 'C:\\workspace',
      sessionId: 'session-1',
    });
    expect(loaded.status).toBe('available');
    if (loaded.status !== 'available') {
      return;
    }
    expect(
      loaded.state.transcript.map((item) =>
        item.kind === 'user' || item.kind === 'assistant' ? item.text : item.kind,
      ),
    ).toEqual(['oldest question', 'oldest answer', 'latest question', 'latest answer']);
  });

  it('pages newest-first with the last message id as cursor', async () => {
    const chronological = Array.from({ length: 101 }, (_, index) =>
      textMessage(
        `m${String(index)}`,
        'user',
        `message-${String(index)}`,
        index,
        index === 0 ? undefined : `m${String(index - 1)}`,
      ),
    );
    const pageOne = chronological.slice(1).reverse();
    const pageTwo = chronological.slice(0, 1);
    const getMessages = vi.fn(async (_id: string, options?: { cursor?: string }) =>
      options?.cursor === undefined ? pageOne : pageTwo,
    );
    const loader = createDaemonFirstHistoryLoader({
      getDroid: droidWithMessages(getMessages),
      isDaemonActive: () => true,
      fallback: fallbackLoader(),
      sessionsDirectory: tempDir(),
      taskInvocationsFile: path.join(tempDir(), 'missing.json'),
    });

    const loaded = await loader.loadHistory({
      cwd: 'C:\\workspace',
      sessionId: 'session-1',
    });
    expect(loaded.status).toBe('available');
    if (loaded.status !== 'available') {
      return;
    }
    expect(loaded.state.transcript).toHaveLength(101);
    expect(loaded.state.transcript[0]).toMatchObject({
      kind: 'user',
      text: 'message-0',
    });
    expect(loaded.state.transcript[100]).toMatchObject({
      kind: 'user',
      text: 'message-100',
    });
    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(getMessages).toHaveBeenLastCalledWith('session-1', {
      limit: 100,
      cursor: 'm1',
    });
  });

  it('keeps an old disconnected branch out of the current transcript tail', async () => {
    const messages = [
      textMessage('m4', 'assistant', 'latest answer', 5, 'm3'),
      textMessage('m3', 'user', 'latest question', 4, 'm2'),
      textMessage('branch', 'assistant', 'old branch answer', 3, 'm2'),
      textMessage('m2', 'assistant', 'earlier answer', 2, 'm1'),
      textMessage('m1', 'user', 'earlier question', 1),
    ];
    const loader = createDaemonFirstHistoryLoader({
      getDroid: droidWithMessages(async () => messages),
      isDaemonActive: () => true,
      fallback: fallbackLoader(),
      sessionsDirectory: tempDir(),
      taskInvocationsFile: path.join(tempDir(), 'missing.json'),
    });

    const loaded = await loader.loadHistory({
      cwd: 'C:\\workspace',
      sessionId: 'session-1',
    });
    expect(loaded.status).toBe('available');
    if (loaded.status !== 'available') {
      return;
    }
    expect(
      loaded.state.transcript.map((item) =>
        item.kind === 'user' || item.kind === 'assistant' ? item.text : item.kind,
      ),
    ).toEqual([
      'earlier question',
      'earlier answer',
      'old branch answer',
      'latest question',
      'latest answer',
    ]);
  });

  it('falls back to the spawn loader when the daemon read fails', async () => {
    const fallbackResult = {
      status: 'available' as const,
      state: {
        transcript: [],
        historyStatus: 'complete' as const,
        truncated: false,
      },
    };
    const fallback = fallbackLoader({
      loadHistory: vi.fn(async () => fallbackResult),
    });
    const loader = createDaemonFirstHistoryLoader({
      getDroid: droidWithMessages(async () => {
        throw new Error('daemon offline');
      }),
      isDaemonActive: () => true,
      fallback,
      sessionsDirectory: tempDir(),
      taskInvocationsFile: path.join(tempDir(), 'missing.json'),
    });

    await expect(
      loader.loadHistory({ cwd: 'C:\\workspace', sessionId: 's1' }),
    ).resolves.toBe(fallbackResult);
    expect(fallback.loadHistory).toHaveBeenCalledOnce();
  });

  it('uses the fallback directly when the daemon is inactive', async () => {
    const getMessages = vi.fn(async () => []);
    const fallback = fallbackLoader();
    const loader = createDaemonFirstHistoryLoader({
      getDroid: droidWithMessages(getMessages),
      isDaemonActive: () => false,
      fallback,
      sessionsDirectory: tempDir(),
      taskInvocationsFile: path.join(tempDir(), 'missing.json'),
    });

    await loader.loadHistory({ cwd: 'C:\\workspace', sessionId: 's1' });
    expect(getMessages).not.toHaveBeenCalled();
    expect(fallback.loadHistory).toHaveBeenCalledOnce();
  });

  it('supplements tokenUsage and mission role from the sidecar', async () => {
    const sessionsDirectory = tempDir();
    // The workspace slug directory resolution falls back to the root
    // sessions directory, which is the second lookup candidate.
    writeFileSync(
      path.join(sessionsDirectory, 'session-1.settings.json'),
      JSON.stringify({
        tags: [
          {
            name: 'decompSessionType',
            metadata: { value: 'orchestrator' },
          },
        ],
        tokenUsage: {
          inputTokens: 10,
          outputTokens: 20,
          cacheReadTokens: 30,
          cacheCreationTokens: 0,
          thinkingTokens: 5,
          factoryCredits: 0,
        },
      }),
    );
    const loader = createDaemonFirstHistoryLoader({
      getDroid: droidWithMessages(async () => [textMessage('m1', 'user', 'hi')]),
      isDaemonActive: () => true,
      fallback: fallbackLoader(),
      sessionsDirectory,
      taskInvocationsFile: path.join(tempDir(), 'missing.json'),
    });

    const loaded = await loader.loadHistory({
      cwd: 'C:\\workspace',
      sessionId: 'session-1',
    });
    expect(loaded.status).toBe('available');
    if (loaded.status !== 'available') {
      return;
    }
    expect(loaded.tokenUsage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 30,
      cacheCreationTokens: 0,
      thinkingTokens: 5,
      factoryCredits: 0,
    });
    expect(loaded.mission).toEqual({
      state: null,
      role: 'orchestrator',
    });
  });
});

describe('task-invocation ledger reads', () => {
  function writeLedger(entries: readonly unknown[]): string {
    const dir = tempDir();
    const file = path.join(dir, 'task-invocations.json');
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ invocations: entries }));
    return file;
  }

  it('filters to the session and sorts by createdAt', async () => {
    const file = writeLedger([
      {
        parentSessionId: 'parent-1',
        createdAt: 200,
        subagentType: 'worker',
        description: 'second',
        status: 'completed',
        childSessionId: 'child-2',
      },
      {
        parentSessionId: 'other',
        createdAt: 100,
        subagentType: 'worker',
        description: 'foreign',
        status: 'running',
        childSessionId: 'child-x',
      },
      {
        parentSessionId: 'parent-1',
        createdAt: 100,
        subagentType: 'worker',
        description: 'first',
        status: 'running',
        childSessionId: 'child-1',
        toolUseCount: 3,
        durationMs: 1200,
      },
    ]);

    await expect(readTaskInvocationLedger(file, 'parent-1')).resolves.toEqual([
      {
        summary: {
          type: 'worker',
          description: 'first',
          status: 'running',
          toolUseCount: 3,
          durationMs: 1200,
        },
        childSessionId: 'child-1',
      },
      {
        summary: {
          type: 'worker',
          description: 'second',
          status: 'completed',
        },
        childSessionId: 'child-2',
      },
    ]);
  });

  it('resolves null for a missing or malformed file', async () => {
    await expect(
      readTaskInvocationLedger(path.join(tempDir(), 'missing.json'), 'parent-1'),
    ).resolves.toBeNull();

    const dir = tempDir();
    const malformed = path.join(dir, 'task-invocations.json');
    writeFileSync(malformed, '{not json');
    await expect(readTaskInvocationLedger(malformed, 'parent-1')).resolves.toBeNull();
  });

  it('serves loadSubagentSummaries without touching the daemon', async () => {
    const file = writeLedger([
      {
        parentSessionId: 'parent-1',
        createdAt: 1,
        subagentType: 'explore',
        description: 'scan',
        status: 'completed',
      },
    ]);
    const getMessages = vi.fn(async () => []);
    const loader = createDaemonFirstHistoryLoader({
      getDroid: droidWithMessages(getMessages),
      isDaemonActive: () => true,
      fallback: fallbackLoader(),
      sessionsDirectory: tempDir(),
      taskInvocationsFile: file,
    });

    await expect(
      loader.loadSubagentSummaries?.({
        cwd: 'C:\\workspace',
        sessionId: 'parent-1',
      }),
    ).resolves.toEqual([{ type: 'explore', description: 'scan', status: 'completed' }]);
    expect(getMessages).not.toHaveBeenCalled();
  });

  it('falls back to the spawn loader when the ledger fails', async () => {
    const fallbackRecords = [
      {
        summary: {
          type: 'worker',
          description: 'fallback',
          status: 'completed' as const,
        },
        childSessionId: null,
      },
    ];
    const fallback = fallbackLoader({
      loadSubagentInvocations: vi.fn(async () => fallbackRecords),
    });
    const loader = createDaemonFirstHistoryLoader({
      getDroid: droidWithMessages(async () => []),
      isDaemonActive: () => true,
      fallback,
      sessionsDirectory: tempDir(),
      taskInvocationsFile: path.join(tempDir(), 'missing.json'),
    });

    await expect(
      loader.loadSubagentInvocations?.({
        cwd: 'C:\\workspace',
        sessionId: 'parent-1',
      }),
    ).resolves.toBe(fallbackRecords);
    expect(fallback.loadSubagentInvocations).toHaveBeenCalledOnce();
  });
});
