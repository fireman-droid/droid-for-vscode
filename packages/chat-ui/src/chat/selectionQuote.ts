export interface SelectionQuote {
  readonly quote: string;
  readonly body: string;
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
