import * as vscode from 'vscode';
import type { ReasoningEffort } from '@factory/droid-sdk/node';
import { runEditorAssistance } from '../../runtime/editorAssistance/runEditorAssistance';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import type { RuntimeSessionSettings } from '../../runtime/DroidRuntime';
import {
  parseEditorAssistanceRequest, type EditorAssistanceMode, type EditorAssistanceSnapshot,
} from '../../shared/protocol/editorAssistanceProtocol';
import { scrubCredentialAssignments } from '../../shared/validation/presentationSafety';
import { getWebviewHtml } from '../webview/webviewHtml';
import { handleWebviewClipboard } from '../webview/webviewClipboard';
import { readWebviewBootTheme } from '../webview/webviewTheme';
import { captureSelection, EditPreview, selectionIsCurrent, type SelectionSnapshot } from './selection';

interface Entry {
  readonly panel: vscode.WebviewPanel;
  readonly capture: SelectionSnapshot;
  readonly subscriptions: vscode.Disposable[];
  state: EditorAssistanceSnapshot;
  operation: AbortController | null;
  applying: boolean;
  replacement: string | undefined;
  publishTimer: ReturnType<typeof setTimeout> | undefined;
}

export class EditorAssistanceController implements vscode.Disposable {
  private entry: Entry | undefined;
  private readonly previews = new EditPreview();
  private disposed = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly readSettings: () => RuntimeSessionSettings | null,
    private readonly diagnostics?: RuntimeDiagnosticSink,
  ) {}

  async open(mode: EditorAssistanceMode): Promise<void> {
    if (this.disposed) return;
    if (this.entry?.applying) throw new Error('Wait for the current edit to finish applying.');
    const capture = captureSelection();
    this.entry?.panel.dispose();
    const dist = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel(
      'droidvisx.editorAssistance', mode === 'edit' ? 'Quick Edit' : 'Ask Droid',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: false },
      { enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [dist] },
    );
    const entry: Entry = {
      panel, capture, operation: null, applying: false, replacement: undefined, subscriptions: [], publishTimer: undefined,
      state: {
        selectionId: capture.id, revision: 0, mode, phase: 'idle', fileLabel: capture.label,
        rangeLabel: capture.rangeLabel, modelLabel: this.readSettings()?.modelId ?? 'Droid default',
        instruction: '', answer: '', message: '', sourceChanged: false, canApply: false, hasEdit: false,
      },
    };
    this.entry = entry;
    const sourceChanged = () => {
      if (selectionIsCurrent(capture)) return;
      entry.operation?.abort();
      this.update(entry, { sourceChanged: true, canApply: false,
        message: 'The source changed. Select the current code and open Quick Edit or Ask again.' });
    };
    entry.subscriptions.push(
      panel.webview.onDidReceiveMessage((value: unknown) => {
        if (handleWebviewClipboard(value, panel.webview)) return;
        const request = parseEditorAssistanceRequest(value);
        if (!request || this.entry !== entry) return;
        if (request.type === 'editor-assistance.ready') {
          this.publish(entry); this.theme(entry); return;
        }
        if (request.selectionId !== capture.id) return;
        const action = request.type === 'editor-assistance.submit'
          ? () => this.submit(entry, request.mode, request.instruction)
          : () => this.action(entry, request.action);
        void action().catch((error: unknown) => {
          if (this.entry === entry) this.update(entry, { message: safeError(error) });
        });
      }),
      panel.onDidDispose(() => {
        entry.operation?.abort();
        clearTimeout(entry.publishTimer);
        entry.subscriptions.forEach((subscription) => subscription.dispose());
        if (this.entry === entry) this.entry = undefined;
        void this.previews.close(capture).catch(() => undefined);
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.document === capture.document && event.contentChanges.length && !entry.applying) sourceChanged();
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document === capture.document) sourceChanged();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('droidvisx.theme')) this.theme(entry);
      }),
      vscode.window.onDidChangeActiveColorTheme(() => this.theme(entry)),
      panel.onDidChangeViewState(() => { if (panel.visible) { this.publish(entry); this.theme(entry); } }),
    );
    panel.webview.html = getWebviewHtml(panel.webview, {
      script: vscode.Uri.joinPath(dist, 'editor-assistance.js'),
      style: vscode.Uri.joinPath(dist, 'webview.css'),
    }, undefined, readWebviewBootTheme());
  }

  private async submit(entry: Entry, mode: EditorAssistanceMode, instruction: string): Promise<void> {
    if (entry.operation || entry.applying || this.entry !== entry) return;
    if (!vscode.workspace.isTrusted || !selectionIsCurrent(entry.capture)) {
      this.update(entry, { sourceChanged: true, canApply: false, message: 'Select the current code in a trusted workspace and try again.' });
      return;
    }
    const abort = new AbortController();
    entry.operation = abort;
    entry.replacement = undefined;
    const settings = this.readSettings();
    this.update(entry, {
      phase: 'running', mode, instruction, answer: '', message: 'Preparing Droid…',
      modelLabel: settings?.modelId ?? 'Droid default', canApply: false,
    });
    entry.panel.title = mode === 'edit' ? 'Quick Edit' : 'Ask Droid';
    const started = Date.now();
    try {
      await this.previews.close(entry.capture);
      abort.signal.throwIfAborted();
      const result = await runEditorAssistance({
        cwd: entry.capture.cwd, selection: entry.capture.context,
        modelId: settings?.modelId,
        reasoningEffort: settings?.reasoningEffort as ReasoningEffort | undefined,
        mode, instruction, signal: abort.signal,
        onDelta: (text) => {
          if (this.entry !== entry || entry.operation !== abort || abort.signal.aborted) return;
          entry.state = { ...entry.state, answer: entry.state.answer + text, message: 'Answering…' };
          if (!entry.publishTimer) entry.publishTimer = setTimeout(() => {
            entry.publishTimer = undefined; this.publish(entry);
          }, 50);
        },
      });
      abort.signal.throwIfAborted();
      if (this.entry !== entry || !selectionIsCurrent(entry.capture)) return;
      if (mode === 'ask') {
        this.update(entry, { phase: 'ready', answer: result.text, message: '' });
      } else {
        if (result.replacement === undefined) throw new Error('Droid returned no replacement. The source has not changed.');
        const eol = entry.capture.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
        entry.replacement = result.replacement.replace(/\r\n|\r|\n/g, eol);
        if (entry.replacement === entry.capture.context.text) {
          entry.replacement = undefined;
          this.update(entry, { phase: 'ready', message: 'No changes proposed.', canApply: false });
        } else {
          await this.previews.open(entry.capture, entry.replacement);
          abort.signal.throwIfAborted();
          if (this.entry !== entry) await this.previews.close(entry.capture);
          else this.update(entry, { phase: 'ready', message: 'Review the diff, then accept or discard.', canApply: selectionIsCurrent(entry.capture) });
        }
      }
      this.record('completed', mode, started);
    } catch (error) {
      if (this.entry !== entry) return;
      entry.replacement = undefined;
      this.update(entry, {
        phase: abort.signal.aborted ? 'cancelled' : 'error', canApply: false,
        message: entry.state.sourceChanged ? 'The source changed. Select the current code and try again.'
          : abort.signal.aborted ? 'Stopped. Your source is unchanged.' : safeError(error),
      });
      this.record(abort.signal.aborted ? 'cancelled' : 'failed', mode, started);
      await this.previews.close(entry.capture);
    } finally {
      if (entry.operation === abort) entry.operation = null;
      clearTimeout(entry.publishTimer); entry.publishTimer = undefined;
      this.publish(entry);
    }
  }

  private async action(entry: Entry, action: string): Promise<void> {
    if (action === 'cancel') {
      entry.operation?.abort();
      if (entry.operation) this.update(entry, { message: 'Stopping…' });
      return;
    }
    if (action === 'source') {
      await vscode.window.showTextDocument(entry.capture.uri, { viewColumn: entry.capture.column, selection: entry.capture.range });
      return;
    }
    if (entry.operation || entry.applying) return;
    if (action === 'review' && entry.replacement !== undefined) {
      await this.previews.open(entry.capture, entry.replacement);
    } else if (action === 'discard') {
      entry.replacement = undefined;
      await this.previews.close(entry.capture);
      this.update(entry, { phase: 'idle', canApply: false, message: 'Discarded. Your source is unchanged.' });
    } else if (action === 'apply') {
      await this.apply(entry);
    }
  }

  private async apply(entry: Entry): Promise<void> {
    if (!entry.state.canApply || entry.replacement === undefined) return;
    entry.applying = true;
    this.update(entry, { phase: 'applying', canApply: false, message: 'Applying edit…' });
    let applied = false;
    try {
      const editor = await vscode.window.showTextDocument(entry.capture.document, {
        viewColumn: entry.capture.column, selection: entry.capture.range, preview: false,
      });
      if (this.entry !== entry || !vscode.workspace.isTrusted || !selectionIsCurrent(entry.capture)) {
        throw new Error('The source changed after this edit was generated. Generate a new edit for the current code.');
      }
      // TextEditor.edit submits the document version atomically to VS Code.
      applied = await editor.edit((edit) => edit.replace(entry.capture.range, entry.replacement!),
        { undoStopBefore: true, undoStopAfter: true });
      if (!applied) throw new Error('VS Code could not apply this edit. The file may be read-only or changed.');
      entry.replacement = undefined;
      this.update(entry, { phase: 'applied', sourceChanged: true, message: 'Applied. Undo restores the previous code; save when ready.' });
      await this.previews.close(entry.capture);
    } finally {
      entry.applying = false;
      if (!applied) this.update(entry, {
        phase: 'ready', sourceChanged: !selectionIsCurrent(entry.capture),
        canApply: selectionIsCurrent(entry.capture) && entry.replacement !== undefined,
      });
    }
  }

  private update(entry: Entry, patch: Partial<EditorAssistanceSnapshot>): void {
    entry.state = { ...entry.state, ...patch };
    this.publish(entry);
  }
  private publish(entry: Entry): void {
    if (this.entry !== entry || this.disposed) return;
    entry.state = { ...entry.state, revision: entry.state.revision + 1, hasEdit: entry.replacement !== undefined };
    void entry.panel.webview.postMessage({ type: 'editor-assistance.state', snapshot: entry.state })
      .then(() => undefined, () => undefined);
  }
  private theme(entry: Entry): void {
    if (this.entry !== entry || this.disposed) return;
    void entry.panel.webview.postMessage({ type: 'editor-assistance.theme', resolved: readWebviewBootTheme().resolved })
      .then(() => undefined, () => undefined);
  }
  private record(outcome: string, mode: EditorAssistanceMode, started: number): void {
    this.diagnostics?.record({ level: outcome === 'failed' ? 'warn' : 'info',
      name: 'editor-assistance.' + outcome, attributes: { mode, elapsedMs: Date.now() - started } });
  }
  dispose(): void {
    this.disposed = true; this.entry?.panel.dispose(); this.previews.dispose();
  }
}

