/*! Classic provider flow adapted from Kilo Code 54de37a85dfef8feb828382d8a71f84139857121
 * (classic-auto-complete/AutocompleteInlineCompletionProvider.ts). MIT; see third-party/KILO-LICENSE.txt.
 */
import * as vscode from 'vscode';
import type { RuntimeDiagnosticAttribute, RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import { FimCompletionError } from '../../runtime/autocomplete/FimClient';
import { requestCompletion } from '../../runtime/autocomplete/requestCompletion';
import { CompletionContextService } from './context/CompletionContextService';
import { KiloContextService } from './context/KiloContextService';
import { readLanguageComments } from './context/LanguageComments';
import { CompletionHistory } from './CompletionHistory';
import { CompletionRequests } from './CompletionRequests';
import { recordCompletionContent } from './completionDiagnostics';
import { prepareCompletionWithOutcome } from './completionText';
import { shouldSkipAutocomplete } from './kilo/classic-auto-complete/contextualSkip';
import { ErrorBackoff } from './kilo/ErrorBackoff';
import { calcDebounceDelay } from './kilo/inline-utils';
import { autocompleteScope, getNotebookContext, notebookUri } from './kilo/continuedev/core/autocomplete/notebook';
import {
  COMPLETION_SECTION, completionDocumentBlockReason, completionNeedsKey, readCompletionKey,
  readCompletionSettings, validateCompletionEndpoint, type CompletionSettings,
} from './settings';

const INITIAL_DEBOUNCE_DELAY_MS = 300;
const LATENCY_SAMPLE_SIZE = 10;

interface Invocation {
  id: number;
  document: vscode.TextDocument;
  position: vscode.Position;
  version: number;
  revision: number;
  documentScope: string;
  controller: AbortController;
  query?: { scope: string; prefix: string; suffix: string };
}

export class AutocompleteProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private active?: Invocation;
  private sequence = 0;
  private abandoned?: ReturnType<typeof setTimeout>;
  private lastContext?: Pick<Invocation, 'document' | 'documentScope' | 'revision'>;
  private readonly history = new CompletionHistory();
  private readonly requests = new CompletionRequests();
  private readonly backoff = new ErrorBackoff();
  private retryAfter = 0;
  private debounceDelayMs = INITIAL_DEBOUNCE_DELAY_MS;
  private readonly latencies: number[] = [];
  private readonly context = new CompletionContextService();
  private kiloContext?: KiloContextService;
  private contextFileCount = 0;
  private latencyMs: number | undefined;
  private message?: string;
  private disposed = false;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this.changed.event;
  private readonly invalidated = new vscode.EventEmitter<void>();
  readonly onDidInvalidateSuggestion = this.invalidated.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly secrets: vscode.SecretStorage, private readonly diagnostics?: RuntimeDiagnosticSink) {
    const notebookChanged = () => {
      const previous = this.active ?? this.lastContext;
      if (previous?.document.uri.scheme === 'vscode-notebook-cell' &&
          autocompleteScope(previous.document) !== previous.documentScope) this.invalidateContext('notebook-context-changed');
    };
    this.subscriptions = [
      vscode.workspace.onDidChangeNotebookDocument(notebookChanged),
      this.context.onDidChangeContext(() => {
        const previous = this.active ?? this.lastContext;
        if (previous && this.context.revisionFor(previous.document.uri) !== previous.revision) this.invalidateContext('context-changed');
      }),
      vscode.workspace.onDidChangeTextDocument(event => {
        notebookChanged();
        if (event.document === this.active?.document && event.contentChanges.length) this.cancel('document-edited');
      }),
      vscode.window.onDidChangeActiveTextEditor(() => {
        this.requests.clear();
        this.cancel('editor-changed');
      }),
      vscode.window.onDidChangeTextEditorSelection(event => {
        if (this.active?.document === event.textEditor.document && !this.inSelection(this.active)) {
          this.requests.clear();
          this.cancel('selection-changed');
        }
      }),
      vscode.workspace.onDidChangeConfiguration(event => {
        if (event.affectsConfiguration(COMPLETION_SECTION) ||
            event.affectsConfiguration('editor.inlineSuggest.enabled')) this.reset();
      }),
      secrets.onDidChange(event => {
        if (event.key.startsWith('droidvisx.autocomplete.')) this.reset();
      }),
    ];
  }

  warmContext(): void {
    if (this.disposed) return;
    const settings = readCompletionSettings(vscode.window.activeTextEditor?.document.uri);
    if (settings.enabled && settings.relatedFiles) this.getKiloContext();
    else if (this.kiloContext && !settings.enabled) {
      this.kiloContext.dispose();
      this.kiloContext = undefined;
    }
  }

  get isLoading(): boolean { return this.active !== undefined; }
  get lastMessage(): string | undefined { return this.message; }
  get lastContextFileCount(): number { return this.contextFileCount; }
  get lastLatencyMs(): number | undefined { return this.latencyMs; }

  reset(reason = 'reset'): void {
    this.clearWork(reason);
    if (reason !== 'context-changed') {
      this.backoff.reset();
      this.retryAfter = 0;
      this.message = undefined;
    }
    this.changed.fire();
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument, position: vscode.Position,
    context: vscode.InlineCompletionContext, token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    const id = ++this.sequence;
    const settings = readCompletionSettings(document.uri);
    const skip = (reason: string): vscode.InlineCompletionItem[] => {
      this.trace('skipped', { id, reason, language: document.languageId, trigger: context.triggerKind });
      return [];
    };
    if (this.disposed || token.isCancellationRequested || document.isClosed) return skip('inactive');
    if (!settings.enabled) return skip('disabled');
    const blocked = completionDocumentBlockReason(document, settings);
    if (blocked) return skip(blocked);
    if (!this.inSelection({ document, position })) return skip('editor-selection-mismatch');
    const explicit = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
    if (!explicit && settings.autoTrigger === false) return skip('automatic-disabled');
    if (!explicit && (settings.snoozeUntil ?? 0) > Date.now()) return skip('snoozed');
    if (!explicit && (this.backoff.blocked() || Date.now() < this.retryAfter)) return skip('error-cooldown');
    const endpointError = validateCompletionEndpoint(settings.endpoint, settings.protocol);
    if (endpointError || !settings.model) {
      this.report(endpointError ?? 'Configure a FIM model in Droid autocomplete settings.');
      return skip('configuration');
    }

    this.cancel('superseded');
    clearTimeout(this.abandoned);
    const pending: Invocation = {
      id, document, position, version: document.version, documentScope: autocompleteScope(document),
      revision: this.context.revisionFor(document.uri), controller: new AbortController(),
    };
    this.active = pending;
    this.lastContext = pending;
    this.message = undefined;
    this.changed.fire();
    const subscription = token.onCancellationRequested(() => {
      if (this.active === pending) this.cancel('editor-token');
    });
    const signal = pending.controller.signal;
    let phase = 'policy';
    try {
      if (token.isCancellationRequested || !this.isCurrent(pending)) return [];
      // File policy applies even to cached completions and pending-request joins.
      const policyUri = notebookUri(document.uri) ?? document.uri;
      if (policyUri.scheme === 'file' && vscode.workspace.getWorkspaceFolder(policyUri) &&
          !await this.context.isAllowed(policyUri === document.uri ? document : {
            uri: policyUri, languageId: document.languageId,
          } as vscode.TextDocument, settings.excludePatterns, signal)) {
        if (!this.isCurrent(pending)) return [];
        this.report('This file is excluded by workspace ignore rules or file policy.');
        return skip('file-policy');
      }
      if (!this.isCurrent(pending)) return [];
      const text = document.getText();
      if (text.length > 1024 * 1024) return skip('document-size');
      const offset = document.offsetAt(position);
      const selected = context.selectedCompletionInfo;
      const start = selected ? document.offsetAt(selected.range.start) : offset;
      const end = selected ? document.offsetAt(selected.range.end) : offset;
      if (selected && (selected.range.start.line !== selected.range.end.line || start > offset || end < offset ||
          !selected.text.startsWith(text.slice(start, offset)))) return skip('selected-completion-mismatch');

      const prefix = text.slice(0, start) + (selected?.text ?? '');
      const suffix = text.slice(end);
      const scope = `${pending.documentScope}:${pending.revision}`;
      const cached = this.history.find(scope, prefix, suffix);
      if (cached) {
        this.trace('cache', { id, matchType: cached.matchType, characters: cached.text.length });
        return this.completionItems(cached.text, pending, selected, true);
      }
      if (shouldSkipAutocomplete(text.slice(0, offset), text.slice(offset), document.languageId)) return skip('contextual-skip');

      const notebook = getNotebookContext(document, position);
      const notebookOffset = notebook ? offsetAtLine(notebook.contents, notebook.position) - offset : 0;
      const contents = notebook?.contents ?? text;
      if (contents.length > 1024 * 1024) return skip('document-size');
      const inputText = contents.slice(0, notebookOffset + start) + (selected?.text ?? '') + contents.slice(notebookOffset + end);
      pending.query = { scope, prefix, suffix };
      phase = 'request';
      const debounceMs = settings.adaptiveDebounce === false ? settings.debounceMs : this.debounceDelayMs;
      await untilCancelled(this.requests.run(scope, prefix, suffix, debounceMs, explicit,
        requestSignal => this.fetchAndCache(pending, settings, inputText, notebookOffset + prefix.length, requestSignal)), signal);
      if (!this.isCurrent(pending)) return [];

      const result = this.history.find(scope, prefix, suffix);
      this.trace('result', { id, matchType: result?.matchType ?? 'none', insertionCharacters: result?.text.length ?? 0 });
      return this.completionItems(result?.text ?? '', pending, selected, false);
    } catch (error) {
      if (!this.isCurrent(pending)) return [];
      this.trace('failed', { id, phase, protocol: settings.protocol,
        code: error instanceof FimCompletionError ? error.code : 'internal',
        status: error instanceof FimCompletionError ? error.status ?? 0 : 0 });
      if (error instanceof FimCompletionError) {
        const help = error.status === 401 || error.status === 402 || error.status === 403
          ? ' Check the API key and model access.'
          : error.status === 429 ? ' Provider rate limit reached.' : '';
        this.report(error.message + help);
      } else {
        this.report('Autocomplete could not prepare a suggestion. Check Droid logs.');
      }
      if (phase === 'request' && this.backoff.failure(error) === 'transient') this.retryAfter = Date.now() + 30_000;
      return [];
    } finally {
      subscription.dispose();
      if (this.active === pending) {
        this.active = undefined;
        this.changed.fire();
      }
    }
  }

  private async fetchAndCache(pending: Invocation, settings: CompletionSettings, text: string, offset: number, signal: AbortSignal): Promise<void> {
    const { id, document, query } = pending;
    if (!query || !this.hasReader(query, signal)) return;
    const apiKey = await readCompletionKey(this.secrets, settings.endpoint);
    if (!this.hasReader(query, signal)) return;
    if (!apiKey && completionNeedsKey(settings.endpoint)) {
      this.report('Configure an API key with Droid: Configure Autocomplete.');
      this.trace('skipped', { id, reason: 'missing-key' });
      return;
    }
    const contextStarted = performance.now();
    const [snippets, comments] = settings.relatedFiles ? await Promise.all([
      this.context.collect(document, pending.position, { maxCharacters: Math.floor(settings.maxContextCharacters * 0.4),
        excludePatterns: settings.excludePatterns, signal }),
      readLanguageComments(document.languageId, signal),
    ]) : [[], undefined] as const;
    if (!this.hasReader(query, signal)) return;
    const policyUri = notebookUri(document.uri) ?? document.uri;
    const prompt = await this.getKiloContext().build({
      document, text, offset, settings, signal, snippets, comments,
      filepath: policyUri.scheme === 'file' ? vscode.workspace.asRelativePath(policyUri, false) : 'untitled',
    });
    if (!this.hasReader(query, signal)) return;
    this.trace('request', { id, protocol: settings.protocol, contextMs: performance.now() - contextStarted,
      prefixCharacters: prompt.prefix.length, suffixCharacters: prompt.suffix.length, relatedFiles: prompt.relatedFiles });
    const started = performance.now();
    const raw = await requestCompletion({ ...prompt, protocol: settings.protocol, endpoint: settings.endpoint,
      model: settings.model, apiKey: apiKey ?? '', maxTokens: settings.maxTokens, signal });
    if (signal.aborted || !vscode.workspace.isTrusted || document.isClosed ||
        autocompleteScope(document) !== pending.documentScope || this.context.revisionFor(document.uri) !== pending.revision) return;
    recordCompletionContent(this.diagnostics, id, 'response', raw);
    const prepared = prepareCompletionWithOutcome(raw, query.prefix, query.suffix, document.languageId, settings.model);
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    let insertion = prepared.text.replace(/\r?\n/g, eol);
    // Save the same terminal line breaks that can actually be inserted and reused.
    if (pending.position.line > 0 && pending.position.character === 0 &&
        !insertion.startsWith(eol) && (query.suffix === '' || query.suffix.startsWith(eol))) {
      insertion = insertion.replace(/(?:\r?\n)+$/, '');
    }
    this.history.put({ ...query, text: insertion });
    this.contextFileCount = prompt.relatedFiles;
    this.latencyMs = Math.round(performance.now() - started);
    this.latencies.push(this.latencyMs);
    if (this.latencies.length > LATENCY_SAMPLE_SIZE) {
      this.latencies.shift();
      this.debounceDelayMs = calcDebounceDelay(this.latencies);
    }
    this.backoff.success();
    this.retryAfter = 0;
    this.trace('generated', { id, outcome: prepared.outcome, receivedCharacters: raw.length, networkMs: this.latencyMs });
  }

  /** The Kilo request can outlive one editor token, but cannot send without an allowed live reader. */
  private hasReader(query: NonNullable<Invocation['query']>, signal: AbortSignal): boolean {
    const reader = this.active;
    return !signal.aborted && reader?.query !== undefined && this.isCurrent(reader) &&
      reader.query.scope === query.scope && reader.query.suffix === query.suffix && reader.query.prefix.startsWith(query.prefix);
  }

  private inSelection({ document, position }: Pick<Invocation, 'document' | 'position'>): boolean {
    const editor = vscode.window.activeTextEditor;
    return editor?.document === document && editor.selections.length === 1 &&
      editor.selection.isEmpty && editor.selection.active.isEqual(position);
  }

  private isCurrent(pending: Invocation): boolean {
    return this.active === pending && !this.disposed && vscode.workspace.isTrusted &&
      !pending.controller.signal.aborted && !pending.document.isClosed && pending.document.version === pending.version &&
      autocompleteScope(pending.document) === pending.documentScope &&
      this.context.revisionFor(pending.document.uri) === pending.revision && this.inSelection(pending);
  }

  private completionItems(text: string, { document, position, id }: Invocation,
    selected: vscode.SelectedCompletionInfo | undefined, cached: boolean): vscode.InlineCompletionItem[] {
    if (!text) return [];
    let insertText = (selected?.text ?? '') + text;
    let range = selected?.range ?? new vscode.Range(position, position);
    // VS Code moves a newline-terminated insertion at column zero to the previous
    // line. Preserve its visible inline edit by keeping the cursor's line in range.
    if (position.line > 0 && position.character === 0 && range.start.isEqual(range.end) &&
        insertText.endsWith('\n') && !insertText.startsWith('\n') && !insertText.startsWith('\r\n')) {
      const line = document.lineAt(position).text;
      if (!line) insertText = insertText.replace(/(?:\r?\n)+$/, '');
      else if (!selected) {
        range = new vscode.Range(position, new vscode.Position(position.line, line.length));
        insertText += line;
      }
    }
    recordCompletionContent(this.diagnostics, id, 'candidate', text);
    return [new vscode.InlineCompletionItem(insertText, range, {
      command: 'droidvisx.autocomplete.accepted', title: 'Completion accepted',
      arguments: [{ suggestionId: id, cached, characters: text.length }],
    })];
  }

  private getKiloContext(): KiloContextService {
    return this.kiloContext ??= new KiloContextService(uri => this.context.trackContextFile(uri),
      () => this.trace('context.timeout', { source: 'language-service' }));
  }

  private cancel(reason: string): void {
    if (!this.active) return;
    this.trace('cancelled', { id: this.active.id, reason });
    this.active.controller.abort();
    this.active = undefined;
    clearTimeout(this.abandoned);
    // Let adjacent VS Code invocations join transport briefly, then abort abandoned work.
    this.abandoned = setTimeout(() => this.requests.clear(), 250);
    this.changed.fire();
  }

  private clearWork(reason: string): void {
    this.cancel(reason);
    clearTimeout(this.abandoned);
    this.requests.clear();
    this.kiloContext?.invalidate();
    this.history.clear();
    this.lastContext = undefined;
    this.contextFileCount = 0;
    this.latencyMs = undefined;
  }

  private invalidateContext(reason: string): void {
    this.reset(reason);
    this.invalidated.fire();
  }

  private trace(name: string, attributes: Record<string, RuntimeDiagnosticAttribute>): void {
    this.diagnostics?.record({ level: 'debug', name: 'autocomplete.' + name, attributes });
  }

  private report(message: string): void {
    this.message = message;
    this.changed.fire();
  }

  dispose(): void {
    this.disposed = true;
    this.clearWork('disposed');
    this.subscriptions.forEach(item => item.dispose());
    this.kiloContext?.dispose();
    this.context.dispose();
    this.changed.dispose();
    this.invalidated.dispose();
  }
}

function offsetAtLine(text: string, position: vscode.Position): number {
  return text.split('\n').slice(0, position.line).reduce((sum, line) => sum + line.length + 1, position.character);
}

function untilCancelled(work: Promise<void>, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); resolve(); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    work.then(() => { cleanup(); resolve(); }, error => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
