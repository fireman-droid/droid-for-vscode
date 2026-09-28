import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import type { CompletionProtocol } from '../../runtime/autocomplete/requestCompletion';

export const COMPLETION_SECTION = 'droidvisx.autocomplete';
export const DEFAULT_ENDPOINT = 'https://api.mistral.ai/v1/fim/completions';
export const DEFAULT_EXCLUSIONS = [
  '**/.env', '**/.env.*', '**/*.{pem,key,p12,pfx}',
  '**/{.git,node_modules,dist,build,vendor}/**',
];

export interface CompletionSettings {
  enabled: boolean;
  protocol: CompletionProtocol;
  relatedFiles: boolean;
  endpoint: string;
  model: string;
  debounceMs: number;
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
  return {
    enabled: config.get<boolean>('enabled', false),
    protocol: userValue('protocol', 'fim') === 'ollama' ? 'ollama' : 'fim',
    relatedFiles: config.get<boolean>('relatedFiles', true),
    endpoint: userValue('endpoint', DEFAULT_ENDPOINT).trim(),
    model: userValue('model', 'codestral-latest').trim(),
    debounceMs: boundedNumber(config.get('debounceMs'), 350, 100, 2000),
    maxContextCharacters: boundedNumber(config.get('maxContextCharacters'), 12000, 1000, 32000),
    maxTokens: boundedNumber(config.get('maxTokens'), 256, 32, 1024),
    excludePatterns: config.get<string[]>('excludePatterns', DEFAULT_EXCLUSIONS),
  };
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
}

export function validateCompletionEndpoint(value: string): string | undefined {
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
    if (/\/(?:chat\/completions|api\/chat)\/?$/i.test(url.pathname)) {
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

export function completionNeedsKey(endpoint: string): boolean {
  return ['api.mistral.ai', 'codestral.mistral.ai', 'api.deepseek.com'].includes(new URL(endpoint).hostname);
}

export async function configureCompletion(secrets: vscode.SecretStorage): Promise<boolean> {
  const config = vscode.workspace.getConfiguration(COMPLETION_SECTION);
  const current = readCompletionSettings();
  const preset = await vscode.window.showQuickPick([
    { label: 'Current configuration', description: current.model, protocol: current.protocol, endpoint: current.endpoint, model: current.model },
    { label: 'Mistral / Codestral', description: 'Native cloud FIM', protocol: 'fim' as const, endpoint: DEFAULT_ENDPOINT, model: 'codestral-latest' },
    { label: 'DeepSeek', description: 'Beta FIM completions', protocol: 'fim' as const, endpoint: 'https://api.deepseek.com/beta/completions', model: 'deepseek-flash' },
    { label: 'Ollama', description: 'Local FIM model', protocol: 'ollama' as const, endpoint: 'http://localhost:11434/api/generate', model: 'qwen2.5-coder:7b-base' },
    { label: 'Custom FIM service', description: 'Native prompt + suffix API', protocol: 'fim' as const, endpoint: current.endpoint, model: current.model },
  ], { title: 'Droid autocomplete · Service', ignoreFocusOut: true });
  if (!preset) return false;
  const endpoint = await vscode.window.showInputBox({
    title: 'Droid autocomplete · Endpoint',
    prompt: preset.protocol === 'ollama' ? 'Complete Ollama /api/generate URL.'
      : 'Complete native FIM URL. Ordinary chat-completions APIs do not accept this protocol.',
    value: preset.endpoint,
    ignoreFocusOut: true,
    validateInput: validateCompletionEndpoint,
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
  const keyId = completionSecretKey(target);
  const existingKey = await secrets.get(keyId);
  const required = completionNeedsKey(target);
  const key = await vscode.window.showInputBox({
    title: 'Droid autocomplete · API key',
    prompt: existingKey
      ? 'Leave blank to keep this endpoint’s saved key. Use Remove API key from the status menu to clear it.'
      : required ? 'Stored in SecretStorage. Use this provider’s API key, not a Droid session token.'
        : 'Optional for local or unauthenticated services. Leave blank if the server does not require a key.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => !required || value.trim() || existingKey ? undefined : 'Enter the provider API key.',
  });
  if (key === undefined) return false;
  if (key.trim()) await secrets.store(keyId, key.trim());
  await config.update('endpoint', target, vscode.ConfigurationTarget.Global);
  await config.update('model', model.trim(), vscode.ConfigurationTarget.Global);
  await config.update('protocol', preset.protocol, vscode.ConfigurationTarget.Global);
  return true;
}

export function setCompletionEnabled(enabled: boolean): Promise<void> {
  return updateResourceSetting('enabled', enabled);
}

export function setRelatedFilesEnabled(enabled: boolean): Promise<void> {
  return updateResourceSetting('relatedFiles', enabled);
}

async function updateResourceSetting(key: 'enabled' | 'relatedFiles', value: boolean): Promise<void> {
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
  if (!['file', 'untitled'].includes(document.uri.scheme)) return 'This document type is not supported.';
  if (!vscode.workspace.getConfiguration('editor', document.uri).get('inlineSuggest.enabled', true)) {
    return 'Enable Editor: Inline Suggest in editor settings.';
  }
  if (settings.excludePatterns.some((pattern) =>
    vscode.languages.match({ pattern, scheme: document.uri.scheme }, document) > 0)) {
    return 'This file is excluded from Droid autocomplete.';
  }
  return undefined;
}
