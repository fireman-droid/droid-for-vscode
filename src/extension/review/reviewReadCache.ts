import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { digest, isNotFound, type ActiveScope } from './reviewCoordinatorSupport';
import { recordedOperationVersion } from './reviewOperationScope';
import type { ReviewContentSource } from './reviewContent';

/** Display revisions avoid reading every file before the file list can be shown. */
export async function reviewDisplayVersion(source: ReviewContentSource, scope: ActiveScope, path: string): Promise<string> {
  if (scope.recordedOperations) return recordedOperationVersion(scope.recordedOperations.filter(entry => entry.path === path));
  if (scope.sdkPatches) {
    const entry = scope.sdkPatches.get(path);
    return entry && !entry.binary ? digest([scope.baseline, path, entry.patch]) : 'unavailable';
  }
  if (scope.scopeKind === 'turn' && scope.lifecycle !== 'writing' || scope.comparison?.after !== undefined && scope.comparison.after !== 'worktree')
    return digest([scope.baseline, path]);
  const root = source.getWorkspaceRoot();
  if (!root) return 'unavailable';
  try {
    const value = await stat(join(root, path), { bigint: true });
    return digest([scope.baseline, path, `${value.size}:${value.mtimeNs}:${value.ctimeNs}:${value.ino}`]);
  } catch (error) {
    if (isNotFound(error)) return digest([scope.baseline, path, '<deleted>']);
    throw error;
  }
}

/** Bounded LRU and in-flight deduplication, shared by content and patch readers. */
export class ReviewReadCache<T> {
  private readonly values = new Map<string, { value: T; bytes: number }>();
  private readonly pending = new Map<string, Promise<T>>();
  private bytes = 0;
  private generation = 0;
  constructor(private readonly size: (value: T) => number, private readonly limit = 32 * 1024 * 1024) {}
  async read(key: string, load: () => Promise<T>): Promise<T> {
    const cached = this.values.get(key);
    if (cached) { this.values.delete(key); this.values.set(key, cached); return cached.value; }
    const pending = this.pending.get(key);
    if (pending) return pending;
    const generation = this.generation;
    const work = load().then(value => {
      if (generation !== this.generation) return value;
      const bytes = this.size(value);
      if (bytes <= this.limit) {
        this.values.set(key, { value, bytes }); this.bytes += bytes;
        while (this.values.size > 128 || this.bytes > this.limit) {
          const oldest = this.values.keys().next().value!;
          this.bytes -= this.values.get(oldest)!.bytes; this.values.delete(oldest);
        }
      }
      return value;
    });
    this.pending.set(key, work);
    try { return await work; }
    finally { if (this.pending.get(key) === work) this.pending.delete(key); }
  }
  clear(): void { this.generation++; this.values.clear(); this.pending.clear(); this.bytes = 0; }
}

export async function reviewReadKey(source: ReviewContentSource, scope: ActiveScope, path: string): Promise<string> {
  const record = scope.turnId ? source.snapshots.read(scope.snapshotSessionId ?? scope.sessionId, scope.turnId) : undefined;
  return JSON.stringify([source.getWorkspaceRoot(), scope.reviewScopeId, scope.baseline, scope.lifecycle === 'writing' ? 'writing' : 'settled',
    record?.before, record?.after, await reviewDisplayVersion(source, scope, path), path,
    scope.turnOperations ? recordedOperationVersion(scope.turnOperations.filter(entry => entry.path === path)) : undefined]);
}
