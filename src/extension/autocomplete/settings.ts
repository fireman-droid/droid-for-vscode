import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import { notebookUri, supportsNotebook } from './kilo/continuedev/core/autocomplete/notebook';
import type { CompletionProtocol } from '../../runtime/autocomplete/requestCompletion';
import { isRetiredEditEndpoint, RETIRED_EDIT_ENDPOINT_MESSAGE } from '../../runtime/autocomplete/completionTransport';

export const COMPLETION_SECTION = 'droidvisx.autocomplete';
export const DEFAULT_ENDPOINT = 'https://api.mistral.ai/v1/fim/completions';
export const MERCURY_FIM_ENDPOINT = 'https://api.inceptionlabs.ai/v1/fim/completions';
const LEGACY_MERCURY_KEY_ENDPOINT = 'https://api.inceptionlabs.ai/v1/edit/completions';
const DEFAULT_MODEL = 'codestral-latest';
export const DEFAULT_EXCLUSIONS = [
  '**/.env', '**/.env.*', '**/*.{pem,key,p12,pfx}',
  '**/{.git,node_modules,dist,build,vendor}/**',
];

export interface CompletionSettings {
  enabled: boolean;
  requiresConfiguration: boolean;
  autoTrigger?: boolean;
  snoozeUntil?: number;
  protocol: CompletionProtocol;
  relatedFiles: boolean;
  includeClipboard?: boolean;
  staticContext?: boolean;
  endpoint: string;
  model: string;
  debounceMs: number;
  adaptiveDebounce?: boolean;
  maxContextCharacters: number;
  maxTokens: number;
  excludePatterns: string[];
}

export function readCompletionSettings(uri?: vscode.Uri): CompletionSettings {
  const config = vscode.workspace.getConfiguration(COMPLETION_SECTION, uri);
  // An opened repository cannot change where we send code or credentials.
  const userConfig = vscode.workspace.getConfiguration(COMPLETION_SECTION);
  const userValue = (key: string, fallback: string) =>
    userConfig.inspect<string>(key)?.globalValue ?? fallback;
  const protocol = userValue('protocol', 'fim');
  const endpoint = userValue('endpoint', DEFAULT_ENDPOINT).trim();
  const retiredRoute = protocol === 'mercury-edit' || isSavedEditEndpoint(endpoint);
  const requiresConfiguration = retiredRoute || userConfig.inspect<boolean>('fimEnabled')?.globalValue === false;
  return {
    enabled: !requiresConfiguration && config.get<boolean>('enabled', false),
    requiresConfiguration,
    autoTrigger: config.get<boolean>('autoTrigger', true),
    snoozeUntil: userConfig.inspect<number>('snoozeUntil')?.globalValue ?? 0,
    protocol: !retiredRoute && (protocol === 'ollama' || protocol === 'siliconflow-fim') ? protocol : 'fim',
    relatedFiles: config.get<boolean>('relatedFiles', true),
    includeClipboard: userConfig.inspect<boolean>('includeClipboard')?.globalValue === true,
    staticContext: config.get<boolean>('staticContext', false),
    endpoint: retiredRoute ? DEFAULT_ENDPOINT : endpoint,
    model: retiredRoute ? DEFAULT_MODEL : userValue('model', DEFAULT_MODEL).trim(),
    adaptiveDebounce: config.get<boolean>('adaptiveDebounce', true),
    debounceMs: boundedNumber(config.get('debounceMs'), 350, 100, 2000),
    maxContextCharacters: boundedNumber(config.get('maxContextCharacters'), 12000, 1000, 32000),
    maxTokens: boundedNumber(config.get('maxTokens'), 256, 32, 1024),
    excludePatterns: config.get<string[]>('excludePatterns', DEFAULT_EXCLUSIONS),
  };
}

function isSavedEditEndpoint(endpoint: string): boolean {
  try { return isRetiredEditEndpoint(new URL(endpoint)); } catch { return false; }
}

