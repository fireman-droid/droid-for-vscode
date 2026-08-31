import type { ReviewOpenMessage } from '../shared/reviewProtocol';
import type { CommittedFileStat } from './changeStats';
import {
  createActiveScope,
  type ActiveScope,
  type PersistedScope,
} from './reviewCoordinatorSupport';
import type { TurnSnapshotStore } from './turnSnapshots';

export interface ReviewWritingScopeHost {
  readonly snapshots: TurnSnapshotStore;
  readonly persisted: ReadonlyMap<string, PersistedScope>;
  getActive(): ActiveScope | null;
  setActive(scope: ActiveScope): void;
  publish(scope: ActiveScope): void;
  loadSettled(sessionId: string, turnId: string): Promise<ActiveScope>;
  refreshVersions(scope: ActiveScope): Promise<void>;
  persist(scope: ActiveScope): Promise<void>;
  enqueue(task: () => Promise<void>): void;
}

const turnMessage = (
  sessionId: string,
  turnId: string,
): ReviewOpenMessage => ({
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
}

export function refreshWritingTurn(
  host: ReviewWritingScopeHost,
  sessionId: string,
  turnId: string,
  files: readonly CommittedFileStat[],
): void {
  const active = host.getActive();
  if (!isWritingTurn(active, sessionId, turnId)) return;
  const currentPath =
    active.currentIndex === null
      ? undefined
      : active.files[active.currentIndex]?.path;
  const hasBefore =
    host.snapshots.read(sessionId, turnId)?.before !== undefined;
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
  host.setActive(refreshed);
  host.publish(refreshed);
}

export function settleWritingTurn(
  host: ReviewWritingScopeHost,
  sessionId: string,
  turnId: string,
  files: readonly CommittedFileStat[],
): void {
  if (!isWritingTurn(host.getActive(), sessionId, turnId)) return;
  host.enqueue(async () => {
    const active = host.getActive();
    if (!isWritingTurn(active, sessionId, turnId)) return;
    const currentPath =
      active.currentIndex === null
        ? undefined
        : active.files[active.currentIndex]?.path;
    const settled = await host.loadSettled(sessionId, turnId);
    settled.reviewed = active.reviewed;
    preserveCurrentPath(settled, currentPath);
    host.setActive(settled);
    await host.refreshVersions(settled);
    host.publish(settled);
    await host.persist(settled);
  });
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

function preserveCurrentPath(
  scope: ActiveScope,
  currentPath: string | undefined,
): void {
  if (currentPath === undefined) return;
  const index = scope.files.findIndex(({ path }) => path === currentPath);
  if (index >= 0) scope.currentIndex = index;
}
