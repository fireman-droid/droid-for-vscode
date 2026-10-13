import type * as vscode from 'vscode';
import { readCompletionKey, readCompletionSettings, MERCURY_EDIT_ENDPOINT, MERCURY_FIM_ENDPOINT } from '../../extension/autocomplete/settings';
import { buildBoundedEditPrompt, parseNextEditReplacement, requestNextEdit } from '../../runtime/autocomplete/nextEdit';
import { asRecord, FimCompletionError, parsePayload, protocolError, readBody, requestCompletionTransport } from '../../runtime/autocomplete/completionTransport';
import type { MercuryEditContext } from '../../runtime/autocomplete/kilo/editPrompt';

// Development gateway only: compare the same configured Mercury model via its
// official paired API. No setting changes or caller-selected destination/model.
export function nextEditAvailable(): boolean {
  const settings = readCompletionSettings();
  return /mercury/i.test(settings.model)
    && ((settings.protocol === 'fim' && settings.endpoint.replace(/\/$/, '') === MERCURY_FIM_ENDPOINT)
      || (settings.protocol === 'mercury-edit' && settings.endpoint.replace(/\/$/, '') === MERCURY_EDIT_ENDPOINT));
}

export async function evaluateNextEdit(secrets: vscode.SecretStorage, value: unknown, signal: AbortSignal) {
  if (!nextEditAvailable()) throw new Error('Next Edit evaluation requires the configured official Mercury service');
  if (!record(value) || Object.keys(value).some(key => !['kind', 'context', 'maxTokens'].includes(key))) throw new Error('Invalid Next Edit evaluation');
  const inspect = value.kind === 'next-edit-inspect';
  if (value.maxTokens !== undefined && (!inspect || typeof value.maxTokens !== 'number'
    || !Number.isInteger(value.maxTokens) || value.maxTokens < 32 || value.maxTokens > 1024)) throw new Error('Invalid inspection token limit');
  const context = parseContext(value.context);
  const settings = readCompletionSettings();
  const apiKey = await readCompletionKey(secrets, settings.endpoint);
  if (!apiKey) throw new Error('The configured Mercury key is unavailable');
  const started = Date.now();
  if (inspect) {
    const maxTokens = Math.max(512, typeof value.maxTokens === 'number' ? value.maxTokens : settings.maxTokens);
    const prompt = buildBoundedEditPrompt(context, settings.maxContextCharacters);
    const encoded = await requestCompletionTransport({ endpoint: MERCURY_EDIT_ENDPOINT, apiKey, signal }, {
      model: settings.model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, stream: false,
    }, 'application/json', async response => {
      let body = '';
      await readBody(response, chunk => { body += chunk; return false; });
      const payload = parsePayload(body);
      const choice = Array.isArray(payload.choices) ? asRecord(payload.choices[0]) : undefined;
      if (!choice) throw protocolError('Next Edit inspection received no choice');
      const raw = asRecord(choice.message)?.content;
      const usage = asRecord(payload.usage);
      return JSON.stringify({ raw: typeof raw === 'string' ? raw : null,
        finishReason: choice.finish_reason === 'stop' || choice.finish_reason === 'length' ? choice.finish_reason : 'other',
        completionTokens: typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : null });
    });
    const observed = JSON.parse(encoded) as { raw: string | null; finishReason: string; completionTokens: number | null };
    let replacement: string | undefined;
    if (observed.finishReason === 'stop' && typeof observed.raw === 'string') {
      try { replacement = parseNextEditReplacement(observed.raw); }
      catch (error) {
        // Keep known format rejections for inspection, but surface unexpected failures.
        if (!(error instanceof FimCompletionError) || error.code !== 'protocol') throw error;
      }
    }
    return { ...observed, replacement, model: settings.model, protocol: 'mercury-edit', maxTokens,
      contextMode: 'response-inspection', elapsedMs: Date.now() - started };
  }
  const replacement = await requestNextEdit({ context, endpoint: MERCURY_EDIT_ENDPOINT, apiKey,
    model: settings.model, maxTokens: settings.maxTokens, maxContextCharacters: settings.maxContextCharacters, signal });
  return { replacement, model: settings.model, protocol: 'mercury-edit', maxTokens: Math.max(512, settings.maxTokens),
    contextMode: 'supplied-fixtures', elapsedMs: Date.now() - started };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseContext(value: unknown): MercuryEditContext {
  if (!record(value) || typeof value.currentFilePath !== 'string' || value.currentFilePath.length > 256
    || typeof value.currentFileContent !== 'string' || value.currentFileContent.length > 64_000
    || !Array.isArray(value.recentlyViewedSnippets) || value.recentlyViewedSnippets.length > 20
    || !Array.isArray(value.editDiffHistory) || value.editDiffHistory.length > 10) throw new Error('Invalid Next Edit context');
  const lines = value.currentFileContent.replace(/\r\n/g, '\n').split('\n');
  const numbers = ['cursorLine', 'cursorCharacter', 'editableRegionStartLine', 'editableRegionEndLine'] as const;
  for (const key of numbers) if (typeof value[key] !== 'number' || !Number.isSafeInteger(value[key]) || value[key] < 0) {
    throw new Error('Invalid Next Edit position');
  }
  const cursorLine = value.cursorLine as number, cursorCharacter = value.cursorCharacter as number;
  const start = value.editableRegionStartLine as number, end = value.editableRegionEndLine as number;
  if (start > end || end >= lines.length || cursorLine >= lines.length || cursorCharacter > lines[cursorLine].length
    || cursorLine < start || cursorLine > end) throw new Error('Next Edit position is outside the source');
  let characters = 0;
  const snippets = value.recentlyViewedSnippets.map(item => {
    if (!record(item) || typeof item.filepath !== 'string' || item.filepath.length > 256 || typeof item.content !== 'string'
      || (characters += item.content.length) > 128_000) throw new Error('Invalid Next Edit snippets');
    return { filepath: item.filepath, content: item.content };
  });
  const history = value.editDiffHistory.map(item => {
    if (typeof item !== 'string' || (characters += item.length) > 128_000) throw new Error('Invalid Next Edit history');
    return item;
  });
  return { currentFilePath: value.currentFilePath, currentFileContent: lines.join('\n'), cursorLine, cursorCharacter,
    editableRegionStartLine: start, editableRegionEndLine: end, recentlyViewedSnippets: snippets, editDiffHistory: history };
}
