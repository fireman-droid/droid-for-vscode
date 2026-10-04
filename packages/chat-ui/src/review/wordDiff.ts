import type { InlineDiffLine } from './inlineDiffLines';

export interface WordRange { readonly start: number; readonly end: number }
interface WordToken extends WordRange { readonly text: string }
interface WordChanges { readonly before: readonly WordRange[]; readonly after: readonly WordRange[] }
type ReadWordRanges = () => readonly WordRange[] | undefined;

// Bound work per visible replacement pair. Long/generated lines retain their
// existing whole-line diff instead of attempting expensive intraline matching.
const MAX_LINE_CHARACTERS = 2_000;
const MAX_LINE_TOKENS = 128;

function tokens(text: string): WordToken[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}\p{M}_$]+|\s+|[^\s]/gu), (match) => ({
    text: match[0], start: match.index, end: match.index + match[0].length,
  }));
}

function changedRanges(words: readonly WordToken[], unchanged: ReadonlySet<number>): WordRange[] {
  const ranges: WordRange[] = [];
  for (let index = 0; index < words.length; index++) {
    if (unchanged.has(index)) continue;
    const word = words[index]!;
    const last = ranges[ranges.length - 1];
    if (last?.end === word.start) ranges[ranges.length - 1] = { start: last.start, end: word.end };
    else ranges.push({ start: word.start, end: word.end });
  }
  return ranges;
}

function compareWords(before: string, after: string): WordChanges | null {
  if (!before || !after || before === after || before.length > MAX_LINE_CHARACTERS || after.length > MAX_LINE_CHARACTERS) return null;
  const left = tokens(before), right = tokens(after);
  if (left.length > MAX_LINE_TOKENS || right.length > MAX_LINE_TOKENS) return null;
  // At most 129 * 129 entries, independent of the file or change-block size.
  // Identifiers stay whole; no character matching that fragments renamed names.
  const width = right.length + 1;
  const lengths = new Uint16Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--)
      lengths[i * width + j] = left[i]!.text === right[j]!.text
        ? 1 + lengths[(i + 1) * width + j + 1]!
        : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!);
  }
  const keptLeft = new Set<number>(), keptRight = new Set<number>();
  let i = 0, j = 0;
  while (i < left.length && j < right.length) {
    if (left[i]!.text === right[j]!.text) { keptLeft.add(i++); keptRight.add(j++); }
    else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) i++;
    else j++;
  }
  return { before: changedRanges(left, keptLeft), after: changedRanges(right, keptRight) };
}

/** Use the same ordered removal/addition pairs in both layouts. Comparisons are
 * lazy: offscreen chunks and pure additions/deletions do no word-diff work. */
export function wordDiffRanges(lines: readonly InlineDiffLine[]): ReadonlyMap<InlineDiffLine, ReadWordRanges> {
  const result = new Map<InlineDiffLine, ReadWordRanges>();
  for (let index = 0; index < lines.length;) {
    if (lines[index]!.kind !== 'remove') { index++; continue; }
    const start = index;
    while (lines[index]?.kind === 'remove') index++;
    const middle = index;
    while (lines[index]?.kind === 'add') index++;
    const count = Math.min(middle - start, index - middle);
    for (let pair = 0; pair < count; pair++) {
      const before = lines[start + pair]!, after = lines[middle + pair]!;
      // The visible Code component memoizes its own ranges. Do not retain every
      // computed pair as a user scrolls through a large, mostly replaced file.
      result.set(before, () => compareWords(before.text, after.text)?.before);
      result.set(after, () => compareWords(before.text, after.text)?.after);
    }
  }
  return result;
}

/** Decorate only text emitted by highlight.js. Close each marker before a syntax
 * tag so its nesting stays valid; entities count as their original characters. */
export function emphasizeWordRanges(html: string, ranges: readonly WordRange[]): string {
  let offset = 0, range = 0, marked = false;
  const output: string[] = [];
  for (const part of html.match(/<[^>]*>|&(?:#x[\da-f]+|#\d+|[a-z]+);|[^<&]|[<&]/giu) ?? []) {
    if (part.startsWith('<')) {
      if (marked) { output.push('</span>'); marked = false; }
      output.push(part);
      continue;
    }
    while (ranges[range] && ranges[range]!.end <= offset) range++;
    const changed = !!ranges[range] && ranges[range]!.start <= offset;
    if (changed !== marked) {
      output.push(changed ? '<span class="diff-word-change">' : '</span>');
      marked = changed;
    }
    output.push(part);
    // highlight.js uses named ASCII entities (and &#x27;) for source escaping.
    // Numeric non-BMP entities remain correct if a grammar emits one.
    const codepoint = part.startsWith('&#') ? Number.parseInt(part.slice(part[2]?.toLowerCase() === 'x' ? 3 : 2), part[2]?.toLowerCase() === 'x' ? 16 : 10) : 0;
    offset += part.startsWith('&') ? codepoint > 0xffff ? 2 : 1 : part.length;
  }
  if (marked) output.push('</span>');
  return output.join('');
}

export function escapeDiffText(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' })[character]!);
}
