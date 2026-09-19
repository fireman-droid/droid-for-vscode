import * as path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  MAX_GIT_COMMIT_ERROR_LENGTH,
  MAX_GIT_STATUS_FILES,
} from '../../shared/protocol/gitCommitFlow';
import {
  createGitWorkflow,
  createUnavailableGitWorkflow,
  mapGitStatusCode,
  type GitApiLike,
  type GitChangeLike,
  type GitRepositoryLike,
} from './gitWorkflow';

const ROOT = path.resolve('git-workflow-test-root');

function change(relativePath: string, status: number): GitChangeLike {
  return {
    uri: { fsPath: path.join(ROOT, relativePath) },
    status,
  };
}

function createRepository(
  overrides: Partial<{
    rootPath: string;
    head: { name?: string; commit?: string } | undefined;
    workingTreeChanges: readonly GitChangeLike[];
    indexChanges: readonly GitChangeLike[];
    mergeChanges: readonly GitChangeLike[];
    statusError: Error;
    addError: Error;
    commitError: unknown;
    commitHash: string;
    getCommitError: Error;
  }> = {},
): GitRepositoryLike & {
  add: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
} {
  const add = vi.fn(() =>
    overrides.addError !== undefined
      ? Promise.reject(overrides.addError)
      : Promise.resolve(),
  );
  const commit = vi.fn(() =>
    overrides.commitError !== undefined
      ? Promise.reject(overrides.commitError)
      : Promise.resolve(),
  );
  return {
    rootUri: { fsPath: overrides.rootPath ?? ROOT },
    state: {
      ...(overrides.head === undefined ? {} : { HEAD: overrides.head }),
      workingTreeChanges: overrides.workingTreeChanges ?? [],
      indexChanges: overrides.indexChanges ?? [],
      mergeChanges: overrides.mergeChanges ?? [],
    },
    status: () =>
      overrides.statusError !== undefined
        ? Promise.reject(overrides.statusError)
        : Promise.resolve(),
    add,
    commit,
    getCommit: () =>
      overrides.getCommitError !== undefined
        ? Promise.reject(overrides.getCommitError)
        : Promise.resolve({
            hash: overrides.commitHash ?? 'abcdef0123456789abcdef0123456789abcdef01',
          }),
  };
}

function workflowFor(api: GitApiLike | undefined) {
  return createGitWorkflow(() => Promise.resolve(api));
}

function repositoryApi(repository: GitRepositoryLike): GitApiLike {
  return { repositories: [repository] };
}

describe('mapGitStatusCode', () => {
  it('collapses the vscode.git Status enum to the display set', () => {
    expect(mapGitStatusCode(0)).toBe('modified');
    expect(mapGitStatusCode(5)).toBe('modified');
    expect(mapGitStatusCode(11)).toBe('modified');
    expect(mapGitStatusCode(1)).toBe('added');
    expect(mapGitStatusCode(4)).toBe('added');
    expect(mapGitStatusCode(9)).toBe('added');
    expect(mapGitStatusCode(2)).toBe('deleted');
    expect(mapGitStatusCode(6)).toBe('deleted');
    expect(mapGitStatusCode(3)).toBe('renamed');
    expect(mapGitStatusCode(10)).toBe('renamed');
    expect(mapGitStatusCode(7)).toBe('untracked');
    expect(mapGitStatusCode(8)).toBeUndefined();
    expect(mapGitStatusCode(12)).toBe('conflicted');
    expect(mapGitStatusCode(18)).toBe('conflicted');
    expect(mapGitStatusCode(19)).toBeUndefined();
    expect(mapGitStatusCode(-1)).toBeUndefined();
  });
});

