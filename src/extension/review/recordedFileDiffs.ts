import type { ReviewContentSource } from './reviewContent';
import type { ActiveScope } from './reviewCoordinatorSupport';
import { diffBytes, isText } from '../changes/inlineDiff';
import { applySdkPatch } from './reviewSdkPatch';
import { recoverRecordedPatchContext } from './recordedPatchRecovery';
import { operationToolName } from '../../runtime/tools/operationDiff';
import { isRestrictedToolContent } from '../../runtime/tools/toolResultPreview';
import { MAX_REVIEW_PATCH_CHARS, type ReviewSyntaxSource } from '../../shared/protocol/reviewPanelProtocol';

type FileVersion = { index: number; before: string; after: string };
type VersionResult = FileVersion | { index: number; unavailableReason: 'too-large' } | undefined;

/** Rebuild each edit from saved versions; undo eligibility is independent of viewing. */
export async function recordedFileDiffs(
  source: ReviewContentSource, scope: ActiveScope, path: string,
  entries: NonNullable<ActiveScope['recordedOperations']>, budget: number, visibleCount: number,
  toolUseId?: string, fullContext = true,
): Promise<{ syntaxSource?: ReviewSyntaxSource; patches: ReadonlyMap<number, string>; selectedIndex: number; unavailableReason?: 'too-large' | 'unavailable' }> {
  const patches = new Map<number, string>();
  const selectedIndex = selectedOperation(entries, toolUseId);
  const version = await rebuildRecordedFileVersion(source, scope, path, entries, toolUseId);
  if (!version || !('before' in version) || version.index >= visibleCount)
    return { patches, selectedIndex, unavailableReason: version && !('before' in version) ? version.unavailableReason : 'unavailable' };
  const syntaxSource = { before: version.before, after: version.after };
  if (!fullContext) return { patches, selectedIndex, syntaxSource };
  const context = Math.max(version.before.split('\n').length, version.after.split('\n').length);
  const patch = await diffBytes(Buffer.from(version.before), Buffer.from(version.after), context);
  if (patch.length > budget || patch.split('\n').length > 100_000)
    return { patches, selectedIndex, syntaxSource, unavailableReason: 'too-large' };
  patches.set(version.index, patch);
  return { patches, selectedIndex, syntaxSource };
}

/** Retain only the selected pair; long turns do not materialize every full-file diff. */
export async function recordedFileVersion(
  source: ReviewContentSource, scope: ActiveScope, path: string,
  entries: NonNullable<ActiveScope['recordedOperations']>, toolUseId?: string,
  maxBytes = MAX_REVIEW_PATCH_CHARS,
): Promise<FileVersion | undefined> {
  const result = await rebuildRecordedFileVersion(source, scope, path, entries, toolUseId, maxBytes);
  return result && 'before' in result ? result : undefined;
}

