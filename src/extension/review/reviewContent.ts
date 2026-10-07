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
import { MAX_REVIEW_PATCH_CHARS, type ReviewContext, type ReviewPanelFile, type ReviewSyntaxSource } from '../../shared/protocol/reviewPanelProtocol';
import { recordedFileContent } from './recordedFileContent';
import { readOperationBody, type OperationBody, type OperationBodyRequest } from '../../runtime/tools/operationBody';

export interface ReviewContentSource {
  readonly readOperationBody?: (request: OperationBodyRequest) => Promise<OperationBody | undefined>;
  readonly snapshots: TurnSnapshotStore;
  readonly getWorkspaceRoot: () => string | undefined;
  readonly readPriorFileOperations?: (sessionId: string, turnId: string, path: string) => NonNullable<ActiveScope['recordedOperations']>;
  readonly diagnostics?: Pick<RuntimeDiagnosticSink, 'record'>;
}
export async function readReviewContents(source: ReviewContentSource, scope: ActiveScope, path: string, maxBytes = MAX_REVIEW_PATCH_CHARS) {
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
export async function readReviewPatch(source: ReviewContentSource, scope: ActiveScope, path: string, context: ReviewContext, toolUseId?: string) {
  if (scope.recordedOperations) {
    if (!scope.files.some((file) => file.path === path)) throw new Error('Review file is no longer available.');
    const matching = scope.recordedOperations.filter((entry) => entry.path === path &&
      (scope.scopeKind === 'operations' || hasOperationChanges(entry)));
    if (!matching.length) throw new Error('No saved before/after snapshot or recorded changes are available for this file. Open the current file to inspect it.');
    if (toolUseId !== undefined && !matching.some(entry => entry.toolUseId === toolUseId))
      throw new Error('The selected edit is no longer available for this file. Refresh Review.');
    const selectedIndex = toolUseId === undefined
      ? matching.reduce((last, entry, index) => entry.source === 'tool-result' && entry.outcome === 'applied' ? index : last, -1)
      : matching.findIndex(entry => entry.toolUseId === toolUseId);
    const targetIndex = selectedIndex < 0 ? matching.length - 1 : selectedIndex;
    const savedTarget = matching[targetIndex]!;
    let target = savedTarget;
    if (savedTarget.bodyRef) {
      const workspace = source.getWorkspaceRoot();
      if (!workspace) throw new Error('The workspace for this saved edit is unavailable.');
      const body = await (source.readOperationBody ?? readOperationBody)({ workspace,
        sourceSessionId: savedTarget.sessionId, callId: savedTarget.callId ?? savedTarget.toolUseId, file: savedTarget });
      if (!body) throw new Error('The saved body for this edit could not be read from its source session.');
      target = { ...savedTarget, ...body };
    }
    const displayEntries = matching.map((entry, index) => index === targetIndex ? target : entry);
    const visible = new Set<number>([targetIndex]);
    let units = target.patch.length + (target.submittedContent?.length ?? 0);
    if (units > 512_000) throw new Error('The selected edit exceeds the recorded preview limit.');
    for (let index = 0; index < matching.length && visible.size < 200; index++) {
      if (index === targetIndex) continue;
      const entry = matching[index]!;
      const size = entry.patch.length + (entry.submittedContent?.length ?? 0);
      if (units + size > 512_000) continue;
      visible.add(index);
      units += size;
    }
    const indexes = [...visible].sort((left, right) => left - right);
    const recordedOperations: NonNullable<ReviewPanelFile['recordedOperations']>[number][] = [];
    for (const index of indexes) {
      const { toolUseId, toolName, sequence, kind, patch, submittedContent, bodyRef, source, outcome, message } = displayEntries[index]!;
      recordedOperations.push({ toolUseId, toolName, sequence, kind, patch, source,
        ...(submittedContent === undefined ? {} : { submittedContent }),
        ...(bodyRef === undefined ? {} : { bodyRef }),
        ...(outcome === undefined ? {} : { outcome }), ...(message === undefined ? {} : { message }) });
    }
    {
      const full = await recordedFileDiffs(source, scope, path, displayEntries, MAX_REVIEW_PATCH_CHARS, matching.length, toolUseId, context === 'all');
      for (let index = 0; index < recordedOperations.length; index++) {
        const originalIndex = indexes[index]!;
        if (originalIndex === full.selectedIndex && full.syntaxSource)
          recordedOperations[index] = { ...recordedOperations[index]!, syntaxSource: full.syntaxSource };
        const fullPatch = full.patches.get(originalIndex);
        if (fullPatch !== undefined) recordedOperations[index] = { ...recordedOperations[index]!, fullPatch };
        else if (context === 'all' && originalIndex === full.selectedIndex && full.unavailableReason)
          recordedOperations[index] = { ...recordedOperations[index]!, fullPatchUnavailableReason: full.unavailableReason };
      }
    }
    const content = recordedFileContent(displayEntries);
    return { version: recordedOperationVersion(matching),
      patch: '', truncated: recordedOperations.length !== matching.length, recordedOperations,
      ...(content === undefined ? {} : { recordedContent: content }) };
  }
  if (scope.sdkPatches !== undefined && context === 3) {
    const entry = scope.sdkPatches.get(path);
    if (!entry) throw new Error('The SDK did not return a patch for this file. Refresh Review.');
    if (entry.binary) throw new Error('Binary files cannot be shown as a text Diff.');
    let syntaxSource: ReviewSyntaxSource | undefined;
    try { syntaxSource = sourceText(await readReviewContents(source, scope, path)); }
    catch (error) {
      // The SDK's saved patch remains readable even when its full baseline is
      // missing or larger than our text limit. Report the lost syntax context.
      source.diagnostics?.record({ level: 'warn', name: 'host.review.syntax_context_unavailable',
        attributes: { reviewScopeId: scope.reviewScopeId, path, reason: error instanceof Error ? error.message : String(error) } });
    }
    return { ...boundedPatch(digest([scope.baseline, path, entry.patch]), entry.patch),
      ...(syntaxSource ? { syntaxSource } : {}) };
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
  return { ...boundedPatch(version, full), syntaxSource: sourceText(contents) };
}
function sourceText(contents: { before: Buffer; after: Buffer }): ReviewSyntaxSource {
  return {
    before: contents.before.toString('utf8').replace(/\r\n/g, '\n'),
    after: contents.after.toString('utf8').replace(/\r\n/g, '\n'),
  };
}
function boundedPatch(version: string, full: string) {
  const lines = full.split('\n');
  const kept: string[] = [];
  let units = 0;
  for (const line of lines) {
    if (kept.length >= 100_000 || units + line.length + 1 > MAX_REVIEW_PATCH_CHARS) break;
    kept.push(line); units += line.length + 1;
  }
  return { version, patch: kept.join('\n'), truncated: kept.length < lines.length };
}
