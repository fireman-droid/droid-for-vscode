import * as vscode from 'vscode';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';

const MAX_SOURCE_BYTES = 1024 * 1024;
const FORBIDDEN_PART = /^(?:\.git|\.gitignore|\.droidignore|\.ssh|\.aws|\.gnupg|\.kube|node_modules|vendor|dist|build|coverage|\.next|\.env(?:\..*)?|\.npmrc|\.pypirc|\.netrc|credentials(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?)$/i;
const FORBIDDEN_EXTENSION = /\.(?:pem|key|p12|pfx|jks|keystore|crt|cer|der|png|jpe?g|gif|webp|ico|pdf|zip|gz|tar|7z|rar|woff2?|ttf|mp[34]|mov|wav|exe|dll|so|dylib|wasm|db|sqlite3?)$/i;

export function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

/** Ancillary files are optional: unreadable, binary and oversized files provide no context. */
export async function readContextFile(file: string, maxBytes = MAX_SOURCE_BYTES): Promise<string | undefined> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await open(file, 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) return undefined;
    const buffer = Buffer.alloc(Math.min(maxBytes + 1, info.size + 1));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes || buffer.subarray(0, bytesRead).includes(0)) return undefined;
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead));
  } catch {
    return undefined;
  } finally {
    await handle?.close();
  }
}

interface IgnoreRules { git: Ignore; droid: Ignore }
interface IgnoreLevel { directory: string; rules: IgnoreRules }

function ignoredByLevels(levels: IgnoreLevel[], file: string, isDirectory: boolean): boolean {
  return (['git', 'droid'] as const).some((kind) => {
    let ignored = false;
    for (const level of levels) {
      const relative = path.relative(level.directory, file).split(path.sep).join('/') + (isDirectory ? '/' : '');
      const result = level.rules[kind].test(relative);
      if (result.ignored) ignored = true;
      else if (result.unignored) ignored = false;
    }
    return ignored;
  });
}

export class CompletionFilePolicy {
  private readonly rules = new Map<string, Promise<IgnoreRules | undefined>>();
  private readonly realRoots = new Map<string, Promise<string>>();

  invalidate(): void { this.rules.clear(); this.realRoots.clear(); }

  async allows(
    uri: vscode.Uri, root: vscode.Uri, languageId: string,
    excludePatterns: readonly string[], signal: AbortSignal,
  ): Promise<boolean> {
    if (signal.aborted || uri.scheme !== 'file' || root.scheme !== 'file' || !inside(root.fsPath, uri.fsPath)) return false;
    const relative = path.relative(root.fsPath, uri.fsPath).split(path.sep).join('/');
    if (relative.split('/').some((part) => FORBIDDEN_PART.test(part)) || FORBIDDEN_EXTENSION.test(relative)) return false;
    const selectorDocument = { uri, languageId } as vscode.TextDocument;
    if (excludePatterns.some((pattern) => vscode.languages.match({ pattern, scheme: 'file' }, selectorDocument) > 0)) return false;
    try {
      let rootPath = this.realRoots.get(root.fsPath);
      if (!rootPath) { rootPath = realpath(root.fsPath); this.realRoots.set(root.fsPath, rootPath); }
      const [resolvedRoot, resolvedFile] = await Promise.all([rootPath, realpath(uri.fsPath)]);
      if (!inside(resolvedRoot, resolvedFile) || signal.aborted) return false;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return false;
      // New unsaved files are eligible only when their existing parent stays in the root.
      try {
        const [resolvedRoot, resolvedParent] = await Promise.all([realpath(root.fsPath), realpath(path.dirname(uri.fsPath))]);
        if (resolvedParent !== resolvedRoot && !inside(resolvedRoot, resolvedParent)) return false;
      } catch { return false; }
    }
    const levels: IgnoreLevel[] = [];
    for (let directory = root.fsPath; ; ) {
      if (signal.aborted) return false;
      const rules = await this.directoryRules(directory, root);
      if (!rules) return false;
      const relativeToDirectory = path.relative(directory, uri.fsPath).split(path.sep).join('/');
      levels.push({ directory, rules });
      const nextPart = relativeToDirectory.split('/');
      if (nextPart.length <= 1) return !signal.aborted && !ignoredByLevels(levels, uri.fsPath, false);
      directory = path.join(directory, nextPart[0]);
      // Git cannot resurrect files inside an ignored parent directory. A file-only
      // match can still be overridden by a deeper ignore file, evaluated above.
      if (ignoredByLevels(levels, directory, true)) return false;
    }
  }

  private directoryRules(directory: string, root: vscode.Uri): Promise<IgnoreRules | undefined> {
    let pending = this.rules.get(directory);
    if (!pending) {
      pending = this.readRules(directory, root);
      this.rules.set(directory, pending);
      if (this.rules.size > 128) this.rules.delete(this.rules.keys().next().value!);
    }
    return pending;
  }

  private async readRules(directory: string, root: vscode.Uri): Promise<IgnoreRules | undefined> {
    const rules: IgnoreRules = { git: ignore(), droid: ignore() };
    for (const [filename, kind] of [['.gitignore', 'git'], ['.droidignore', 'droid']] as const) {
      const file = path.join(directory, filename);
      const openDocument = vscode.workspace.textDocuments.find((document) => path.relative(document.uri.fsPath, file) === '' && !document.isClosed);
      try {
        const target = await realpath(file);
        const rootPath = await realpath(root.fsPath);
        if (!inside(rootPath, target)) return undefined;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return undefined;
        if (!openDocument) continue;
      }
      const text = openDocument ? openDocument.getText() : await readContextFile(file, 65536);
      if (text && text.length > 65536) return undefined;
      if (text === undefined) return undefined;
      rules[kind].add(text);
    }
    return rules;
  }
}
