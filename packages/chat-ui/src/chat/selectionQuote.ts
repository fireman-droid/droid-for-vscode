export interface SelectionQuote {
  readonly quote: string;
  readonly body: string;
}

export interface SelectionQuotes {
  readonly quotes: readonly string[];
  readonly body: string;
}

/** Keep the editable body verbatim; each selected passage is a separate block. */
export function formatSelectionQuotes(quotes: readonly string[], body: string): string {
  const blocks = quotes.filter((quote) => quote.trim().length > 0)
    .map((quote) => quote.split(/\r?\n/).map((line) => `> ${line}`).join('\n'));
  return blocks.length === 0 ? body : `${blocks.join('\n\n')}\n\n${body}`;
}

/** Reads both existing single quotes and multiple leading quoted passages. */
export function parseSelectionQuotes(text: string): SelectionQuotes | null {
  if (!text.startsWith('>')) return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const quotes: string[] = [];
  let index = 0;
  while (lines[index]?.startsWith('>')) {
    const passage: string[] = [];
    while (lines[index]?.startsWith('>')) passage.push(lines[index++].replace(/^>\s?/, ''));
    const quote = passage.join('\n');
    if (!quote.trim()) break;
    quotes.push(quote);
    if (lines[index] === '') index += 1;
  }
  return quotes.length === 0 ? null : { quotes, body: lines.slice(index).join('\n') };
}

/** Append a whole passage or leave the current draft untouched at its limit. */
export function appendSelectionQuote(text: string, quote: string, maxLength: number): string | null {
  if (!quote.trim()) return text;
  const parsed = parseSelectionQuotes(text);
  const next = formatSelectionQuotes([...(parsed?.quotes ?? []), quote], parsed?.body ?? text);
  return next.length <= maxLength ? next : null;
}

export function fitSelectionQuote(quote: string, maxFormattedLength: number): string {
  const lines = quote.trim().split(/\r?\n/);
  const fitted: string[] = [];
  let used = 0;
  for (const line of lines) {
    const separatorLength = fitted.length === 0 ? 0 : 1;
    const available = maxFormattedLength - used - separatorLength - 2;
    if (available < 0) {
      break;
    }
    const next = line.slice(0, available);
    fitted.push(next);
    used += separatorLength + 2 + next.length;
    if (next.length < line.length) {
      break;
    }
  }
  return fitted.join('\n').trim();
}

export function formatSelectionQuote(quote: string, body: string): string {
  const normalizedQuote = quote.trim();
  const normalizedBody = body.trim();
  if (normalizedQuote.length === 0) {
    return normalizedBody;
  }
  const quoted = normalizedQuote
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join('\n');
  return normalizedBody.length === 0 ? quoted : `${quoted}\n\n${normalizedBody}`;
}

export function parseSelectionQuote(text: string): SelectionQuote | null {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  if (!lines[0]?.startsWith('>')) {
    return null;
  }
  const quoteLines: string[] = [];
  let bodyIndex = 0;
  while (bodyIndex < lines.length && lines[bodyIndex]?.startsWith('>')) {
    quoteLines.push(lines[bodyIndex]?.replace(/^>\s?/, '') ?? '');
    bodyIndex += 1;
  }
  if (lines[bodyIndex] === '') {
    bodyIndex += 1;
  }
  const quote = quoteLines.join('\n').trim();
  if (quote.length === 0) {
    return null;
  }
  return {
    quote,
    body: lines.slice(bodyIndex).join('\n').trimStart(),
  };
}
