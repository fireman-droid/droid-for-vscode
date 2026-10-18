import { toolNameCandidates } from './toolActivity';

export const isScriptTool = (name: string): boolean => !/__+/u.test(name) && toolNameCandidates(name).includes('script');

/** Only the CLI's final diagnostic trailer, never arbitrary lines mentioning status. */
export function stripScriptTrailer(text: string): string {
  return text.replace(/(?:\r?\n)?\[Script completed · [\d.]+ s elapsed · \d+ calls?(?: · \d+ background executes? running)?(?: · [\d.]+ (?:B|KiB|MiB|GiB) passed through unfiltered)? · log: [^\r\n]+\]\s*$/u, '').trimEnd();
}

export interface ScriptOutputPart { readonly part: number; readonly text: string; readonly exitCode?: number; readonly partial?: boolean }

function resultText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(resultText).join('\n');
  if (value && typeof value === 'object' && 'path' in value && typeof value.path === 'string' &&
    'text' in value && typeof value.text === 'string' && 'line' in value && Number.isSafeInteger(value.line) &&
    Object.keys(value).every(key => ['path', 'line', 'text', 'kind'].includes(key))) return `${value.path}:${value.line}\n${value.text}`;
  return JSON.stringify(value, null, 2);
}

function partialArray(text: string): string {
  const values: unknown[] = [];
  let start = 1, depth = 0, quoted = false, escaped = false;
  for (let index = 1; index < text.length; index++) {
    const char = text[index]!;
    if (quoted) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quoted = false; continue; }
    if (char === '"') quoted = true;
    else if (char === '{' || char === '[') depth++;
    else if (char === '}' || char === ']' && depth > 0) depth--;
    else if ((char === ',' || char === ']') && depth === 0) {
      try { if (text.slice(start, index).trim()) values.push(JSON.parse(text.slice(start, index))); } catch { break; }
      start = index + 1;
      if (char === ']') break;
    }
  }
  // Keep the incomplete final fragment rather than guessing missing fields.
  const remainder = text.slice(start).trim();
  return [resultText(values), remainder].filter(Boolean).join('\n');
}

/** Read only complete JSON escapes from a truncated string; never invent the
 * missing end of a result, exit code, or subsequent part. */
function partialResult(line: string): ScriptOutputPart | undefined {
  const prefix = /^\s*\{\s*"part"\s*:\s*(\d+)\s*,\s*"result"\s*:\s*/u.exec(line);
  if (!prefix || !Number.isSafeInteger(Number(prefix[1]))) return undefined;
  const raw = line.slice(prefix[0].length);
  const input = raw.replace(/^\{\s*"output"\s*:\s*/u, '');
  if (input[0] !== '"') return { part: Number(prefix[1]), text: raw.startsWith('[') ? partialArray(raw) : raw, partial: true };
  let index = 1;
  for (; index < input.length; index++) {
    if (input[index] === '"') return { part: Number(prefix[1]), text: JSON.parse(input.slice(0, index + 1)) as string, partial: true };
    if (input[index] === '\\') {
      if (input[index + 1] === 'u') {
        if (!/^[0-9a-f]{4}$/iu.test(input.slice(index + 2, index + 6))) break;
        index += 5;
      } else if (input[index + 1] && /["\\/bfnrt]/u.test(input[index + 1]!)) index++;
      else break;
    } else if (input.charCodeAt(index) < 32) return undefined;
  }
  const decoded = JSON.parse(input.slice(0, index) + '"') as string;
  return { part: Number(prefix[1]), text: decoded.replace(/[\uD800-\uDBFF]$/u, ''), partial: true };
}

/** Script's printed part/result bundles remain supplemental output, not file attribution. */
export function scriptOutputParts(text: string, truncated = false): readonly ScriptOutputPart[] | undefined {
  const body = stripScriptTrailer(text);
  const lines = body.trim().split(/\r?\n/u);
  if (!lines.length || !lines.every(line => line.trimStart().startsWith('{'))) return undefined;
  const parts: ScriptOutputPart[] = [];
  for (const [index, line] of lines.entries()) {
    let value: unknown;
    try { value = JSON.parse(line); } catch {
      const tail = truncated && index === lines.length - 1 ? partialResult(line) : undefined;
      if (tail) { parts.push(tail); continue; }
      return undefined;
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value) ||
      Object.keys(value).length !== 2 || !('part' in value) || !('result' in value) ||
      !Number.isSafeInteger(value.part) || Number(value.part) < 0) return undefined;
    if (typeof value.result === 'string') parts.push({ part: Number(value.part), text: value.result });
    else if (typeof value.result === 'object' && value.result !== null && !Array.isArray(value.result) &&
      'output' in value.result && typeof value.result.output === 'string' &&
      Object.keys(value.result).every(key => ['output', 'exitCode'].includes(key)) &&
      (!('exitCode' in value.result) || value.result.exitCode === null || Number.isSafeInteger(value.result.exitCode))) {
      parts.push({ part: Number(value.part), text: value.result.output,
        ...('exitCode' in value.result && typeof value.result.exitCode === 'number' ? { exitCode: value.result.exitCode } : {}) });
    } else parts.push({ part: Number(value.part), text: resultText(value.result) });
  }
  return parts;
}

export function formatScriptParts(parts: readonly ScriptOutputPart[]): string {
  return parts.map(part => `[${part.part}]\n${part.text.trimEnd()}${part.exitCode === undefined ? '' : `\n[Process exited with code ${part.exitCode}]`}`).join('\n\n');
}

export function readableScriptOutput(text: string, truncated = false): string {
  const parts = scriptOutputParts(text, truncated);
  if (!parts) return stripScriptTrailer(text);
  const content = parts.filter(part => part.text.trim() !== 'TODO List Updated');
  return content.length ? formatScriptParts(content) : 'TODO List Updated';
}

export function scriptBackgroundReceipt(text: string): { pid: string; log: string } | undefined {
  const match = /^exit null · pid (\d+) · outputFile ([^\r\n]+)$/u.exec(stripScriptTrailer(text).trim());
  return match ? { pid: match[1]!, log: match[2]! } : undefined;
}

export function readReceipt(text: string): { start: string; end: string; size: string } | undefined {
  const match = /^Read [^\r\n]+: lines (\d+)-(\d+) \(\d+ lines?, ([^\r\n;)]+)\); the file holds the bytes\s*$/u.exec(text);
  return match ? { start: match[1]!, end: match[2]!, size: match[3]! } : undefined;
}
