import type { ReviewOpenMessage } from '../../shared/protocol/reviewProtocol';
import { toWorkspaceRelativePath } from '../../runtime/tools/toolFilePath';
import type { ActiveScope } from './reviewCoordinatorSupport';

interface ReviewWatcherRefreshOptions {
  getActive(): ActiveScope | null;
  setActive(scope: ActiveScope): void;
  loadScope(scope: ActiveScope): Promise<ActiveScope>;
  refreshVersions(scope: ActiveScope, affectedPaths?: ReadonlySet<string>): Promise<void>;
  publish(scope: ActiveScope): void;
  enqueue(task: () => Promise<void>): Promise<void>;
}

export class ReviewWatcherRefresh {
  private readonly pendingPaths = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scheduled = false;
  private disposed = false;

  constructor(private readonly options: ReviewWatcherRefreshOptions) {}

  note(path: string): void {
    if (this.disposed) return;
    this.pendingPaths.add(path);
    if (this.scheduled) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.scheduled = true;
      void this.options.enqueue(() => this.drain());
    }, 120);
  }

  noteWorkspacePath(root: string | undefined, fsPath: string): void {
    if (root === undefined) return;
    const path = toWorkspaceRelativePath(root, fsPath);
    if (path !== undefined) this.note(path);
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.pendingPaths.clear();
  }

  private async drain(): Promise<void> {
    try {
      while (!this.disposed && this.pendingPaths.size > 0) {
        const affected = new Set(this.pendingPaths);
        this.pendingPaths.clear();
        await this.refresh(affected);
      }
    } finally {
      this.scheduled = false;
    }
  }

  private async refresh(affected: ReadonlySet<string>): Promise<void> {
    const source = this.options.getActive();
    if (source === null || source.lifecycle === 'writing') return;
    const refreshed =
      source.scopeKind === 'turn'
        ? cloneScope(source)
        : await this.options.loadScope(source);
    if (this.disposed || this.options.getActive() !== source) return;
    preserveScopeState(refreshed, source);
    const baselineChanged = refreshed.baseline !== source.baseline;
    if (baselineChanged) {
      refreshed.lifecycle = 'stale';
      refreshed.message = 'The review baseline changed. Reopen this scope.';
    } else if (refreshed !== source) {
      reuseUnaffectedVersions(refreshed, source, affected);
    }
    await this.options.refreshVersions(refreshed, baselineChanged ? undefined : affected);
    if (this.disposed || this.options.getActive() !== source) return;
    this.options.setActive(refreshed);
    this.options.publish(refreshed);
  }
}

export function watcherOpenMessage(scope: ActiveScope): ReviewOpenMessage {
  return {
    type: 'review.open',
    sessionId: scope.sessionId,
    scopeKind: scope.scopeKind,
    ...(scope.baseBranch === undefined ? {} : { baseBranch: scope.baseBranch }),
    ...(scope.turnId === undefined ? {} : { turnId: scope.turnId }),
  };
}

export async function refreshScopeVersions(
  scope: ActiveScope,
  affectedPaths: ReadonlySet<string> | undefined,
  readVersion: (path: string) => Promise<string>,
  cancelled: () => boolean,
): Promise<void> {
  const files = scope.files.filter(
    ({ path, version, comparable }) =>
      comparable &&
      (affectedPaths === undefined || version === '' || affectedPaths.has(path)),
  );
  const workers = Math.min(6, files.length);
  await Promise.all(
    Array.from({ length: workers }, async (_, worker) => {
      for (let index = worker; index < files.length; index += workers) {
        const file = files[index]!;
        const version = await readVersion(file.path);
        if (cancelled()) return;
        file.version = version;
      }
    }),
  );
}

function cloneScope(scope: ActiveScope): ActiveScope {
  return {
    ...scope,
    files: scope.files.map((file) => ({ ...file })),
    reviewed: new Map(scope.reviewed),
  };
}

function preserveScopeState(target: ActiveScope, source: ActiveScope): void {
  const currentPath =
    source.currentIndex === null ? undefined : source.files[source.currentIndex]?.path;
  target.reviewed = new Map(source.reviewed);
  if (currentPath === undefined) return;
  const index = target.files.findIndex(({ path }) => path === currentPath);
  if (index >= 0) target.currentIndex = index;
}

function reuseUnaffectedVersions(
  target: ActiveScope,
  source: ActiveScope,
  affected: ReadonlySet<string>,
): void {
  const previous = new Map(source.files.map((file) => [file.path, file]));
  for (const file of target.files) {
    const old = previous.get(file.path);
    if (old !== undefined && !affected.has(file.path)) {
      file.version = old.version;
    }
  }
}
