import { findMatchingSuggestion } from './kilo/inline-utils';
import type { FillInAtCursorSuggestion } from './kilo/types';
type Entry = FillInAtCursorSuggestion & { createdAt: number };
/** Kilo's 20-entry history matching, with Droid's expiry and memory budget. */
export class CompletionHistory {
  private entries: Entry[] = [];
  find(scope: string, prefix: string, suffix: string, now = Date.now()): string | undefined {
    this.entries = this.entries.filter(e => now >= e.createdAt && now - e.createdAt <= 30_000);
    return findMatchingSuggestion(scope, prefix, suffix, this.entries)?.text;
  }
  put(scope: string, prefix: string, suffix: string, text: string, now = Date.now()): void {
    this.entries = this.entries.filter(e => !(e.scope === scope && e.prefix === prefix && e.suffix === suffix));
    this.entries.push({ scope, prefix, suffix, text, createdAt: now });
    let size = this.entries.reduce((n, e) => n + e.prefix.length + e.suffix.length + e.text.length, 0);
    while (this.entries.length > 20 || size > 2_097_152) {
      const e = this.entries.shift()!;
      size -= e.prefix.length + e.suffix.length + e.text.length;
    }
  }
  clear(): void { this.entries = []; }
}
