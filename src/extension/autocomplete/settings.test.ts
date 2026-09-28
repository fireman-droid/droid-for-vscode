import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';

const mocks = vi.hoisted(() => ({
  global: {} as Record<string, unknown>,
  workspace: {} as Record<string, unknown>,
  values: new Map<string, string>(),
  pick: vi.fn(), input: vi.fn(), update: vi.fn(), getSecret: vi.fn(), storeSecret: vi.fn(),
}));

vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  window: { showQuickPick: mocks.pick, showInputBox: mocks.input },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => mocks.workspace[key] ?? mocks.global[key] ?? fallback,
      inspect: (key: string) => ({ globalValue: mocks.global[key], workspaceValue: mocks.workspace[key] }),
      update: mocks.update,
    }),
  },
}));

import { configureCompletion, DEFAULT_ENDPOINT } from './settings';

type Preset = { label: string; protocol: string; endpoint: string; model: string };
const secrets = { get: mocks.getSecret, store: mocks.storeSecret } as unknown as vscode.SecretStorage;

function choose(label: string) {
  mocks.pick.mockImplementation(async (presets: Preset[]) => presets.find((preset) => preset.label === label));
}

async function accept(options: vscode.InputBoxOptions, value: string | undefined) {
  if (value !== undefined) expect(await options.validateInput?.(value)).toBeUndefined();
  return value;
}

function useDefaults(key = '') {
  mocks.input.mockImplementation((options: vscode.InputBoxOptions) => accept(options, options.password ? key : options.value));
}

beforeEach(() => {
  mocks.global = {};
  mocks.workspace = {};
  mocks.values.clear();
  mocks.pick.mockReset();
  mocks.input.mockReset();
  mocks.update.mockReset().mockImplementation(async (key: string, value: unknown) => { mocks.global[key] = value; });
  mocks.getSecret.mockReset().mockImplementation(async (key: string) => mocks.values.get(key));
  mocks.storeSecret.mockReset().mockImplementation(async (key: string, value: string) => { mocks.values.set(key, value); });
});

describe('autocomplete configuration workflow', () => {
  it('saves the Ollama protocol, complete endpoint and model together without requiring a local key', async () => {
    choose('Ollama');
    useDefaults();
    expect(await configureCompletion(secrets)).toBe(true);
    expect(mocks.update.mock.calls).toEqual([
      ['endpoint', 'http://localhost:11434/api/generate', 1],
      ['model', 'qwen2.5-coder:7b-base', 1],
      ['protocol', 'ollama', 1],
    ]);
    expect(mocks.storeSecret).not.toHaveBeenCalled();
  });

  it('requires a Mistral API key and stores it in SecretStorage instead of settings', async () => {
    choose('Mistral / Codestral');
    mocks.input.mockImplementation(async (options: vscode.InputBoxOptions) => {
      if (!options.password) return accept(options, options.value);
      expect(await options.validateInput?.('')).toBe('Enter the provider API key.');
      expect(await options.validateInput?.('   ')).toBe('Enter the provider API key.');
      return accept(options, ' synthetic-mistral-key ');
    });
    expect(await configureCompletion(secrets)).toBe(true);
    expect(mocks.storeSecret).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'synthetic-mistral-key');
    expect(mocks.update.mock.calls).toEqual([
      ['endpoint', DEFAULT_ENDPOINT, 1], ['model', 'codestral-latest', 1], ['protocol', 'fim', 1],
    ]);
    expect(JSON.stringify(mocks.global)).not.toContain('synthetic-mistral-key');
  });

  it('keeps an endpoint’s stored key when the user leaves its API-key input blank', async () => {
    choose('Mistral / Codestral');
    useDefaults('saved-key');
    await configureCompletion(secrets);
    const keyId = mocks.storeSecret.mock.calls[0][0] as string;
    mocks.storeSecret.mockClear();
    useDefaults();
    expect(await configureCompletion(secrets)).toBe(true);
    expect(mocks.storeSecret).not.toHaveBeenCalled();
    expect(mocks.values.get(keyId)).toBe('saved-key');
    expect(mocks.getSecret).toHaveBeenLastCalledWith(keyId);
  });

  it('does not write configuration or credentials when service selection is cancelled', async () => {
    mocks.pick.mockResolvedValue(undefined);
    expect(await configureCompletion(secrets)).toBe(false);
    expect(mocks.input).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.storeSecret).not.toHaveBeenCalled();
  });

  it.each(['endpoint', 'model', 'API key'])('leaves configuration and credentials unchanged when cancelled at %s', async (stage) => {
    choose('Ollama');
    const cancelAt = ['endpoint', 'model', 'API key'].indexOf(stage);
    let index = 0;
    mocks.input.mockImplementation((options: vscode.InputBoxOptions) =>
      accept(options, index++ === cancelAt ? undefined : options.value));
    expect(await configureCompletion(secrets)).toBe(false);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.storeSecret).not.toHaveBeenCalled();
  });

  it('keeps the trusted user endpoint and model when a workspace overrides provider configuration', async () => {
    mocks.global = { endpoint: 'https://trusted.example/fim', model: 'trusted-model', protocol: 'fim' };
    mocks.workspace = { endpoint: 'https://workspace.example/collect', model: 'workspace-model', protocol: 'ollama' };
    choose('Current configuration');
    useDefaults();
    expect(await configureCompletion(secrets)).toBe(true);
    expect(mocks.input.mock.calls[0][0].value).toBe('https://trusted.example/fim');
    expect(mocks.update.mock.calls).toEqual([
      ['endpoint', 'https://trusted.example/fim', 1], ['model', 'trusted-model', 1], ['protocol', 'fim', 1],
    ]);
  });

  it.each([
    'https://provider.example/v1/chat/completions',
    'http://localhost:11434/api/chat',
  ])('rejects a chat endpoint in the input validation before allowing the wizard to advance (%s)', async (endpoint) => {
    choose('Custom FIM service');
    mocks.input.mockImplementationOnce(async (options: vscode.InputBoxOptions) => {
      expect(await options.validateInput?.(endpoint)).toContain('chat endpoint');
      // The user cancels after the editor rejects the incompatible endpoint.
      return undefined;
    });
    expect(await configureCompletion(secrets)).toBe(false);
    expect(mocks.input).toHaveBeenCalledTimes(1);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.storeSecret).not.toHaveBeenCalled();
  });

  it('keeps saved keys isolated when switching between providers', async () => {
    choose('Mistral / Codestral');
    useDefaults('mistral-private-key');
    await configureCompletion(secrets);
    const mistralId = mocks.storeSecret.mock.calls[0][0] as string;
    choose('DeepSeek');
    mocks.input.mockImplementation(async (options: vscode.InputBoxOptions) => {
      if (!options.password) return accept(options, options.value);
      // A key already exists for Mistral, but it cannot satisfy DeepSeek’s key requirement.
      expect(await options.validateInput?.('')).toBe('Enter the provider API key.');
      return accept(options, 'deepseek-private-key');
    });
    expect(await configureCompletion(secrets)).toBe(true);
    const deepseekId = mocks.storeSecret.mock.calls[1][0] as string;
    expect(deepseekId).not.toBe(mistralId);
    expect(mocks.values.get(mistralId)).toBe('mistral-private-key');
    expect(mocks.values.get(deepseekId)).toBe('deepseek-private-key');
    expect(mocks.global.endpoint).toBe('https://api.deepseek.com/beta/completions');
    expect(mocks.global.protocol).toBe('fim');
  });
});
