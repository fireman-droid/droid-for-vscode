import type { ReviewOpenMessage } from '../../shared/protocol/reviewProtocol';
import type { CommittedFileStat } from '../changes/changeStats';
import {
  createActiveScope,
  type ActiveScope,
  type PersistedScope,
} from './reviewCoordinatorSupport';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';

export interface ReviewWritingScopeHost {
  readonly snapshots: TurnSnapshotStore;
  readonly persisted: ReadonlyMap<string, PersistedScope>;
  getActive(): ActiveScope | null;
  setActive(scope: ActiveScope): void;
  publish(scope: ActiveScope): void;
  loadSettled(sessionId: string, turnId: string): Promise<ActiveScope>;
  refreshVersions(scope: ActiveScope, affectedPaths?: ReadonlySet<string>): Promise<void>;
  persist(scope: ActiveScope): Promise<void>;
  enqueue(task: () => Promise<void>): Promise<void>;
}

const turnMessage = (sessionId: string, turnId: string): ReviewOpenMessage => ({
  type: 'review.open',
  sessionId,
  scopeKind: 'turn',
  turnId,
});

export function openWritingTurn(
  host: ReviewWritingScopeHost,
  sessionId: string,
  turnId: string,
  files: readonly CommittedFileStat[],
): void {
  const record = host.snapshots.read(sessionId, turnId);
  const scope = createActiveScope(
    turnMessage(sessionId, turnId),
    record?.before ?? `writing-${turnId}`,
    'Before turn',
    files,
    host.persisted,
    record?.before !== undefined,
  );
  scope.lifecycle = 'writing';
  scope.reviewed.clear();
  host.setActive(scope);
  host.publish(scope);
  refreshWritingFiles(host, sessionId, turnId, new Set(scope.files.map(({ path }) => path)));
}

export function refreshWritingTurn(
  host: ReviewWritingScopeHost,
  sessionId: string,
  turnId: string,
  files: readonly CommittedFileStat[],
): void {
  void host.enqueue(async () => {
    const active = host.getActive();
    if (!isWritingTurn(active, sessionId, turnId)) return;
    const currentPath =
      active.currentIndex === null ? undefined : active.files[active.currentIndex]?.path;
    const hasBefore = host.snapshots.read(sessionId, turnId)?.before !== undefined;
    const refreshed = createActiveScope(
      turnMessage(sessionId, turnId),
      active.baseline,
      active.baselineLabel,
      files,
      host.persisted,
      hasBefore || active.files.every(({ comparable }) => comparable),
    );
    refreshed.lifecycle = 'writing';
    refreshed.reviewed = active.reviewed;
    preserveCurrentPath(refreshed, currentPath);
    const previous = new Map(active.files.map((file) => [file.path, file.version]));
    const added = new Set<string>();
    for (const file of refreshed.files) {
      const version = previous.get(file.path);
      if (version === undefined) added.add(file.path);
      else file.version = version;
    }
    await host.refreshVersions(refreshed, added);
    if (host.getActive() !== active) return;
    host.setActive(refreshed);
    host.publish(refreshed);
  });
}

export function invalidateWritingTurn(
  host: ReviewWritingScopeHost,
  sessionId: string,
  turnId: string,
  paths: readonly string[],
): void {
  refreshWritingFiles(host, sessionId, turnId, new Set(paths));
}

export function settleWritingTurn(
  host: ReviewWritingScopeHost,
  sessionId: string,
  turnId: string,
  files: readonly CommittedFileStat[],
): Promise<void> {
  if (!isWritingTurn(host.getActive(), sessionId, turnId)) {
    return Promise.resolve();
  }
  return host.enqueue(async () => {
    const active = host.getActive();
    if (!isWritingTurn(active, sessionId, turnId)) return;
    const currentPath =
      active.currentIndex === null ? undefined : active.files[active.currentIndex]?.path;
    const settled = await host.loadSettled(sessionId, turnId);
    if (host.getActive() !== active) return;
    settled.reviewed = active.reviewed;
    preserveCurrentPath(settled, currentPath);
    await host.refreshVersions(settled);
    if (host.getActive() !== active) return;
    await host.persist(settled);
    if (host.getActive() !== active) return;
    host.setActive(settled);
    host.publish(settled);
  });
}

function refreshWritingFiles(
  host: ReviewWritingScopeHost,
  sessionId: string,
  turnId: string,
  affected: ReadonlySet<string>,
): void {
  if (affected.size === 0) return;
  void host.enqueue(async () => {
    const active = host.getActive();
    if (!isWritingTurn(active, sessionId, turnId)) return;
    const refreshed = cloneScope(active);
    await host.refreshVersions(refreshed, affected);
    if (host.getActive() !== active) return;
    host.setActive(refreshed);
    host.publish(refreshed);
  });
}

function cloneScope(scope: ActiveScope): ActiveScope {
  return {
    ...scope,
    files: scope.files.map((file) => ({ ...file })),
    reviewed: new Map(scope.reviewed),
  };
}

function isWritingTurn(
  scope: ActiveScope | null,
  sessionId: string,
  turnId: string,
): scope is ActiveScope {
  return (
    scope?.sessionId === sessionId &&
    scope.scopeKind === 'turn' &&
    scope.turnId === turnId &&
    scope.lifecycle === 'writing'
  );
}

function preserveCurrentPath(scope: ActiveScope, currentPath: string | undefined): void {
  if (currentPath === undefined) return;
  const index = scope.files.findIndex(({ path }) => path === currentPath);
  if (index >= 0) scope.currentIndex = index;
}
