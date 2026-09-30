import * as vscode from 'vscode';
import path from 'node:path';
import { CompletionFilePolicy, inside, readContextFile } from './CompletionFilePolicy';
import { contextExcerpt, recentlyViewedExcerpt } from './contextText';

export interface ContextSnippet {
  uri: string;
  filepath: string;
  content: string;
  source: 'definition' | 'recentEdit' | 'openFile';
  version?: number;
}

interface Candidate {
  uri: vscode.Uri;
  line: number;
  endLine?: number;
  source: ContextSnippet['source'];
}
interface RecentFile { uri: vscode.Uri; line: number; sequence: number }
interface CollectOptions { maxCharacters: number; excludePatterns: readonly string[]; signal: AbortSignal }

function isIgnoreFile(uri: vscode.Uri): boolean { return /^(?:\.gitignore|\.droidignore)$/.test(path.basename(uri.fsPath)); }

/** Races optional editor/filesystem work without leaving abort listeners or rejected promises behind. */
function untilAborted<T>(work: PromiseLike<T>, signal: AbortSignal, fallback: T): Promise<T> {
  if (signal.aborted) return Promise.resolve(fallback);
  return new Promise((resolve, reject) => {
    const onAbort = () => { cleanup(); resolve(fallback); };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    work.then((value) => { cleanup(); resolve(value); }, (error: unknown) => { cleanup(); reject(error); });
  });
}

