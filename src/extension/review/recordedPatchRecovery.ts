import { applySdkPatch, type ReviewSdkPatch } from './reviewSdkPatch';

/**
 * ApplyPatch can trim the last hunk's blank context lines from its result.
 * Recover only those exact lines from the saved before image. The caller must
 * still verify the complete operation chain against a saved after image.
 */
export function recoverRecordedPatchContext(before: string, entry: ReviewSdkPatch): string | undefined {
  if (entry.binary || entry.beforePath === null || entry.afterPath === null) return undefined;
  const lines = entry.patch.split('\n');
  if (lines.at(-1) === '') lines.pop();
  let lastHunk = -1;
  for (let index = 0; index < lines.length; index++) {
    if (lines[index]!.startsWith('@@')) lastHunk = index;
  }
  if (lastHunk < 0) return undefined;
  const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/.exec(lines[lastHunk]!);
  if (!header) return undefined;
  const oldStart = Number(header[1]);
  const oldExpected = Number(header[2] ?? 1);
  const newExpected = Number(header[4] ?? 1);
  if (![oldStart, oldExpected, newExpected].every(Number.isSafeInteger) || oldStart < 1) return undefined;
  let oldCount = 0;
  let newCount = 0;
  for (const line of lines.slice(lastHunk + 1)) {
    if (![' ', '-', '+'].includes(line[0]!)) return undefined;
    if (line[0] !== '+') oldCount++;
    if (line[0] !== '-') newCount++;
  }
  const missing = oldExpected - oldCount;
  if (missing <= 0 || missing !== newExpected - newCount) return undefined;
  const original = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const start = oldStart - 1 + oldCount;
  if (start + missing > original.length) return undefined;
  for (const line of original.slice(start, start + missing)) {
    if (!/^[\t ]*\n?$/.test(line)) return undefined;
    lines.push(` ${line.replace(/\n$/, '')}`);
    if (!line.endsWith('\n')) lines.push('\\ No newline at end of file');
  }
  try {
    // This also verifies every original context/removal line and all earlier hunks.
    return applySdkPatch(before, { ...entry, patch: lines.join('\n') });
  } catch {
    return undefined;
  }
}
