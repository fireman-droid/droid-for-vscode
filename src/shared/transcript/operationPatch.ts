interface RecordedPatch {
  readonly patch: string;
  readonly complete: boolean;
  readonly correctedPatch?: string;
}

/** Recount omitted final context only when the result confirms every submitted edit. */
export function normalizeOperationResultPatch(source: string, submittedPatch?: string): RecordedPatch | undefined {
  const result = readRecordedPatch(source);
  if (result?.correctedPatch !== undefined && submittedPatch !== undefined &&
    sameChangedLines(result.patch, submittedPatch)) {
    return { patch: result.correctedPatch, complete: true };
  }
  return result === undefined ? undefined : { patch: result.patch, complete: result.complete };
}

/** History may upgrade the count metadata, but never replace already recorded lines. */
export function isOperationPatchCountCorrection(saved: string, incoming: string): boolean {
  return saved !== incoming && readRecordedPatch(saved)?.correctedPatch === incoming;
}

function sameChangedLines(result: string, submitted: string): boolean {
  const resultLines = result.split('\n');
  const submittedLines = submitted.split('\n');
  let changed = false;
  for (const prefix of ['-', '+']) {
    const actual = resultLines.filter(line => line.startsWith(prefix));
    const expected = submittedLines.filter(line => line.startsWith(prefix));
    if (actual.length !== expected.length || actual.some((line, index) => line !== expected[index])) return false;
    changed ||= actual.length > 0;
  }
  return changed;
}

function readRecordedPatch(source: string): RecordedPatch | undefined {
  const lines = source.replace(/\r\n?/gu, '\n').split('\n');
  const hunks: string[] = [];
  let complete = true;
  let correctedPatch: string | undefined;
  let newlineBoundary = false;
  let index = 0;
  while (index < lines.length && !lines[index]!.startsWith('@@')) index += 1;
  while (index < lines.length) {
    const header = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u.exec(lines[index]!);
    if (!header) return undefined;
    const oldStart = Number(header[1]);
    const newStart = Number(header[3]);
    const oldExpected = Number(header[2] ?? 1);
    const newExpected = Number(header[4] ?? 1);
    if (![oldStart, newStart, oldExpected, newExpected].every(Number.isSafeInteger)) return undefined;
    let oldCount = 0;
    let newCount = 0;
    const headerIndex = hunks.length;
    hunks.push(lines[index++]!);
    while (index < lines.length && !lines[index]!.startsWith('@@')) {
      const line = lines[index]!;
      if (line === '' && index === lines.length - 1) {
        index += 1;
        break;
      }
      if (line.startsWith('\\ No newline at end of file')) {
        newlineBoundary = true;
      } else if (line.startsWith(' ')) {
        oldCount += 1;
        newCount += 1;
      } else if (line.startsWith('-')) {
        oldCount += 1;
      } else if (line.startsWith('+')) {
        newCount += 1;
      } else return undefined;
      hunks.push(line);
      index += 1;
    }
    if (oldCount !== oldExpected || newCount !== newExpected) {
      // Equal deficits can be omitted context or a lost replacement. The caller
      // must corroborate all additions/removals before accepting this candidate.
      const missing = oldExpected - oldCount;
      if (complete && !newlineBoundary && index === lines.length && oldStart > 0 && newStart > 0 &&
        oldCount > 0 && newCount > 0 && missing > 0 && missing === newExpected - newCount) {
        const corrected = [...hunks];
        corrected[headerIndex] = corrected[headerIndex]!.replace(
          /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/u,
          `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
        );
        correctedPatch = corrected.join('\n');
      }
      complete = false;
    }
  }
  return hunks.length > 0 ? { patch: hunks.join('\n'), complete, correctedPatch } : undefined;
}
