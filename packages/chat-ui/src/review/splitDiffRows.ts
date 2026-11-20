import type { InlineDiffLine } from './inlineDiffLines';

export interface DiffRow { left: InlineDiffLine | null; right: InlineDiffLine | null; header?: string }

// A full-file replacement can contain tens of thousands of lines. Limit the
// alignment matrix; larger blocks retain positional pairing instead of
// blocking the webview or allocating a quadratic amount of memory.
const MAX_ALIGNMENT_CELLS = 250_000;
const MAX_COMPARISON_CHARACTERS = 2_000;
const MAX_COMPARISON_WORDS = 128;

function lineWords(line: InlineDiffLine) {
  const counts = new Map<string, number>();
  let length = 0;
  if (line.text.length <= MAX_COMPARISON_CHARACTERS) {
    const words = line.text.match(/[\p{L}\p{N}_$]+/gu) ?? [];
    if (words.length <= MAX_COMPARISON_WORDS) {
      for (const word of words) {
        counts.set(word, (counts.get(word) ?? 0) + 1);
        length += word.length;
      }
    }
  }
  return { counts, length };
}

function similarity(left: ReturnType<typeof lineWords>, right: ReturnType<typeof lineWords>): number {
  let common = 0;
  for (const [word, count] of left.counts)
    common += word.length * Math.min(count, right.counts.get(word) ?? 0);
  // Ignore braces and other short boilerplate as anchors.
  if (common < 8 || common * 2 < (left.length + right.length) * 0.55) return 0;
  return Math.round(1000 * common * 2 / (left.length + right.length));
}

function appendReplacement(rows: DiffRow[], removed: readonly InlineDiffLine[], added: readonly InlineDiffLine[]) {
  const appendRange = (leftStart: number, leftEnd: number, rightStart: number, rightEnd: number) => {
    const count = Math.max(leftEnd - leftStart, rightEnd - rightStart);
    for (let index = 0; index < count; index++) rows.push({
      left: leftStart + index < leftEnd ? removed[leftStart + index]! : null,
      right: rightStart + index < rightEnd ? added[rightStart + index]! : null,
    });
  };
  if (!removed.length || !added.length || removed.length * added.length > MAX_ALIGNMENT_CELLS) {
    appendRange(0, removed.length, 0, added.length);
    return;
  }

  const leftWords = removed.map(lineWords), rightWords = added.map(lineWords);
  const width = added.length + 1;
  const scores = new Uint32Array((removed.length + 1) * width);
  const pairScores = new Uint16Array(removed.length * added.length);
  for (let left = removed.length - 1; left >= 0; left--) {
    for (let right = added.length - 1; right >= 0; right--) {
      const score = similarity(leftWords[left]!, rightWords[right]!);
      pairScores[left * added.length + right] = score;
      scores[left * width + right] = Math.max(
        scores[(left + 1) * width + right]!,
        scores[left * width + right + 1]!,
        score ? score + scores[(left + 1) * width + right + 1]! : 0,
      );
    }
  }
  let left = 0, right = 0, leftStart = 0, rightStart = 0;
  while (left < removed.length && right < added.length) {
    const score = pairScores[left * added.length + right]!;
    if (score && scores[left * width + right] === score + scores[(left + 1) * width + right + 1]!) {
      appendRange(leftStart, left, rightStart, right);
      rows.push({ left: removed[left]!, right: added[right]! });
      leftStart = ++left;
      rightStart = ++right;
    } else if (scores[(left + 1) * width + right]! > scores[left * width + right + 1]!) left++;
    else right++;
  }
  appendRange(leftStart, removed.length, rightStart, added.length);
}

export function splitDiffRows(lines: readonly InlineDiffLine[]): DiffRow[] {
  const rows: DiffRow[] = [];
  for (let i = 0; i < lines.length;) {
    const line = lines[i]!;
    if (line.kind === 'remove' || line.kind === 'add') {
      const removed: InlineDiffLine[] = [];
      const added: InlineDiffLine[] = [];
      while (lines[i]?.kind === 'remove') removed.push(lines[i++]!);
      while (lines[i]?.kind === 'add') added.push(lines[i++]!);
      appendReplacement(rows, removed, added);
    } else {
      rows.push(line.kind === 'hunk' || line.kind === 'note'
        ? { left: null, right: null, header: line.text }
        : { left: line, right: line });
      i++;
    }
  }
  return rows;
}
