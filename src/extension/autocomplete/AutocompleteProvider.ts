import * as vscode from 'vscode';
import type { RuntimeDiagnosticSink, RuntimeDiagnosticAttribute } from '../../runtime/runtimeDiagnostics';
import { setTimeout as delay } from 'node:timers/promises';
import { FimCompletionError } from '../../runtime/autocomplete/FimClient';
import { requestCompletion } from '../../runtime/autocomplete/requestCompletion';
import { CompletionContextService } from './context/CompletionContextService';
import { KiloContextService } from './context/KiloContextService';
import { autocompleteScope, getNotebookContext, notebookUri } from './kilo/continuedev/core/autocomplete/notebook';
import { readLanguageComments } from './context/LanguageComments';
import {
  prepareCompletion,
} from './completionText';
import {
  COMPLETION_SECTION, completionDocumentBlockReason, completionNeedsKey, readCompletionKey,
  readCompletionSettings, validateCompletionEndpoint, mercuryAlternateEndpoint,
} from './settings';

import { NextEditSupport } from './NextEditSupport';
import { requestNextEdit } from '../../runtime/autocomplete/nextEdit';
import { CompletionHistory } from './CompletionHistory';
import { CompletionRequests } from './CompletionRequests';
import { shouldSkipAutocomplete } from './kilo/classic-auto-complete/contextualSkip';
import { calcDebounceDelay, shouldShowOnlyFirstLine, getFirstLine } from './kilo/inline-utils';
import { ErrorBackoff } from './kilo/ErrorBackoff';

interface PendingCompletion {
  id: number;
  startedAt: number;
  phase: 'debounce' | 'policy' | 'credentials' | 'context' | 'request';
  controller: AbortController;
  document: vscode.TextDocument;
  version: number;
  position: vscode.Position;
  contextRevision: number;
  documentScope: string;
}

