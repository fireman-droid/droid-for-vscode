import { recordedFileDiffs } from './recordedFileDiffs';
import { diffBytes, readTurnDiffContents } from '../changes/inlineDiff';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import type { ActiveScope } from './reviewCoordinatorSupport';
import { digest } from './reviewCoordinatorSupport';
import { readReviewVersion, textContents } from './reviewGitComparison';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isNotFound } from './reviewCoordinatorSupport';
import { hasOperationChanges } from '../../shared/protocol/operationDiff';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import { describeDiffBytes } from '../changes/diffDiagnostics';
import { applySdkPatch } from './reviewSdkPatch';
import { recordedOperationVersion } from './reviewOperationScope';
import type { ReviewContext, ReviewPanelFile } from '../../shared/protocol/reviewPanelProtocol';
import { recordedFileContent } from './recordedFileContent';

export interface ReviewContentSource {
  readonly snapshots: TurnSnapshotStore;
  readonly getWorkspaceRoot: () => string | undefined;
  readonly diagnostics?: Pick<RuntimeDiagnosticSink, 'record'>;
}
export async function readReviewContents(source: ReviewContentSource, scope: ActiveScope, path: string, maxBytes = 512 * 1024) {
  const root = source.getWorkspaceRoot();
  if (!root || !scope.files.some((file) => file.path === path)) throw new Error('Review file is no longer available.');
  if (scope.scopeKind === 'turn') {
    const contents = await readTurnDiffContents(source.snapshots, {
      sessionId: scope.snapshotSessionId ?? scope.sessionId, turnId: scope.turnId!,
    }, root, path, scope.lifecycle === 'writing' ? 'live' : 'settled', maxBytes);
    if (contents.status !== 'ready') {
      const messages = {
        'not-found': 'This file is absent from both sides of this comparison. No file change was recorded.',
        unavailable: 'The saved baseline for this turn is unavailable.',
        'too-large': 'This file exceeds the Diff preview size limit.',
        binary: 'This file is binary or not UTF-8 text.',
        'read-failed': 'The Diff could not be read. Try refreshing Review.',
      };
      throw new Error(messages[contents.status]);
    }
    return contents;
  }
  if (scope.sdkPatches !== undefined) {
    const entry = scope.sdkPatches.get(path);
    if (!entry) throw new Error('The SDK did not return a patch for this file. Refresh Review.');
    if (entry.binary) throw new Error('Binary files cannot be shown as a text Diff.');
    const before = entry.beforePath === null ? null :
      await readReviewVersion(root, scope.comparison!.before, entry.beforePath, maxBytes);
    const baseline = textContents(before, null).before;
    const after = Buffer.from(applySdkPatch(baseline.toString('utf8'), entry));
    if (after.length > maxBytes) throw new Error('File exceeds the text preview limit.');
    return { before: baseline, after };
  }
  const comparison = scope.comparison ?? { before: scope.baseline, after: 'worktree' };
  const [before, after] = await Promise.all([
    readReviewVersion(root, comparison.before, path, maxBytes), readReviewVersion(root, comparison.after, path, maxBytes),
  ]);
  return textContents(before, after);
}
export async function reviewFileVersion(source: ReviewContentSource, scope: ActiveScope, path: string, exact: boolean): Promise<string> {
  if (scope.scopeKind === 'operations')
    return recordedOperationVersion(scope.recordedOperations?.filter((entry) => entry.path === path) ?? []);
  if (scope.sdkPatches !== undefined) {
    const entry = scope.sdkPatches.get(path);
    return entry && !entry.binary ? digest([scope.baseline, path, entry.patch]) : 'unavailable';
  }
  if (exact) {
    try {
      const contents = await readReviewContents(source, scope, path);
      return digest([scope.baseline, path, contents.before, contents.after]);
    } catch { return 'unavailable'; }
  }
  const root = source.getWorkspaceRoot();
  if (!root) return 'unavailable';
  let current: Buffer | null;
  try { current = await readFile(join(root, path)); }
  catch (error) { current = isNotFound(error) ? null : Buffer.from('unavailable'); }
  return digest([scope.baseline, path, current === null ? '<deleted>' : current]);
}
export async function readReviewPatch(source: ReviewContentSource, scope: ActiveScope, path: string, context: ReviewContext) {
  if (scope.recordedOperations) {
    if (!scope.files.some((file) => file.path === path)) throw new Error('Review file is no longer available.');
    const matching = scope.recordedOperations.filter((entry) => entry.path === path &&
      (scope.scopeKind === 'operations' || hasOperationChanges({ kind: entry.kind ?? 'modified', patch: entry.patch })));
    if (!matching.length) throw new Error('No saved before/after snapshot or recorded changes are available for this file. Open the current file to inspect it.');
    const recordedOperations: NonNullable<ReviewPanelFile['recordedOperations']>[number][] = [];
    let units = 0;
    for (const { toolUseId, toolName, sequence, kind, patch, submittedContent, source, outcome, message } of matching) {
      const size = patch.length + (submittedContent?.length ?? 0);
      if (recordedOperations.length === 200 || units + size > 512_000) break;
      recordedOperations.push({ toolUseId, toolName, sequence, kind, patch, source,
        ...(submittedContent === undefined ? {} : { submittedContent }),
        ...(outcome === undefined ? {} : { outcome }), ...(message === undefined ? {} : { message }) });
      units += size;
    }
    if (context === 'all') {
      const fullPatches = await recordedFileDiffs(source, scope, path, matching, 512_000 - units, recordedOperations.length);
      for (let index = 0; index < recordedOperations.length; index++) {
        const fullPatch = fullPatches.get(index);
        if (fullPatch !== undefined) recordedOperations[index] = { ...recordedOperations[index]!, fullPatch };
      }
    }
    const content = scope.operationUndoBlocked ? undefined : recordedFileContent(matching);
    return { version: recordedOperationVersion(matching),
      patch: '', truncated: recordedOperations.length !== matching.length, recordedOperations,
      ...(content === undefined ? {} : { recordedContent: content }) };
  }
  if (scope.sdkPatches !== undefined && context === 3) {
    const entry = scope.sdkPatches.get(path);
    if (!entry) throw new Error('The SDK did not return a patch for this file. Refresh Review.');
    if (entry.binary) throw new Error('Binary files cannot be shown as a text Diff.');
    return boundedPatch(digest([scope.baseline, path, entry.patch]), entry.patch);
  }
  const contents = await readReviewContents(source, scope, path);
  source.diagnostics?.record({ level: 'debug', name: 'host.changes.contents',
    attributes: { sessionId: scope.sessionId, snapshotSessionId: scope.snapshotSessionId ?? scope.sessionId,
      turnId: scope.turnId ?? null, reviewScopeId: scope.reviewScopeId, scopeKind: scope.scopeKind,
      baseline: scope.baseline, lifecycle: scope.lifecycle, path, source: 'review', status: 'ready',
      ...describeDiffBytes(contents.before, contents.after) } });
  const version = scope.sdkPatches === undefined ? digest([scope.baseline, path, contents.before, contents.after]) :
    await reviewFileVersion(source, scope, path, true);
  const lines = context === 'all'
    ? Math.max(contents.before.toString('utf8').split('\n').length, contents.after.toString('utf8').split('\n').length)
    : context;
  const full = await diffBytes(contents.before, contents.after, lines);
  return boundedPatch(version, full);
}
function boundedPatch(version: string, full: string) {
  const lines = full.split('\n');
  const kept: string[] = [];
  let units = 0;
  for (const line of lines) {
    if (kept.length >= 10_000 || units + line.length + 1 > 512_000) break;
    kept.push(line); units += line.length + 1;
  }
  return { version, patch: kept.join('\n'), truncated: kept.length < lines.length };
}
