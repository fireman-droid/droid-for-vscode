import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { ReviewOpenMessage, ReviewScopeKind, ReviewScopeState } from '../shared/reviewProtocol';
import { isSafeWorkspaceRelativePath } from '../shared/validateMessage';
import { toWorkspaceRelativePath } from '../runtime/toolFilePath';
import type { ChangeStatsPersistence, CommittedFileStat } from './changeStats';
import { getGitApi } from './vscodeGitWorkflow';

export interface PersistedScope {
  readonly reviewScopeId: string;
  readonly sessionId: string;
  readonly scopeKind: ReviewScopeKind;
  readonly turnId?: string;
  readonly baseline: string;
  readonly currentPath?: string;
  readonly reviewed: readonly { readonly path: string; readonly version: string }[];
  readonly updatedAt: number;
}

export interface ScopeFile extends CommittedFileStat {
  version: string;
  comparable: boolean;
  restorable: boolean;
  restoreConflict: boolean;
}

export interface ActiveScope {
  reviewScopeId: string;
  sessionId: string;
  scopeKind: ReviewScopeKind;
  turnId?: string;
  baseline: string;
  baselineLabel: string;
  fallbackBaselineRef?: string;
  lifecycle: ReviewScopeState['lifecycle'];
  files: ScopeFile[];
  currentIndex: number | null;
  reviewed: Map<string, string>;
  message?: string;
}

export interface RecoveryEntry {
  readonly path: string;
  readonly existed: boolean;
  readonly dataBase64?: string;
}

export function mapStats(
  stats: ReadonlyMap<string, { additions: number | null; deletions: number | null }>,
): CommittedFileStat[] {
  return [...stats].map(([path, value]) => ({ path, ...value }));
}

export function createActiveScope(
  message: ReviewOpenMessage,
  baseline: string,
  baselineLabel: string,
  stats: readonly CommittedFileStat[],
  persisted: ReadonlyMap<string, PersistedScope>,
  comparable = true,
  restorable = comparable && message.scopeKind === 'turn',
  fallbackBaselineRef?: string,
): ActiveScope {
  const reviewScopeId = scopeId(message, baseline);
  const saved = persisted.get(reviewScopeId);
  const reviewed = new Map(
    saved?.baseline === baseline
      ? saved.reviewed.map(({ path, version }) => [path, version])
      : [],
  );
  const files = stats
    .filter(({ path }) => isSafeWorkspaceRelativePath(path))
    .slice(0, 200)
    .map((file) => ({
      ...file,
      version: '',
      comparable,
      restorable,
      restoreConflict: false,
    }));
  const currentPath =
    saved?.baseline === baseline ? saved.currentPath : undefined;
  const savedIndex =
    currentPath === undefined
      ? -1
      : files.findIndex(({ path }) => path === currentPath);
  const firstUnreviewed = files.findIndex(
    ({ path }) => !reviewed.has(path),
  );
  return {
    reviewScopeId,
    sessionId: message.sessionId,
    scopeKind: message.scopeKind,
    ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
    baseline,
    baselineLabel,
    ...(fallbackBaselineRef === undefined ? {} : { fallbackBaselineRef }),
    lifecycle: files.length === 0 ? 'complete' : 'settled',
    files,
    currentIndex:
      files.length === 0
        ? null
        : savedIndex >= 0
          ? savedIndex
          : firstUnreviewed >= 0
            ? firstUnreviewed
            : 0,
    reviewed,
  };
}

export function unavailableScope(
  message: ReviewOpenMessage,
  reason: string,
): ActiveScope {
  return {
    reviewScopeId: scopeId(message, 'unavailable'),
    sessionId: message.sessionId,
    scopeKind: message.scopeKind,
    ...(message.turnId === undefined ? {} : { turnId: message.turnId }),
    baseline: 'unavailable',
    baselineLabel: 'Unavailable',
    lifecycle: 'unavailable',
    files: [],
    currentIndex: null,
    reviewed: new Map(),
    message: reason,
  };
}

export function scopeId(message: ReviewOpenMessage, baseline: string): string {
  return digest([
    message.sessionId,
    message.scopeKind,
    message.turnId ?? '',
    baseline,
  ]).slice(0, 24);
}

export function digest(parts: readonly (string | Buffer)[]): string {
  const hash = createHash('sha256');
  for (const part of parts) {
    hash.update(part);
    hash.update('\0');
  }
  return hash.digest('hex');
}

export function sameBytes(left: Buffer | null, right: Buffer | null): boolean {
  return left === null ? right === null : right !== null && left.equals(right);
}

export function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

export function readPersistedScopes(
  persistence: ChangeStatsPersistence,
  key: string,
  version: number,
  maxScopes: number,
): Map<string, PersistedScope> {
  const map = new Map<string, PersistedScope>();
  const value = persistence.get<unknown>(key);
  if (
    typeof value !== 'object' ||
    value === null ||
    (value as { version?: unknown }).version !== version ||
    !Array.isArray((value as { scopes?: unknown }).scopes)
  ) return map;
  for (const candidate of (value as { scopes: unknown[] }).scopes.slice(-maxScopes)) {
    if (
      typeof candidate === 'object' &&
      candidate !== null &&
      typeof (candidate as PersistedScope).reviewScopeId === 'string' &&
      Array.isArray((candidate as PersistedScope).reviewed)
    ) {
      const record = candidate as PersistedScope;
      map.set(record.reviewScopeId, record);
    }
  }
  return map;
}

export function latestPersistedScope(
  scopes: ReadonlyMap<string, PersistedScope>,
  sessionId: string,
): PersistedScope | undefined {
  let latest: PersistedScope | undefined;
  for (const scope of scopes.values()) {
    if (
      scope.sessionId === sessionId &&
      (latest === undefined || scope.updatedAt > latest.updatedAt)
    ) {
      latest = scope;
    }
  }
  return latest;
}

export function isRecoveryEntry(value: unknown): value is RecoveryEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    isSafeWorkspaceRelativePath((value as RecoveryEntry).path) &&
    typeof (value as RecoveryEntry).existed === 'boolean' &&
    ((value as RecoveryEntry).existed
      ? typeof (value as RecoveryEntry).dataBase64 === 'string'
      : (value as RecoveryEntry).dataBase64 === undefined)
  );
}

export async function restoreRecovery(
  root: string,
  entries: readonly RecoveryEntry[],
): Promise<void> {
  for (const entry of [...entries].reverse()) {
    const target = join(root, entry.path);
    if (!entry.existed) {
      await rm(target, { force: true });
    } else {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(entry.dataBase64!, 'base64'));
    }
  }
}

export async function resolveReviewGitRef(
  workspaceRoot: string,
  ref: string,
): Promise<string | undefined> {
  try {
    const api = await getGitApi();
    const repository = api?.repositories.find(
      ({ rootUri }) =>
        toWorkspaceRelativePath(rootUri.fsPath, workspaceRoot) === '' ||
        rootUri.fsPath === workspaceRoot,
    );
    return repository === undefined
      ? undefined
      : (await repository.getCommit(ref)).hash;
  } catch {
    return undefined;
  }
}
