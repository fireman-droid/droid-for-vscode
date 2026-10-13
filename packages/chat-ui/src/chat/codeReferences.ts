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

export function parseCodeReferences(value: string): { references: CodeReference[]; body: string } {
  const references: CodeReference[] = [];
  let body = value;
  while (body.startsWith('```')) {
    const header = /^(`{3,})code-reference ([^\n]+)\n/.exec(body);
    if (!header) break;
    const closing = new RegExp(`\\n${header[1]}(?:\\n\\n|$)`, 'g');
    closing.lastIndex = header[0].length;
    const match = closing.exec(body);
    const end = match?.index ?? -1;
    if (end < 0) break;
    let reference: CodeReference | null;
    try { reference = readCodeReference({ ...JSON.parse(header[2]!), text: body.slice(header[0].length, end) }); }
    catch { break; }
    if (!reference) break;
    references.push(reference);
    body = body.slice(end + match![0].length);
  }
  return { references, body };
}

export function editorCopyMarkers(data: string): string[] {
  try {
    const types: unknown = JSON.parse(data).providerCopyMimeTypes;
    return Array.isArray(types) ? types.filter((type): type is string => typeof type === 'string' && /^application\/vnd\.droid\.copy\.[a-f0-9-]{36}$/.test(type)).slice(0, 8) : [];
  } catch { return []; }
}
