import type { ReviewContentSource } from './reviewContent';
import type { ActiveScope } from './reviewCoordinatorSupport';
import { diffBytes, readTurnDiffContents } from '../changes/inlineDiff';
import { applySdkPatch } from './reviewSdkPatch';
import { isRestrictedToolContent } from '../../runtime/tools/toolResultPreview';

/** Only saved before/after trees prove that the complete edit chain covers this file. */
export async function recordedFileDiffs(
  source: ReviewContentSource, scope: ActiveScope, path: string,
  entries: NonNullable<ActiveScope['recordedOperations']>, budget: number, visibleCount: number,
): Promise<ReadonlyMap<number, string>> {
  const patches = new Map<number, string>();
  const root = source.getWorkspaceRoot();
  if (!root || !scope.turnId || scope.lifecycle === 'writing' || scope.operationUndoBlocked ||
    entries.length === 0 || entries.length > 200 || new Set(entries.map(entry => entry.sessionId)).size !== 1)
    return patches;
  const snapshot = await readTurnDiffContents(source.snapshots, {
    sessionId: scope.snapshotSessionId ?? scope.sessionId, turnId: scope.turnId,
  }, root, path, 'settled');
  if (snapshot.status !== 'ready') return patches;
  let current = snapshot.before.toString('utf8').replace(/\r\n/g, '\n');
  const expected = snapshot.after.toString('utf8').replace(/\r\n/g, '\n');
  if (isRestrictedToolContent(current) || isRestrictedToolContent(expected)) return patches;
  const versions: { index: number; before: string; after: string }[] = [];
  let retained = current.length;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry.outcome === 'failed') continue;
    if (entry.source !== 'tool-result' || entry.outcome !== 'applied' || entry.previousPath || entry.contentRestricted)
      return patches;
    let after: string;
    if (entry.submittedContent !== undefined) after = entry.submittedContent.replace(/\r\n/g, '\n');
    else {
      if (!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(entry.patch)) return patches;
      try {
        after = applySdkPatch(current, { patch: entry.patch,
          beforePath: entry.kind === 'added' ? null : path,
          afterPath: entry.kind === 'deleted' ? null : path, binary: false });
      } catch {
        // A gap or mismatch invalidates this reconstruction; keep the original excerpts.
        return patches;
      }
    }
    if (after.length > 512_000 || isRestrictedToolContent(after)) return patches;
    versions.push({ index, before: current, after });
    current = after;
    retained += after.length;
    // Limit retained intermediate versions while preferring the latest selected edit.
    while (retained > 2_000_000 && versions.length > 1) {
      retained -= versions.shift()!.before.length;
    }
  }
  if (current !== expected) return patches;
  let units = 0;
  for (const version of versions.reverse()) {
    if (version.index >= visibleCount) continue;
    const context = Math.max(version.before.split('\n').length, version.after.split('\n').length);
    const patch = await diffBytes(Buffer.from(version.before), Buffer.from(version.after), context);
    if (patch.length === 0 || patch.split('\n').length > 10_000 || units + patch.length > budget) continue;
    patches.set(version.index, patch);
    units += patch.length;
  }
  return patches;
}
