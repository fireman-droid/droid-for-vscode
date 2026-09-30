import type { ReviewContentSource } from './reviewContent';
import type { ActiveScope } from './reviewCoordinatorSupport';
import { diffBytes, readTurnDiffContents } from '../changes/inlineDiff';
import { applySdkPatch } from './reviewSdkPatch';
import { isRestrictedToolContent } from '../../runtime/tools/toolResultPreview';

/** Rebuild each edit from saved versions; undo eligibility is independent of viewing. */
export async function recordedFileDiffs(
  source: ReviewContentSource, scope: ActiveScope, path: string,
  entries: NonNullable<ActiveScope['recordedOperations']>, budget: number, visibleCount: number,
): Promise<ReadonlyMap<number, string>> {
  const patches = new Map<number, string>();
  const root = source.getWorkspaceRoot();
  if (!root || !scope.turnId ||
    entries.length === 0 || entries.length > 200 || new Set(entries.map(entry => entry.sessionId)).size !== 1)
    return patches;
  const snapshot = await readTurnDiffContents(source.snapshots, {
    sessionId: scope.snapshotSessionId ?? scope.sessionId, turnId: scope.turnId,
  }, root, path, scope.lifecycle === 'writing' ? 'live' : 'settled');
  let current = snapshot.status === 'ready' ? snapshot.before.toString('utf8').replace(/\r\n/g, '\n') : undefined;
  const expected = snapshot.status === 'ready' ? snapshot.after.toString('utf8').replace(/\r\n/g, '\n') : undefined;
  if (current !== undefined && isRestrictedToolContent(current) || expected !== undefined && isRestrictedToolContent(expected)) return patches;
  const versions: { index: number; before: string; after: string }[] = [];
  let retained = current?.length ?? 0;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry.outcome === 'failed') continue;
    if (entry.source !== 'tool-result' || entry.outcome !== 'applied' || entry.previousPath || entry.contentRestricted)
      return patches;
    // A successful full write supplies a baseline even for history without turn snapshots.
    // Its submitted content proves the after image, not what was overwritten.
    if (current === undefined && entry.submittedContent !== undefined) {
      current = entry.submittedContent.replace(/\r\n/g, '\n');
      if (isRestrictedToolContent(current)) return patches;
      retained = current.length;
      continue;
    }
    // ApplyPatch's confirmed create result contains the complete newly created file.
    if (current === undefined && entry.kind === 'added' && /^@@ -0,0 \+1,\d+ @@/u.test(entry.patch)) current = '';
    if (current === undefined) return patches;
    let after: string;
    if (entry.submittedContent !== undefined) after = entry.submittedContent.replace(/\r\n/g, '\n');
    else {
      if (!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(entry.patch)) return patches;
      if (expected === undefined && entry.kind !== 'added' && entry.reversible !== true && entry.toolName.toLowerCase() !== 'edit')
        return patches;
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
  // While streaming, current bytes only verify the recorded chain. They are never
  // substituted for an older version or used to attribute unrelated changes.
  if (expected !== undefined && current !== expected) return patches;
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
