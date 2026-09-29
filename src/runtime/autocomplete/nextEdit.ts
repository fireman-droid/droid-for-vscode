import { buildMercuryEditPrompt, type MercuryEditContext } from './kilo/editPrompt';
import { asRecord, parsePayload, protocolError, readBody, requestCompletionTransport } from './completionTransport';
import type { FimRequest } from './FimClient';

export function buildBoundedEditPrompt(context: MercuryEditContext, maxCharacters: number): string {
  const ctx = { ...context, recentlyViewedSnippets: context.recentlyViewedSnippets.slice(-5),
    editDiffHistory: context.editDiffHistory.slice(-5) };
  let lines = ctx.currentFileContent.replace(/\r\n/g, '\n').split('\n');
  ctx.currentFileContent = lines.join('\n');
  let prompt = buildMercuryEditPrompt(ctx);
  while (prompt.length > maxCharacters && ctx.recentlyViewedSnippets.length) {
    ctx.recentlyViewedSnippets.shift(); prompt = buildMercuryEditPrompt(ctx);
  }
  while (prompt.length > maxCharacters && ctx.editDiffHistory.length) {
    ctx.editDiffHistory.shift(); prompt = buildMercuryEditPrompt(ctx);
  }
  // Find the largest surrounding line window that fits; never cut the editable region.
  if (prompt.length > maxCharacters) {
    const originalStart = ctx.editableRegionStartLine, originalEnd = ctx.editableRegionEndLine;
    const originalCursor = ctx.cursorLine;
    const render = (radius: number) => {
      const start = Math.max(0, originalStart - radius), end = Math.min(lines.length, originalEnd + radius + 1);
      return buildMercuryEditPrompt({ ...ctx, currentFileContent: lines.slice(start, end).join('\n'),
        cursorLine: originalCursor - start, editableRegionStartLine: originalStart - start,
        editableRegionEndLine: originalEnd - start });
    };
    prompt = render(0);
    if (prompt.length > maxCharacters) throw protocolError('Editable region exceeds the configured context budget.');
    let low = 0, high = lines.length;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2), candidate = render(mid);
      if (candidate.length <= maxCharacters) { low = mid; prompt = candidate; } else high = mid - 1;
    }
  }
  return prompt;
}

/** Mercury returns an entire editable region; truncated or ambiguous replies must never be applied. */
export function parseNextEditReplacement(message: string): string {
  const normalized = message.replace(/\r\n/g, '\n').trim();
  const match = /^\x60\x60\x60[^\n\x60]*\n([\s\S]*?)\n?\x60\x60\x60$/.exec(normalized);
  if (!match || /^\s*\x60{3,}/m.test(match[1])) throw protocolError('Next Edit returned an incomplete or ambiguous code region.');
  let body = match[1];
  if (body.startsWith('<|code_to_edit|>\n') && body.endsWith('\n<|/code_to_edit|>')) {
    body = body.slice('<|code_to_edit|>\n'.length, -'\n<|/code_to_edit|>'.length);
  }
  if (/<\|(?:\/?code_to_edit|cursor)\|>/.test(body)) throw protocolError('Next Edit returned unresolved edit markers.');
  return body;
}

export async function requestNextEdit(
  request: Omit<FimRequest, 'prefix' | 'suffix'> & { context: MercuryEditContext; maxContextCharacters: number },
): Promise<string> {
  const prompt = buildBoundedEditPrompt(request.context, request.maxContextCharacters);
  return requestCompletionTransport(request, {
    model: request.model, messages: [{ role: 'user', content: prompt }],
    max_tokens: Math.max(512, request.maxTokens), stream: false,
  }, 'application/json', async response => {
    const type = response.headers.get('content-type') ?? '';
    if (!type.includes('json')) throw protocolError('Next Edit provider returned an unsupported response format.');
    let body = '';
    await readBody(response, chunk => { body += chunk; return false; });
    const payload = parsePayload(body);
    const choice = Array.isArray(payload.choices) ? asRecord(payload.choices[0]) : undefined;
    const content = asRecord(choice?.message)?.content;
    if (choice?.finish_reason !== 'stop' || typeof content !== 'string') {
      throw protocolError('Next Edit did not return a complete replacement. Suggestion hidden.');
    }
    return parseNextEditReplacement(content);
  });
}
