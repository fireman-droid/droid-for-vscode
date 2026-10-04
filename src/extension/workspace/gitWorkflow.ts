import * as path from 'node:path';

import {
  GIT_SHORT_HASH_LENGTH,
  MAX_GIT_BRANCH_LENGTH,
  MAX_GIT_COMMIT_ERROR_LENGTH,
  MAX_GIT_COMMIT_PATHS,
  type GitCommitMode,
  type GitFileStatus,
  type GitStatusFile,
  type GitUnavailableReason,
} from '../../shared/protocol/gitCommitFlow';
import { createGitCommitSnapshots, type GitCommitSnapshotReader } from './gitCommitSnapshot';

/**
 * Git commit workflow (slice A of the git/PR workflow design): reads
 * working-tree/index status and performs add+commit through the
 * built-in `vscode.git` extension's public v1 API. The API handle is
 * injected as a structural type so tests and the unavailable fallback
 * never touch `vscode`; the real accessor lives in
 * `vscodeGitWorkflow.ts`.
 */

export interface GitUriLike {
  readonly fsPath: string;
}

export interface GitChangeLike {
  readonly uri: GitUriLike;
  /** `Status` const-enum value from `vscode.git`'s `git.d.ts`. */
  readonly status: number;
}

export interface GitRepositoryLike {
  readonly rootUri: GitUriLike;
  readonly state: {
    readonly HEAD?: {
      readonly name?: string;
      readonly commit?: string;
    };
    readonly workingTreeChanges: readonly GitChangeLike[];
    readonly indexChanges: readonly GitChangeLike[];
    readonly mergeChanges: readonly GitChangeLike[];
  };
  /** Forces a status refresh so `state` is current before reading. */
  status(): Promise<void>;
  add(paths: readonly string[]): Promise<void>;
  commit(message: string): Promise<void>;
  getCommit(ref: string): Promise<{ readonly hash: string }>;
  getObjectDetails?(treeish: string, path: string): Promise<unknown>;
}

export interface GitApiLike {
  readonly repositories: readonly GitRepositoryLike[];
}

export type GitWorkflowStatus =
  | {
      readonly available: true;
      readonly branch: string | null;
      readonly files: readonly GitStatusFile[];
      readonly snapshotId?: string;
    }
  | {
      readonly available: false;
      readonly reason: GitUnavailableReason;
    };

export type GitCommitOutcome =
  | { readonly ok: true; readonly hash: string }
  | { readonly ok: false; readonly error: string };

export interface GitWorkflow {
  status(
    workspaceRoot: string,
    inTurnPaths: ReadonlySet<string>,
  ): Promise<GitWorkflowStatus>;
  commit(
    workspaceRoot: string,
    paths: readonly string[],
    message: string,
    isCurrent?: () => boolean,
    preview?: { readonly snapshotId?: string; readonly mode?: GitCommitMode },
  ): Promise<GitCommitOutcome>;
}

export function createUnavailableGitWorkflow(): GitWorkflow {
  return {
    status: () =>
      Promise.resolve({
        available: false,
        reason: 'no-git-extension',
      }),
    commit: () =>
      Promise.resolve({
        ok: false,
        error: 'Git is unavailable in this environment.',
      }),
  };
}

/**
 * `Status` const-enum from `vscode.git`'s `git.d.ts` (v1), collapsed
 * to the Bridge's closed display set. `IGNORED` maps to undefined and
 * the file is dropped.
 */
export function mapGitStatusCode(code: number): GitFileStatus | undefined {
  switch (code) {
    case 0: // INDEX_MODIFIED
    case 5: // MODIFIED
    case 11: // TYPE_CHANGED
      return 'modified';
    case 1: // INDEX_ADDED
    case 4: // INDEX_COPIED
    case 9: // INTENT_TO_ADD
      return 'added';
    case 2: // INDEX_DELETED
    case 6: // DELETED
      return 'deleted';
    case 3: // INDEX_RENAMED
    case 10: // INTENT_TO_RENAME
      return 'renamed';
    case 7: // UNTRACKED
      return 'untracked';
    default:
      // 12..18 are the merge-conflict pairings (ADDED_BY_US ...).
      return code >= 12 && code <= 18 ? 'conflicted' : undefined;
  }
}

