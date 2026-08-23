import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LocalDiagnostics, scrubCredentials } from './LocalDiagnostics';

const temporaryDirectories: string[] = [];
const credentialKeys = [
  'api-key',
  'api_key',
  'api-token',
  'api_token',
  'secret',
  'token',
  'passwd',
  'password',
  'credential',
  'authorization',
  'access-key',
  'access_key',
  'access-token',
  'access_token',
  'client-secret',
  'client_secret',
  'OPENAI_API_KEY',
] as const;

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

const silentOutput = () => ({
  appendLine: vi.fn(),
  show: vi.fn(),
  dispose: vi.fn(),
});

describe('LocalDiagnostics', () => {
  it('persists full-fidelity records with act, workspace, and turn fields', async () => {
    const directory = await temporaryDirectory();
    const diagnostics = new LocalDiagnostics({
      directory,
      output: silentOutput(),
      workspace: () => 'D:\\projects\\demo',
      now: () => new Date('2026-08-11T12:00:00.000Z'),
    });

    diagnostics.record({
      level: 'info',
      name: 'runtime.turn.started',
      attributes: {
        textLength: 11,
        sessionId: 'session-abc',
        filePath: 'C:\\repo\\src\\main.ts',
      },
      detail: 'real prompt',
    });
    diagnostics.beginTurnScope('turn-uuid-1');
    diagnostics.record({
      level: 'error',
      name: 'runtime.stream.error',
      detail: 'Error: boom\n    at stack frame line 1',
    });
    diagnostics.endTurnScope();
    diagnostics.record({
      level: 'info',
      name: 'host.turn.state',
      attributes: { status: 'completed' },
    });
    await diagnostics.flush();

    expect(diagnostics.filePath).toBe(
      join(directory, 'droidvisx-20260811.jsonl'),
    );
    const records = (await readFile(diagnostics.filePath, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);

    expect(records[0]).toMatchObject({
      sequence: 0,
      act: diagnostics.act,
      source: 'host',
      level: 'info',
      name: 'runtime.turn.started',
      workspace: 'D:\\projects\\demo',
      attributes: {
        textLength: 11,
        sessionId: 'session-abc',
        filePath: 'C:\\repo\\src\\main.ts',
      },
      detail: 'real prompt',
    });
    expect(records[0]).not.toHaveProperty('turn');
    expect(records[1]).toMatchObject({
      turn: 'turn-uuid-1',
      detail: 'Error: boom\n    at stack frame line 1',
    });
    expect(records[2]).not.toHaveProperty('turn');
    expect(diagnostics.act).toMatch(/^[0-9a-f]{6}$/);
  });

  it('passes SDK log messages, attributes, and stacks through', async () => {
    const directory = await temporaryDirectory();
    const diagnostics = new LocalDiagnostics({
      directory,
      output: silentOutput(),
      now: () => new Date('2026-08-11T12:00:00.000Z'),
    });

    diagnostics.observability.logger?.log({
      level: 'error',
      name: 'droid.sdk.error',
      message: 'request failed for C:\\repo\\workspace',
      attributes: {
        requestId: 'request-9',
        sessionId: 'session-7',
        cwd: 'C:\\repo\\workspace',
        method: 'add_user_message',
      },
      error: {
        name: 'Error',
        message: 'transport closed',
        stack: 'Error: transport closed\n    at Transport.send',
      },
    } as never);
    diagnostics.observability.metrics?.record({
      name: 'cli_jsonrpc_child_spawn_latency',
      kind: 'histogram',
      value: 42,
      unit: 'ms',
      attributes: {
        outcome: 'success',
        path: 'C:\\droid\\droid.exe',
      },
    });
    await diagnostics.flush();

    const contents = await readFile(diagnostics.filePath, 'utf8');
    const records = contents
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(records[0]).toMatchObject({
      source: 'sdk',
      name: 'droid.sdk.error',
      attributes: {
        requestId: 'request-9',
        sessionId: 'session-7',
        cwd: 'C:\\repo\\workspace',
        method: 'add_user_message',
      },
    });
    expect(records[0]?.detail).toContain(
      'request failed for C:\\repo\\workspace',
    );
    expect(records[0]?.detail).toContain('at Transport.send');
    expect(records[1]).toMatchObject({
      source: 'sdk',
      name: 'sdk.metric',
      attributes: {
        metric: 'cli_jsonrpc_child_spawn_latency',
        value: 42,
        path: 'C:\\droid\\droid.exe',
      },
    });
  });

  it('scrubs credential-shaped values while keeping the rest verbatim', async () => {
    const directory = await temporaryDirectory();
    const diagnostics = new LocalDiagnostics({
      directory,
      output: silentOutput(),
      now: () => new Date('2026-08-11T12:00:00.000Z'),
    });

    diagnostics.record({
      level: 'error',
      name: 'runtime.stream.error',
      attributes: {
        header: 'Authorization: Bearer abc123def456ghi789',
        openai: 'failed with sk-proj-abcdefghijklmnop1234',
        assignment: "api_key='super-secret-value' plus context",
        ...Object.fromEntries(
          credentialKeys.map((key, index) => [
            key,
            `structured-secret-${index}`,
          ]),
        ),
        nested: {
          request: {
            access_token: 'nested-secret-value',
          },
        } as never,
        not_client_secret: 'ordinary-structured-value',
        refresh_token: 'ordinary-refresh-value',
      },
      detail:
        'command `curl -H "Authorization: Bearer abc123def456ghi789"` failed in C:\\repo (client_secret="detail-secret-value")',
    });
    await diagnostics.flush();

    const contents = await readFile(diagnostics.filePath, 'utf8');
    expect(contents).not.toContain('abc123def456ghi789');
    expect(contents).not.toContain('sk-proj-abcdefghijklmnop1234');
    expect(contents).not.toContain('super-secret-value');
    for (let index = 0; index < credentialKeys.length; index += 1) {
      expect(contents).not.toContain(`structured-secret-${index}`);
    }
    expect(contents).not.toContain('nested-secret-value');
    expect(contents).not.toContain('detail-secret-value');
    expect(contents).not.toContain('ghp_abcdefghijklmnopqrst1234');
    expect(contents).toContain('[REDACTED]');
    expect(contents).toContain('ordinary-structured-value');
    expect(contents).toContain('ordinary-refresh-value');
    // Non-credential free text stays verbatim.
    expect(contents).toContain('failed in C:\\\\repo');
    expect(contents).toContain('curl -H');
  });

  it('writes one file per UTC day', async () => {
    const directory = await temporaryDirectory();
    let now = new Date('2026-08-11T23:59:00.000Z');
    const diagnostics = new LocalDiagnostics({
      directory,
      output: silentOutput(),
      now: () => now,
    });

    diagnostics.record({ level: 'info', name: 'extension.activated' });
    now = new Date('2026-08-12T00:01:00.000Z');
    diagnostics.record({ level: 'info', name: 'runtime.turn.started' });
    await diagnostics.flush();

    expect((await readdir(directory)).sort()).toEqual([
      'droidvisx-20260811.jsonl',
      'droidvisx-20260812.jsonl',
    ]);
  });

  it('deletes oldest whole-day files when the total budget is exceeded', async () => {
    const directory = await temporaryDirectory();
    // Pre-existing older days from previous runs.
    await writeFile(
      join(directory, 'droidvisx-20260808.jsonl'),
      'x'.repeat(400),
    );
    await writeFile(
      join(directory, 'droidvisx-20260809.jsonl'),
      'x'.repeat(400),
    );
    await writeFile(join(directory, 'unrelated.txt'), 'keep me');

    const diagnostics = new LocalDiagnostics({
      directory,
      output: silentOutput(),
      now: () => new Date('2026-08-11T12:00:00.000Z'),
      maxTotalBytes: 1_000,
    });
    for (let index = 0; index < 4; index += 1) {
      diagnostics.record({
        level: 'info',
        name: 'runtime.turn.finished',
        attributes: { durationMs: index },
      });
    }
    await diagnostics.flush();

    const entries = (await readdir(directory)).sort();
    // Oldest days go first; the current day's file is never deleted,
    // and non-log files are untouched.
    expect(entries).not.toContain('droidvisx-20260808.jsonl');
    expect(entries).toContain('droidvisx-20260811.jsonl');
    expect(entries).toContain('unrelated.txt');
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

describe('scrubCredentials', () => {
  it.each([
    [
      'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature',
      /Bearer/,
    ],
    ['api-key: sk-abcdefghijklmnop1234', /api-key/],
    ['AWS key AKIAIOSFODNN7EXAMPLE in output', /AWS key/],
    ['slack xoxb-12345678-abcdefghij', /slack/],
    ["api_key='single-quoted-value'", /api_key/],
    ['api_token="double-quoted-value"', /api_token/],
    ['client_secret=unquoted-value', /client_secret/],
    ['access-token="access-value"', /access-token/],
  ])('scrubs %s', (input) => {
    const scrubbed = scrubCredentials(input);
    expect(scrubbed).toContain('[REDACTED]');
  });

  it.each(credentialKeys)(
    'scrubs quoted and unquoted %s assignments',
    (key) => {
      for (const assignment of [
        `${key}=unquoted-value`,
        `${key}='single-quoted value'`,
        `${key}="double-quoted value"`,
      ]) {
        const scrubbed = scrubCredentials(assignment);
        expect(scrubbed).toContain('[REDACTED]');
        expect(scrubbed).not.toContain('value');
      }
    },
  );

  it('keeps ordinary paths, commands, and ids untouched', () => {
    const input =
      'Ran `git status` in C:\\repo; tokenizer=cl100k; not_client_secret=ordinary';
    expect(scrubCredentials(input)).toBe(input);
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'droidvisx-diagnostics-'));
  temporaryDirectories.push(directory);
  return directory;
}
