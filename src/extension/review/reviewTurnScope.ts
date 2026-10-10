import type { ReviewOpenMessage } from '../../shared/protocol/reviewProtocol';
import type { ReviewCoordinatorOptions } from './reviewCoordinator';
import { createActiveScope, withSnapshotSession, type ActiveScope, type PersistedScope } from './reviewCoordinatorSupport';
import { confirmedTurnFiles } from './reviewTurnFiles';
import { flattenOperations, loadOperationReviewScope } from './reviewOperationScope';

/** Recompute historical display counts; persisted totals may count CRLF as edits. */
export async function refreshTurnReviewStats(
  options: Pick<ReviewCoordinatorOptions, 'snapshots' | 'diagnostics'>, scope: ActiveScope,
): Promise<ActiveScope> {
  if (scope.lifecycle === 'writing' || scope.recordedOperations || !scope.files.length) return scope;
  const sessionId = scope.snapshotSessionId ?? scope.sessionId;
  try {
    const stats = await options.snapshots.diff({ sessionId, turnId: scope.turnId! });
    scope.files = scope.files.map(file => ({ ...file, ...(stats.get(file.path) ?? { additions: 0, deletions: 0 }) }));
  } catch (error) {
    scope.files = scope.files.map(file => ({ ...file, additions: null, deletions: null }));
    scope.message = 'Saved turn change counts could not be read. Refresh Review to retry.';
    options.diagnostics?.record({ level: 'warn', name: 'host.review.turn_stats_unavailable',
      attributes: { sessionId, turnId: scope.turnId!, reason: error instanceof Error ? error.message : String(error) } });
  }
  return scope;
}

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
