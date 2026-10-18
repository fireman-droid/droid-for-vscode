import { toolNameCandidates } from './toolActivity';

export const isScriptTool = (name: string): boolean => !/__+/u.test(name) && toolNameCandidates(name).includes('script');

/** Only the CLI's final diagnostic trailer, never arbitrary lines mentioning status. */
export function stripScriptTrailer(text: string): string {
  return text.replace(/(?:\r?\n)?\[Script completed · [\d.]+ s elapsed · \d+ calls?(?: · \d+ background executes? running)? · log: [^\r\n]+\]\s*$/u, '').trimEnd();
}

/** Script's printed part/result bundles remain supplemental output, not file attribution. */
export function readableScriptOutput(text: string): string {
  const body = stripScriptTrailer(text);
  const lines = body.trim().split(/\r?\n/u);
  if (!lines.length || !lines.every(line => line.startsWith('{'))) return body;
  const parts: { part: number; result: string }[] = [];
  for (const line of lines) {
    let value: unknown;
    try { value = JSON.parse(line); } catch { return body; }
    if (typeof value !== 'object' || value === null || Array.isArray(value) ||
      Object.keys(value).length !== 2 || !('part' in value) || !('result' in value) ||
      !Number.isSafeInteger(value.part) || Number(value.part) < 0 || typeof value.result !== 'string') return body;
    parts.push(value as { part: number; result: string });
  }
  const content = parts.filter(part => part.result.trim() !== 'TODO List Updated');
  return content.length ? content.map(part => `[${part.part}]\n${part.result}`).join('\n\n') : 'TODO List Updated';
}

export function readReceipt(text: string): { start: string; end: string; size: string } | undefined {
  const match = /^Read [^\r\n]+: lines (\d+)-(\d+) \(\d+ lines?, ([^\r\n;)]+)\); the file holds the bytes\s*$/u.exec(text);
  return match ? { start: match[1]!, end: match[2]!, size: match[3]! } : undefined;
}
