/** Portable code snapshots. The stored draft is also the complete model input. */
export interface CodeReference {
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  readonly text: string;
  readonly side?: 'before' | 'after';
}
export const CODE_REFERENCE_MIME = 'application/vnd.droid.code-reference';
export const EDITOR_COPY_MIME = 'application/vnd.code.copymetadata';
export const CODE_REFERENCE_LIMIT = 256_000;

export function readCodeReference(value: unknown): CodeReference | null {
  if (!value || typeof value !== 'object') return null;
  const ref = value as CodeReference;
  return typeof ref.path === 'string' && ref.path.length > 0 && ref.path.length <= 4096 && !/[\r\n\0]/.test(ref.path) &&
    Number.isSafeInteger(ref.startLine) && ref.startLine > 0 && Number.isSafeInteger(ref.endLine) && ref.endLine >= ref.startLine && ref.endLine <= 10_000_000 &&
    typeof ref.text === 'string' && ref.text.length > 0 && ref.text.length <= CODE_REFERENCE_LIMIT &&
    (ref.side === undefined || ref.side === 'before' || ref.side === 'after')
    ? { path: ref.path, startLine: ref.startLine, endLine: ref.endLine, text: ref.text, ...(ref.side ? { side: ref.side } : {}) } : null;
}

export function decodeCodeReference(json: string): CodeReference | null {
  if (json.length > CODE_REFERENCE_LIMIT * 6 + 8192) return null;
  try { return readCodeReference(JSON.parse(json)); } catch { return null; }
}

export function formatCodeReferences(references: readonly CodeReference[], body: string): string {
  return references.map(({ text, ...location }) => {
    let longest = 2;
    for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
    const fence = '`'.repeat(longest + 1);
    return `${fence}code-reference ${JSON.stringify(location)}\n${text}\n${fence}\n\n`;
  }).join('') + body;
}

export function parseCodeReferences(value: string): { references: CodeReference[]; body: string; inline: string; tokens: string[] } {
  const references: CodeReference[] = [];
  const tokens: string[] = [];
  let body = '', inline = '', offset = 0, symbol = 0xe000;
  const headers = /(`{3,})code-reference ([^\n]+)\n/g;
  for (let header; (header = headers.exec(value));) {
    const closing = new RegExp(`\\n${header[1]}(?:\\n\\n|$)`, 'g');
    closing.lastIndex = headers.lastIndex;
    const match = closing.exec(value);
    if (!match) continue;
    let reference: CodeReference | null = null;
    try { reference = readCodeReference({ ...JSON.parse(header[2]!), text: value.slice(headers.lastIndex, match.index) }); }
    catch { continue; }
    if (!reference) continue;
    while (value.includes(String.fromCharCode(symbol))) symbol++;
    if (symbol > 0xf8ff) break;
    const token = String.fromCharCode(symbol++);
    const text = value.slice(offset, header.index);
    body += text; inline += text + token;
    references.push(reference); tokens.push(token);
    offset = match.index + match[0].length;
    headers.lastIndex = offset;
  }
  return { references, tokens, body: body + value.slice(offset), inline: inline + value.slice(offset) };
}

/** Expand atoms in place; the saved/model-facing draft always contains the complete snapshots. */
export function formatInlineCodeReferences(inline: string, references: readonly CodeReference[], tokens: readonly string[]): string {
  const byToken = new Map(tokens.map((token, index) => [token, references[index]!]));
  return Array.from(inline, character => byToken.has(character) ? formatCodeReferences([byToken.get(character)!], '') : character).join('');
}

export function editorCopyMarkers(data: string): string[] {
  try {
    const types: unknown = JSON.parse(data).providerCopyMimeTypes;
    return Array.isArray(types) ? types.filter((type): type is string => typeof type === 'string' && /^application\/vnd\.droid\.copy\.[a-f0-9-]{36}$/.test(type)).slice(0, 8) : [];
  } catch { return []; }
}
