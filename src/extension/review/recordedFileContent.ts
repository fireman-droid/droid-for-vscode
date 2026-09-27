import type { ReviewRecordedContent } from '../../shared/protocol/reviewPanelProtocol';
import type { ActiveScope } from './reviewCoordinatorSupport';
import { applySdkPatch } from './reviewSdkPatch';

/** A recorded version, never a claim about the current working-copy bytes. */
export function recordedFileContent(
  entries: NonNullable<ActiveScope['recordedOperations']>,
): ReviewRecordedContent | undefined {
  // Separate agent sessions have no reliable shared edit order.
  if (new Set(entries.map((entry) => entry.sessionId)).size !== 1) return undefined;
  let start = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]!;
    if (entry.source === 'tool-result' && entry.outcome === 'applied' && entry.submittedContent !== undefined) {
      start = index;
      break;
    }
  }
  if (start < 0) return undefined;
  const source = entries[start]!;
  let content = source.submittedContent!.replace(/\r\n/g, '\n');
  let appliedEdits = 0;
  let remainingOperations = 0;
  for (let index = start + 1; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.outcome === 'failed') continue;
    if (remainingOperations > 0 || entry.source !== 'tool-result' || entry.outcome !== 'applied' ||
      entry.kind !== 'modified' || entry.previousPath ||
      (entry.reversible !== true && entry.toolName.toLowerCase() !== 'edit') ||
      !/^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/m.test(entry.patch)) {
      remainingOperations += 1;
      continue;
    }
    try {
      const next = applySdkPatch(content, {
        patch: entry.patch, beforePath: entry.path, afterPath: entry.path, binary: false,
      });
      if (next.length > 512_000) { remainingOperations += 1; continue; }
      content = next;
      appliedEdits += 1;
    } catch {
      // Exact context no longer matches this saved version; retain it as a partial view.
      remainingOperations += 1;
    }
  }
  return { content, sourceToolUseId: source.toolUseId, appliedEdits, remainingOperations };
}
