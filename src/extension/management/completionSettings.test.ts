import { beforeEach, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { CompletionPreferences } from '../../shared/protocol/managementPageProtocol';
import { MANAGEMENT_VERSION, parseManagementRequest } from '../../shared/protocol/managementPageProtocol';

const state = vi.hoisted(() => ({ values: {} as Record<string, unknown>, secrets: new Map<string, string>(),
  trusted: true, update: vi.fn(), input: vi.fn(), get: vi.fn(), store: vi.fn() }));
vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: { get isTrusted() { return state.trusted; }, getConfiguration: () => ({
    get: (key: string, fallback: unknown) => state.values[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: state.values[key] }), update: state.update,
  }) }, window: { showInputBox: state.input },
}));
vi.mock('../webview/webviewTheme', () => ({ readChatStarfieldEnabled: () => true, readWebviewBootTheme: () => ({ resolved: 'dark' }), readWebviewThemePreference: () => 'auto' }));
import { ManagementSettingsService } from './managementSettings';
import { completionSecretKey, DEFAULT_ENDPOINT, MERCURY_FIM_ENDPOINT } from '../autocomplete/settings';

const legacyEditEndpoint = 'https://api.inceptionlabs.ai/v1/edit/completions';
const preferences: CompletionPreferences = { enabled: true, protocol: 'fim', model: 'codestral-2508',
  endpoint: DEFAULT_ENDPOINT, autoTrigger: true, relatedFiles: true, debounceMs: 350, adaptiveDebounce: true };
const service = () => new ManagementSettingsService({
  get: state.get, store: state.store,
} as unknown as vscode.SecretStorage, 'test', () => ({ cwd: null, connection: 'connected', ide: 'connected', sessionManagementAvailable: false }), () => []);

beforeEach(() => {
  state.values = {}; state.secrets.clear(); state.input.mockReset(); state.trusted = true;
  state.update.mockReset().mockImplementation(async (key: string, value: unknown) => { state.values[key] = value; });
  state.get.mockReset().mockImplementation(async (key: string) => state.secrets.get(key));
  state.store.mockReset().mockImplementation(async (key: string, value: string) => { state.secrets.set(key, value); });
});

it('round-trips FIM settings and keeps the provider credential out of the bridge', async () => {
  state.input.mockResolvedValueOnce('fim-secret');
  await service().save(preferences, true);
  const result = await service().read();
  expect(result.completion).toEqual(preferences);
  expect(result.completionHasKey).toBe(true);
  expect(state.secrets.get(completionSecretKey(DEFAULT_ENDPOINT))).toBe('fim-secret');
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(state.update.mock.calls.every(call => call[2] === 1)).toBe(true);
});

it('cancelling the key prompt leaves credentials and settings unchanged', async () => {
  state.input.mockResolvedValueOnce(undefined);
  await expect(service().save(preferences, true)).rejects.toThrow('已取消');
  expect(state.store).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
});

it('can enable the official Mercury FIM service using an existing provider key without rewriting it', async () => {
  const oldKeyId = completionSecretKey(legacyEditEndpoint);
  state.secrets.set(oldKeyId, 'shared-mercury-key');
  const mercury = { ...preferences, endpoint: MERCURY_FIM_ENDPOINT, model: 'mercury-edit-2' };
  await service().save(mercury, false);
  expect(await service().read()).toMatchObject({ completionHasKey: true, completion: mercury });
  expect(state.input).not.toHaveBeenCalled();
  expect(state.store).not.toHaveBeenCalled();
  expect([...state.secrets]).toEqual([[oldKeyId, 'shared-mercury-key']]);
});

it('requires credentials before enabling an authenticated provider', async () => {
  await expect(service().save(preferences, false)).rejects.toThrow('请先设置 API Key');
  expect(state.update).not.toHaveBeenCalled();
  await service().save({ ...preferences, enabled: false }, false);
  expect(state.values.model).toBe('codestral-2508');
});

it('leaves the retired route and its credential untouched until the user explicitly selects FIM', async () => {
  state.values = { enabled: true, protocol: 'mercury-edit', endpoint: legacyEditEndpoint, model: 'legacy-model', fimEnabled: false };
  const legacyKeyId = completionSecretKey(legacyEditEndpoint);
  state.secrets.set(legacyKeyId, 'existing-edit');
  const result = await service().read();
  expect(result).toMatchObject({ completionHasKey: false, completion: { enabled: false, protocol: 'fim', endpoint: DEFAULT_ENDPOINT } });
  expect(JSON.stringify(result)).not.toContain(legacyEditEndpoint);
  expect(state.get).not.toHaveBeenCalledWith(legacyKeyId);
  await service().save({ ...result.completion, autoTrigger: false }, false);
  expect(state.values).toMatchObject({ enabled: true, autoTrigger: false, protocol: 'mercury-edit', endpoint: legacyEditEndpoint, fimEnabled: false });
  const ollama = { ...result.completion, enabled: true, protocol: 'ollama' as const, endpoint: 'http://localhost:11434/api/generate', model: 'qwen2.5-coder' };
  await service().save(ollama, false);
  expect((await service().read()).completion).toEqual(ollama);
  expect(state.values.fimEnabled).toBeUndefined();
  expect(state.get).not.toHaveBeenCalledWith(legacyKeyId);
  expect([...state.secrets]).toEqual([[legacyKeyId, 'existing-edit']]);
});

it('rejects a retired edit endpoint before accessing keys or updating settings', async () => {
  await expect(service().save({ ...preferences, endpoint: legacyEditEndpoint }, true)).rejects.toThrow('Use a FIM endpoint');
  expect(state.get).not.toHaveBeenCalled();
  expect(state.input).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
});

it('rejects enabling FIM from an untrusted workspace before accessing the key', async () => {
  state.trusted = false;
  await expect(service().save(preferences, true)).rejects.toThrow('请先信任当前工作区');
  expect(state.get).not.toHaveBeenCalled();
  expect(state.input).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
});

it('accepts only the FIM service draft and never accepts credentials in the bridge payload', () => {
  const request = { type: 'management.request', version: MANAGEMENT_VERSION, requestId: 'completion',
    action: { kind: 'completion.save', preferences, setApiKey: false } };
  expect(parseManagementRequest(request)).toEqual(request);
  expect(parseManagementRequest({ ...request, action: { ...request.action, apiKey: 'not-allowed' } })).toBeUndefined();
  expect(parseManagementRequest({ ...request, action: { ...request.action, setNextEditApiKey: true } })).toBeUndefined();
  expect(parseManagementRequest({ ...request, action: { ...request.action, preferences: { ...preferences,
    protocol: 'mercury-edit' } } })).toBeUndefined();
});