export class AutocompleteProvider implements vscode.InlineCompletionItemProvider, vscode.Disposable {
  private active?: PendingCompletion;
  private sequence = 0;
  private firstAutomaticRequest = true;
  private nextEdit?: NextEditSupport;
  private kiloContext?: KiloContextService;
  private readonly history = new CompletionHistory();
  private readonly requests = new CompletionRequests();
  private readonly backoff = new ErrorBackoff();
  private readonly latencies: number[] = [];
  private cacheContextRevision = -1;
  private readonly context = new CompletionContextService();
  private lastDocument?: vscode.TextDocument;
  private lastDocumentScope?: string;
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
    const notebookChanged = () => {
        if (this.lastDocument?.uri.scheme === 'vscode-notebook-cell' &&
            autocompleteScope(this.lastDocument) !== this.lastDocumentScope) {
          this.lastDocumentScope = autocompleteScope(this.lastDocument);
          this.reset('notebook-context-changed'); this.invalidated.fire();
        }
    };
    this.subscriptions = [
      vscode.workspace.onDidChangeNotebookDocument(notebookChanged),
      this.context.onDidChangeContext(() => {
        if (!this.active && !this.lastDocument) return;
        const document = this.active?.document ?? this.lastDocument;
        const revision = this.active?.contextRevision ?? this.cacheContextRevision;
        if (document && this.context.revisionFor(document.uri) !== revision) {
          this.reset('context-changed');
          this.invalidated.fire();
        }
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        notebookChanged();
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

  warmNextEdit(): void {
    const settings = readCompletionSettings(vscode.window.activeTextEditor?.document.uri);
    if (settings.enabled) {
      // Track context before the first request, across FIM and Next Edit switches.
      this.kiloContext ??= new KiloContextService(uri => this.context.trackContextFile(uri),
        () => this.trace('context.timeout', { source: 'language-service' }));
      this.nextEdit ??= new NextEditSupport(this.context,
        () => { this.trace('history.failed', { code: 'context' }); this.report('Autocomplete edit history could not be read. Check Droid logs.'); },
        event => this.trace('next-edit.result', event));
      if (settings.protocol !== 'mercury-edit') this.nextEdit.clear();
    } else {
      this.nextEdit?.dispose(); this.nextEdit = undefined;
      this.kiloContext?.dispose(); this.kiloContext = undefined;
    }
  }
  acceptOrJumpNextEdit(): Promise<void> { return this.nextEdit?.manager.acceptOrJump() ?? Promise.resolve(); }
  dismissNextEdit(): void { this.cancel('dismissed'); this.requests.clear(); this.nextEdit?.clear(); }
  nextEditAccepted(): void { this.nextEdit?.accepted(); }

  get isLoading(): boolean { return this.active !== undefined; }
  get lastMessage(): string | undefined { return this.message; }
  get lastContextFileCount(): number { return this.contextFileCount; }
  get lastLatencyMs(): number | undefined { return this.latencyMs; }

  reset(reason = 'reset'): void {
    this.cancel(reason);
    this.nextEdit?.clear();
    this.kiloContext?.invalidate();
    this.history.clear();
    this.requests.clear();
    this.contextFileCount = 0;
    this.latencyMs = undefined;
    if (reason !== 'context-changed') {
      this.backoff.reset();
      this.retryAfter = 0;
      this.message = undefined;
    }
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
    const configured = readCompletionSettings(document.uri);
    const settings = document.uri.scheme === 'vscode-notebook-cell' && configured.protocol === 'mercury-edit'
      && mercuryAlternateEndpoint(configured.endpoint)
      ? { ...configured, protocol: 'fim' as const, endpoint: mercuryAlternateEndpoint(configured.endpoint)! } : configured;
    if (!settings.enabled) return skip('disabled');
    const blocked = completionDocumentBlockReason(document, settings);
    if (blocked) return skip(blocked);
    const editor = vscode.window.activeTextEditor;
    if (editor?.document !== document || editor.selections.length !== 1 ||
        !editor.selection.isEmpty || !editor.selection.active.isEqual(position)) return skip('editor-selection-mismatch');

    const explicit = context.triggerKind === vscode.InlineCompletionTriggerKind.Invoke;
    if (!explicit && settings.autoTrigger === false) return skip('automatic-disabled');
    if (!explicit && (settings.snoozeUntil ?? 0) > Date.now()) return skip('snoozed');
    if (!explicit && (this.backoff.blocked() || Date.now() < this.retryAfter)) return skip('error-cooldown');
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
    const isNextEdit = settings.protocol === 'mercury-edit';
    if (isNextEdit) {
      this.warmNextEdit();
      if (selected || this.nextEdit?.manager.isPending()) return skip('next-edit-pending');
    }
    const originalOffset = document.offsetAt(position);
    const notebook = getNotebookContext(document, position);
    let inputText = notebook?.contents ?? text;
    let offset = notebook ? notebook.contents.split('\n').slice(0, notebook.position.line).reduce((sum, line) => sum + line.length + 1, 0)
      + notebook.position.character : originalOffset;
    const cellOffset = offset - originalOffset;
    if (selected) {
      const start = document.offsetAt(selected.range.start);
      const end = document.offsetAt(selected.range.end);
      if (selected.range.start.line !== selected.range.end.line || start > originalOffset ||
          end < originalOffset || !selected.text.startsWith(text.slice(start, originalOffset))) return skip('selected-completion-mismatch');
      // Ask for code after the selected language-server item, then extend that same item/range.
      inputText = inputText.slice(0, cellOffset + start) + selected.text + inputText.slice(cellOffset + end);
      offset = cellOffset + start + selected.text.length;
    }
    const prefix = inputText.slice(0, offset);
    const suffix = inputText.slice(offset);
    if (!prefix.trim() && !isNextEdit) return skip('empty-prefix');
    this.lastDocument = document; this.lastDocumentScope = autocompleteScope(document);
    const contextRevision = this.context.revisionFor(document.uri);
    this.cacheContextRevision = contextRevision;
    const scope = autocompleteScope(document) + ':' + contextRevision;
    const cached = isNextEdit ? undefined : this.history.find(scope, prefix, suffix);
    if (cached !== undefined) {
      this.trace('cache', { id, characters: cached.length, outcome: cached ? 'suggestion-returned' : 'empty' });
      if (!cached) return [];
      const completion = this.completionItem(shouldShowOnlyFirstLine(prefix, cached) ? getFirstLine(cached) : cached, document, position, selected);
      return [completion.item];
    }
    // Cached continuations remain available mid-word; explicit retries can force a request.
    if (!isNextEdit && !explicit && shouldSkipAutocomplete(prefix, suffix, document.languageId)) return skip('contextual-skip');
    const leading = !isNextEdit && this.firstAutomaticRequest;
    if (!explicit) this.firstAutomaticRequest = false;
    const pending: PendingCompletion = {
      id, startedAt: Date.now(), phase: 'debounce',
      controller: new AbortController(), document, version: document.version, position, contextRevision, documentScope: autocompleteScope(document),
    };
    this.active = pending;
    this.trace('started', { id, language: document.languageId, trigger: context.triggerKind, documentVersion: document.version });
    this.message = undefined;
    this.changed.fire();
    const releaseRequest = isNextEdit ? undefined : this.requests.reserve(scope, prefix, suffix, pending.controller.signal);
    const cancellation = token.onCancellationRequested(() => {
      if (this.active === pending) this.cancel('editor-token');
    });
    try {
      if (token.isCancellationRequested) return [];
      if (!explicit && !releaseRequest && !(leading && settings.adaptiveDebounce !== false)) await delay(settings.adaptiveDebounce === false ? settings.debounceMs : isNextEdit ? 250 : this.latencies.length < 10 ? 300 : calcDebounceDelay(this.latencies), undefined, { signal: pending.controller.signal });
      if (!this.isCurrent(pending, token)) return [];
      const signal = pending.controller.signal;
      pending.phase = 'policy';
      const policyUri = notebookUri(document.uri) ?? document.uri;
      const policyDocument = policyUri === document.uri ? document : { uri: policyUri, languageId: document.languageId } as vscode.TextDocument;
      if (policyUri.scheme === 'file' && vscode.workspace.getWorkspaceFolder(policyUri) &&
          !await this.context.isAllowed(policyDocument, settings.excludePatterns, signal)) {
        if (this.isCurrent(pending, token)) this.report('This file is excluded by workspace ignore rules or file policy.');
        return skip('file-policy');
      }
      if (!this.isCurrent(pending, token)) return [];
      pending.phase = 'credentials';
      const apiKey = await readCompletionKey(this.secrets, settings.endpoint);
      if (!this.isCurrent(pending, token)) return [];
      if (!apiKey && completionNeedsKey(settings.endpoint)) {
        this.report('Configure an API key with Droid: Configure Autocomplete.');
        return skip('missing-key');
      }
      const started = Date.now();
      pending.phase = 'context';
      const contextOptions = {
        maxCharacters: Math.floor(settings.maxContextCharacters * 0.4),
        excludePatterns: settings.excludePatterns, signal,
      };
      const [snippets, comments] = settings.relatedFiles ? await Promise.all([
        isNextEdit ? this.context.collectRecentlyViewed(document, contextOptions)
          : this.context.collect(document, position, contextOptions),
        readLanguageComments(document.languageId, signal),
      ]) : [[], undefined] as const;
      if (!this.isCurrent(pending, token)) return [];
      if (isNextEdit) {
        const support = this.nextEdit!;
        const editContext = await support.capture(document, position, text, snippets, settings);
        if (!this.isCurrent(pending, token)) return [];
        pending.phase = 'request';
        const replacement = await requestNextEdit({
          context: editContext, maxContextCharacters: settings.maxContextCharacters,
          endpoint: settings.endpoint, model: settings.model, apiKey: apiKey ?? '',
          maxTokens: settings.maxTokens, signal,
        });
        if (!this.isCurrent(pending, token)) return [];
        this.contextFileCount = snippets.length;
        this.latencyMs = Date.now() - started;
        this.backoff.success();
        this.latencies.push(this.latencyMs);
        if (this.latencies.length > 10) this.latencies.shift();
        return support.presenter.toCompletionItems(document, position, {
          replacement: document.eol === vscode.EndOfLine.CRLF ? replacement.replace(/\r?\n/g, '\r\n') : replacement,
          editableRegionStartLine: editContext.editableRegionStartLine,
          editableRegionEndLine: editContext.editableRegionEndLine, latencyMs: this.latencyMs,
        }) ?? [];
      }
      const contextText = await (this.kiloContext ??= new KiloContextService(uri => this.context.trackContextFile(uri),
        () => this.trace('context.timeout', { source: 'language-service' }))).build({
        document, text: inputText, offset, settings, signal,
        filepath: document.uri.scheme === 'file' ? vscode.workspace.asRelativePath(document.uri, false) : 'untitled',
        snippets, comments,
      });
      if (!this.isCurrent(pending, token)) return [];
      pending.phase = 'request';
      this.trace('request', { id, protocol: settings.protocol, prefixCharacters: contextText.prefix.length, suffixCharacters: contextText.suffix.length, relatedFiles: contextText.relatedFiles });
      const result = await this.requests.run(scope, prefix, suffix, signal, (requestSignal) => requestCompletion({
        ...contextText, protocol: settings.protocol, endpoint: settings.endpoint,
        model: settings.model, apiKey: apiKey ?? '', maxTokens: settings.maxTokens, signal: requestSignal,
      }));
      if (!this.isCurrent(pending, token)) return [];
      const normalized = document.eol === vscode.EndOfLine.CRLF
        ? result.replace(/\r?\n/g, '\r\n') : result.replace(/\r\n/g, '\n');
      const suggestion = prepareCompletion(normalized, prefix, suffix, document.languageId, settings.model);
      const completion = suggestion ? this.completionItem(suggestion, document, position, selected) : undefined;
      this.trace('result', { id, receivedCharacters: normalized.length, insertionCharacters: completion?.text.length ?? 0, durationMs: Date.now() - started,
        outcome: suggestion === undefined ? 'format-rejected' : suggestion ? 'suggestion-returned' : normalized.trim() ? 'already-present' : 'empty' });
      this.history.put(scope, prefix, suffix, completion?.text ?? '');
      this.cacheContextRevision = contextRevision;
      this.contextFileCount = contextText.relatedFiles;
      this.latencyMs = Date.now() - started;
      this.retryAfter = 0;
      this.backoff.success();
      this.latencies.push(this.latencyMs);
      if (this.latencies.length > 10) this.latencies.shift();
      if (suggestion === undefined) {
        // Cache the rejection for this exact context; a manual retry clears it.
        this.report('Autocomplete response included ambiguous code fences. Suggestion hidden; use Request suggestion / retry.');
        return [];
      }
      if (!completion) return [];
      return [shouldShowOnlyFirstLine(prefix, completion.text)
        ? this.completionItem(getFirstLine(completion.text), document, position, selected).item : completion.item];
    } catch (error) {
      if (!this.isCurrent(pending, token)) return [];
      this.trace('failed', { id, phase: pending.phase, code: error instanceof FimCompletionError ? error.code : 'internal', status: error instanceof FimCompletionError ? error.status ?? 0 : 0 });
      if (error instanceof FimCompletionError) {
        const help = error.status === 401 || error.status === 402 || error.status === 403
          ? ' Check the API key and model access.'
          : error.status === 429 ? ' Provider rate limit reached.' : '';
        this.report(error.message + help);
      } else {
        this.report(pending.phase === 'context' ? 'Autocomplete could not collect editor context. Check Droid logs.'
          : 'Autocomplete failed. Check the endpoint, model and stored API key.');
      }
      // Automatic typing must not hammer an unavailable provider. Manual invocation can retry.
      const kind = this.backoff.failure(error);
      this.retryAfter = kind === 'transient' ? Date.now() + 30_000 : 0;
      return [];
    } finally {
      releaseRequest?.();
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
      autocompleteScope(pending.document) === pending.documentScope &&
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
    return { item: new vscode.InlineCompletionItem(insertText, range, { command: 'droidvisx.autocomplete.accepted', title: 'Completion accepted' }), text };
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
    this.history.clear();
    this.requests.clear();
    this.backoff.reset();
    this.subscriptions.forEach((item) => item.dispose());
    this.nextEdit?.dispose();
    this.kiloContext?.dispose();
    this.context.dispose();
    this.changed.dispose();
    this.invalidated.dispose();
  }
}
