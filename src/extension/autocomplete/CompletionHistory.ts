/*! Adapted from Kilo Code 54de37a85dfef8feb828382d8a71f84139857121
 * (classic-auto-complete/AutocompleteInlineCompletionProvider.ts: updateSuggestions).
 * MIT; see third-party/KILO-LICENSE.txt.
 */
import { applyFirstLineOnly, findMatchingSuggestion } from './kilo/inline-utils';
import type { FillInAtCursorSuggestion } from './kilo/types';

const MAX_SUGGESTIONS_HISTORY = 20;

export class CompletionHistory {
  private entries: FillInAtCursorSuggestion[] = [];

  find(scope: string, prefix: string, suffix: string) {
    return applyFirstLineOnly(findMatchingSuggestion(scope, prefix, suffix, this.entries), prefix);
  }

  put(fillInAtCursor: FillInAtCursorSuggestion): void {
    const isDuplicate = this.entries.some(existing =>
      existing.scope === fillInAtCursor.scope && existing.text === fillInAtCursor.text &&
      existing.prefix === fillInAtCursor.prefix && existing.suffix === fillInAtCursor.suffix);
    if (isDuplicate) return;
    this.entries.push(fillInAtCursor);
    if (this.entries.length > MAX_SUGGESTIONS_HISTORY) this.entries.shift();
  }

  clear(): void { this.entries = []; }
}
