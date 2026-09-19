import { isSafeWorkspaceRelativePath } from '../../shared/validation/guards';

export interface ReviewSdkPatch {
  readonly patch: string;
  readonly beforePath: string | null;
  readonly afterPath: string | null;
  readonly binary: boolean;
}

/** Git quotes non-ASCII path bytes using C-style octal escapes. */
function gitPath(value: string): string {
  if (!value.startsWith('"')) return value.split('\t')[0]!;
  if (!value.endsWith('"')) throw new Error('Invalid SDK Diff path.');
  const bytes: number[] = [];
  const text = value.slice(1, -1);
  const escapes: Record<string, string> = { a: '\x07', b: '\b', t: '\t', n: '\n', v: '\v', f: '\f', r: '\r', '\\': '\\', '"': '"' };
  for (let index = 0; index < text.length;) {
    if (text[index] === '\\') {
      const octal = /^[0-7]{1,3}/.exec(text.slice(index + 1));
      if (octal) { bytes.push(Number.parseInt(octal[0], 8)); index += octal[0].length + 1; continue; }
      const escaped = escapes[text[index + 1]!];
      if (escaped === undefined) throw new Error('Invalid SDK Diff path escape.');
      bytes.push(...Buffer.from(escaped)); index += 2;
    } else {
      const character = String.fromCodePoint(text.codePointAt(index)!);
      bytes.push(...Buffer.from(character)); index += character.length;
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

function filePath(value: string): string | null {
  const decoded = gitPath(value);
  if (decoded === '/dev/null') return null;
  const path = decoded.replace(/^[ab]\//, '');
  if (!isSafeWorkspaceRelativePath(path)) throw new Error('SDK Diff path is outside the workspace.');
  return path;
}

export function splitSdkPatches(text: string): ReadonlyMap<string, ReviewSdkPatch> {
  const entries = new Map<string, ReviewSdkPatch>();
  for (const patch of text.split(/(?=^diff --git )/m).filter(Boolean)) {
    const header = /^diff --git ("(?:\\.|[^"])*"|a\/.*?) ("(?:\\.|[^"])*"|b\/.*)\n/.exec(patch);
    if (!header) throw new Error('The SDK returned an unsupported Git patch.');
    const before = /^--- (.*)$/m.exec(patch)?.[1];
    const after = /^\+\+\+ (.*)$/m.exec(patch)?.[1];
    const beforePath = /^new file mode /m.test(patch) ? null : filePath(before ?? header[1]!);
    const afterPath = /^deleted file mode /m.test(patch) ? null : filePath(after ?? header[2]!);
    const key = afterPath ?? beforePath;
    if (key === null) throw new Error('The SDK returned a patch without a file.');
    entries.set(key, { patch, beforePath, afterPath, binary: /^(?:Binary files |GIT binary patch)/m.test(patch) });
  }
  return entries;
}

/** Rebuild the SDK's after image, never the possibly newer working-copy bytes. */
export function applySdkPatch(before: string, entry: ReviewSdkPatch): string {
  if (entry.binary) throw new Error('Binary files cannot be shown as a text Diff.');
  const original = before.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const output: string[] = [];
  const lines = entry.patch.split('\n');
  let cursor = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const hunk = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[index]!);
    if (!hunk) continue;
    const oldCount = Number(hunk[2] ?? 1);
    const newCount = Number(hunk[4] ?? 1);
    const start = Number(hunk[1]) - (oldCount === 0 ? 0 : 1);
    if (start < cursor || start > original.length) throw new Error('SDK Diff no longer matches its Git baseline. Refresh Review.');
    while (cursor < start) output.push(original[cursor++]!);
    if (output.length !== Number(hunk[3]) - (newCount === 0 ? 0 : 1))
      throw new Error('The SDK returned an inconsistent Git hunk.');
    let removed = 0;
    let added = 0;
    while (removed < oldCount || added < newCount) {
      const line = lines[++index];
      if (line === undefined || ![' ', '-', '+'].includes(line[0]!))
        throw new Error('The SDK Diff is incomplete. Refresh Review.');
      const noNewline = lines[index + 1] === '\\ No newline at end of file';
      const content = line.slice(1) + (noNewline ? '' : '\n');
      if (noNewline) index += 1;
      if (line[0] !== '+') {
        if (original[cursor++] !== content) throw new Error('SDK Diff no longer matches its Git baseline. Refresh Review.');
        removed += 1;
      }
      if (line[0] !== '-') { output.push(content); added += 1; }
      if (removed > oldCount || added > newCount) throw new Error('The SDK returned an inconsistent Git hunk.');
    }
  }
  while (cursor < original.length) output.push(original[cursor++]!);
  const result = output.join('');
  if (entry.afterPath === null && result !== '') throw new Error('The SDK deletion patch is incomplete.');
  return result;
}
