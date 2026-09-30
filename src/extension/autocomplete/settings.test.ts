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

import {
  completionNeedsKey, configureCompletion, DEFAULT_ENDPOINT, readCompletionSettings, validateCompletionEndpoint,
  readCompletionKey, completionSecretKey, MERCURY_FIM_ENDPOINT, MERCURY_EDIT_ENDPOINT, switchMercuryMode, removeCompletionKey, mercuryAlternateEndpoint,
} from './settings';

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
  it('configures Mercury Next Edit with its own endpoint and secret', async () => {
    choose('Inception / Mercury Next Edit');
    useDefaults('synthetic-mercury-key');
    expect(await configureCompletion(secrets)).toBe(true);
    expect(mocks.global).toMatchObject({protocol:'mercury-edit',model:'mercury-edit-2',
      endpoint:'https://api.inceptionlabs.ai/v1/edit/completions'});
    expect(mocks.storeSecret).toHaveBeenCalledWith(expect.any(String),'synthetic-mercury-key');
    expect(JSON.stringify(mocks.global)).not.toContain('synthetic-mercury-key');
    expect(validateCompletionEndpoint('https://api.inceptionlabs.ai/v1/chat/completions','mercury-edit')).toBeTruthy();
  });
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

  it('saves the SiliconFlow FIM preset with a SecretStorage key and its supported Qwen model', async () => {
    choose('SiliconFlow');
    mocks.input.mockImplementation(async (options: vscode.InputBoxOptions) => {
      if (!options.password) return accept(options, options.value);
      expect(await options.validateInput?.('')).toBe('Enter the provider API key.');
      return accept(options, ' synthetic-siliconflow-key ');
    });
    expect(await configureCompletion(secrets)).toBe(true);
    expect(mocks.update.mock.calls).toEqual([
      ['endpoint', 'https://api.siliconflow.cn/v1/chat/completions', 1],
      ['model', 'Qwen/Qwen3-Coder-30B-A3B-Instruct', 1],
      ['protocol', 'siliconflow-fim', 1],
    ]);
    expect(mocks.storeSecret).toHaveBeenCalledExactlyOnceWith(expect.any(String), 'synthetic-siliconflow-key');
    expect(JSON.stringify(mocks.global)).not.toContain('synthetic-siliconflow-key');
    expect(readCompletionSettings().protocol).toBe('siliconflow-fim');
  });

  it('keeps a saved SiliconFlow configuration when reopening the configuration wizard', async () => {
    mocks.global = {
      protocol: 'siliconflow-fim', endpoint: 'https://api.siliconflow.cn/v1/chat/completions',
      model: 'Qwen/Qwen3-Coder-30B-A3B-Instruct',
    };
    choose('Current configuration');
    useDefaults('synthetic-siliconflow-key');
    expect(await configureCompletion(secrets)).toBe(true);
    expect(mocks.global.protocol).toBe('siliconflow-fim');
    expect(mocks.input.mock.calls[0][0].value).toBe('https://api.siliconflow.cn/v1/chat/completions');
  });
});