/** Clear the retired switch only after the user explicitly configures or enables FIM. */
export async function clearLegacyFimSwitch(config: vscode.WorkspaceConfiguration): Promise<void> {
  if (config.inspect<boolean>('fimEnabled')?.globalValue === false) {
    await config.update('fimEnabled', undefined, vscode.ConfigurationTarget.Global);
  }
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

export function validateCompletionEndpoint(
  value: string, protocol: CompletionProtocol = 'fim',
): string | undefined {
  try {
    const url = new URL(value);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
      return 'Use HTTPS, or HTTP for a local server.';
    }
    if (url.username || url.password || url.search || url.hash) {
      return 'Put the API key in SecretStorage, not in the endpoint URL.';
    }
    if (url.pathname === '/') return 'Enter the complete completion endpoint, including its path.';
    if (isRetiredEditEndpoint(url)) return RETIRED_EDIT_ENDPOINT_MESSAGE;
    if (protocol === 'siliconflow-fim') {
      if (!/\/chat\/completions\/?$/i.test(url.pathname)) {
        return 'Use the SiliconFlow /v1/chat/completions endpoint for FIM.';
      }
    } else if (/\/(?:chat\/completions|api\/chat)\/?$/i.test(url.pathname)) {
      return 'This is a chat endpoint. Use a FIM endpoint or Ollama /api/generate.';
    }
  } catch {
    return 'Enter a valid FIM endpoint URL.';
  }
  return undefined;
}

export function completionSecretKey(endpoint: string): string {
  return 'droidvisx.autocomplete.key.' +
    createHash('sha256').update(new URL(endpoint).toString()).digest('hex');
}

/** Old releases stored the same official Inception provider key under two endpoint hashes. */
export async function readCompletionKey(secrets: vscode.SecretStorage, endpoint: string): Promise<string | undefined> {
  const current = await secrets.get(completionSecretKey(endpoint));
  if (current) return current;
  return isOfficialMercuryFim(endpoint) ? secrets.get(completionSecretKey(LEGACY_MERCURY_KEY_ENDPOINT)) : undefined;
}

function isOfficialMercuryFim(endpoint: string): boolean {
  return new URL(endpoint).toString().replace(/\/$/, '') === MERCURY_FIM_ENDPOINT;
}

export async function removeCompletionKey(secrets: vscode.SecretStorage, endpoint: string): Promise<void> {
  await secrets.delete(completionSecretKey(endpoint));
  if (isOfficialMercuryFim(endpoint)) await secrets.delete(completionSecretKey(LEGACY_MERCURY_KEY_ENDPOINT));
}

export function completionNeedsKey(endpoint: string): boolean {
  return ['api.mistral.ai', 'codestral.mistral.ai', 'api.deepseek.com', 'api.siliconflow.cn', 'api.inceptionlabs.ai']
    .includes(new URL(endpoint).hostname);
}

