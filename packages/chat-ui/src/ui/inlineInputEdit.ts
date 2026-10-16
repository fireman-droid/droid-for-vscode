/** Limit the inserted part of an edit, never the unchanged text after the caret. */
export function limitInlineEdit(previous: string, next: string, cursor: number, limit: number, measure = (text: string) => text.length) {
  if (measure(next) <= limit) return { value: next, cursor };
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) start++;
  // Keep surrogate pairs together when the differing character shares a high surrogate.
  if (start > 0 && /[\uDC00-\uDFFF]/.test(next[start] ?? '')) start--;
  let end = previous.length, nextEnd = next.length;
  while (end > start && nextEnd > start && previous[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
  if (nextEnd < next.length && /[\uDC00-\uDFFF]/.test(next[nextEnd] ?? '')) { end++; nextEnd++; }
  const before = next.slice(0, start), after = next.slice(nextEnd);
  const inserted = next.slice(start, nextEnd);
  let low = 0, high = inserted.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(before + inserted.slice(0, middle) + after) <= limit) low = middle;
    else high = middle - 1;
  }
  if (low > 0 && /[\uDC00-\uDFFF]/.test(inserted[low] ?? '')) low--;
  return {
    value: before + inserted.slice(0, low) + after,
    cursor: cursor > nextEnd ? cursor - inserted.length + low : Math.min(cursor, start + low),
  };
}
