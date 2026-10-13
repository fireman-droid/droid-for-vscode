import type * as vscode from 'vscode';
import { FimCompletionError } from '../../runtime/autocomplete/FimClient';
import { requestCompletion } from '../../runtime/autocomplete/requestCompletion';
import { prepareCompletionWithOutcome } from '../autocomplete/completionText';
import { buildCompletionPrompt } from '../autocomplete/context/CompletionPrompt';
import { readCompletionKey, readCompletionSettings, validateCompletionEndpoint } from '../autocomplete/settings';

type EvaluationInput = {
  prefix: string;
  suffix: string;
  language: string;
  filepath: string;
  references: { path: string; content: string }[];
};

export type AutocompleteEvaluation = (input: unknown, signal: AbortSignal) => Promise<unknown>;

/** Only reachable through the explicitly started, authenticated Browser Dev bridge.
 * Uses normal SecretStorage access in the Host; credentials never leave the Host.
 * References are supplied benchmark fixtures, not a claim that LSP retrieval was exercised.
 */
export function createAutocompleteEvaluation(secrets: vscode.SecretStorage): AutocompleteEvaluation {
  return async (value, signal) => {
    const settings = readCompletionSettings();
    if (isRecord(value) && value.kind === 'settings') {
      return { model: settings.model, protocol: settings.protocol, maxTokens: settings.maxTokens,
        maxContextCharacters: settings.maxContextCharacters };
    }
    const input = parseInput(value);
    const validation = validateCompletionEndpoint(settings.endpoint, settings.protocol);
    if (validation || settings.protocol === 'mercury-edit') throw new Error('Evaluation requires a valid FIM configuration.');
    const started = Date.now();
    const apiKey = await readCompletionKey(secrets, settings.endpoint);
    if (signal.aborted) throw signal.reason;
    if (!apiKey && settings.protocol !== 'ollama') throw new Error('Configure the autocomplete provider key in VS Code first.');
    const prompt = buildCompletionPrompt({
      text: input.prefix + input.suffix, offset: input.prefix.length, maxCharacters: settings.maxContextCharacters,
      filepath: input.filepath, model: settings.model, comments: { line: input.language === 'python' ? '#' : '//' },
      snippets: input.references.map(reference => ({ uri: reference.path, filepath: reference.path,
        content: reference.content, source: 'definition' })),
    });
    const contextMs = Date.now() - started;
    const networkStarted = Date.now();
    try {
      const raw = await requestCompletion({ ...prompt, protocol: settings.protocol, endpoint: settings.endpoint,
        model: settings.model, apiKey: apiKey ?? '', maxTokens: settings.maxTokens, signal });
      const networkMs = Date.now() - networkStarted;
      const prepared = prepareCompletionWithOutcome(raw, input.prefix, input.suffix, input.language, settings.model);
      return { model: settings.model, protocol: settings.protocol, maxTokens: settings.maxTokens,
        contextMode: 'supplied-fixtures', contextMs, networkMs, elapsedMs: Date.now() - started,
        prefixCharacters: prompt.prefix.length, suffixCharacters: prompt.suffix.length,
        raw, insertion: prepared.text ?? null, outcome: prepared.outcome };
    } catch (error) {
      // Provider error bodies can contain credentials or arbitrary text. Return only classified fields.
      if (signal.aborted) throw new Error('Evaluation cancelled.');
      return { error: 'completion-failed', code: error instanceof FimCompletionError ? error.code : 'internal',
        status: error instanceof FimCompletionError ? error.status ?? null : null,
        elapsedMs: Date.now() - started };
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseInput(value: unknown): EvaluationInput {
  if (!isRecord(value) || typeof value.prefix !== 'string' || typeof value.suffix !== 'string'
    || typeof value.language !== 'string' || typeof value.filepath !== 'string'
    || !Array.isArray(value.references) || value.references.length > 20
    || value.prefix.length + value.suffix.length > 64_000 || value.language.length > 40 || value.filepath.length > 256) {
    throw new Error('Invalid autocomplete evaluation input.');
  }
  const references: EvaluationInput['references'] = [];
  let characters = 0;
  for (const reference of value.references) {
    if (!isRecord(reference) || typeof reference.path !== 'string' || typeof reference.content !== 'string'
      || reference.path.length > 256 || (characters += reference.content.length) > 128_000) {
      throw new Error('Invalid autocomplete evaluation reference.');
    }
    references.push({ path: reference.path, content: reference.content });
  }
  return { prefix: value.prefix, suffix: value.suffix, language: value.language, filepath: value.filepath, references };
}