/** Case tolerance matches Windows path semantics. */
function isSameRoot(a: string, b: string): boolean {
  const left = path.resolve(a);
  const right = path.resolve(b);
  if (process.platform === 'win32') {
    return left.toLowerCase() === right.toLowerCase();
  }
  return left === right;
}

/**
 * Workspace-relative forward-slash path for a change, or undefined
 * when the change lies outside the repository root.
 */
function toRelativePath(root: string, fsPath: string): string | undefined {
  const relative = path.relative(root, fsPath);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    return undefined;
  }
  return relative.replaceAll('\\', '/');
}

/**
 * Resolves a Bridge-validated workspace-relative path to an absolute
 * path, re-checking containment because this module is the last stop
 * before the filesystem.
 */
function resolveContainedPath(root: string, relativePath: string): string | undefined {
  if (path.isAbsolute(relativePath)) {
    return undefined;
  }
  const resolved = path.resolve(root, relativePath);
  return toRelativePath(root, resolved) === undefined ? undefined : resolved;
}

function resolveRepository(
  api: GitApiLike | undefined,
  workspaceRoot: string,
):
  | { readonly repository: GitRepositoryLike }
  | { readonly reason: GitUnavailableReason } {
  if (api === undefined) {
    return { reason: 'no-git-extension' };
  }
  if (api.repositories.length === 0) {
    return { reason: 'no-repository' };
  }
  const repository = api.repositories[0];
  if (
    repository === undefined ||
    api.repositories.length > 1 ||
    !isSameRoot(repository.rootUri.fsPath, workspaceRoot)
  ) {
    return { reason: 'unsupported-workspace' };
  }
  return { repository };
}

/**
 * Extracts git's own failure text from a `vscode.git` GitError, which
 * carries the raw stderr; plain errors fall back to their message.
 */
function readGitErrorText(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const record = error as { stderr?: unknown; message?: unknown };
    if (typeof record.stderr === 'string' && record.stderr.trim() !== '') {
      return record.stderr.trim();
    }
    if (typeof record.message === 'string' && record.message.trim() !== '') {
      return record.message.trim();
    }
  }
  return 'git failed without an error message.';
}

function capError(text: string): string {
  return text.slice(0, MAX_GIT_COMMIT_ERROR_LENGTH);
}

function collectStatusFiles(
  repository: GitRepositoryLike,
  workspaceRoot: string,
  inTurnPaths: ReadonlySet<string>,
): GitStatusFile[] {
  const staged = new Set<string>();
  // Later groups win the displayed status: a file that is both staged
  // and re-modified shows its working-tree state, and a conflicted
  // file always shows as conflicted.
  const displayStatus = new Map<string, GitFileStatus>();
  const groups = [
    repository.state.indexChanges,
    repository.state.workingTreeChanges,
    repository.state.mergeChanges,
  ] as const;
  groups.forEach((changes, groupIndex) => {
    for (const change of changes) {
      const relative = toRelativePath(workspaceRoot, change.uri.fsPath);
      const status = mapGitStatusCode(change.status);
      if (relative === undefined || status === undefined) {
        continue;
      }
      if (groupIndex === 0) {
        staged.add(relative);
      }
      displayStatus.set(relative, groupIndex === 2 ? 'conflicted' : status);
    }
  });
  const files = [...displayStatus.entries()]
    .map(([filePath, status]) => ({
      path: filePath,
      status,
      staged: staged.has(filePath),
      inTurn: inTurnPaths.has(filePath),
    }))
    .sort((a, b) => {
      if (a.inTurn !== b.inTurn) {
        return a.inTurn ? -1 : 1;
      }
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
    });
  return files;
}

