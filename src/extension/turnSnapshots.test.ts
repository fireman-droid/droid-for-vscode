import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ChangeStatsPersistence } from './changeStats';
import {
  MAX_SNAPSHOT_OBJECT_BYTES,
  createTurnSnapshotStore,
  type GitRunResult,
  type TurnSnapshotDependencies,
} from './turnSnapshots';

const SCOPE = { sessionId: 'session-a', turnId: 'turn-a' };
const BEFORE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const AFTER = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const PATH_BEFORE = 'cccccccccccccccccccccccccccccccccccccccc';

function memoryPersistence(initial?: unknown): ChangeStatsPersistence & {
  stored: unknown;
} {
  const persistence = {
    stored: initial,
    get<T>(_key: string): T | undefined {
      return persistence.stored as T | undefined;
    },
    update(_key: string, value: unknown): Promise<void> {
      persistence.stored = value;
      return Promise.resolve();
    },
  };
  return persistence;
}

function gitResult(stdout: string, code = 0): GitRunResult {
  return { stdout: Buffer.from(stdout), code, timedOut: false };
}

function verb(args: readonly string[]): string {
  let index = 0;
  while (index < args.length) {
    if (args[index] === '-c') {
      index += 2;
      continue;
    }
    return args[index] ?? '';
  }
  return '';
}

function createStore(
  runGit: TurnSnapshotDependencies['runGit'],
  extras: Partial<TurnSnapshotDependencies> = {},
  persistence: ChangeStatsPersistence = memoryPersistence(),
) {
  const unlink = vi.fn(async () => undefined);
  const copyFile = vi.fn(async () => {
    const error = Object.assign(new Error('missing'), { code: 'ENOENT' });
    throw error;
  });
  return {
    unlink,
    copyFile,
    store: createTurnSnapshotStore(
      () => '/workspace',
      '/storage',
      persistence,
      {
        runGit,
        copyFile,
        unlink,
        mkdir: vi.fn(async () => undefined),
        rm: vi.fn(async () => undefined),
        readdir: vi.fn(async () => []),
        stat: vi.fn(async () => ({ size: 0, isDirectory: () => false })),
        now: () => 0,
        recordDiagnostic: vi.fn(),
        ...extras,
      },
    ),
  };
}

