import { postprocessAutocompleteSuggestion } from './kilo/classic-auto-complete/uselessSuggestionFilter';

/** A UTF-16 character budget matching VS Code document offsets. */
export function buildCompletionContext(
  text: string,
  offset: number,
  maxContextCharacters: number,
): { prefix: string; suffix: string } {
  const cursor = Math.min(text.length, Math.max(0, Math.trunc(offset)));
  const budget = Math.max(0, Math.trunc(maxContextCharacters));
  let prefixLength = Math.min(cursor, Math.ceil(budget * 0.75));
  const suffixLength = Math.min(text.length - cursor, budget - prefixLength);
  prefixLength = Math.min(cursor, budget - suffixLength);

  let start = cursor - prefixLength;
  let end = cursor + suffixLength;
  // Only move the truncation edges; the cursor remains exactly where the editor put it.
  if (start < cursor && splitsPair(text, start)) start += 1;
  if (end > cursor && splitsPair(text, end)) end -= 1;
  return { prefix: text.slice(start, cursor), suffix: text.slice(cursor, end) };
}

function splitsPair(text: string, offset: number): boolean {
  if (offset <= 0 || offset >= text.length) return false;
  const before = text.charCodeAt(offset - 1);
  const after = text.charCodeAt(offset);
  return (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff)
    || (before === 13 && after === 10);
}

export type CompletionPreparationResult = {
  text: string;
  outcome: 'suggestion-returned' | 'empty' | 'already-present' | 'repetition-filtered';
};

export function prepareCompletion(
  text: string, prefix: string, suffix: string, languageId: string, model = '',
): string {
  return prepareCompletionWithOutcome(text, prefix, suffix, languageId, model).text;
}

/** Normalize document line endings around the pinned Kilo filters, without adding another filter. */
export function prepareCompletionWithOutcome(
  text: string, prefix: string, suffix: string, languageId: string, model = '',
): CompletionPreparationResult {
  const fromCRLF = (input: string) => input.replace(/\r\n/g, '\n');
  const suggestion = postprocessAutocompleteSuggestion({
    suggestion: fromCRLF(text), prefix: fromCRLF(prefix), suffix: fromCRLF(suffix), languageId, model,
  });
  if (!suggestion) {
    const trimmed = fromCRLF(text).trim();
    return { text: '', outcome: !trimmed ? 'empty'
      : fromCRLF(suffix).trimStart().startsWith(trimmed) ? 'already-present' : 'repetition-filtered' };
  }
  const useCRLF = prefix.includes('\r\n') || suffix.includes('\r\n') || text.includes('\r\n');
  return { text: useCRLF ? suggestion.replace(/\n/g, '\r\n') : suggestion, outcome: 'suggestion-returned' };
}
