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

/** Keep code unchanged; undefined rejects ambiguous model formatting instead of repairing it. */
export function prepareCompletion(
  text: string, prefix: string, suffix: string, languageId: string, model?: string,
): string | undefined {
  if (!text.trim() || suffix.startsWith(text)) return '';
  const allowsFences = ['markdown', 'mdx', 'plaintext'].includes(languageId);
  // Without lexical state an isolated fence may be model markup or legitimate string/comment
  // content. Suppress the whole code suggestion rather than guessing and deleting its lines.
  if (!allowsFences && /^[ \t]*`{3,}/m.test(text)) return undefined;
  // The provider supplies the model to enable Kilo's model/language-aware pipeline.
  if (!model) return text;
  const eol = text.includes('\r\n') || prefix.includes('\r\n') ? '\r\n' : '\n';
  const processed = postprocessAutocompleteSuggestion({ suggestion: text.replace(/\r\n/g, '\n'),
    prefix: prefix.replace(/\r\n/g, '\n'), suffix: suffix.replace(/\r\n/g, '\n'), languageId, model });
  return (processed ?? '').replace(/\n/g, eol);
}

export type CachedCompletion = {
  uri: string;
  prefix: string;
  suffix: string;
  text: string;
  createdAt: number;
};

/** Reuse only a suggestion from this exact context, or the remainder after typing it. */
export function reuseCompletion(
  cache: CachedCompletion | undefined,
  uri: string,
  prefix: string,
  suffix: string,
  now: number,
): string | undefined {
  if (!cache || cache.uri !== uri || cache.suffix !== suffix
    || now < cache.createdAt || now - cache.createdAt > 30_000
    || !prefix.startsWith(cache.prefix)) return undefined;
  const typed = prefix.slice(cache.prefix.length);
  if (!cache.text.startsWith(typed)) return undefined;
  const remainder = cache.text.slice(typed.length);
  return remainder;
}