async function rebuildRecordedFileVersion(
  source: ReviewContentSource, scope: ActiveScope, path: string,
  entries: NonNullable<ActiveScope['recordedOperations']>, toolUseId?: string,
  maxBytes = MAX_REVIEW_PATCH_CHARS,
): Promise<VersionResult> {
  if (!source.getWorkspaceRoot() || !scope.turnId ||
    entries.length === 0 || entries.length > 200 || new Set(entries.map(entry => entry.sessionId)).size !== 1)
    return undefined;
  const target = selectedOperation(entries, toolUseId);
  if (target < 0) return undefined;
  const snapshotScope = {
    sessionId: scope.snapshotSessionId ?? scope.sessionId, turnId: scope.turnId,
  };
  // A saved before image remains useful before the turn settles or if the after
  // capture fails. Never use today's worktree to fill in historical versions.
  const before = await source.snapshots.readTreeBytes(snapshotScope, path, 'before');
  let current = savedText(before, maxBytes);
  let blockedBySize = (before?.length ?? 0) > maxBytes;
  let selectedTooLarge = false;
  const prior = current === undefined
    ? source.readPriorFileOperations?.(scope.sessionId, scope.turnId, path) ?? [] : [];
  // Prior writes are evidence only within the exact same originating session.
  // A branch or another worker's file cannot establish this edit's baseline.
  const history = prior.slice(-200);
  const chain = [...history, ...entries];
  let selected: { index: number; before: string; after: string } | undefined;
  let recoveredContext = false;
  let selectedNeedsVerification = false;
  let lastGap = -1;
  for (let chainIndex = 0; chainIndex < chain.length; chainIndex++) {
    const entry = chain[chainIndex]!;
    const index = chainIndex - history.length;
    if (index === target && blockedBySize) selectedTooLarge = true;
    if (entry.outcome === 'failed' && entry.executionPhase === 'settled_without_execution') continue;
    if (entry.sessionId !== entries[0]!.sessionId || entry.source !== 'tool-result' || entry.outcome !== 'applied' || entry.previousPath || entry.contentRestricted) {
      current = undefined;
      recoveredContext = false;
      blockedBySize = false;
      lastGap = chainIndex;
      continue;
    }
    // A successful full write supplies a baseline even for history without turn snapshots.
    // Its submitted content proves the after image, not what was overwritten.
    if (current === undefined && entry.submittedContent !== undefined) {
      current = entry.submittedContent.replace(/\r\n/g, '\n');
      recoveredContext = false;
      blockedBySize = Buffer.byteLength(current) > maxBytes;
      if (!usableText(current, maxBytes)) current = undefined;
      continue;
    }
    // ApplyPatch's confirmed create result contains the complete newly created file.
    if (current === undefined && entry.kind === 'added' && /^@@ -0,0 \+1,\d+ @@/u.test(entry.patch)) current = '';
    if (current === undefined) continue;
    const replacesUnverifiedBefore = recoveredContext &&
      (entry.submittedContent !== undefined || entry.kind === 'deleted' && entry.patch === '');
    let after: string | undefined;
    if (entry.submittedContent !== undefined) after = entry.submittedContent.replace(/\r\n/g, '\n');
    else if (entry.kind === 'deleted' && entry.patch === '') after = '';
    else {
      if (!/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(entry.patch)) {
        current = undefined;
        recoveredContext = false;
        blockedBySize = false;
        lastGap = chainIndex;
        continue;
      }
      try {
        after = applySdkPatch(current, { patch: entry.patch,
          beforePath: entry.kind === 'added' ? null : path,
          afterPath: entry.kind === 'deleted' ? null : path, binary: false });
      } catch {
        if (operationToolName(entry.toolName) === 'applypatch' && entry.kind === 'modified') {
          after = recoverRecordedPatchContext(current, {
            patch: entry.patch, beforePath: path, afterPath: path, binary: false,
          });
          if (after !== undefined) recoveredContext = true;
        }
      }
      if (after === undefined) {
        // A later gap does not erase an already reconstructed earlier edit.
        current = undefined;
        recoveredContext = false;
        blockedBySize = false;
        lastGap = chainIndex;
        continue;
      }
    }
    if (!usableText(after, maxBytes)) {
      blockedBySize = Buffer.byteLength(after) > maxBytes;
      if (index === target && blockedBySize) selectedTooLarge = true;
      current = undefined;
      recoveredContext = false;
      lastGap = chainIndex;
      continue;
    }
    if (replacesUnverifiedBefore) {
      // A full overwrite proves a new baseline, but cannot verify the recovered
      // bytes it replaced through the final turn snapshot.
      recoveredContext = false;
      lastGap = chainIndex;
    }
    if (index === target && !replacesUnverifiedBefore) {
      selected = { index, before: current, after };
      selectedNeedsVerification = recoveredContext;
    }
    current = after;
  }
  if (selected && selectedNeedsVerification && (scope.lifecycle === 'writing' ||
    selected.index + history.length <= lastGap)) return undefined;
  if (selected && selected.index + history.length > lastGap && scope.lifecycle !== 'writing') {
    const expected = savedText(await source.snapshots.readTreeBytes(snapshotScope, path, 'after'), maxBytes);
    // A completed snapshot can disprove the assumed edit chain. A missing
    // snapshot cannot, unless omitted context was recovered and needs proof.
    // A moving worktree is never a historical authority.
    if (selectedNeedsVerification && expected === undefined || expected !== undefined && current !== expected) return undefined;
  }
  return selected ?? (selectedTooLarge ? { index: target, unavailableReason: 'too-large' } : undefined);
}

function selectedOperation(entries: NonNullable<ActiveScope['recordedOperations']>, toolUseId?: string): number {
  if (toolUseId !== undefined) return entries.findIndex(entry => entry.toolUseId === toolUseId);
  for (let index = entries.length - 1; index >= 0; index--) {
    if (entries[index]!.source === 'tool-result' && entries[index]!.outcome === 'applied') return index;
  }
  return -1;
}

function usableText(value: string, maxBytes: number): boolean {
  return Buffer.byteLength(value) <= maxBytes && !isRestrictedToolContent(value);
}

function savedText(value: Buffer | null | undefined, maxBytes: number): string | undefined {
  if (value === undefined || !isText(value)) return undefined;
  const text = value?.toString('utf8').replace(/\r\n/g, '\n') ?? '';
  return usableText(text, maxBytes) ? text : undefined;
}
