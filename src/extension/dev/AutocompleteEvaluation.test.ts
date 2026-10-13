import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

const mocks = vi.hoisted(() => ({ request: vi.fn(), key: vi.fn(), settings: vi.fn() }));
vi.mock('../autocomplete/settings', () => ({
  readCompletionSettings: mocks.settings, readCompletionKey: mocks.key,
  validateCompletionEndpoint: () => undefined,
}));
vi.mock('../../runtime/autocomplete/requestCompletion', () => ({ requestCompletion: mocks.request }));
import { createAutocompleteEvaluation } from './AutocompleteEvaluation';

const input = { prefix: 'function run() {\n  if', suffix: '\n}', language: 'typescript', filepath: 'main.ts', references: [] };
const settings = { model: 'mercury-edit-2', protocol: 'fim', endpoint: 'https://api.example.test/v1/fim/completions',
  maxTokens: 256, maxContextCharacters: 12000 };
const evaluate = createAutocompleteEvaluation({} as vscode.SecretStorage);
beforeEach(() => {
  mocks.settings.mockReturnValue(settings);
  mocks.key.mockReset().mockResolvedValue('synthetic-private-credential');
  mocks.request.mockReset().mockResolvedValue(' (ready) {\n    work();\n  }');
});

describe('autocomplete evaluation through the dev Host', () => {
  it('uses the configured service without returning its key or accepting a request endpoint override', async () => {
    const result = await evaluate({ ...input, endpoint: 'https://untrusted.invalid', apiKey: 'override' }, new AbortController().signal);
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ endpoint: settings.endpoint,
      apiKey: 'synthetic-private-credential', maxTokens: 256 }));
    expect(result).toEqual(expect.objectContaining({ outcome: 'suggestion-returned', insertion: ' (ready) {\n    work();\n  }',
      contextMode: 'supplied-fixtures' }));
    expect(JSON.stringify(result)).not.toContain('synthetic-private-credential');
  });
  it('includes benchmark reference definitions in the real prompt builder', async () => {
    await evaluate({ ...input, references: [{ path: 'types.ts', content: 'export type UserId = string;' }] }, new AbortController().signal);
    expect(mocks.request.mock.calls[0][0].prefix).toContain('export type UserId = string;');
  });
  it('rejects invalid payloads before reading credentials or making a request', async () => {
    await expect(evaluate({ ...input, references: [{ path: '../test', content: null }] }, new AbortController().signal)).rejects.toThrow('Invalid');
    expect(mocks.key).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('does not expose raw errors from a provider', async () => {
    mocks.request.mockRejectedValue(new Error('provider repeated synthetic-private-credential'));
    const result = await evaluate(input, new AbortController().signal);
    expect(result).toEqual(expect.objectContaining({ error: 'completion-failed', code: 'internal' }));
    expect(JSON.stringify(result)).not.toContain('synthetic-private-credential');
  });
  it('stops before requesting when cancellation arrives during credential access', async () => {
    const abort = new AbortController();
    mocks.key.mockImplementation(async () => { abort.abort(new Error('cancelled')); return 'synthetic-private-credential'; });
    await expect(evaluate(input, abort.signal)).rejects.toThrow('cancelled');
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it('reads non-secret settings without requesting credentials', async () => {
    expect(await evaluate({ kind: 'settings' }, new AbortController().signal)).toEqual({
      model: settings.model, protocol: 'fim', maxTokens: 256, maxContextCharacters: 12000,
    });
    expect(mocks.key).not.toHaveBeenCalled();
  });
});
