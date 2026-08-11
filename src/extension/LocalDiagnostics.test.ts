import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalDiagnostics } from './LocalDiagnostics';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('LocalDiagnostics', () => {
  it('persists bounded records without messages, paths, IDs, or raw errors', async () => {
    const directory = await temporaryDirectory();
    const outputLines: string[] = [];
    const diagnostics = new LocalDiagnostics({
      directory,
      output: {
        appendLine: (line) => outputLines.push(line),
        show: vi.fn(),
        dispose: vi.fn(),
      },
      now: () => new Date('2026-08-09T12:00:00.000Z'),
    });

    diagnostics.observability.logger?.log({
      level: 'error',
      name: 'droid.sdk.error',
      message: 'secret prompt and C:\\private\\workspace',
      attributes: {
        requestId: 'private-request-id',
        sessionId: 'private-session-id',
        cwd: 'C:\\private\\workspace',
        method: 'add_user_message',
        messageByteLength: 200,
        cause: 'private stack trace',
      },
      error: {
        message: 'private error',
        name: 'Error',
      },
    });
    diagnostics.observability.metrics?.record({
      name: 'cli_jsonrpc_child_spawn_latency',
      kind: 'histogram',
      value: 42,
      unit: 'ms',
      attributes: {
        outcome: 'success',
        path: 'C:\\private\\droid.exe',
      },
    });
    diagnostics.record({
      level: 'info',
      name: 'runtime.turn.finished',
      attributes: {
        durationMs: 84,
        outcome: 'completed',
        terminalId: 'private-terminal-id',
      },
    });
    await diagnostics.flush();

    const contents = await readFile(diagnostics.filePath, 'utf8');
    const serializedOutput = outputLines.join('\n');
    for (const prohibited of [
      'secret prompt',
      'private',
      'workspace',
      'requestId',
      'sessionId',
      'terminalId',
      'stack trace',
    ]) {
      expect(contents).not.toContain(prohibited);
      expect(serializedOutput).not.toContain(prohibited);
    }
    const records = contents
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records).toMatchObject([
      {
        source: 'sdk',
        level: 'error',
        name: 'droid.sdk.error',
        attributes: {
          method: 'add_user_message',
          messageByteLength: 200,
        },
      },
      {
        source: 'sdk',
        level: 'debug',
        name: 'sdk.metric',
        attributes: {
          metric: 'cli_jsonrpc_child_spawn_latency',
          value: 42,
          outcome: 'success',
        },
      },
      {
        source: 'host',
        level: 'info',
        name: 'runtime.turn.finished',
        attributes: {
          durationMs: 84,
          outcome: 'completed',
        },
      },
    ]);
  });

  it('rotates within a bounded retention count', async () => {
    const directory = await temporaryDirectory();
    const diagnostics = new LocalDiagnostics({
      directory,
      output: {
        appendLine: vi.fn(),
        show: vi.fn(),
        dispose: vi.fn(),
      },
      maxFileBytes: 220,
      backupCount: 2,
    });

    for (let index = 0; index < 8; index += 1) {
      diagnostics.record({
        level: 'info',
        name: 'runtime.turn.finished',
        attributes: {
          durationMs: index,
          outcome: 'completed',
        },
      });
    }
    await diagnostics.flush();

    expect((await readdir(directory)).sort()).toEqual([
      'droidvisx.jsonl',
      'droidvisx.jsonl.1',
      'droidvisx.jsonl.2',
    ]);
  });

  it('contains Output Channel and file sink failures', async () => {
    const directory = await temporaryDirectory();
    const diagnostics = new LocalDiagnostics({
      directory,
      output: {
        appendLine: () => {
          throw new Error('Output unavailable');
        },
        show: () => {
          throw new Error('Output unavailable');
        },
        dispose: () => {
          throw new Error('Output unavailable');
        },
      },
    });

    expect(() =>
      diagnostics.record({
        level: 'info',
        name: 'extension.activated',
      }),
    ).not.toThrow();
    expect(() => diagnostics.show()).not.toThrow();
    await expect(diagnostics.flush()).resolves.toBeUndefined();
    expect(() => diagnostics.dispose()).not.toThrow();
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'droidvisx-diagnostics-'));
  temporaryDirectories.push(directory);
  return directory;
}
