import { describe, expect, it, vi } from 'vitest';

import type { SessionSummary } from '../shared/bridgeMessages';
import type {
  SessionCatalogEntry,
  SessionCatalogResult,
} from '../runtime/SessionCatalog';
import type { SessionRecoveryPersistence } from './SessionRecoveryStore';
import {
  appendWorktreeSessions,
  createWorktreeSessionsFeature,
  isGitWorkspace,
  MAX_TRACKED_WORKTREE_SESSIONS,
  recordCreatedWorktreeSession,
  resolveWorktreeBranch,
  WORKTREE_SESSIONS_STORAGE_KEY,
  WORKTREE_SESSIONS_VERSION,
  WorktreeSessionStore,
  type GitExec,
} from './worktreeSessions';

const CWD = 'D:\\repo';
const RECORD = { branch: 'main-wt', path: 'D:\\repo-wt-main-wt' };

describe('WorktreeSessionStore', () => {
  it('persists records and reloads them through a fresh store', async () => {
    const persistence = memoryPersistence();
    const store = new WorktreeSessionStore(persistence);

    await store.record(CWD, 'session-1', RECORD);

    expect(persistence.update).toHaveBeenCalledWith(
      WORKTREE_SESSIONS_STORAGE_KEY,
      {
        version: WORKTREE_SESSIONS_VERSION,
        workspaces: { [CWD]: { 'session-1': RECORD } },
      },
    );

    const reloaded = new WorktreeSessionStore(persistence);
    expect(reloaded.get(CWD, 'session-1')).toEqual(RECORD);
    expect(reloaded.get('D:\\other', 'session-1')).toBeUndefined();
  });

  it('scopes listings to the requesting workspace cwd', async () => {
    const store = new WorktreeSessionStore(memoryPersistence());
    await store.record(CWD, 'session-1', RECORD);
    await store.record('D:\\other', 'session-2', {
      branch: 'dev-wt',
      path: 'D:\\other-wt-dev-wt',
    });

    expect([...store.list(CWD).keys()]).toEqual(['session-1']);
    expect([...store.list('D:\\other').keys()]).toEqual(['session-2']);
    expect(store.list('D:\\unknown').size).toBe(0);
  });

  it('drops the oldest session beyond the per-workspace cap', async () => {
    const store = new WorktreeSessionStore(memoryPersistence());
    for (let i = 0; i < MAX_TRACKED_WORKTREE_SESSIONS + 1; i += 1) {
      await store.record(CWD, `session-${i}`, RECORD);
    }

    const ids = [...store.list(CWD).keys()];
    expect(ids).toHaveLength(MAX_TRACKED_WORKTREE_SESSIONS);
    expect(ids[0]).toBe('session-1');
    expect(ids.at(-1)).toBe(`session-${MAX_TRACKED_WORKTREE_SESSIONS}`);
  });

  it('rejects oversized or empty fields without persisting', async () => {
    const persistence = memoryPersistence();
    const store = new WorktreeSessionStore(persistence);

    await store.record(CWD, '', RECORD);
    await store.record(CWD, 'x'.repeat(129), RECORD);
    await store.record(CWD, 'session-1', { branch: 'b', path: '' });
    await store.record(CWD, 'session-1', {
      branch: 'x'.repeat(513),
      path: RECORD.path,
    });

    expect(store.list(CWD).size).toBe(0);
    expect(persistence.update).not.toHaveBeenCalled();
  });

  it('removes a session and prunes the workspace entry when empty', async () => {
    const persistence = memoryPersistence();
    const store = new WorktreeSessionStore(persistence);
    await store.record(CWD, 'session-1', RECORD);

    await store.remove(CWD, 'session-1');

    expect(store.get(CWD, 'session-1')).toBeUndefined();
    expect(persistence.value).toEqual({
      version: WORKTREE_SESSIONS_VERSION,
      workspaces: {},
    });
    // Removing a missing id must not rewrite persistence.
    persistence.update.mockClear();
    await store.remove(CWD, 'session-1');
    expect(persistence.update).not.toHaveBeenCalled();
  });

  it('drops hostile persisted state instead of loading it', () => {
    const hostile = {
      version: WORKTREE_SESSIONS_VERSION,
      workspaces: {
        [CWD]: {
          good: RECORD,
          'no-path': { branch: 'b' },
          'bad-types': { branch: 7, path: ['x'] },
          'long-path': { branch: 'b', path: 'x'.repeat(1025) },
        },
        '': { orphan: RECORD },
      },
    };
    const store = new WorktreeSessionStore(memoryPersistence(hostile));

    expect([...store.list(CWD).keys()]).toEqual(['good']);
    expect(store.list('').size).toBe(0);
  });

  it.each([
    ['non-object', 'gibberish'],
    ['null', null],
    ['wrong version', { version: 999, workspaces: {} }],
    ['missing workspaces', { version: WORKTREE_SESSIONS_VERSION }],
  ])('ignores unusable persisted state (%s)', (_label, stored) => {
    const store = new WorktreeSessionStore(memoryPersistence(stored));
    expect(store.list(CWD).size).toBe(0);
  });

  it('survives persistence.update rejections', async () => {
    const persistence = memoryPersistence();
    persistence.update.mockRejectedValue(new Error('disk full'));
    const store = new WorktreeSessionStore(persistence);

    await expect(
      store.record(CWD, 'session-1', RECORD),
    ).resolves.toBeUndefined();
    // In-memory registry still serves the current window.
    expect(store.get(CWD, 'session-1')).toEqual(RECORD);
  });
});

