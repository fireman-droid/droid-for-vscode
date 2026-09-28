import * as vscode from 'vscode';
import type { RuntimeDiagnosticSink, RuntimeDiagnosticAttribute } from '../../runtime/runtimeDiagnostics';
import { setTimeout as delay } from 'node:timers/promises';
import { FimCompletionError } from '../../runtime/autocomplete/FimClient';
import { requestCompletion } from '../../runtime/autocomplete/requestCompletion';
import { CompletionContextService } from './context/CompletionContextService';
import { buildCompletionPrompt } from './context/CompletionPrompt';
import { readLanguageComments } from './context/LanguageComments';
import {
  prepareCompletion, reuseCompletion, type CachedCompletion,
} from './completionText';
import {
  COMPLETION_SECTION, completionDocumentBlockReason, completionNeedsKey, completionSecretKey,
  readCompletionSettings, validateCompletionEndpoint,
} from './settings';

interface PendingCompletion {
  id: number;
  startedAt: number;
  phase: 'debounce' | 'policy' | 'credentials' | 'context' | 'request';
  controller: AbortController;
  document: vscode.TextDocument;
  version: number;
  position: vscode.Position;
  contextRevision: number;
}

export class AutocompleteProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private active?: PendingCompletion;
  private sequence = 0;
  private cache?: CachedCompletion;
  private cacheContextRevision = -1;
  private readonly context = new CompletionContextService();
  private lastDocument?: vscode.TextDocument;
  private contextFileCount = 0;
  private latencyMs: number | undefined;
  private retryAfter = 0;
  private message?: string;
  private disposed = false;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeState = this.changed.event;
  private readonly invalidated = new vscode.EventEmitter<void>();
  readonly onDidInvalidateSuggestion = this.invalidated.event;
  private readonly subscriptions: vscode.Disposable[];

  constructor(private readonly secrets: vscode.SecretStorage, private readonly diagnostics?: RuntimeDiagnosticSink) {
    this.subscriptions = [
      this.context.onDidChangeContext(() => {
        if (!this.active && !this.cache) return;
        const document = this.active?.document ?? this.lastDocument;
        const revision = this.active?.contextRevision ?? this.cacheContextRevision;
        if (document && this.context.revisionFor(document.uri) !== revision) {
          this.reset('context-changed');
          this.invalidated.fire();
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (this.active && event.document === this.active.document && event.contentChanges.length > 0) {
          this.cancel('document-edited');
        }
      }),
      vscode.window.onDidChangeActiveTextEditor(() => this.cancel('editor-changed')),
      vscode.window.onDidChangeTextEditorSelection((event) => {
        if (this.active && event.textEditor.document === this.active.document &&
            (event.selections.length !== 1 || !event.selections[0].isEmpty ||
              !event.selections[0].active.isEqual(this.active.position))) this.cancel('selection-changed');
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
  get lastContextFileCount(): number { return this.contextFileCount; }
  get lastLatencyMs(): number | undefined { return this.latencyMs; }

  reset(reason = 'reset'): void {
    this.cancel(reason);
    this.cache = undefined;
    this.contextFileCount = 0;
    this.latencyMs = undefined;
    this.retryAfter = 0;
    this.message = undefined;
    this.changed.fire();
  }

  cancel(reason = 'cancelled'): void {
    if (!this.active) return;
    this.trace('cancelled', { id: this.active.id, phase: this.active.phase, reason, durationMs: Date.now() - this.active.startedAt });
    this.active.controller.abort();
    this.active = undefined;
    this.changed.fire();
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument, position: vscode.Position,
    context: vscode.InlineCompletionContext, token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    this.cancel('superseded');
    const id = ++this.sequence;
    const skip = (reason: string): vscode.InlineCompletionItem[] => {
      this.trace('skipped', { id, reason, language: document.languageId, trigger: context.triggerKind });
      return [];
    };
    if (this.disposed || token.isCancellationRequested) return skip('inactive');
    const settings = readCompletionSettings(document.uri);
    if (!settings.enabled) return skip('disabled');
    const blocked = completionDocumentBlockReason(document, settings);
    if (blocked) return skip(blocked);
    const editor = vscode.window.activeTextEditor;
    if (editor?.document !== document || editor.selections.length !== 1 ||
        !editor.selection.isEmpty || !editor.selection.active.isEqual(position)) return skip('editor-selection-mismatch');

    const explicit = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
    if (!explicit && Date.now() < this.retryAfter) return skip('error-cooldown');
    const endpointError = validateCompletionEndpoint(settings.endpoint, settings.protocol);
    if (endpointError || !settings.model) {
      this.report(endpointError ?? 'Configure a FIM model in Droid autocomplete settings.');
      return skip('configuration');
    }
    const text = document.getText();
    if (text.length > 1024 * 1024) {
      this.report('Autocomplete is paused for files larger than 1 MiB of text.');
      return skip('document-size');
    }
    const selected = context.selectedCompletionInfo;
    const originalOffset = document.offsetAt(position);
    let inputText = text;
    let offset = originalOffset;
    if (selected) {
      const start = document.offsetAt(selected.range.start);
      const end = document.offsetAt(selected.range.end);
      if (selected.range.start.line !== selected.range.end.line || start > originalOffset ||
          end < originalOffset || !selected.text.startsWith(text.slice(start, originalOffset))) return skip('selected-completion-mismatch');
      // Ask for code after the selected language-server item, then extend that same item/range.
      inputText = text.slice(0, start) + selected.text + text.slice(end);
      offset = start + selected.text.length;
    }
    const prefix = inputText.slice(0, offset);
    const suffix = inputText.slice(offset);
    if (!prefix.trim()) return skip('empty-prefix');
    this.lastDocument = document;
    const contextRevision = this.context.revisionFor(document.uri);
    const cached = contextRevision === this.cacheContextRevision
      ? reuseCompletion(this.cache, document.uri.toString(), prefix, suffix, Date.now()) : undefined;
    if (cached !== undefined) {
      this.trace('cache', { id, characters: cached.length, outcome: cached ? 'suggestion-returned' : 'empty' });
      if (!cached) return [];
      const completion = this.completionItem(cached, document, position, selected);
      if (this.cache) this.cache.text = this.cache.text.slice(0, -cached.length) + completion.text;
      return [completion.item];
    }
    const pending: PendingCompletion = {
      id, startedAt: Date.now(), phase: 'debounce',
      controller: new AbortController(), document, version: document.version, position, contextRevision,
    };
    this.active = pending;
    this.trace('started', { id, language: document.languageId, trigger: context.triggerKind, documentVersion: document.version });
    this.message = undefined;
    this.changed.fire();
    const cancellation = token.onCancellationRequested(() => {
      if (this.active === pending) this.cancel('editor-token');
    });
    try {
      if (token.isCancellationRequested) return [];
      if (!explicit) await delay(settings.debounceMs, undefined, { signal: pending.controller.signal });
      if (!this.isCurrent(pending, token)) return [];
      const signal = pending.controller.signal;
      pending.phase = 'policy';
      if (document.uri.scheme === 'file' && vscode.workspace.getWorkspaceFolder(document.uri) &&
          !await this.context.isAllowed(document, settings.excludePatterns, signal)) {
        if (this.isCurrent(pending, token)) this.report('This file is excluded by workspace ignore rules or file policy.');
        return skip('file-policy');
      }
      if (!this.isCurrent(pending, token)) return [];
      pending.phase = 'credentials';
      const apiKey = await this.secrets.get(completionSecretKey(settings.endpoint));
      if (!this.isCurrent(pending, token)) return [];
      if (!apiKey && completionNeedsKey(settings.endpoint)) {
        this.report('Configure an API key with Droid: Configure Autocomplete.');
        return skip('missing-key');
      }
      const started = Date.now();
      pending.phase = 'context';
      const [snippets, comments] = settings.relatedFiles ? await Promise.all([
        this.context.collect(document, position, {
          maxCharacters: Math.floor(settings.maxContextCharacters * 0.4),
          excludePatterns: settings.excludePatterns, signal,
        }),
        readLanguageComments(document.languageId, signal),
      ]) : [[], undefined] as const;
      if (!this.isCurrent(pending, token)) return [];
      const contextText = buildCompletionPrompt({
        text: inputText, offset, maxCharacters: settings.maxContextCharacters,
        filepath: document.uri.scheme === 'file' ? vscode.workspace.asRelativePath(document.uri, false) : 'untitled',
        model: settings.model, snippets, comments,
      });
      pending.phase = 'request';
      this.trace('request', { id, protocol: settings.protocol, prefixCharacters: contextText.prefix.length, suffixCharacters: contextText.suffix.length, relatedFiles: snippets.length });
      const result = await requestCompletion({
        ...contextText, protocol: settings.protocol, endpoint: settings.endpoint,
        model: settings.model, apiKey: apiKey ?? '', maxTokens: settings.maxTokens, signal,
      });
      if (!this.isCurrent(pending, token)) return [];
      const normalized = document.eol === vscode.EndOfLine.CRLF
        ? result.replace(/\r?\n/g, '\r\n') : result.replace(/\r\n/g, '\n');
      const suggestion = prepareCompletion(normalized, prefix, suffix, document.languageId);
      const completion = suggestion ? this.completionItem(suggestion, document, position, selected) : undefined;
      this.trace('result', { id, receivedCharacters: normalized.length, insertionCharacters: completion?.text.length ?? 0, durationMs: Date.now() - started,
        outcome: suggestion === undefined ? 'format-rejected' : suggestion ? 'suggestion-returned' : normalized.trim() ? 'already-present' : 'empty' });
      this.cache = { uri: document.uri.toString(), prefix, suffix, text: completion?.text ?? '', createdAt: Date.now() };
      this.cacheContextRevision = contextRevision;
      this.contextFileCount = snippets.length;
      this.latencyMs = Date.now() - started;
      this.retryAfter = 0;
      if (suggestion === undefined) {
        // Cache the rejection for this exact context; a manual retry clears it.
        this.report('Autocomplete response included ambiguous code fences. Suggestion hidden; use Request suggestion / retry.');
        return [];
      }
      return completion ? [completion.item] : [];
    } catch (error) {
      if (!this.isCurrent(pending, token)) return [];
      this.trace('failed', { id, phase: pending.phase, code: error instanceof FimCompletionError ? error.code : 'internal', status: error instanceof FimCompletionError ? error.status ?? 0 : 0 });
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
    const current = this.active === pending && !this.disposed &&
      !token.isCancellationRequested && !pending.controller.signal.aborted &&
      !pending.document.isClosed && pending.document.version === pending.version &&
      this.context.revisionFor(pending.document.uri) === pending.contextRevision &&
      editor?.document === pending.document && editor.selections.length === 1 &&
      editor.selection.isEmpty && editor.selection.active.isEqual(pending.position);
    if (!current && !pending.controller.signal.aborted) {
      this.trace('discarded', { id: pending.id, phase: pending.phase, reason: token.isCancellationRequested ? 'editor-token'
        : pending.document.version !== pending.version ? 'document-version'
          : this.context.revisionFor(pending.document.uri) !== pending.contextRevision ? 'context-version' : 'editor-state' });
    }
    return current;
  }

  private completionItem(text: string, document: vscode.TextDocument, position: vscode.Position, selected?: vscode.SelectedCompletionInfo) {
    let insertText = (selected?.text ?? '') + text;
    let range = selected?.range ?? new vscode.Range(position, position);
    const eol = document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    // VS Code normalizes empty-range, newline-terminated insertions at column zero
    // onto the previous line, where its visibility check rejects them. Keep the
    // edit on the cursor line using a same-line replacement when text follows it.
    if (position.line > 0 && position.character === 0 && range.start.isEqual(range.end) &&
        insertText.endsWith(eol) && !insertText.startsWith(eol)) {
      const line = document.lineAt(position).text;
      if (!line.length) {
        // The document's existing newline separates following code. At EOF only
        // terminal blank lines are omitted; interior code and indentation stay exact.
        insertText = insertText.replace(/(?:\r?\n)+$/, '');
        text = insertText.slice(selected?.text.length ?? 0);
      } else if (!selected) {
        range = new vscode.Range(position, new vscode.Position(position.line, line.length));
        insertText += line;
      }
    }
    return { item: new vscode.InlineCompletionItem(insertText, range), text };
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
    this.cancel();
    this.cache = undefined;
    this.subscriptions.forEach((item) => item.dispose());
    this.context.dispose();
    this.changed.dispose();
    this.invalidated.dispose();
  }
}