describe('gitWorkflow.status', () => {
  it('reports no-git-extension when the API is missing', async () => {
    const result = await workflowFor(undefined).status(ROOT, new Set());
    expect(result).toEqual({
      available: false,
      reason: 'no-git-extension',
    });
  });

  it('reports no-repository for an empty repository list', async () => {
    const result = await workflowFor({ repositories: [] }).status(ROOT, new Set());
    expect(result).toEqual({
      available: false,
      reason: 'no-repository',
    });
  });

  it('reports unsupported-workspace for multiple repositories', async () => {
    const result = await workflowFor({
      repositories: [createRepository(), createRepository()],
    }).status(ROOT, new Set());
    expect(result).toEqual({
      available: false,
      reason: 'unsupported-workspace',
    });
  });

  it('reports unsupported-workspace when the repo root differs', async () => {
    const repository = createRepository({
      rootPath: path.join(ROOT, 'nested'),
    });
    const result = await workflowFor(repositoryApi(repository)).status(ROOT, new Set());
    expect(result).toEqual({
      available: false,
      reason: 'unsupported-workspace',
    });
  });

  it('reports status-failed when the refresh rejects', async () => {
    const repository = createRepository({
      statusError: new Error('index locked'),
    });
    const result = await workflowFor(repositoryApi(repository)).status(ROOT, new Set());
    expect(result).toEqual({
      available: false,
      reason: 'status-failed',
    });
  });

  it('reports no-git-extension when the accessor throws', async () => {
    const workflow = createGitWorkflow(() =>
      Promise.reject(new Error('activation failed')),
    );
    const result = await workflow.status(ROOT, new Set());
    expect(result).toEqual({
      available: false,
      reason: 'no-git-extension',
    });
  });

  it('merges index and working changes with staged flags and in-turn ordering', async () => {
    const repository = createRepository({
      head: { name: 'feature/commit-panel' },
      indexChanges: [change('staged-only.ts', 0), change('both.ts', 0)],
      workingTreeChanges: [
        change('both.ts', 5),
        change('new-file.ts', 7),
        change('zz-last.ts', 5),
        change('ignored.log', 8),
      ],
    });
    const result = await workflowFor(repositoryApi(repository)).status(
      ROOT,
      new Set(['zz-last.ts']),
    );
    expect(result.available).toBe(true);
    if (!result.available) {
      return;
    }
    expect(result.branch).toBe('feature/commit-panel');
    expect(result.files).toEqual([
      {
        path: 'zz-last.ts',
        status: 'modified',
        staged: false,
        inTurn: true,
      },
      {
        path: 'both.ts',
        status: 'modified',
        staged: true,
        inTurn: false,
      },
      {
        path: 'new-file.ts',
        status: 'untracked',
        staged: false,
        inTurn: false,
      },
      {
        path: 'staged-only.ts',
        status: 'modified',
        staged: true,
        inTurn: false,
      },
    ]);
  });

  it('marks merge-group files conflicted and drops out-of-root files', async () => {
    const repository = createRepository({
      head: { name: 'main' },
      workingTreeChanges: [
        {
          uri: { fsPath: path.resolve('outside', 'other.ts') },
          status: 5,
        },
      ],
      mergeChanges: [change('clash.ts', 16)],
    });
    const result = await workflowFor(repositoryApi(repository)).status(ROOT, new Set());
    expect(result.available).toBe(true);
    if (!result.available) {
      return;
    }
    expect(result.files).toEqual([
      {
        path: 'clash.ts',
        status: 'conflicted',
        staged: false,
        inTurn: false,
      },
    ]);
  });

  it('returns a null branch for a detached HEAD', async () => {
    const repository = createRepository({ head: {} });
    const result = await workflowFor(repositoryApi(repository)).status(ROOT, new Set());
    expect(result.available).toBe(true);
    if (!result.available) {
      return;
    }
    expect(result.branch).toBeNull();
  });

  it('caps the file list with in-turn files kept first', async () => {
    const workingTreeChanges = Array.from(
      { length: MAX_GIT_STATUS_FILES + 20 },
      (_, index) => change(`file-${String(index).padStart(4, '0')}.ts`, 5),
    );
    // Alphabetically last, so only the in-turn priority keeps it.
    const inTurnPath = `file-${String(MAX_GIT_STATUS_FILES + 19).padStart(4, '0')}.ts`;
    const repository = createRepository({ workingTreeChanges });
    const result = await workflowFor(repositoryApi(repository)).status(
      ROOT,
      new Set([inTurnPath]),
    );
    expect(result.available).toBe(true);
    if (!result.available) {
      return;
    }
    expect(result.files).toHaveLength(MAX_GIT_STATUS_FILES);
    expect(result.files[0]?.path).toBe(inTurnPath);
    expect(result.files[0]?.inTurn).toBe(true);
  });
});

