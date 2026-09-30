import * as vscode from 'vscode';
import { parse, type ParseError } from 'jsonc-parser';

export type LanguageComments = { line?: string; block?: [string, string] };
type ConfigurationSource = { uri: vscode.Uri; path: string };
const MAX_CONFIGURATION_BYTES = 128 * 1024;
const METADATA_TIMEOUT_MS = 150;
let sourceFingerprint = '';
const cache = new Map<string, Promise<LanguageComments | undefined>>();

/** Read installed language metadata without activating an extension or opening source files. */
export async function readLanguageComments(
  languageId: string, signal?: AbortSignal,
): Promise<LanguageComments | undefined> {
  if (signal?.aborted) return undefined;
  const sources = findSources(languageId);
  const fingerprint = JSON.stringify(vscode.extensions.all.map((extension) => [
    extension.id, extension.extensionUri.toString(), extension.packageJSON.version,
    extension.packageJSON.contributes?.languages,
  ]));
  if (fingerprint !== sourceFingerprint) {
    cache.clear();
    sourceFingerprint = fingerprint;
  }
  let pending = cache.get(languageId);
  if (!pending) {
    pending = readWithDeadline(languageId, sources);
    cache.set(languageId, pending);
  }
  return untilCancelled(pending, signal);
}

function readWithDeadline(
  languageId: string, sources: ConfigurationSource[],
): Promise<LanguageComments | undefined> {
  const pending = new Promise<LanguageComments | undefined>((resolve, reject) => {
    const timer = setTimeout(() => {
      // A provider that hangs must not leave a permanently pending cache entry.
      if (cache.get(languageId) === pending) cache.delete(languageId);
      resolve(undefined);
    }, METADATA_TIMEOUT_MS);
    readSources(sources).then((comments) => {
      clearTimeout(timer);
      resolve(comments);
    }, (error: unknown) => {
      clearTimeout(timer);
      if (cache.get(languageId) === pending) cache.delete(languageId);
      reject(error);
    });
  });
  return pending;
}

function untilCancelled(
  pending: Promise<LanguageComments | undefined>, signal?: AbortSignal,
): Promise<LanguageComments | undefined> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    const onAbort = () => { cleanup(); resolve(undefined); };
    signal.addEventListener('abort', onAbort, { once: true });
    // Cancelling a caller leaves the shared read and its bounded lifetime intact.
    pending.then((comments) => { cleanup(); resolve(comments); }, (error: unknown) => {
      cleanup();
      reject(error);
    });
  });
}

function findSources(languageId: string): ConfigurationSource[] {
  const sources: ConfigurationSource[] = [];
  for (const extension of vscode.extensions.all) {
    const languages: unknown = extension.packageJSON.contributes?.languages;
    if (!Array.isArray(languages)) continue;
    for (const language of languages) {
      if (!language || typeof language !== 'object' || language.id !== languageId
        || typeof language.configuration !== 'string') continue;
      const path = language.configuration.replace(/\\/g, '/');
      if (!path || path.startsWith('/') || /^[a-z][a-z\d+.-]*:/i.test(path)
        || path.split('/').includes('..')) continue;
      sources.push({ uri: extension.extensionUri, path });
    }
  }
  return sources;
}

async function readSources(sources: ConfigurationSource[]): Promise<LanguageComments | undefined> {
  // Later contributions can override the built-in language configuration.
  for (const source of sources.slice().reverse()) {
    let bytes: Uint8Array;
    try {
      const uri = vscode.Uri.joinPath(source.uri, source.path);
      if ((await vscode.workspace.fs.stat(uri)).size > MAX_CONFIGURATION_BYTES) continue;
      bytes = await vscode.workspace.fs.readFile(uri);
    } catch {
      // Language metadata is optional (an extension can disappear while requests are pending).
      continue;
    }
    if (bytes.byteLength > MAX_CONFIGURATION_BYTES) continue;
    const errors: ParseError[] = [];
    const configuration: unknown = parse(Buffer.from(bytes).toString('utf8'), errors, {
      allowTrailingComma: true,
    });
    if (errors.length || !configuration || typeof configuration !== 'object') continue;
    const comments = (configuration as { comments?: unknown }).comments;
    if (!comments || typeof comments !== 'object') continue;
    const candidate = comments as { lineComment?: unknown; blockComment?: unknown };
    const line = marker(candidate.lineComment);
    const block = Array.isArray(candidate.blockComment) && candidate.blockComment.length === 2
      && marker(candidate.blockComment[0]) && marker(candidate.blockComment[1])
      ? candidate.blockComment as [string, string] : undefined;
    if (line || block) return { ...(line ? { line } : {}), ...(block ? { block } : {}) };
  }
  return undefined;
}

function marker(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 128
    && !/[\r\n\0]/.test(value) ? value : undefined;
}
