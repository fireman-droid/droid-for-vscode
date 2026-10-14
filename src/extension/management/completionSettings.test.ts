import { beforeEach, expect, it, vi } from 'vitest';
import type * as vscode from 'vscode';
import type { CompletionPreferences } from '../../shared/protocol/managementPageProtocol';
import { parseManagementRequest } from '../../shared/protocol/managementPageProtocol';

const state = vi.hoisted(() => ({ values: {} as Record<string, unknown>, secrets: new Map<string, string>(),
  update: vi.fn(), input: vi.fn(), store: vi.fn() }));
vi.mock('vscode', () => ({
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  workspace: { isTrusted: true, getConfiguration: () => ({
    get: (key: string, fallback: unknown) => state.values[key] ?? fallback,
    inspect: (key: string) => ({ globalValue: state.values[key] }), update: state.update,
  }) }, window: { showInputBox: state.input },
}));
vi.mock('../webview/webviewTheme', () => ({ readWebviewBootTheme: () => ({ resolved: 'dark' }), readWebviewThemePreference: () => 'auto' }));
import { ManagementSettingsService } from './managementSettings';
import { completionSecretKey, DEFAULT_ENDPOINT, MERCURY_EDIT_ENDPOINT, MERCURY_FIM_ENDPOINT } from '../autocomplete/settings';

const preferences: CompletionPreferences = { enabled: true, fimEnabled: true, protocol: 'fim', model: 'codestral-2508',
  endpoint: DEFAULT_ENDPOINT, autoTrigger: true, relatedFiles: true, debounceMs: 350, adaptiveDebounce: true,
  nextEdit: { enabled: true, endpoint: MERCURY_EDIT_ENDPOINT, model: 'mercury-edit-2' } };
const service = () => new ManagementSettingsService({
  get: async (key: string) => state.secrets.get(key), store: state.store,
} as unknown as vscode.SecretStorage, 'test', () => ({ cwd: null, connection: 'connected', ide: 'connected', sessionManagementAvailable: false }), () => []);

beforeEach(() => {
  state.values = {}; state.secrets.clear(); state.input.mockReset();
  state.update.mockReset().mockImplementation(async (key: string, value: unknown) => { state.values[key] = value; });
  state.store.mockReset().mockImplementation(async (key: string, value: string) => { state.secrets.set(key, value); });
});

it('round-trips both services and keeps their credentials out of the bridge', async () => {
  state.input.mockResolvedValueOnce('fim-secret').mockResolvedValueOnce('edit-secret');
  await service().save(preferences, true, true);
  const result = await service().read();
  expect(result.completion).toEqual(preferences);
  expect(result).toMatchObject({ completionHasKey: true, nextEditHasKey: true });
  expect(state.secrets.get(completionSecretKey(DEFAULT_ENDPOINT))).toBe('fim-secret');
  expect(state.secrets.get(completionSecretKey(MERCURY_EDIT_ENDPOINT))).toBe('edit-secret');
  expect(JSON.stringify(result)).not.toContain('secret');
  expect(state.update.mock.calls.every(call => call[2] === 1)).toBe(true);
});

it('cancelling the second key prompt does not save the first key or either service', async () => {
  state.input.mockResolvedValueOnce('new-fim-key').mockResolvedValueOnce(undefined);
  await expect(service().save(preferences, true, true)).rejects.toThrow('已取消');
  expect(state.store).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
});

it('can enable both official Mercury services with one newly entered provider key', async () => {
  state.input.mockResolvedValue('shared-mercury-key');
  await service().save({ ...preferences, endpoint: MERCURY_FIM_ENDPOINT, model: 'mercury-edit-2' }, true, false);
  expect(state.input).toHaveBeenCalledOnce();
  expect(state.secrets.get(completionSecretKey(MERCURY_EDIT_ENDPOINT))).toBe('shared-mercury-key');
  expect(state.secrets.get(completionSecretKey(DEFAULT_ENDPOINT))).toBeUndefined();
});

it('requires only enabled services to have credentials', async () => {
  state.secrets.set(completionSecretKey(DEFAULT_ENDPOINT), 'existing');
  await expect(service().save(preferences, false)).rejects.toThrow('Next Edit');
  expect(state.update).not.toHaveBeenCalled();
  await service().save({ ...preferences, nextEdit: { ...preferences.nextEdit, enabled: false } }, false);
  expect(state.values.model).toBe('codestral-2508');
});

it('presents legacy edit-only settings without silently enabling FIM', async () => {
  state.values = { enabled: true, protocol: 'mercury-edit', endpoint: MERCURY_EDIT_ENDPOINT, model: 'mercury-edit-2' };
  state.secrets.set(completionSecretKey(MERCURY_EDIT_ENDPOINT), 'existing-edit');
  const { completion } = await service().read();
  expect(completion).toMatchObject({ protocol: 'fim', fimEnabled: false, nextEdit: preferences.nextEdit });
  await service().save(completion, false);
  expect((await service().read()).completion).toEqual(completion);
});

it('rejects an ordinary FIM endpoint for edit predictions before saving', async () => {
  await expect(service().save({ ...preferences, nextEdit: { ...preferences.nextEdit, endpoint: DEFAULT_ENDPOINT } }, true, true)).rejects.toThrow('Next Edit');
  expect(state.input).not.toHaveBeenCalled(); expect(state.update).not.toHaveBeenCalled();
});

it('validates both service drafts and rejects credentials in the bridge payload', () => {
  const request = { type: 'management.request', version: 1, requestId: 'completion',
    action: { kind: 'completion.save', preferences, setApiKey: false, setNextEditApiKey: true } };
  expect(parseManagementRequest(request)).toEqual(request);
  expect(parseManagementRequest({ ...request, action: { ...request.action, apiKey: 'not-allowed' } })).toBeUndefined();
  expect(parseManagementRequest({ ...request, action: { ...request.action, preferences: { ...preferences,
    nextEdit: { ...preferences.nextEdit, enabled: 'yes' } } } })).toBeUndefined();
});
