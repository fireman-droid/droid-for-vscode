/** Keep context close to the edit/definition, preserving complete lines when possible. */
export function contextExcerpt(text: string, line: number, budget: number, endLine = line + 24): string {
  if (budget <= 0 || text.includes('\0')) return '';
  const lines = text.split(/\r?\n/);
  const first = Math.max(0, Math.min(lines.length - 1, line) - 4);
  const last = Math.min(lines.length, Math.max(first + 1, endLine + 5), first + 80);
  return lines.slice(first, last).join('\n').slice(0, budget);
}

/** A recently viewed window keeps the viewed line and never sends partial lines. */
export function recentlyViewedExcerpt(text: string, line: number, budget: number): string {
  if (budget <= 0 || text.includes('\0')) return '';
  const lines = text.split(/\r?\n/);
  const center = Math.max(0, Math.min(lines.length - 1, line));
  let start = Math.max(0, Math.min(center - 10, lines.length - 20));
  let end = Math.min(lines.length, start + 20);
  let length = lines.slice(start, end).join('\n').length;
  while (length > budget && end - start > 1) {
    if (center - start >= end - 1 - center) length -= lines[start++].length + 1;
    else length -= lines[--end].length + 1;
  }
  return length <= budget ? lines.slice(start, end).join('\n') : '';
}