function safeError(error: unknown): string {
  return scrubCredentialAssignments(error instanceof Error ? error.message : 'Droid could not complete this request.').slice(0, 2048);
}

export function registerEditorAssistance(
  context: vscode.ExtensionContext,
  readSettings: () => RuntimeSessionSettings | null,
  diagnostics?: RuntimeDiagnosticSink,
): void {
  const controller = new EditorAssistanceController(context.extensionUri, readSettings, diagnostics);
  const open = (mode: EditorAssistanceMode) => async () => {
    try { await controller.open(mode); }
    catch (error) { await vscode.window.showErrorMessage(safeError(error)); }
  };
  context.subscriptions.push(controller,
    vscode.commands.registerCommand('droidvisx.quickEdit', open('edit')),
    vscode.commands.registerCommand('droidvisx.askSelection', open('ask')),
    vscode.languages.registerHoverProvider([{ scheme: 'file' }, { scheme: 'untitled' }], {
      provideHover(document, position) {
        const editor = vscode.window.activeTextEditor;
        if (!vscode.workspace.isTrusted || !editor || editor.document !== document ||
            editor.selection.isEmpty || editor.selections.length !== 1 || !editor.selection.contains(position)) return;
        const markdown = new vscode.MarkdownString(
          '[Quick Edit](command:droidvisx.quickEdit "Edit the selected code")  ·  ' +
          '[Ask Droid](command:droidvisx.askSelection "Ask about the selected code")  ·  ' +
          '[Add to Chat](command:droidvisx.addSelectionToChat "Add the selection to Droid chat")',
        );
        markdown.isTrusted = { enabledCommands: ['droidvisx.quickEdit', 'droidvisx.askSelection', 'droidvisx.addSelectionToChat'] };
        return new vscode.Hover(markdown, editor.selection);
      },
    }),
  );
}