export async function configureCompletion(secrets: vscode.SecretStorage): Promise<boolean> {
  const config = vscode.workspace.getConfiguration(COMPLETION_SECTION);
  const current = readCompletionSettings();
  const preset = await vscode.window.showQuickPick([
    ...(!current.requiresConfiguration ? [{ label: 'Current configuration', description: current.model, protocol: current.protocol, endpoint: current.endpoint, model: current.model }] : []),
    { label: 'Mistral / Codestral', description: 'Native cloud FIM', protocol: 'fim' as const, endpoint: DEFAULT_ENDPOINT, model: DEFAULT_MODEL },
    { label: 'DeepSeek', description: 'Beta FIM completions', protocol: 'fim' as const, endpoint: 'https://api.deepseek.com/beta/completions', model: 'deepseek-flash' },
    { label: 'SiliconFlow', description: 'Qwen Coder with SiliconFlow FIM', protocol: 'siliconflow-fim' as const, endpoint: 'https://api.siliconflow.cn/v1/chat/completions', model: 'Qwen/Qwen3-Coder-30B-A3B-Instruct' },
    { label: 'Ollama', description: 'Local FIM model', protocol: 'ollama' as const, endpoint: 'http://localhost:11434/api/generate', model: 'qwen2.5-coder:7b-base' },
    { label: 'Inception / Mercury Code Completion', description: 'Native FIM; requires an Inception key', protocol: 'fim' as const, endpoint: MERCURY_FIM_ENDPOINT, model: 'mercury-edit-2' },
    { label: 'Custom FIM service', description: 'Native prompt + suffix API', protocol: 'fim' as const, endpoint: current.endpoint, model: current.model },
  ], { title: 'Droid autocomplete · Service', ignoreFocusOut: true });
  if (!preset) return false;
  const endpoint = await vscode.window.showInputBox({
    title: 'Droid autocomplete · Endpoint',
    prompt: preset.protocol === 'ollama' ? 'Complete Ollama /api/generate URL.'
      : preset.protocol === 'siliconflow-fim' ? 'Complete SiliconFlow /v1/chat/completions URL. Uses its FIM prefix/suffix extension.'
        : 'Complete native FIM URL. Ordinary chat-completions APIs do not accept this protocol.',
    value: preset.endpoint,
    ignoreFocusOut: true,
    validateInput: (value) => validateCompletionEndpoint(value, preset.protocol),
  });
  if (endpoint === undefined) return false;
  const target = endpoint.trim();
  const model = await vscode.window.showInputBox({
    title: 'Droid autocomplete · Model',
    prompt: preset.protocol === 'ollama' ? 'Enter the name of an installed model that supports FIM / suffix.'
      : 'Enter a FIM-capable model ID on this service.',
    value: preset.model,
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : 'Enter a model ID.',
  });
  if (model === undefined) return false;
  const existingKey = await readCompletionKey(secrets, target);
  const required = completionNeedsKey(target);
  const key = await vscode.window.showInputBox({
    title: 'Droid autocomplete · API key',
    prompt: existingKey
      ? 'Leave blank to keep the saved provider key. Use Remove API key from the status menu to clear it.'
      : required ? 'Stored in SecretStorage. Use this provider’s API key, not a Droid session token.'
        : 'Optional for local or unauthenticated services. Leave blank if the server does not require a key.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => !required || value.trim() || existingKey ? undefined : 'Enter the provider API key.',
  });
  if (key === undefined) return false;
  if (key.trim()) await secrets.store(completionSecretKey(target), key.trim());
  await config.update('endpoint', target, vscode.ConfigurationTarget.Global);
  await config.update('model', model.trim(), vscode.ConfigurationTarget.Global);
  await config.update('protocol', preset.protocol, vscode.ConfigurationTarget.Global);
  await clearLegacyFimSwitch(config);
  return true;
}

export function setCompletionEnabled(enabled: boolean): Promise<void> {
  return updateResourceSetting('enabled', enabled);
}

export function setAutoTriggerEnabled(enabled: boolean): Promise<void> {
  return updateResourceSetting('autoTrigger', enabled);
}
export async function setCompletionSnooze(minutes: number): Promise<void> {
  await vscode.workspace.getConfiguration(COMPLETION_SECTION).update('snoozeUntil',
    minutes > 0 ? Date.now() + minutes * 60_000 : undefined, vscode.ConfigurationTarget.Global);
}

export function setRelatedFilesEnabled(enabled: boolean): Promise<void> {
  return updateResourceSetting('relatedFiles', enabled);
}

async function updateResourceSetting(key: 'enabled' | 'relatedFiles' | 'autoTrigger', value: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration(
    COMPLETION_SECTION, vscode.window.activeTextEditor?.document.uri,
  );
  const inspection = config.inspect<boolean>(key);
  const target = inspection?.workspaceFolderValue !== undefined
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : inspection?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await config.update(key, value, target);
}

export function completionDocumentBlockReason(
  document: vscode.TextDocument, settings: CompletionSettings,
): string | undefined {
  if (!vscode.workspace.isTrusted) return 'Autocomplete is unavailable in an untrusted workspace.';
  if (!['file', 'untitled', 'vscode-notebook-cell'].includes(document.uri.scheme)) return 'This document type is not supported.';
  if (document.uri.scheme === 'vscode-notebook-cell' && !supportsNotebook(document)) return 'Only supported notebook code cells can receive suggestions.';
  if (!vscode.workspace.getConfiguration('editor', document.uri).get('inlineSuggest.enabled', true)) {
    return 'Enable Editor: Inline Suggest in editor settings.';
  }
  const policyUri = notebookUri(document.uri) ?? document.uri;
  if (settings.excludePatterns.some((pattern) =>
    vscode.languages.match({ pattern, scheme: policyUri.scheme }, { uri: policyUri, languageId: document.languageId } as vscode.TextDocument) > 0)) {
    return 'This file is excluded from Droid autocomplete.';
  }
  return undefined;
}
