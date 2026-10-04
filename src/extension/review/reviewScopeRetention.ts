import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import type { ActiveScope } from './reviewCoordinatorSupport';

/** A selected historical comparison must outlive normal snapshot rotation. */
export class ReviewScopeRetention {
  private key: string | null = null;
  private release: (() => void) | undefined;
  constructor(private readonly snapshots: TurnSnapshotStore) {}
  select(scope: ActiveScope | null): void {
    const target = scope?.turnId && (scope.scopeKind === 'turn' || scope.scopeKind === 'operations')
      ? { sessionId: scope.snapshotSessionId ?? scope.sessionId, turnId: scope.turnId } : null;
    const key = target ? JSON.stringify(target) : null;
    if (this.key === key) return;
    const next = target ? this.snapshots.retain?.(target) : undefined;
    this.release?.(); this.key = key; this.release = next;
  }
  dispose(): void { this.release?.(); this.release = undefined; this.key = null; }
}