describe('createTurnSnapshotStore', () => {
  it('captures before and after oids through a serial queue', async () => {
    const order: string[] = [];
    let releaseBefore: (() => void) | undefined;
    const beforeGate = new Promise<void>((resolve) => {
      releaseBefore = resolve;
    });
    const runGit: TurnSnapshotDependencies['runGit'] = async (args) => {
      const command = verb(args);
      if (command === 'rev-parse') {
        return gitResult(
          args.includes('--absolute-git-dir')
            ? '/workspace/.git'
            : '/workspace/.git/objects',
        );
      }
      if (command === 'add') {
        return gitResult('');
      }
      if (command === 'write-tree') {
        if (order.length === 0) {
          order.push('before-start');
          await beforeGate;
          order.push('before-done');
          return gitResult(`${BEFORE}\n`);
        }
        order.push('after-done');
        return gitResult(`${AFTER}\n`);
      }
      return gitResult('', 1);
    };
    const { store, unlink } = createStore(runGit);

    const before = store.capture(SCOPE, 'before');
    await vi.waitFor(() => {
      expect(order).toEqual(['before-start']);
    });
    const after = store.capture(SCOPE, 'after');
    await Promise.resolve();
    expect(order).toEqual(['before-start']);
    releaseBefore?.();
    await expect(before).resolves.toBe(BEFORE);
    await expect(after).resolves.toBe(AFTER);
    expect(order).toEqual(['before-start', 'before-done', 'after-done']);
    expect(store.read(SCOPE.sessionId, SCOPE.turnId)).toEqual({
      turnId: SCOPE.turnId,
      before: BEFORE,
      after: AFTER,
    });
    expect(unlink).toHaveBeenCalled();
  });

  it.each(['synchronous', 'asynchronous'] as const)(
    'keeps %s persistence failures out of visible captures until a retry succeeds',
    async (failureKind) => {
      const failure = new Error('sensitive persistence failure');
      let fail = false;
      const persistence = memoryPersistence();
      persistence.update = vi.fn((_key: string, value: unknown) => {
        if (fail) {
          if (failureKind === 'synchronous') {
            throw failure;
          }
          return Promise.reject(failure);
        }
        persistence.stored = value;
        return Promise.resolve();
      });
      const writes = [
        BEFORE,
        BEFORE,
        AFTER,
        AFTER,
        PATH_BEFORE,
        PATH_BEFORE,
      ];
      const runGit: TurnSnapshotDependencies['runGit'] = async (args) => {
        const command = verb(args);
        if (command === 'rev-parse') {
          return gitResult(
            args.includes('--absolute-git-dir')
              ? '/workspace/.git'
              : '/workspace/.git/objects',
          );
        }
        if (command === 'add' || command === 'read-tree') {
          return gitResult('');
        }
        if (command === 'write-tree') {
          return gitResult(`${writes.shift()}\n`);
        }
        return gitResult('', 1);
      };
      const { store } = createStore(runGit, {}, persistence);

      fail = true;
      await expect(store.capture(SCOPE, 'before')).rejects.toBe(failure);
      expect(store.read(SCOPE.sessionId, SCOPE.turnId)).toBeUndefined();

      fail = false;
      await store.capture(SCOPE, 'before');
      fail = true;
      await expect(store.capture(SCOPE, 'after')).rejects.toBe(failure);
      expect(store.read(SCOPE.sessionId, SCOPE.turnId)).toEqual({
        turnId: SCOPE.turnId,
        before: BEFORE,
      });

      fail = false;
      await store.capture(SCOPE, 'after');
      expect(store.read(SCOPE.sessionId, SCOPE.turnId)).toEqual({
        turnId: SCOPE.turnId,
        before: BEFORE,
        after: AFTER,
      });

      const path = join('/workspace', 'ignored.txt');
      fail = true;
      await expect(store.capturePaths(SCOPE, [path])).rejects.toBe(failure);
      expect(store.read(SCOPE.sessionId, SCOPE.turnId)).toEqual({
        turnId: SCOPE.turnId,
        before: BEFORE,
        after: AFTER,
      });

      fail = false;
      await store.capturePaths(SCOPE, [path]);
      expect(store.read(SCOPE.sessionId, SCOPE.turnId)).toEqual({
        turnId: SCOPE.turnId,
        before: PATH_BEFORE,
        after: AFTER,
        snapshotPaths: ['ignored.txt'],
      });
      expect(persistence.stored).toEqual({
        version: 1,
        sessions: [
          {
            sessionId: SCOPE.sessionId,
            turns: [
              {
                turnId: SCOPE.turnId,
                before: PATH_BEFORE,
                after: AFTER,
                snapshotPaths: ['ignored.txt'],
              },
            ],
          },
        ],
      });
    },
  );

  it.each([
    'pending success',
    'synchronous failure',
    'asynchronous failure',
  ] as const)(
    'makes dispose join the final %s snapshot write',
    async (outcome) => {
      const failure = new Error('final persistence failure');
      let release!: () => void;
      const persistence = memoryPersistence();
      persistence.update = vi.fn(() => {
        if (outcome === 'synchronous failure') {
          throw failure;
        }
        if (outcome === 'asynchronous failure') {
          return Promise.reject(failure);
        }
        return new Promise<void>((resolve) => {
          release = resolve;
        });
      });
      const runGit: TurnSnapshotDependencies['runGit'] = async (args) => {
        const command = verb(args);
        if (command === 'rev-parse') {
          return gitResult(
            args.includes('--absolute-git-dir')
              ? '/workspace/.git'
              : '/workspace/.git/objects',
          );
        }
        if (command === 'add') {
          return gitResult('');
        }
        if (command === 'write-tree') {
          return gitResult(`${BEFORE}\n`);
        }
        return gitResult('', 1);
      };
      const { store } = createStore(runGit, {}, persistence);
      const capture = store.capture(SCOPE, 'before');
      const first = store.dispose();
      const joiner = store.dispose();

      expect(joiner).toBe(first);
      if (outcome === 'pending success') {
        await vi.waitFor(() => {
          expect(persistence.update).toHaveBeenCalledOnce();
        });
        release();
        await expect(capture).resolves.toBe(BEFORE);
        await expect(first).resolves.toBeUndefined();
        await expect(joiner).resolves.toBeUndefined();
        return;
      }

      await expect(capture).rejects.toBe(failure);
      await expect(first).rejects.toBe(failure);
      await expect(joiner).rejects.toBe(failure);
    },
  );

  it('force-includes tool paths in both trees even when Git ignores them', async () => {
    const path = 'artifacts/diff-review-test/a.txt';
    const toolPath = join('/workspace', ...path.split('/'));
    const writes = [BEFORE, PATH_BEFORE, AFTER];
    const runGit = vi.fn<TurnSnapshotDependencies['runGit']>(
      async (args) => {
        const command = verb(args);
        if (command === 'rev-parse') {
          return gitResult(
            args.includes('--absolute-git-dir')
              ? '/workspace/.git\n'
              : '/workspace/.git/objects\n',
          );
        }
        if (command === 'write-tree') {
          return gitResult(`${writes.shift()}\n`);
        }
        return gitResult('');
      },
    );
    const persistence = memoryPersistence();
    const { store } = createStore(runGit, {}, persistence);

    await store.capture(SCOPE, 'before');
    await store.capturePaths(SCOPE, [toolPath]);
    await store.capture(SCOPE, 'after');

    expect(store.read(SCOPE.sessionId, SCOPE.turnId)).toMatchObject({
      before: PATH_BEFORE,
      after: AFTER,
      snapshotPaths: [path],
    });
    const forcedAdds = runGit.mock.calls.filter(
      ([args]) =>
        verb(args) === 'add' &&
        args.includes('-f') &&
        args.includes(path),
    );
    expect(forcedAdds).toHaveLength(2);
  });

  it('keeps a missing Create path absent from the before tree', async () => {
    const path = 'docs/new.md';
    const toolPath = join('/workspace', ...path.split('/'));
    const writes = [BEFORE, BEFORE, AFTER];
    let present = false;
    const runGit = vi.fn<TurnSnapshotDependencies['runGit']>(
      async (args) => {
        const command = verb(args);
        if (command === 'rev-parse') {
          return gitResult(
            args.includes('--absolute-git-dir')
              ? '/workspace/.git\n'
              : '/workspace/.git/objects\n',
          );
        }
        if (command === 'write-tree') {
          return gitResult(`${writes.shift()}\n`);
        }
        if (command === 'add' && args.includes(path) && !present) {
          return gitResult('', 128);
        }
        return gitResult('');
      },
    );
    const { store } = createStore(runGit);

    await store.capture(SCOPE, 'before');
    await store.capturePaths(SCOPE, [toolPath]);
    present = true;
    await store.capture(SCOPE, 'after');

    expect(store.read(SCOPE.sessionId, SCOPE.turnId)).toMatchObject({
      before: BEFORE,
      after: AFTER,
      snapshotPaths: [path],
    });
    const forcedAdds = runGit.mock.calls.filter(
      ([args]) =>
        verb(args) === 'add' &&
        args.includes('-f') &&
        args.includes(path),
    );
    expect(forcedAdds).toHaveLength(2);
  });

  it('diffs the two captured trees without binding an index', async () => {
    const calls: Array<{
      readonly args: readonly string[];
      readonly env: NodeJS.ProcessEnv;
    }> = [];
    let written = 0;
    const runGit: TurnSnapshotDependencies['runGit'] = async (args, options) => {
      const command = verb(args);
      if (command === 'rev-parse') {
        return gitResult(
          args.includes('--absolute-git-dir')
            ? '/workspace/.git'
            : '/workspace/.git/objects',
        );
      }
      if (command === 'add') {
        return gitResult('');
      }
      if (command === 'write-tree') {
        written += 1;
        return gitResult(`${written === 1 ? BEFORE : AFTER}\n`);
      }
      if (command === 'diff') {
        calls.push({ args: [...args], env: options.env });
        return gitResult('3\t1\tsrc/app.ts\u00000\t4\tdocs/old.md\u0000', 1);
      }
      return gitResult('', 1);
    };
    const { store } = createStore(runGit);
    await store.capture(SCOPE, 'before');
    await store.capture(SCOPE, 'after');
    await expect(store.diff(SCOPE)).resolves.toEqual(
      new Map([
        ['src/app.ts', { additions: 3, deletions: 1 }],
        ['docs/old.md', { additions: 0, deletions: 4 }],
      ]),
    );
    const call = calls[0];
    expect(call?.args).toEqual(expect.arrayContaining([BEFORE, AFTER]));
    expect(call?.env.GIT_INDEX_FILE).toBeUndefined();
  });

  it('reports no tree stats until the after snapshot exists', async () => {
    const runGit = vi.fn(async (args: readonly string[]) => {
      const command = verb(args);
      if (command === 'rev-parse') {
        return gitResult(
          args.includes('--absolute-git-dir')
            ? '/workspace/.git'
            : '/workspace/.git/objects',
        );
      }
      if (command === 'add') {
        return gitResult('');
      }
      if (command === 'write-tree') {
        return gitResult(`${BEFORE}\n`);
      }
      return gitResult('', 1);
    });
    const { store } = createStore(runGit);
    await store.capture(SCOPE, 'before');
    await expect(store.diff(SCOPE)).resolves.toEqual(new Map());
    expect(
      runGit.mock.calls.filter((call) => verb(call[0]) === 'diff'),
    ).toHaveLength(0);
  });

  it('disables a session after a failed capture and skips later retries', async () => {
    const runGit = vi.fn(async (args: readonly string[]) => {
      const command = verb(args);
      if (command === 'rev-parse') {
        return gitResult(
          args.includes('--absolute-git-dir')
            ? '/workspace/.git'
            : '/workspace/.git/objects',
        );
      }
      if (command === 'add') {
        return gitResult('', 128);
      }
      return gitResult('', 1);
    });
    const recordDiagnostic = vi.fn();
    const { store } = createStore(runGit, { recordDiagnostic });
    await expect(store.capture(SCOPE, 'before')).resolves.toBeUndefined();
    await expect(store.capture(SCOPE, 'after')).resolves.toBeUndefined();
    expect(
      runGit.mock.calls.filter((call) => verb(call[0]) === 'add'),
    ).toHaveLength(1);
    expect(recordDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'host.changes.snapshot-failed',
        attributes: expect.objectContaining({
          sessionId: SCOPE.sessionId,
          phase: 'before',
          reason: 'add-failed',
        }),
      }),
    );
  });

  it('disables the store when the workspace is not a git repo', async () => {
    const runGit = vi.fn(async () => gitResult('', 128));
    const { store } = createStore(runGit);
    await expect(store.capture(SCOPE, 'before')).resolves.toBeUndefined();
    await expect(store.capture(SCOPE, 'after')).resolves.toBeUndefined();
    expect(runGit).toHaveBeenCalledOnce();
  });

  it('returns empty text for a path missing from the before tree', async () => {
    const runGit: TurnSnapshotDependencies['runGit'] = async (args) => {
      const command = verb(args);
      if (command === 'rev-parse') {
        return gitResult(
          args.includes('--absolute-git-dir')
            ? '/workspace/.git'
            : '/workspace/.git/objects',
        );
      }
      if (command === 'add' || command === 'write-tree') {
        return command === 'write-tree' ? gitResult(`${BEFORE}\n`) : gitResult('');
      }
      if (command === 'show') {
        return gitResult('exists', 128);
      }
      if (command === 'cat-file') {
        return gitResult('');
      }
      return gitResult('', 1);
    };
    const { store } = createStore(runGit);
    await store.capture(SCOPE, 'before');
    await expect(store.readTreeFile(SCOPE, 'src/new.ts')).resolves.toBe('');
  });

  it('refuses an empty baseline when the before tree is gone', async () => {
    const runGit: TurnSnapshotDependencies['runGit'] = async (args) => {
      const command = verb(args);
      if (command === 'rev-parse') {
        return gitResult(
          args.includes('--absolute-git-dir')
            ? '/workspace/.git'
            : '/workspace/.git/objects',
        );
      }
      if (command === 'add') {
        return gitResult('');
      }
      if (command === 'write-tree') {
        return gitResult(`${BEFORE}\n`);
      }
      if (command === 'show' || command === 'cat-file') {
        return gitResult('', 128);
      }
      return gitResult('', 1);
    };
    const { store } = createStore(runGit);
    await store.capture(SCOPE, 'before');
    await expect(
      store.readTreeFile(SCOPE, 'src/app.ts'),
    ).resolves.toBeUndefined();
  });

  it('rejects binary tree files and unsafe paths', async () => {
    const runGit: TurnSnapshotDependencies['runGit'] = async (args) => {
      const command = verb(args);
      if (command === 'rev-parse') {
        return gitResult(
          args.includes('--absolute-git-dir')
            ? '/workspace/.git'
            : '/workspace/.git/objects',
        );
      }
      if (command === 'write-tree') {
        return gitResult(`${BEFORE}\n`);
      }
      if (command === 'add') {
        return gitResult('');
      }
      if (command === 'show') {
        return { stdout: Buffer.from([0x00, 0x61]), code: 0, timedOut: false };
      }
      return gitResult('', 1);
    };
    const { store } = createStore(runGit);
    await store.capture(SCOPE, 'before');
    await expect(store.readTreeFile(SCOPE, 'src/app.ts')).resolves.toBeUndefined();
    await expect(store.readTreeFile(SCOPE, '../secret')).resolves.toBeUndefined();
  });

  it('drops invalid persisted turns and remembers sanitized files', async () => {
    const persistence = memoryPersistence({
      version: 1,
      sessions: [
        {
          sessionId: 'session-a',
          turns: [
            { turnId: 'bad-oid', before: 'not-an-oid' },
            {
              turnId: 'turn-ok',
              before: BEFORE,
              files: [{ path: 'src/app.ts', additions: 2, deletions: 1 }],
            },
            {
              turnId: 'bad-files',
              before: AFTER,
              files: [{ path: '../x', additions: 1, deletions: 0 }],
            },
          ],
        },
      ],
    });
    const { store } = createStore(async () => gitResult(''), {}, persistence);
    expect(store.readTurns('session-a')).toEqual([
      {
        turnId: 'turn-ok',
        before: BEFORE,
        files: [{ path: 'src/app.ts', additions: 2, deletions: 1 }],
      },
    ]);
    await store.rememberFiles(
      { sessionId: 'session-a', turnId: 'turn-ok' },
      [{ path: 'src/app.ts', additions: 9, deletions: 3 }],
    );
    expect(
      (persistence.stored as { sessions: unknown[] }).sessions,
    ).toEqual([
      {
        sessionId: 'session-a',
        turns: [
          {
            turnId: 'turn-ok',
            before: BEFORE,
            files: [{ path: 'src/app.ts', additions: 9, deletions: 3 }],
          },
        ],
      },
    ]);
    expect(persistence.stored).toMatchObject({
      version: 1,
    });
  });

  it('prunes the object directory when it exceeds the byte cap', async () => {
    const rm = vi.fn(async () => undefined);
    const runGit: TurnSnapshotDependencies['runGit'] = async (args) => {
      const command = verb(args);
      if (command === 'rev-parse') {
        return gitResult(
          args.includes('--absolute-git-dir')
            ? '/workspace/.git'
            : '/workspace/.git/objects',
        );
      }
      if (command === 'add') {
        return gitResult('');
      }
      if (command === 'write-tree') {
        return gitResult(`${BEFORE}\n`);
      }
      return gitResult('', 1);
    };
    const persistence = memoryPersistence();
    const { store } = createStore(
      runGit,
      {
        rm,
        readdir: async () => ['pack'],
        stat: async () => ({
          size: MAX_SNAPSHOT_OBJECT_BYTES + 1,
          isDirectory: () => false,
        }),
      },
      persistence,
    );
    await store.capture(SCOPE, 'before');
    expect(store.read(SCOPE.sessionId)?.before).toBe(BEFORE);
    await store.prune();
    expect(rm).toHaveBeenCalled();
    expect(store.readTurns(SCOPE.sessionId)).toEqual([]);
    expect(persistence.stored).toEqual({
      version: 1,
      sessions: [],
    });
  });

  it('sets isolated object and index env on capture', async () => {
    let env: NodeJS.ProcessEnv | undefined;
    const runGit: TurnSnapshotDependencies['runGit'] = async (args, options) => {
      const command = verb(args);
      if (command === 'rev-parse') {
        return gitResult(
          args.includes('--absolute-git-dir')
            ? '/workspace/.git'
            : '/workspace/.git/objects',
        );
      }
      if (command === 'add') {
        env = options.env;
        return gitResult('');
      }
      if (command === 'write-tree') {
        return gitResult(`${BEFORE}\n`);
      }
      return gitResult('', 1);
    };
    const { store } = createStore(runGit);
    await store.capture(SCOPE, 'before');
    expect(env?.GIT_OBJECT_DIRECTORY).toBe(join('/storage', 'objects'));
    expect(env?.GIT_ALTERNATE_OBJECT_DIRECTORIES).toBe(
      '/workspace/.git/objects',
    );
    expect(env?.GIT_INDEX_FILE).toBe(join('/storage', 'index-1'));
  });
});