describe('autocomplete provider settings', () => {
  it.each(['fim', 'ollama', 'siliconflow-fim'] as const)('reads the user-selected %s protocol without workspace overrides', (protocol) => {
    mocks.global.protocol = protocol;
    mocks.workspace.protocol = protocol === 'fim' ? 'siliconflow-fim' : 'fim';
    expect(readCompletionSettings().protocol).toBe(protocol);
  });

  it('falls back to native FIM for an unknown protocol', () => {
    mocks.global.protocol = 'unrecognized';
    expect(readCompletionSettings().protocol).toBe('fim');
  });

  it('allows the SiliconFlow chat route only with the explicit SiliconFlow FIM protocol', () => {
    const endpoint = 'https://api.siliconflow.cn/v1/chat/completions';
    expect(validateCompletionEndpoint(endpoint, 'siliconflow-fim')).toBeUndefined();
    expect(validateCompletionEndpoint(endpoint)).toContain('chat endpoint');
    expect(validateCompletionEndpoint(endpoint, 'fim')).toContain('chat endpoint');
    expect(validateCompletionEndpoint(endpoint, 'ollama')).toContain('chat endpoint');
    expect(validateCompletionEndpoint('http://localhost:11434/api/chat', 'siliconflow-fim'))
      .toContain('/v1/chat/completions');
    expect(validateCompletionEndpoint(DEFAULT_ENDPOINT, 'siliconflow-fim')).toContain('/v1/chat/completions');
  });

  it.each([
    'http://api.siliconflow.cn/v1/chat/completions',
    'https://key:secret@api.siliconflow.cn/v1/chat/completions',
    'https://api.siliconflow.cn/v1/chat/completions?key=secret',
  ])('retains URL security validation for SiliconFlow (%s)', (endpoint) => {
    expect(validateCompletionEndpoint(endpoint, 'siliconflow-fim')).toBeDefined();
  });

  it('requires a key for the SiliconFlow service without requiring one for local endpoints', () => {
    expect(completionNeedsKey('https://api.siliconflow.cn/v1/chat/completions')).toBe(true);
    expect(completionNeedsKey('http://localhost:11434/api/generate')).toBe(false);
  });

});

describe('Mercury completion modes and credentials', () => {
  it('switches both directions and retains the same saved Inception key', async () => {
    choose('Inception / Mercury Code Completion'); useDefaults('example-provider-key');
    expect(await configureCompletion(secrets)).toBe(true);
    expect(mocks.global).toMatchObject({ endpoint: MERCURY_FIM_ENDPOINT, protocol: 'fim', model: 'mercury-edit-2' });
    expect(await switchMercuryMode()).toBe(true);
    expect(mocks.global).toMatchObject({ endpoint: MERCURY_EDIT_ENDPOINT, protocol: 'mercury-edit' });
    expect(await readCompletionKey(secrets, MERCURY_EDIT_ENDPOINT)).toBe('example-provider-key');
    expect(await switchMercuryMode()).toBe(true);
    expect(mocks.global.endpoint).toBe(MERCURY_FIM_ENDPOINT);
  });
  it('reuses an existing Next Edit key for FIM without sharing it with another endpoint', async () => {
    mocks.values.set(completionSecretKey(MERCURY_EDIT_ENDPOINT), 'existing-provider-key');
    expect(await readCompletionKey(secrets, MERCURY_FIM_ENDPOINT)).toBe('existing-provider-key');
    expect(await readCompletionKey(secrets, 'https://example.test/v1/fim/completions')).toBeUndefined();
    expect(mercuryAlternateEndpoint('invalid')).toBeUndefined();
  });
  it('removes both mode credentials and never changes another provider key', async () => {
    for (const endpoint of [MERCURY_FIM_ENDPOINT, MERCURY_EDIT_ENDPOINT, DEFAULT_ENDPOINT]) mocks.values.set(completionSecretKey(endpoint), 'example');
    await removeCompletionKey({ ...secrets, delete: async key => { mocks.values.delete(key); } }, MERCURY_FIM_ENDPOINT);
    expect(await readCompletionKey(secrets, MERCURY_FIM_ENDPOINT)).toBeUndefined();
    expect(await readCompletionKey(secrets, MERCURY_EDIT_ENDPOINT)).toBeUndefined();
    expect(await readCompletionKey(secrets, DEFAULT_ENDPOINT)).toBe('example');
  });
  it('does not let workspace settings enable clipboard reads or redirect the service', () => {
    mocks.workspace = { includeClipboard: true, endpoint: 'https://example.test/v1/fim/completions' };
    expect(readCompletionSettings()).toMatchObject({ includeClipboard: false, endpoint: DEFAULT_ENDPOINT });
  });
});
