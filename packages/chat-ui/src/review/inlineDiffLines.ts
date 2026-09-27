export interface InlineDiffLine {
  readonly kind: 'hunk' | 'context' | 'add' | 'remove' | 'note';
  readonly text: string;
  readonly before: number | null;
  readonly after: number | null;
}

/** Human-readable locations for a hunk; counts include unchanged context. */
export function formatDiffHunkHeader(text: string): string {
  const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(text);
  if (!match) return text;
  const range = (startText: string, countText: string | undefined) => {
    const start = Number(startText);
    const count = countText === undefined ? 1 : Number(countText);
    return count === 0 ? '无对应行' : count === 1 ? `${start} 行` : `${start}–${start + count - 1} 行`;
  };
  const context = match[5]!.trim();
  return `修改前 ${range(match[1]!, match[2])} → 修改后 ${range(match[3]!, match[4])}${context ? ` · ${context}` : ''}`;
}

/** Parses Git's unified hunk body, preserving code that itself starts with + or -. */
export function inlineDiffLines(patch: string): readonly InlineDiffLine[] {
  const lines: InlineDiffLine[] = [];
  let before: number | null = null;
  let after: number | null = null;
  for (const line of patch.split('\n')) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      before = Number(hunk[1]);
      after = Number(hunk[2]);
      lines.push({ kind: 'hunk', text: line, before: null, after: null });
    } else if (line === '@@') {
      before = null;
      after = null;
      lines.push({ kind: 'hunk', text: 'Change excerpt · absolute line positions not recorded', before: null, after: null });
    } else if (line.startsWith('+')) {
      lines.push({ kind: 'add', text: line.slice(1), before: null, after });
      if (after !== null) after += 1;
    } else if (line.startsWith('-')) {
      lines.push({ kind: 'remove', text: line.slice(1), before, after: null });
      if (before !== null) before += 1;
    } else if (line.startsWith(' ')) {
      lines.push({ kind: 'context', text: line.slice(1), before, after });
      if (before !== null) before += 1;
      if (after !== null) after += 1;
    } else if (line.startsWith('\\')) {
      lines.push({ kind: 'note', text: line, before: null, after: null });
    }
  }
  return lines;
}
