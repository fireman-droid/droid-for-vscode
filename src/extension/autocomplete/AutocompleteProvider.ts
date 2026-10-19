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
  prepareCompletionWithOutcome,
} from './completionText';
import {
  COMPLETION_SECTION, completionDocumentBlockReason, completionNeedsKey, readCompletionKey,
  readCompletionSettings, validateCompletionEndpoint, mercuryAlternateEndpoint, nextEditSettings, type CompletionSettings,
} from './settings';

import { NextEditSupport } from './NextEditSupport';
import { requestNextEdit } from '../../runtime/autocomplete/nextEdit';
import { CompletionHistory } from './CompletionHistory';
import { CompletionRequests } from './CompletionRequests';
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
  private lastAutomaticRequestAt = 0;
  private generation?: { id: number; relatedFiles: number; contextMs: number; networkMs: number; phase: PendingCompletion['phase'] };
  private nextEdit?: NextEditSupport;
  private kiloContext?: KiloContextService;
  private readonly history = new CompletionHistory();
  private readonly requests = new CompletionRequests();
  private readonly routes = { fim: { backoff: new ErrorBackoff(), retryAfter: 0 }, edit: { backoff: new ErrorBackoff(), retryAfter: 0 } };
  private editIntent?: { document: vscode.TextDocument; version: number; line?: number };
  private readonly latencies: number[] = [];
  private cacheContextRevision = -1;
  private readonly context = new CompletionContextService();
  private lastDocument?: vscode.TextDocument;
  private lastDocumentScope?: string;
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
        if (event.document === vscode.window.activeTextEditor?.document && event.contentChanges.length) {
          const replacement = event.contentChanges.find(change => change.rangeLength > 0);
          const continuing = this.editIntent?.document === event.document && this.editIntent.line !== undefined &&
            event.contentChanges.every(change => change.range?.start.line === this.editIntent?.line && !change.text.includes('\n'));
          this.editIntent = !event.reason && (replacement || continuing)
            ? { document: event.document, version: event.document.version, line: replacement?.range?.start.line ?? this.editIntent?.line } : undefined;
        }
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
        event => this.trace('next-edit.result', event), () => this.preferNextEdit());
      if (!nextEditSettings(settings)) this.nextEdit.clear();
    } else {
      this.nextEdit?.dispose(); this.nextEdit = undefined;
      this.kiloContext?.dispose(); this.kiloContext = undefined;
    }
  }
  acceptOrJumpNextEdit(): Promise<void> { return this.nextEdit?.manager.acceptOrJump() ?? Promise.resolve(); }
  dismissNextEdit(): void { this.cancel('dismissed'); this.requests.clear(); this.nextEdit?.clear(); }
  nextEditAccepted(): void { this.nextEdit?.accepted(); }
  completionAccepted(): void {
    if (nextEditSettings(readCompletionSettings(vscode.window.activeTextEditor?.document.uri))) {
      this.warmNextEdit(); this.nextEdit?.accepted();
    }
  }
  private preferNextEdit(): void {
    const document = vscode.window.activeTextEditor?.document;
    if (document) this.editIntent = { document, version: document.version };
  }

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
    this.generation = undefined;
    this.contextFileCount = 0;
    this.latencyMs = undefined;
    if (reason !== 'context-changed') {
      for (const route of Object.values(this.routes)) { route.backoff.reset(); route.retryAfter = 0; }
      if (reason !== 'retry') this.editIntent = undefined;
      this.message = undefined;
    }
    this.changed.fire();
  }

  cancel(reason = 'cancelled'): void {
    if (!this.active) return;
    this.trace('cancelled', { id: this.active.id, phase: this.active.phase, reason, durationMs: Date.now() - this.active.startedAt });
    const editor = vscode.window.activeTextEditor;
    if (reason === 'editor-token' && this.active.phase === 'request' &&
        this.active.document.version === this.active.version && editor?.document === this.active.document &&
        editor.selection.isEmpty && editor.selection.active.isEqual(this.active.position)) this.requests.retainForEditorRefresh();
    this.active.controller.abort();
    this.active = undefined;
    this.changed.fire();
  }

  async provideInlineCompletionItems(
    document: vscode.TextDocument, position: vscode.Position,
    context: vscode.InlineCompletionContext, token: vscode.CancellationToken,
  ): Promise<vscode.InlineCompletionItem[]> {
    const configured = readCompletionSettings(document.uri);
    const edit = document.uri.scheme === 'vscode-notebook-cell' ? undefined : nextEditSettings(configured);
    if (this.nextEdit?.manager.isPending()) return [];
    const version = document.version;
    const preferEdit = edit && (configured.fimEnabled === false || configured.protocol === 'mercury-edit' ||
      this.editIntent?.document === document && this.editIntent.version === version && !context.selectedCompletionInfo);
    const onlyEdit = configured.fimEnabled === false && configured.protocol !== 'mercury-edit';
    if ((onlyEdit || configured.protocol === 'mercury-edit' && document.uri.scheme !== 'vscode-notebook-cell') && !edit) return [];
    let emptyFim = false;
    const items = await this.provideForSettings(document, position, context, token,
      preferEdit ? edit : configured, () => { emptyFim = true; });
    // A visible FIM suggestion always wins. Only a valid empty response can fall
    // through; failures, cancellations and policy gates never launch a second API.
    if (!preferEdit && edit && emptyFim && !items.length && !context.selectedCompletionInfo &&
        !token.isCancellationRequested && document.version === version && !this.nextEdit?.manager.isPending()) {
      return this.provideForSettings(document, position, context, token, edit);
    }
    return items;
  }

  private async provideForSettings(
    document: vscode.TextDocument, position: vscode.Position,
    context: vscode.InlineCompletionContext, token: vscode.CancellationToken,
    configured: CompletionSettings, onEmpty?: () => void,
  ): Promise<vscode.InlineCompletionItem[]> {
    this.cancel('superseded');
    const id = ++this.sequence;
    this.trace('invoked', { id, language: document.languageId, trigger: context.triggerKind,
      selectedCompletion: !!context.selectedCompletionInfo });
    const skip = (reason: string): vscode.InlineCompletionItem[] => {
      this.trace('skipped', { id, reason, language: document.languageId, trigger: context.triggerKind });
      return [];
    };
    if (this.disposed || token.isCancellationRequested) return skip('inactive');
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
    const route = this.routes[settings.protocol === 'mercury-edit' ? 'edit' : 'fim'];
    if (!explicit && settings.autoTrigger === false) return skip('automatic-disabled');
    if (!explicit && (settings.snoozeUntil ?? 0) > Date.now()) return skip('snoozed');
    if (!explicit && (route.backoff.blocked() || Date.now() < route.retryAfter)) return skip('error-cooldown');
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
      if (selected) return skip('next-edit-language-suggestion');
      if (this.nextEdit?.manager.isPending()) return skip('next-edit-pending');
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
    const cached = isNextEdit ? undefined : this.history.find(scope, prefix, suffix, undefined, explicit);
    if (cached !== undefined) {
      this.trace('cache', { id, characters: cached.length, outcome: cached ? 'suggestion-returned' : 'empty' });
      if (!cached) { onEmpty?.(); return []; }
      const completion = this.completionItem(shouldShowOnlyFirstLine(prefix, cached) ? getFirstLine(cached) : cached, document, position, selected, id, true);
      return [completion.item];
    }
    if (explicit && !isNextEdit && this.history.find(scope, prefix, suffix) === '') this.requests.clear();
    // Keywords, partial identifiers and closing parentheses can all need a continuation.
    // Coalesce automatic input instead of permanently suppressing these positions.
    const leading = Date.now() - this.lastAutomaticRequestAt >= 1000;
    if (!explicit) this.lastAutomaticRequestAt = Date.now();
    const debounceMs = explicit ? 0 : settings.adaptiveDebounce === false ? settings.debounceMs
      : leading ? 0 : isNextEdit ? 250 : this.latencies.length < 10 ? 150 : Math.min(250, calcDebounceDelay(this.latencies));
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
      if (isNextEdit && debounceMs) await delay(debounceMs, undefined, { signal: pending.controller.signal });
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
      if (isNextEdit) {
        pending.phase = 'context';
        const [viewed, definitions] = settings.relatedFiles ? await Promise.all([
          this.context.collectRecentlyViewed(document, {
            maxCharacters: Math.floor(settings.maxContextCharacters * 0.4), excludePatterns: settings.excludePatterns, signal,
          }),
          this.kiloContext!.collectDefinitions({ document, text, offset: originalOffset, settings, signal }),
        ]) : [[], []];
        // Fresh definitions take priority over older views of the same code. The
        // prompt builder bounds the combined context and retains the newest five.
        const snippets = [...viewed.filter(s => !definitions.some(d => d.uri === s.uri && d.content.includes(s.content.trim()))),
          ...definitions].slice(-5);
        if (!this.isCurrent(pending, token)) return [];
        const support = this.nextEdit!;
        const editContext = await support.capture(document, position, text, snippets, settings);
        if (!this.isCurrent(pending, token)) return [];
        pending.phase = 'request';
        this.trace('request', { id, protocol: settings.protocol, relatedFiles: snippets.length });
        const replacement = await requestNextEdit({
          context: editContext, maxContextCharacters: settings.maxContextCharacters,
          endpoint: settings.endpoint, model: settings.model, apiKey: apiKey ?? '',
          maxTokens: settings.maxTokens, signal,
        });
        if (!this.isCurrent(pending, token)) return [];
        this.contextFileCount = snippets.length;
        this.latencyMs = Date.now() - pending.startedAt;
        route.backoff.success();
        this.latencies.push(this.latencyMs);
        if (this.latencies.length > 10) this.latencies.shift();
        return support.presenter.toCompletionItems(document, position, {
          replacement: document.eol === vscode.EndOfLine.CRLF ? replacement.replace(/\r?\n/g, '\r\n') : replacement,
          editableRegionStartLine: editContext.editableRegionStartLine,
          editableRegionEndLine: editContext.editableRegionEndLine, latencyMs: this.latencyMs,
        }) ?? [];
      }
      if (releaseRequest) {
        pending.phase = this.generation?.phase ?? 'context';
        this.trace('reused', { id, sourceRequestId: this.generation?.id ?? 0 });
      }
      // The shared task owns debounce, context and transport. A compatible invocation
      // joins that work instead of preparing a second prompt or restarting its timer.
      const result = await this.requests.run(scope, prefix, suffix, signal, async (requestSignal) => {
        const generation = { id, relatedFiles: 0, contextMs: 0, networkMs: 0, phase: 'debounce' as PendingCompletion['phase'] };
        this.generation = generation;
        const phase = (value: PendingCompletion['phase']) => {
          generation.phase = value;
          if (this.generation === generation && this.active) this.active.phase = value;
        };
        const assertContextCurrent = () => {
          requestSignal.throwIfAborted();
          if (this.disposed || document.isClosed || autocompleteScope(document) !== pending.documentScope ||
              this.context.revisionFor(document.uri) !== contextRevision) throw new DOMException('Context changed', 'AbortError');
        };
        const prepareContext = async () => {
          assertContextCurrent();
          phase('context');
          const contextStarted = Date.now();
          const [snippets, comments] = settings.relatedFiles ? await Promise.all([
            this.context.collect(document, position, { maxCharacters: Math.floor(settings.maxContextCharacters * 0.4),
              excludePatterns: settings.excludePatterns, signal: requestSignal }),
            readLanguageComments(document.languageId, requestSignal),
          ]) : [[], undefined] as const;
          assertContextCurrent();
          const prepared = await (this.kiloContext ??= new KiloContextService(uri => this.context.trackContextFile(uri),
            () => this.trace('context.timeout', { source: 'language-service' }))).build({
            document, text: inputText, offset, settings, signal: requestSignal,
            filepath: document.uri.scheme === 'file' ? vscode.workspace.asRelativePath(document.uri, false) : 'untitled', snippets, comments,
          });
          assertContextCurrent();
          generation.contextMs = Date.now() - contextStarted;
          phase('debounce');
          return prepared;
        };
        // Prepare locally during the send delay. Both gates must finish, and the
        // shared request still owns cancellation and compatible typing handoffs.
        const [contextText] = await Promise.all([
          prepareContext(), debounceMs ? delay(debounceMs, undefined, { signal: requestSignal }) : undefined,
        ]);
        assertContextCurrent();
        generation.relatedFiles = contextText.relatedFiles;
        phase('request');
        this.trace('request', { id, protocol: settings.protocol, debounceMs, contextMs: generation.contextMs,
          prefixCharacters: contextText.prefix.length, suffixCharacters: contextText.suffix.length, relatedFiles: contextText.relatedFiles });
        const networkStarted = Date.now();
        const output = await requestCompletion({ ...contextText, protocol: settings.protocol, endpoint: settings.endpoint,
          model: settings.model, apiKey: apiKey ?? '', maxTokens: settings.maxTokens, signal: requestSignal });
        assertContextCurrent();
        generation.networkMs = Date.now() - networkStarted;
        // Preserve valid results across editor invocation handoffs, as Kilo does.
        // Reset/context/config changes abort this task before it can populate history.
        const normalized = document.eol === vscode.EndOfLine.CRLF ? output.replace(/\r?\n/g, '\r\n') : output.replace(/\r\n/g, '\n');
        const prepared = prepareCompletionWithOutcome(normalized, prefix, suffix, document.languageId, settings.model);
        this.history.put(scope, prefix, suffix, prepared.text ?? '');
        this.trace('generated', { id, receivedCharacters: normalized.length, contextMs: generation.contextMs,
          networkMs: generation.networkMs, outcome: prepared.outcome });
        return normalized;
      });
      if (!this.isCurrent(pending, token)) return [];
      const normalized = document.eol === vscode.EndOfLine.CRLF
        ? result.replace(/\r?\n/g, '\r\n') : result.replace(/\r\n/g, '\n');
      const prepared = prepareCompletionWithOutcome(normalized, prefix, suffix, document.languageId, settings.model);
      const suggestion = prepared.text;
      const completion = suggestion ? this.completionItem(suggestion, document, position, selected, id) : undefined;
      const offered = completion && shouldShowOnlyFirstLine(prefix, completion.text)
        ? this.completionItem(getFirstLine(completion.text), document, position, selected, id) : completion;
      this.trace('result', { id, sourceRequestId: this.generation?.id ?? id, receivedCharacters: normalized.length,
        insertionCharacters: offered?.text.length ?? 0, durationMs: Date.now() - pending.startedAt,
        contextMs: this.generation?.contextMs ?? 0, networkMs: this.generation?.networkMs ?? 0, outcome: prepared.outcome });
      this.history.put(scope, prefix, suffix, completion?.text ?? '');
      this.cacheContextRevision = contextRevision;
      this.contextFileCount = this.generation?.relatedFiles ?? 0;
      this.latencyMs = Date.now() - pending.startedAt;
      route.retryAfter = 0;
      route.backoff.success();
      this.latencies.push(this.latencyMs);
      if (this.latencies.length > 10) this.latencies.shift();
      if (suggestion === undefined) {
        // Cache the rejection for this exact context; a manual retry clears it.
        this.report('Autocomplete response included ambiguous code fences. Suggestion hidden; use Request suggestion / retry.');
        return [];
      }
      if (!offered) onEmpty?.();
      return offered ? [offered.item] : [];
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
      const kind = route.backoff.failure(error);
      route.retryAfter = kind === 'transient' ? Date.now() + 30_000 : 0;
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

  private completionItem(text: string, document: vscode.TextDocument, position: vscode.Position,
    selected?: vscode.SelectedCompletionInfo, id?: number, cached = false) {
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
    return { item: new vscode.InlineCompletionItem(insertText, range, {
      command: 'droidvisx.autocomplete.accepted', title: 'Completion accepted',
      arguments: [{ suggestionId: id ?? 0, cached, characters: text.length }],
    }), text };
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
    for (const route of Object.values(this.routes)) route.backoff.reset();
    this.subscriptions.forEach((item) => item.dispose());
    this.nextEdit?.dispose();
    this.kiloContext?.dispose();
    this.context.dispose();
    this.changed.dispose();
    this.invalidated.dispose();
  }
}