describe('isGitWorkspace', () => {
  it('is true only for a work-tree answer of true', async () => {
    await expect(isGitWorkspace(CWD, gitExec('true\n'))).resolves.toBe(
      true,
    );
    await expect(isGitWorkspace(CWD, gitExec('false\n'))).resolves.toBe(
      false,
    );
    await expect(isGitWorkspace(CWD, gitExec(null))).resolves.toBe(false);
  });

  it('queries rev-parse in the workspace cwd', async () => {
    const exec = gitExec('true\n');
    await isGitWorkspace(CWD, exec);
    expect(exec).toHaveBeenCalledExactlyOnceWith(
      ['rev-parse', '--is-inside-work-tree'],
      CWD,
    );
  });
});

describe('resolveWorktreeBranch', () => {
  it('returns the trimmed branch name from the worktree path', async () => {
    const exec = gitExec('main-wt\n');
    await expect(
      resolveWorktreeBranch('D:\\repo-wt-main-wt', exec),
    ).resolves.toBe('main-wt');
    expect(exec).toHaveBeenCalledExactlyOnceWith(
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      'D:\\repo-wt-main-wt',
    );
  });

  it('returns null for git failure, detached HEAD, or empty output', async () => {
    await expect(
      resolveWorktreeBranch(CWD, gitExec(null)),
    ).resolves.toBeNull();
    await expect(
      resolveWorktreeBranch(CWD, gitExec('HEAD\n')),
    ).resolves.toBeNull();
    await expect(
      resolveWorktreeBranch(CWD, gitExec('  \n')),
    ).resolves.toBeNull();
  });
});

describe('createWorktreeSessionsFeature', () => {
  it('bundles the store and git helpers behind one exec', async () => {
    const exec = vi.fn(
      async (args: readonly string[]) =>
        args[1] === '--is-inside-work-tree' ? 'true\n' : 'main-wt\n',
    ) as GitExec & ReturnType<typeof vi.fn>;
    const feature = createWorktreeSessionsFeature({
      enabled: true,
      persistence: memoryPersistence(),
      exec,
    });

    expect(feature.enabled).toBe(true);
    await expect(feature.isGitWorkspace(CWD)).resolves.toBe(true);
    await expect(
      feature.resolveBranch('D:\\repo-wt-main-wt'),
    ).resolves.toBe('main-wt');
    await feature.store.record(CWD, 'session-1', RECORD);
    expect(feature.store.get(CWD, 'session-1')).toEqual(RECORD);
  });
});

describe('recordCreatedWorktreeSession', () => {
  it('resolves the branch from git and records the binding', async () => {
    const feature = fakeFeature({ branch: 'main-wt' });

    const info = await recordCreatedWorktreeSession({
      workspaceCwd: CWD,
      sessionId: 'session-1',
      sessionCwd: 'D:\\repo-wt-main-wt',
      feature,
    });

    expect(info).toEqual({
      branch: 'main-wt',
      path: 'D:\\repo-wt-main-wt',
    });
    expect(feature.store.get(CWD, 'session-1')).toEqual(info);
  });

  it('records an empty branch when git recovery fails', async () => {
    const feature = fakeFeature({ branch: null });

    const info = await recordCreatedWorktreeSession({
      workspaceCwd: CWD,
      sessionId: 'session-1',
      sessionCwd: 'D:\\repo-wt-main-wt',
      feature,
    });

    expect(info).toEqual({ branch: '', path: 'D:\\repo-wt-main-wt' });
  });

  it('records nothing when the daemon fell back to the workspace cwd', async () => {
    const feature = fakeFeature({ branch: 'main' });

    // Unknown cwd (process sessions) and same-directory fallbacks
    // (daemon in a non-git cwd) must not fabricate worktree metadata.
    await expect(
      recordCreatedWorktreeSession({
        workspaceCwd: CWD,
        sessionId: 'session-1',
        sessionCwd: null,
        feature,
      }),
    ).resolves.toBeNull();
    await expect(
      recordCreatedWorktreeSession({
        workspaceCwd: CWD,
        sessionId: 'session-1',
        // Case difference only: same directory on Windows.
        sessionCwd: 'd:\\REPO',
        feature,
      }),
    ).resolves.toBeNull();
    expect(feature.store.get(CWD, 'session-1')).toBeUndefined();
  });
});