export function createGitWorkflow(
  getGitApi: () => Promise<GitApiLike | undefined>,
  snapshotReader?: GitCommitSnapshotReader,
): GitWorkflow {
  const snapshots = createGitCommitSnapshots(snapshotReader);
  const resolve = async (workspaceRoot: string) =>
    resolveRepository(await getGitApi(), workspaceRoot);

  return {
    async status(workspaceRoot, inTurnPaths) {
      let resolved: Awaited<ReturnType<typeof resolve>>;
      try {
        resolved = await resolve(workspaceRoot);
      } catch {
        return { available: false, reason: 'no-git-extension' };
      }
      if (!('repository' in resolved)) {
        return { available: false, reason: resolved.reason };
      }
      const { repository } = resolved;
      try {
        await repository.status();
      } catch {
        return { available: false, reason: 'status-failed' };
      }
      const branch = repository.state.HEAD?.name;
      const files = collectStatusFiles(repository, workspaceRoot, inTurnPaths);
      if (files.length > MAX_GIT_COMMIT_PATHS) return { available: false, reason: 'too-many-files' };
      let snapshotId: string;
      try { snapshotId = await snapshots.capture(workspaceRoot, files); }
      catch { return { available: false, reason: 'status-failed' }; }
      return {
        available: true,
        branch:
          branch === undefined || branch === ''
            ? null
            : branch.slice(0, MAX_GIT_BRANCH_LENGTH),
        files,
        snapshotId,
      };
    },

    async commit(workspaceRoot, paths, message, isCurrent = () => true, preview) {
      const mode = preview?.mode ?? 'files';
      let resolved: Awaited<ReturnType<typeof resolve>>;
      try {
        resolved = await resolve(workspaceRoot);
      } catch (error) {
        return { ok: false, error: capError(readGitErrorText(error)) };
      }
      if (!('repository' in resolved)) {
        return {
          ok: false,
          error: `Git is unavailable (${resolved.reason}).`,
        };
      }
      const { repository } = resolved;
      const absolutePaths: string[] = [];
      for (const relativePath of paths) {
        const resolvedPath = resolveContainedPath(workspaceRoot, relativePath);
        if (resolvedPath === undefined) {
          return {
            ok: false,
            error: `Path escapes the workspace: ${relativePath}`,
          };
        }
        absolutePaths.push(resolvedPath);
      }
      try {
        await repository.status();
        if (!isCurrent()) return { ok: false, error: 'The commit target changed. Reopen Commit.' };
        const selected = new Set(paths.map((path) => path.replaceAll('\\', '/')));
        const hasUnselectedIndex = () => repository.state.indexChanges.some((change) => {
          const path = toRelativePath(workspaceRoot, change.uri.fsPath);
          return path === undefined || !selected.has(path);
        });
        if (hasUnselectedIndex())
          return { ok: false, error: 'Other files are already staged. Include them explicitly or adjust the index before committing.' };
        if (repository.state.mergeChanges.length > 0)
          return { ok: false, error: 'Resolve merge conflicts before committing.' };
        if (mode === 'staged' && (repository.state.indexChanges.length === 0 || paths.some(path =>
          !repository.state.indexChanges.some(change => toRelativePath(workspaceRoot, change.uri.fsPath) === path))))
          return { ok: false, error: 'Select the complete current staged file set before committing the index.' };
        await snapshots.verify(preview?.snapshotId, workspaceRoot, paths, mode);
        if (mode === 'files') await repository.add(absolutePaths);
        await repository.status();
        if (!isCurrent() || hasUnselectedIndex())
          return { ok: false, error: 'The target or staged files changed. Nothing was committed; check the index.' };
        await snapshots.verify(preview?.snapshotId, workspaceRoot, paths, mode, mode === 'staged');
        if (!isCurrent()) return { ok: false, error: 'The commit target changed. Nothing was committed; check the index.' };
        await repository.commit(message);
        snapshots.forget(preview?.snapshotId);
      } catch (error) {
        return { ok: false, error: capError(readGitErrorText(error)) };
      }
      // The commit itself succeeded past this point; a hash read
      // failure must never report the commit as failed, and falling
      // back to `state.HEAD.commit` risks echoing the stale parent
      // hash, so the echo degrades to empty instead.
      let hash = '';
      try {
        hash = (await repository.getCommit('HEAD')).hash;
      } catch {
        hash = '';
      }
      if (!/^[0-9a-f]{4,64}$/.test(hash)) {
        hash = '';
      }
      return {
        ok: true,
        hash: hash.slice(0, GIT_SHORT_HASH_LENGTH),
      };
    },
  };
}
