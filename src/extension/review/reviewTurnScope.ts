import type { ReviewOpenMessage } from '../../shared/protocol/reviewProtocol';
import type { ReviewCoordinatorOptions } from './reviewCoordinator';
import { createActiveScope, withSnapshotSession, type ActiveScope, type PersistedScope } from './reviewCoordinatorSupport';
import { confirmedTurnFiles } from './reviewTurnFiles';
import { flattenOperations, loadOperationReviewScope } from './reviewOperationScope';

export function loadTurnReviewScope(
  options: Pick<ReviewCoordinatorOptions, 'snapshots' | 'resolveCanonicalTurnSessionId' |
    'isTurnWriting' | 'readCanonicalTurnFiles' | 'readTurnOperations' | 'diagnostics'>,
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
  const operations = options.readTurnOperations?.(sessionId, turnId) ?? [];
  const files = confirmedTurnFiles(operations, canonicalFiles ?? activeFiles ?? record?.files ?? []);
  if (unchanged) for (const file of files) Object.assign(file, { additions: 0, deletions: 0 });
  const message: ReviewOpenMessage = { type: 'review.open', sessionId, scopeKind: 'turn', turnId };
  const complete = record?.before !== undefined && (live || record.after !== undefined);
  const scope = createActiveScope(message,
    complete ? live ? record.before! : `${record.before}:${record.after}` : record?.before ?? `missing-${turnId}`,
    live ? 'Before turn → live files' : 'Before turn → after turn', files, persisted, complete, false);
  scope.turnOperations = flattenOperations(operations);
  if (!complete) {
    const recorded = loadOperationReviewScope(message, operations, persisted);
    scope.recordedOperations = recorded.recordedOperations;
    scope.files = scope.files.map(file => ({ ...file,
      comparable: recorded.files.find(entry => entry.path === file.path)?.comparable ?? false }));
    scope.lifecycle = files.length ? 'settled' : 'unavailable';
    scope.message = 'Showing recorded edits. The complete file snapshots for this turn are unavailable.';
  }
  if (live) scope.lifecycle = 'writing';
  options.diagnostics?.record({ level: 'info', name: 'host.review.scope',
    attributes: { sessionId, snapshotSessionId, turnId, reviewScopeId: scope.reviewScopeId,
      lifecycle: scope.lifecycle, beforeTree: record?.before ?? null, afterTree: record?.after ?? null,
      complete, fileCount: files.length,
      fileSource: 'confirmed-sdk-operations' } });
  return withSnapshotSession(scope, snapshotSessionId);
}