describe('appendWorktreeSessions', () => {
  it('appends registered worktree sessions with their annotation', async () => {
    const store = new WorktreeSessionStore(memoryPersistence());
    await store.record(CWD, 'wt-session', RECORD);
    const listSessions = vi.fn(
      async (cwd: string): Promise<SessionCatalogResult> => ({
        status: 'available',
        sessions:
          cwd === RECORD.path
            ? [
                entry('wt-session', '2026-08-12T06:00:00.000Z'),
                entry('unrelated', '2026-08-12T07:00:00.000Z'),
              ]
            : [],
      }),
    );

    const items = await appendWorktreeSessions({
      cwd: CWD,
      items: [
        summary('main-session', '2026-08-12T05:00:00.000Z'),
        summary('newer-session', '2026-08-12T08:00:00.000Z'),
      ],
      store,
      listSessions,
      project: projectEntries,
    });

    expect(listSessions).toHaveBeenCalledExactlyOnceWith(RECORD.path);
    // Sorted newest-first; the unregistered worktree session is not
    // adopted, only ids present in the registry.
    expect(items.map((item) => item.id)).toEqual([
      'newer-session',
      'wt-session',
      'main-session',
    ]);
    expect(items[1]?.worktree).toEqual(RECORD);
  });

  it('returns the base page untouched when the registry is empty', async () => {
    const store = new WorktreeSessionStore(memoryPersistence());
    const listSessions = vi.fn();
    const base = [summary('main-session', '2026-08-12T05:00:00.000Z')];

    const items = await appendWorktreeSessions({
      cwd: CWD,
      items: base,
      store,
      listSessions,
      project: projectEntries,
    });

    expect(items).toBe(base);
    expect(listSessions).not.toHaveBeenCalled();
  });

  it('skips unreachable worktrees fail-soft', async () => {
    const store = new WorktreeSessionStore(memoryPersistence());
    await store.record(CWD, 'gone-session', {
      branch: 'gone-wt',
      path: 'D:\\deleted-worktree',
    });
    await store.record(CWD, 'wt-session', RECORD);
    const listSessions = vi.fn(
      async (cwd: string): Promise<SessionCatalogResult> => {
        if (cwd === RECORD.path) {
          return {
            status: 'available',
            sessions: [entry('wt-session', '2026-08-12T06:00:00.000Z')],
          };
        }
        throw new Error('ENOENT');
      },
    );

    const items = await appendWorktreeSessions({
      cwd: CWD,
      items: [],
      store,
      listSessions,
      project: projectEntries,
    });

    expect(items.map((item) => item.id)).toEqual(['wt-session']);
  });
});

function entry(id: string, modifiedTime: string): SessionCatalogEntry {
  return {
    id,
    title: `Title ${id}`,
    messageCount: 2,
    modifiedTime,
    createdTime: modifiedTime,
    isFavorite: false,
  };
}

function summary(id: string, modifiedTime: string): SessionSummary {
  return {
    id,
    title: `Title ${id}`,
    messageCount: 2,
    modifiedTime,
    active: false,
    isFavorite: false,
  };
}

function projectEntries(
  entries: readonly SessionCatalogEntry[],
): readonly SessionSummary[] {
  return entries.map((item) => summary(item.id, item.modifiedTime));
}

function fakeFeature(options: { branch: string | null }) {
  return createWorktreeSessionsFeature({
    enabled: true,
    persistence: memoryPersistence(),
    exec: vi.fn(async (args: readonly string[]) =>
      args[1] === '--abbrev-ref'
        ? options.branch === null
          ? 'HEAD\n'
          : `${options.branch}\n`
        : 'true\n',
    ) as GitExec,
  });
}

function gitExec(output: string | null) {
  return vi.fn(async () => output) as GitExec & ReturnType<typeof vi.fn>;
}

function memoryPersistence(initial?: unknown) {
  const persistence = { value: initial as unknown };
  const get = vi.fn(
    (_key: string) => persistence.value,
  ) as unknown as SessionRecoveryPersistence['get'] &
    ReturnType<typeof vi.fn>;
  const update = vi.fn(async (_key: string, value: unknown) => {
    persistence.value = value;
  });
  return Object.assign(persistence, { get, update });
}
