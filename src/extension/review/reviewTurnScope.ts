import type { ReviewOpenMessage } from '../../shared/protocol/reviewProtocol';
import type { ReviewCoordinatorOptions } from './reviewCoordinator';
import { createActiveScope, withSnapshotSession, type ActiveScope, type PersistedScope } from './reviewCoordinatorSupport';

export function loadTurnReviewScope(
  options: Pick<ReviewCoordinatorOptions, 'snapshots' | 'resolveCanonicalTurnSessionId' |
    'isTurnWriting' | 'readCanonicalTurnFiles' | 'diagnostics'>,
  persisted: ReadonlyMap<string, PersistedScope>,
  active: ActiveScope | null, sessionId: string, turnId: string,
): ActiveScope {
  const snapshotSessionId = options.resolveCanonicalTurnSessionId?.(sessionId, turnId) ?? sessionId;
  const record = options.snapshots.read(snapshotSessionId, turnId);
  const live = options.isTurnWriting?.(sessionId, turnId) ??
    (active?.scopeKind === 'turn' && active.sessionId === sessionId && active.turnId === turnId && active.lifecycle === 'writing' && !record?.after);
  const canonicalFiles = options.readCanonicalTurnFiles(sessionId, turnId);
  const activeFiles = live && active?.sessionId === sessionId && active.turnId === turnId ? active.files : undefined;
  const unchanged = !live && record?.before !== undefined && record.before === record.after;
  const files = unchanged ? [] : canonicalFiles ?? activeFiles ?? record?.files ?? [];
  const message: ReviewOpenMessage = { type: 'review.open', sessionId, scopeKind: 'turn', turnId };
  const complete = record?.before !== undefined && (live || record.after !== undefined);
  const scope = createActiveScope(message,
    complete ? live ? record.before! : `${record.before}:${record.after}` : record?.before ?? `missing-${turnId}`,
    live ? 'Before turn → live files' : 'Before turn → after turn', files, persisted, complete, false);
  if (live) scope.lifecycle = 'writing';
  else if (!complete) {
    scope.lifecycle = 'unavailable';
    scope.message = 'This turn has no complete saved workspace snapshot.';
  }
  options.diagnostics?.record({ level: 'info', name: 'host.review.scope',
    attributes: { sessionId, snapshotSessionId, turnId, reviewScopeId: scope.reviewScopeId,
      lifecycle: scope.lifecycle, beforeTree: record?.before ?? null, afterTree: record?.after ?? null,
      complete, fileCount: files.length,
      fileSource: canonicalFiles !== undefined ? 'canonical' : activeFiles !== undefined ? 'active-turn' : record?.files !== undefined ? 'snapshot-record' : 'none' } });
  return withSnapshotSession(scope, snapshotSessionId);
}