describe('gitWorkflow.commit', () => {
  it('never commits unselected staged files, including entries beyond the display cap', async () => {
    const indexChanges = Array.from({ length: MAX_GIT_STATUS_FILES + 1 }, (_, i) => change(`staged-${i}.ts`, 0));
    const repository = createRepository({ indexChanges });
    const result = await workflowFor(repositoryApi(repository)).commit(ROOT, indexChanges.slice(0, -1).map((entry) => path.relative(ROOT, entry.uri.fsPath)), 'selected only');
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('already staged') });
    expect(repository.add).not.toHaveBeenCalled();
    expect(repository.commit).not.toHaveBeenCalled();
  });
  it('cancels a stale target before staging without clearing the index', async () => {
    const repository = createRepository();
    const result = await workflowFor(repositoryApi(repository)).commit(ROOT, ['a.ts'], 'msg', () => false);
    expect(result.ok).toBe(false);
    expect(repository.add).not.toHaveBeenCalled();
    expect(repository.commit).not.toHaveBeenCalled();
  });
  it('stages the resolved paths then commits and echoes a short hash', async () => {
    const repository = createRepository({
      commitHash: '0123456789abcdef0123456789abcdef01234567',
    });
    const result = await workflowFor(repositoryApi(repository)).commit(
      ROOT,
      ['src/a.ts', 'docs/readme.md'],
      'feat: add commit panel\n\nvia DroidVisX, 2 files',
    );
    expect(repository.add).toHaveBeenCalledWith([
      path.resolve(ROOT, 'src/a.ts'),
      path.resolve(ROOT, 'docs/readme.md'),
    ]);
    expect(repository.commit).toHaveBeenCalledWith(
      'feat: add commit panel\n\nvia DroidVisX, 2 files',
    );
    expect(result).toEqual({ ok: true, hash: '0123456' });
  });

  it('echoes git stderr from a failed commit, capped', async () => {
    const stderr = `pre-commit hook failed ${'x'.repeat(3000)}`;
    const repository = createRepository({
      commitError: { stderr, message: 'unused' },
    });
    const result = await workflowFor(repositoryApi(repository)).commit(
      ROOT,
      ['src/a.ts'],
      'fix: something',
    );
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error).toBe(stderr.slice(0, MAX_GIT_COMMIT_ERROR_LENGTH));
  });

  it('rejects traversal and absolute paths before touching git', async () => {
    const repository = createRepository();
    const workflow = workflowFor(repositoryApi(repository));
    const traversal = await workflow.commit(ROOT, ['../outside.ts'], 'msg');
    expect(traversal).toEqual({
      ok: false,
      error: 'Path escapes the workspace: ../outside.ts',
    });
    const absolute = await workflow.commit(ROOT, [path.join(ROOT, 'src/a.ts')], 'msg');
    expect(absolute.ok).toBe(false);
    expect(repository.add).not.toHaveBeenCalled();
    expect(repository.commit).not.toHaveBeenCalled();
  });

  it('fails with a readable reason when git is unavailable', async () => {
    const result = await workflowFor({ repositories: [] }).commit(
      ROOT,
      ['src/a.ts'],
      'msg',
    );
    expect(result).toEqual({
      ok: false,
      error: 'Git is unavailable (no-repository).',
    });
  });

  it('still reports success with an empty hash when the hash read fails', async () => {
    const repository = createRepository({
      getCommitError: new Error('rev-parse failed'),
    });
    const result = await workflowFor(repositoryApi(repository)).commit(
      ROOT,
      ['src/a.ts'],
      'msg',
    );
    expect(result).toEqual({ ok: true, hash: '' });
  });
});

describe('createUnavailableGitWorkflow', () => {
  it('hides the entry and refuses commits', async () => {
    const workflow = createUnavailableGitWorkflow();
    expect(await workflow.status(ROOT, new Set())).toEqual({
      available: false,
      reason: 'no-git-extension',
    });
    const commit = await workflow.commit(ROOT, ['a.ts'], 'msg');
    expect(commit.ok).toBe(false);
  });
});
