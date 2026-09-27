import type { RootContent } from 'hast';

export interface ParsedMarkdown {
  readonly text: string;
  readonly thinking: boolean;
  readonly nodes: readonly RootContent[];
}

// Reuse recently viewed long replies after virtual row eviction. Keep only
// the latest prefix of a stream, with bounded retention in this webview.
const MAX_ENTRIES = 24;
const MAX_TEXT_LENGTH = 1_048_576;
const entries = new Set<ParsedMarkdown>();
let textLength = 0;
export const mountedMarkdownCounts = new WeakMap<readonly RootContent[], number>();

export function recallMarkdown(text: string, thinking: boolean): ParsedMarkdown | null {
  let match: ParsedMarkdown | null = null;
  for (const entry of entries) {
    if (entry.thinking === thinking && text.startsWith(entry.text)
      && (!match || entry.text.length > match.text.length)) match = entry;
  }
  if (match) { entries.delete(match); entries.add(match); }
  return match;
}

export function retainMarkdown(value: ParsedMarkdown): void {
  if (!value.text.length || value.text.length > MAX_TEXT_LENGTH) return;
  for (const entry of entries) {
    if (entry.thinking === value.thinking && value.text.startsWith(entry.text)) {
      entries.delete(entry);
      textLength -= entry.text.length;
    }
  }
  entries.add(value);
  textLength += value.text.length;
  while (entries.size > MAX_ENTRIES || textLength > MAX_TEXT_LENGTH) {
    const oldest = entries.values().next().value!;
    entries.delete(oldest);
    textLength -= oldest.text.length;
  }
}
