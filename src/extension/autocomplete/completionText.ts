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

/** Keep model-provided whitespace: it is part of the insertion, including indentation. */
export function prepareCompletion(text: string, _prefix: string, suffix: string): string {
  const fenced = /^```[a-zA-Z0-9_+.-]*[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*(?:\r?\n)?$/.exec(text);
  const completion = fenced ? fenced[1] : text;
  if (!completion.trim() || suffix.startsWith(completion)) return '';
  // Partial overlap (especially braces) can be valid nested code, so leave it intact.
  return completion;
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
