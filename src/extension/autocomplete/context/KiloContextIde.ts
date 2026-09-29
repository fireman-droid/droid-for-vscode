import * as vscode from 'vscode';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { VsCodeIde } from '../kilo/continuedev/core/vscode-test-harness/src/VSCodeIde';
import type { Range, Location, RangeInFile, SignatureHelp } from '../kilo/continuedev/core';
import { CompletionFilePolicy, inside, readContextFile } from './CompletionFilePolicy';
import { readCompletionSettings } from '../settings';
import { notebookUri } from '../kilo/continuedev/core/autocomplete/notebook';

/** Host adapter for Kilo/Continue context reads; every file passes Droid's existing policy. */
export class KiloContextIde extends VsCodeIde implements vscode.Disposable {
  constructor(private readonly onRead: (uri: string) => void = () => {}) { super(); }
  private readonly request = new AsyncLocalStorage<AbortSignal>();
  run<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> { return this.request.run(signal, action); }
  private async wait<T>(work: Promise<T>): Promise<T> {
    const signal = this.request.getStore() ?? this.lifetime.signal;
    signal.throwIfAborted();
    return new Promise<T>((resolve, reject) => {
      const abort = () => { cleanup(); reject(signal.reason); };
      const cleanup = () => signal.removeEventListener('abort', abort);
      signal.addEventListener('abort', abort, { once: true });
      work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    });
  }
  private readonly policy = new CompletionFilePolicy();
  private readonly lifetime = new AbortController();
  async allowed(filepath: string): Promise<boolean> {
    this.request.getStore()?.throwIfAborted();
    if (this.lifetime.signal.aborted || !vscode.workspace.isTrusted) return false;
    const active = vscode.window.activeTextEditor?.document;
    if (!active) return false;
    const settings = readCompletionSettings(active.uri);
    if (!settings.enabled) return false;
    const uri = vscode.Uri.parse(filepath);
    if (uri.toString() === active.uri.toString() && uri.scheme === 'untitled') return true;
    const activeUri = notebookUri(active.uri) ?? active.uri;
    const root = vscode.workspace.getWorkspaceFolder(activeUri)?.uri;
    if (uri.scheme !== 'file') return false;
    if (!root) return uri.toString() === activeUri.toString();
    if (!inside(root.fsPath, uri.fsPath) || vscode.workspace.getWorkspaceFolder(uri)?.uri.toString() !== root.toString()) return false;
    if (!settings.relatedFiles && uri.toString() !== activeUri.toString()) return false;
    const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === filepath);
    return this.policy.allows(uri, root, document?.languageId ?? '', settings.excludePatterns, this.lifetime.signal);
  }
  override async readFile(filepath: string): Promise<string> {
    if (!await this.allowed(filepath)) return '';
    const document = vscode.workspace.textDocuments.find(d => d.uri.toString() === filepath && !d.isClosed);
    this.onRead(filepath);
    const content = document?.getText() ?? await readContextFile(vscode.Uri.parse(filepath).fsPath);
    return this.lifetime.signal.aborted || !content || content.length > 1024 * 1024 ? '' : content;
  }
  override async readRangeInFile(filepath: string, range: Range): Promise<string> {
    const text = await this.readFile(filepath);
    const lines = text.split('\n');
    if (range.start.line >= lines.length) return '';
    return lines.slice(range.start.line, range.end.line + 1).map((line, index, picked) => {
      const end = range.start.line + index === range.end.line ? range.end.character : line.length;
      return line.slice(index === 0 ? range.start.character : 0, end);
    }).join('\n');
  }
  override async getWorkspaceDirs(): Promise<string[]> {
    const active = vscode.window.activeTextEditor?.document.uri;
    const root = active && vscode.workspace.getWorkspaceFolder(notebookUri(active) ?? active)?.uri;
    return root ? [root.toString()] : [];
  }
  override async findWorkspaceFiles(pattern: string): Promise<string[]> {
    const roots = await this.getWorkspaceDirs();
    if (!roots.length) return [];
    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(vscode.Uri.parse(roots[0]), pattern),
      '**/{node_modules,.git,dist,build,out,.next,coverage}/**', 2000);
    const access = await Promise.all(files.map(uri => this.allowed(uri.toString())));
    return files.filter((_, index) => access[index]).map(uri => uri.toString());
  }
  private async definitions(location: Location, resolve: () => Promise<RangeInFile[]>): Promise<RangeInFile[]> {
    if (!await this.allowed(location.filepath)) return [];
    const result = await this.wait(resolve());
    const access = await Promise.all(result.map(item => this.allowed(item.filepath)));
    return result.filter((_, index) => access[index]);
  }
  override gotoDefinition(location: Location): Promise<RangeInFile[]> {
    return this.definitions(location, () => super.gotoDefinition(location));
  }
  override gotoTypeDefinition(location: Location): Promise<RangeInFile[]> {
    return this.definitions(location, () => super.gotoTypeDefinition(location));
  }
  override async getSignatureHelp(location: Location): Promise<SignatureHelp | null> {
    return await this.allowed(location.filepath) ? this.wait(super.getSignatureHelp(location)) : null;
  }
  override async getOpenFiles(): Promise<string[]> {
    const files = vscode.workspace.textDocuments.filter(d => d.uri.scheme === 'file').map(d => d.uri.toString());
    const allowed = await Promise.all(files.map(f => this.allowed(f)));
    return files.filter((_, index) => allowed[index]);
  }
  override async getClipboardContent(): Promise<{ text: string; copiedAt: string }> {
    if (!readCompletionSettings().includeClipboard || !vscode.workspace.isTrusted || this.lifetime.signal.aborted) return { text: '', copiedAt: '' };
    return { text: (await vscode.env.clipboard.readText()).slice(0, 4000), copiedAt: new Date().toISOString() };
  }
  relative(filepath: string): string {
    const uri = vscode.Uri.parse(filepath);
    return vscode.workspace.getWorkspaceFolder(uri) ? vscode.workspace.asRelativePath(uri, false) : path.basename(uri.fsPath);
  }
  invalidate(): void { this.policy.invalidate(); }
  dispose(): void { this.lifetime.abort(); }
}
