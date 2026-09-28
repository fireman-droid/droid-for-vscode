import { createHash } from 'node:crypto';
import * as vscode from 'vscode';

export const COMPLETION_SECTION = 'droidvisx.autocomplete';
export const DEFAULT_ENDPOINT = 'https://api.mistral.ai/v1/fim/completions';
export const DEFAULT_EXCLUSIONS = [
  '**/.env', '**/.env.*', '**/*.{pem,key,p12,pfx}',
  '**/{.git,node_modules,dist,build,vendor}/**',
];

export interface CompletionSettings {
  enabled: boolean;
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
    if (url.pathname === '/') return 'Enter the complete FIM endpoint, including its path.';
  } catch {
    return 'Enter a valid FIM endpoint URL.';
  }
  return undefined;
}

export function completionSecretKey(endpoint: string): string {
  return 'droidvisx.autocomplete.key.' +
    createHash('sha256').update(new URL(endpoint).toString()).digest('hex');
}

export async function configureCompletion(secrets: vscode.SecretStorage): Promise<boolean> {
  const config = vscode.workspace.getConfiguration(COMPLETION_SECTION);
  const current = readCompletionSettings();
  const endpoint = await vscode.window.showInputBox({
    title: 'Droid autocomplete · FIM endpoint',
    prompt: 'Full native FIM endpoint. Chat-completions APIs are not interchangeable with FIM.',
    value: current.endpoint,
    ignoreFocusOut: true,
    validateInput: validateCompletionEndpoint,
  });
  if (endpoint === undefined) return false;
  const target = endpoint.trim();
  const model = await vscode.window.showInputBox({
    title: 'Droid autocomplete · Model',
    prompt: 'Use a FIM-capable model, for example codestral-latest with Mistral.',
    value: current.model,
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() ? undefined : 'Enter a model ID.',
  });
  if (model === undefined) return false;
  const keyId = completionSecretKey(target);
  const existingKey = await secrets.get(keyId);
  const key = await vscode.window.showInputBox({
    title: 'Droid autocomplete · API key',
    prompt: existingKey
      ? 'Stored in SecretStorage. Leave blank to keep the key for this endpoint.'
      : 'Stored in SecretStorage. Use the completion provider key, not a Droid session token.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (value) => value.trim() || existingKey ? undefined : 'Enter the provider API key.',
  });
  if (key === undefined) return false;
  if (key.trim()) await secrets.store(keyId, key.trim());
  await config.update('endpoint', target, vscode.ConfigurationTarget.Global);
  await config.update('model', model.trim(), vscode.ConfigurationTarget.Global);
  return true;
}

export async function setCompletionEnabled(enabled: boolean): Promise<void> {
  const config = vscode.workspace.getConfiguration(
    COMPLETION_SECTION, vscode.window.activeTextEditor?.document.uri,
  );
  const inspection = config.inspect<boolean>('enabled');
  const target = inspection?.workspaceFolderValue !== undefined
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : inspection?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace : vscode.ConfigurationTarget.Global;
  await config.update('enabled', enabled, target);
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