export class CompletionContextService implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeContext = this.changed.event;
  private sequence = 0;
  private structureRevision = 0;
  private readonly changes = new Map<string, number>();
  private readonly edited = new Map<string, RecentFile>();
  private readonly visited = new Map<string, RecentFile>();
  private readonly viewed = new Map<string, RecentFile>();
  private viewSequence = 0;
  private readonly policy = new CompletionFilePolicy();
  private readonly contextFiles = new Set<string>();
  private readonly subscriptions: vscode.Disposable[];
  private readonly lifetime = new AbortController();

  constructor() {
    for (const document of vscode.workspace.textDocuments) this.visit(document.uri, 0);
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      this.visit(editor.document.uri, editor.selection.active.line);
      this.rememberViewed(editor.document.uri, editor.selection.active.line);
    }
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    const invalidateRules = () => { this.policy.invalidate(); this.bumpStructure(); };
    const fileChanged = (uri: vscode.Uri) => {
      if (isIgnoreFile(uri)) { invalidateRules(); return; }
      const id = uri.toString();
      if (this.contextFiles.has(id)) this.recordChange(id);
    };
    this.subscriptions = [
      watcher, watcher.onDidCreate(fileChanged), watcher.onDidChange(fileChanged), watcher.onDidDelete(fileChanged),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (isIgnoreFile(event.document.uri)) { invalidateRules(); return; }
        if (!event.contentChanges.length || event.document.uri.scheme !== 'file') return;
        const id = event.document.uri.toString();
        this.edited.set(id, { uri: event.document.uri, line: event.contentChanges[0].range.start.line, sequence: this.sequence + 1 });
        this.recordChange(id);
        this.trim(this.edited);
      }),
      vscode.workspace.onDidOpenTextDocument((document) => this.visit(document.uri, 0)),
      vscode.workspace.onDidCloseTextDocument((document) => {
        const id = document.uri.toString();
        this.edited.delete(id); this.visited.delete(id); this.changes.delete(id);
        if (isIgnoreFile(document.uri)) this.policy.invalidate();
        this.bumpStructure();
      }),
      vscode.window.onDidChangeActiveTextEditor((active) => {
        if (active) {
          this.visit(active.document.uri, active.selection.active.line);
          this.rememberViewed(active.document.uri, active.selection.active.line);
        }
      }),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        const uri = event.textEditor.document.uri;
        const previous = this.visited.get(uri.toString());
        const line = event.selections[0]?.active.line;
        if (line !== undefined) this.rememberViewed(uri, line);
        if (previous && line !== undefined && line !== previous.line) {
          this.visited.set(uri.toString(), { uri, line, sequence: this.sequence + 1 });
          this.recordChange(uri.toString());
        }
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        this.edited.clear(); this.visited.clear(); this.viewed.clear(); this.changes.clear(); this.contextFiles.clear(); invalidateRules();
      }),
    ];
  }

  trackContextFile(uri: string): void { this.contextFiles.add(uri); }

  get revision(): number { return this.sequence; }

  /** Typing in the request's own document can reuse its remaining suggestion. */
  revisionFor(uri: vscode.Uri): number {
    let revision = this.structureRevision;
    const current = uri.toString();
    for (const [id, value] of this.changes) if (id !== current) revision = Math.max(revision, value);
    return revision;
  }

  async isAllowed(document: vscode.TextDocument, excludePatterns: readonly string[], signal: AbortSignal): Promise<boolean> {
    const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    if (this.lifetime.signal.aborted || !vscode.workspace.isTrusted || !root) return false;
    const combined = AbortSignal.any([signal, this.lifetime.signal]);
    return untilAborted(this.policy.allows(document.uri, root, document.languageId, excludePatterns, combined), combined, false);
  }

  async collect(document: vscode.TextDocument, position: vscode.Position, options: CollectOptions): Promise<ContextSnippet[]> {
    const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    if (options.signal.aborted || this.lifetime.signal.aborted || !vscode.workspace.isTrusted ||
        document.uri.scheme !== 'file' || !root || options.maxCharacters <= 0) return [];
    const timeout = new AbortController();
    const signal = AbortSignal.any([options.signal, timeout.signal, this.lifetime.signal]);
    const snippets: ContextSnippet[] = [];
    const timer = setTimeout(() => timeout.abort(), 400);
    try {
      await untilAborted(this.collectWithinBudget(document, position, root, { ...options, signal }, snippets), signal, undefined);
      return options.signal.aborted || this.lifetime.signal.aborted ? [] : snippets.slice();
    } finally { clearTimeout(timer); }
  }

  /** Mercury expects recently viewed files oldest to newest, separate from definitions and edits. */
  async collectRecentlyViewed(document: vscode.TextDocument, options: CollectOptions): Promise<ContextSnippet[]> {
    const root = vscode.workspace.getWorkspaceFolder(document.uri)?.uri;
    if (options.signal.aborted || this.lifetime.signal.aborted || !vscode.workspace.isTrusted ||
        document.uri.scheme !== 'file' || !root || options.maxCharacters <= 0) return [];
    const timeout = new AbortController();
    const signal = AbortSignal.any([options.signal, timeout.signal, this.lifetime.signal]);
    const snippets: ContextSnippet[] = [];
    const timer = setTimeout(() => timeout.abort(), 400);
    try {
      await untilAborted(this.collectViewedWithinBudget(document, root, { ...options, signal }, snippets), signal, undefined);
      return options.signal.aborted || this.lifetime.signal.aborted ? [] : snippets.reverse();
    } finally { clearTimeout(timer); }
  }

  private async collectViewedWithinBudget(
    document: vscode.TextDocument, root: vscode.Uri, options: CollectOptions, snippets: ContextSnippet[],
  ): Promise<void> {
    const recent = [...this.viewed.values()].sort((a, b) => b.sequence - a.sequence);
    let remaining = Math.floor(options.maxCharacters);
    for (const candidate of recent) {
      if (options.signal.aborted || remaining <= 0 || snippets.length === 5) break;
      const id = candidate.uri.toString();
      if (id === document.uri.toString() || vscode.workspace.getWorkspaceFolder(candidate.uri)?.uri.toString() !== root.toString()
          || !inside(root.fsPath, candidate.uri.fsPath)) continue;
      const openDocument = vscode.workspace.textDocuments.find(item => item.uri.toString() === id && !item.isClosed);
      if (!await this.policy.allows(candidate.uri, root, openDocument?.languageId ?? '', options.excludePatterns, options.signal)) continue;
      if (options.signal.aborted) break;
      const text = openDocument ? openDocument.getText() : await readContextFile(candidate.uri.fsPath);
      if (options.signal.aborted) break;
      if (text === undefined || text.length > 1024 * 1024) continue;
      const content = recentlyViewedExcerpt(text, candidate.line, remaining);
      if (!content.trim()) continue;
      this.trackContextFile(id);
      snippets.push({ uri: id, filepath: path.relative(root.fsPath, candidate.uri.fsPath).split(path.sep).join('/'),
        content, source: 'openFile', ...(openDocument ? { version: openDocument.version } : {}),
      });
      remaining -= content.length;
    }
  }

  private async collectWithinBudget(
    document: vscode.TextDocument, position: vscode.Position, root: vscode.Uri,
    options: CollectOptions, snippets: ContextSnippet[],
  ): Promise<void> {
    const definitions = await this.definitions(document, position, options.signal);
    if (options.signal.aborted) return;
    const recent = [...this.edited.values()].sort((a, b) => b.sequence - a.sequence)
      .map((file): Candidate => ({ ...file, source: 'recentEdit' }));
    const opened = [...this.visited.values()].sort((a, b) => b.sequence - a.sequence)
      .map((file): Candidate => ({ ...file, source: 'openFile' }));
    const seen = new Set([document.uri.toString()]);
    let remaining = Math.floor(options.maxCharacters);
    let checked = 0;
    for (const candidate of [...definitions, ...recent, ...opened]) {
      if (options.signal.aborted || remaining <= 0 || snippets.length === 6 || checked === 24) break;
      const id = candidate.uri.toString();
      if (seen.has(id)) continue;
      seen.add(id); checked++;
      // Multi-root workspaces are separate context boundaries.
      if (vscode.workspace.getWorkspaceFolder(candidate.uri)?.uri.toString() !== root.toString() ||
          !inside(root.fsPath, candidate.uri.fsPath)) continue;
      const openDocument = vscode.workspace.textDocuments.find((item) => item.uri.toString() === id && !item.isClosed);
      if (!await this.policy.allows(candidate.uri, root, openDocument?.languageId ?? '', options.excludePatterns, options.signal)) continue;
      if (options.signal.aborted) break;
      const text = openDocument ? openDocument.getText() : await readContextFile(candidate.uri.fsPath);
      if (options.signal.aborted) break;
      if (text === undefined || text.length > 1024 * 1024) continue;
      const content = contextExcerpt(text, candidate.line, Math.min(2400, remaining), candidate.endLine);
      if (!content.trim()) continue;
      this.contextFiles.add(id);
      if (this.contextFiles.size > 48) this.contextFiles.delete(this.contextFiles.values().next().value!);
      snippets.push({
        uri: id, filepath: path.relative(root.fsPath, candidate.uri.fsPath).split(path.sep).join('/'),
        content, source: candidate.source, ...(openDocument ? { version: openDocument.version } : {}),
      });
      remaining -= content.length;
    }
  }

  private async definitions(document: vscode.TextDocument, position: vscode.Position, signal: AbortSignal): Promise<Candidate[]> {
    const timeout = new AbortController();
    const combined = AbortSignal.any([signal, timeout.signal]);
    const timer = setTimeout(() => timeout.abort(), 150);
    try {
      const words: vscode.Position[] = [];
      let character = position.character;
      // Native word ranges keep receiver lookup language-neutral, including `object.`
      // and partially typed members. Stay on this line and bound punctuation probing.
      for (let probes = 0; probes < 12 && character >= 0 && words.length < 3; probes++) {
        const at = position.translate(0, character - position.character);
        const word = document.getWordRangeAtPosition(at);
        if (word) {
          if (!words.some((point) => point.character === word.start.character)) words.push(word.start);
          character = word.start.character - 1;
        } else character--;
      }
      const results: (vscode.Location | vscode.LocationLink)[][] = words.map(() => []);
      await untilAborted(Promise.all(words.map(async (word, index) => {
        try {
          results[index] = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[] | undefined>(
            'vscode.executeDefinitionProvider', document.uri, word,
          ) ?? [];
        } catch { /* A not-ready server does not prevent other words or recent context. */ }
      })), combined, []);
      const result = results.flat();
      return result.slice(0, 12).map((location): Candidate => {
        const uri = 'targetUri' in location ? location.targetUri : location.uri;
        const range = 'targetRange' in location ? location.targetRange : location.range;
        return { uri, line: range.start.line, endLine: range.end.line, source: 'definition' };
      });
    } catch {
      // Missing/not-ready language servers are normal; recent editor context remains useful.
      return [];
    } finally { clearTimeout(timer); }
  }

  private rememberViewed(uri: vscode.Uri, line: number): void {
    if (uri.scheme !== 'file') return;
    this.viewed.delete(uri.toString());
    this.viewed.set(uri.toString(), { uri, line, sequence: ++this.viewSequence });
    if (this.viewed.size > 24) this.viewed.delete(this.viewed.keys().next().value!);
  }

  private visit(uri: vscode.Uri, line: number): void {
    if (uri.scheme !== 'file') return;
    this.visited.set(uri.toString(), { uri, line, sequence: this.sequence + 1 });
    this.trim(this.visited);
    this.bumpStructure();
  }

  private trim(map: Map<string, RecentFile>): void {
    if (map.size <= 24) return;
    const oldest = [...map].sort((a, b) => a[1].sequence - b[1].sequence)[0][0];
    map.delete(oldest);
    this.changes.delete(oldest);
    this.bumpStructure();
  }

  private recordChange(id: string): void {
    this.changes.set(id, ++this.sequence);
    if (this.changes.size > 96) {
      this.changes.delete(this.changes.keys().next().value!);
      // Retiring an old per-file revision must not make a cache appear current again.
      this.structureRevision = this.sequence;
    }
    this.changed.fire();
  }

  private bumpStructure(): void {
    this.structureRevision = ++this.sequence;
    this.changed.fire();
  }

  dispose(): void {
    this.lifetime.abort();
    this.subscriptions.forEach((subscription) => subscription.dispose());
    this.changed.dispose();
    this.edited.clear(); this.visited.clear(); this.viewed.clear(); this.changes.clear(); this.contextFiles.clear(); this.policy.invalidate();
  }
}
