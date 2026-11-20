/** Keep context close to the edit/definition, preserving complete lines when possible. */
export function contextExcerpt(text: string, line: number, budget: number, endLine = line + 24): string {
  if (budget <= 0 || text.includes('\0')) return '';
  const lines = text.split(/\r?\n/);
  const first = Math.max(0, Math.min(lines.length - 1, line) - 4);
  const last = Math.min(lines.length, Math.max(first + 1, endLine + 5), first + 80);
  return lines.slice(first, last).join('\n').slice(0, budget);
}
