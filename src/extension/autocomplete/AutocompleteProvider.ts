import * as vscode from 'vscode';
import { setTimeout as delay } from 'node:timers/promises';
import { FimCompletionError, requestFimCompletion } from '../../runtime/autocomplete/FimClient';
import {
  buildCompletionContext, prepareCompletion, reuseCompletion, type CachedCompletion,
} from './completionText';
import {
  COMPLETION_SECTION, completionDocumentBlockReason, completionSecretKey,
  readCompletionSettings, validateCompletionEndpoint,
} from './settings';

interface PendingCompletion {
  controller: AbortController;
  document: vscode.TextDocument;
  version: number;
  position: vscode.Position;
}

export class AutocompleteProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private active?: PendingCompletion;
  private cache?: CachedCompletion;
  private retryAfter = 0;
  private message?: string;
  private disposed = false;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this.changed.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly secrets: vscode.SecretStorage) {
    this.subscriptions = [
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === this.active?.document) this.cancel();
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.cancel()),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (this.active && event.textEditor.document === this.active.document &&
            (event.selections.length !== 1 || !event.selections[0].isEmpty ||
              !event.selections[0].active.isEqual(this.active.position))) this.cancel();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(COMPLETION_SECTION) ||
            event.affectsConfiguration('editor.inlineSuggest.enabled')) this.reset();
      }),
      secrets.onDidChange((event) => {
        if (event.key.startsWith('droidvisx.autocomplete.')) this.reset();
      }),
    ];
  }

  get isLoading(): boolean { return this.active !== undefined; }
  get lastMessage(): string | undefined { return this.message; }

  reset(): void {
    this.cancel();
    this.cache = undefined;
    this.retryAfter = 0;
    this.message = undefined;
    this.changed.fire();
  }

  cancel(): void {
    if (!this.active) return;
    this.active.controller.abort();
    this.active = undefined;
    this.changed.fire();
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument, position: vscode.Position,
    context: vscode.InlineCompletionContext, token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    this.cancel();
    if (this.disposed || token.isCancellationRequested) return [];
    const settings = readCompletionSettings(document.uri);
    if (!settings.enabled) return [];
    const blocked = completionDocumentBlockReason(document, settings);
    if (blocked) return [];
    const editor = vscode.window.activeTextEditor;
    if (editor?.document !== document || editor.selections.length !== 1 ||
        !editor.selection.isEmpty || !editor.selection.active.isEqual(position)) return [];
    // Let the language server own the suggest widget; do not replace its selected item.
    if (context.selectedCompletionInfo) return [];
    const explicit = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
    if (!explicit && Date.now() < this.retryAfter) return [];
    const endpointError = validateCompletionEndpoint(settings.endpoint);
    if (endpointError || !settings.model) {
      this.report(endpointError ?? 'Configure a FIM model in Droid autocomplete settings.');
      return [];
    }
    const text = document.getText();
    if (text.length > 1024 * 1024) {
      this.report('Autocomplete is paused for files larger than 1 MiB of text.');
      return [];
    }
    const offset = document.offsetAt(position);
    const prefix = text.slice(0, offset);
    const suffix = text.slice(offset);
    if (!prefix.trim()) return [];
    const cached = reuseCompletion(this.cache, document.uri.toString(), prefix, suffix, Date.now());
    if (cached !== undefined) return cached ? this.items(cached, position) : [];
    const pending: PendingCompletion = {
      controller: new AbortController(), document, version: document.version, position,
    };
    this.active = pending;
    this.message = undefined;
    this.changed.fire();
    const cancellation = token.onCancellationRequested(() => {
      if (this.active === pending) this.cancel();
    });
    try {
      if (token.isCancellationRequested) return [];
      if (!explicit) await delay(settings.debounceMs, undefined, { signal: pending.controller.signal });
      if (!this.isCurrent(pending, token)) return [];
      const apiKey = await this.secrets.get(completionSecretKey(settings.endpoint));
      if (!this.isCurrent(pending, token)) return [];
      if (!apiKey) {
        this.report('Configure an API key with Droid: Configure Autocomplete.');
        return [];
      }
      const contextText = buildCompletionContext(text, offset, settings.maxContextCharacters);
      const result = await requestFimCompletion({
        ...contextText, endpoint: settings.endpoint, model: settings.model, apiKey,
        maxTokens: settings.maxTokens, signal: pending.controller.signal,
      });
      if (!this.isCurrent(pending, token)) return [];
      const normalized = document.eol === vscode.EndOfLine.CRLF
        ? result.replace(/\r?\n/g, '\r\n') : result.replace(/\r\n/g, '\n');
      const suggestion = prepareCompletion(normalized, prefix, suffix);
      this.cache = { uri: document.uri.toString(), prefix, suffix, text: suggestion, createdAt: Date.now() };
      this.retryAfter = 0;
      return suggestion ? this.items(suggestion, position) : [];
    } catch (error) {
      if (!this.isCurrent(pending, token)) return [];
      if (error instanceof FimCompletionError) {
        const help = error.status === 401 || error.status === 403
          ? ' Check the API key and model access.'
          : error.status === 429 ? ' Provider rate limit reached.' : '';
        this.report(error.message + help);
      } else {
        this.report('Autocomplete failed. Check the endpoint, model and stored API key.');
      }
      // Automatic typing must not hammer an unavailable provider. Manual invocation can retry.
      this.retryAfter = Date.now() + 30_000;
      return [];
    } finally {
      cancellation.dispose();
      if (this.active === pending) {
        this.active = undefined;
        this.changed.fire();
      }
    }
  }

  private isCurrent(pending: PendingCompletion, token: vscode.CancellationToken): boolean {
    const editor = vscode.window.activeTextEditor;
    return this.active === pending && !this.disposed &&
      !token.isCancellationRequested && !pending.controller.signal.aborted &&
      !pending.document.isClosed && pending.document.version === pending.version &&
      editor?.document === pending.document && editor.selections.length === 1 &&
      editor.selection.isEmpty && editor.selection.active.isEqual(pending.position);
  }

  private items(text: string, position: vscode.Position) {
    return [new vscode.InlineCompletionItem(text, new vscode.Range(position, position))];
  }

  private report(message: string): void {
    this.message = message;
    this.changed.fire();
  }

  dispose(): void {
    this.disposed = true;
    this.cancel();
    this.cache = undefined;
    this.subscriptions.forEach((item) => item.dispose());
    this.changed.dispose();
  }
}
