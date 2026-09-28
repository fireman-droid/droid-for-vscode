import { randomUUID } from 'node:crypto';
import type { ReasoningEffort } from '@factory/droid-sdk/node';
import * as vscode from 'vscode';
import type { RuntimeSessionSettings } from '../../runtime/DroidRuntime';
import { runEditorAssistance } from '../../runtime/editorAssistance/runEditorAssistance';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
import { MAX_EDITOR_INSTRUCTION } from '../../shared/protocol/editorAssistanceProtocol';
import { scrubCredentialAssignments } from '../../shared/validation/presentationSafety';
import { selectionIsCurrent, type SelectionSnapshot } from './selection';

const COMMANDS = {
  close: 'droidvisx.askSelectionCard.close',
  copy: 'droidvisx.askSelectionCard.copy',
  again: 'droidvisx.askSelectionCard.again',
  retry: 'droidvisx.askSelectionCard.retry',
} as const;
type Action = keyof typeof COMMANDS;
type Answer = { readonly kind: 'answer'; readonly text: string }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'cancelled' };

interface PendingQuestion {
  readonly capture: SelectionSnapshot;
  readonly token: string;
  readonly cancellation: vscode.CancellationTokenSource;
}
interface CardEntry {
  readonly capture: SelectionSnapshot;
  readonly token: string;
  readonly question: string;
  readonly abort: AbortController;
  completion?: Promise<Answer>;
  answer?: Answer;
}

/** A native editor hover; receiving an answer never reopens or refocuses it. */
export class AskSelectionCard implements vscode.Disposable {
  private readonly subscriptions: vscode.Disposable[] = [];
  private pending: PendingQuestion | undefined;
  private entry: CardEntry | undefined;
  private disposed = false;

  constructor(
    private readonly readSettings: () => RuntimeSessionSettings | null,
    private readonly diagnostics?: RuntimeDiagnosticSink,
  ) {
    const selector: vscode.DocumentSelector = [{ scheme: 'file' }, { scheme: 'untitled' }];
    // Providers are ordered newest first at equal selector scores. Register the
    // static heading last, so the asynchronous answer follows it when ready.
    this.subscriptions.push(
      vscode.languages.registerHoverProvider(selector, {
        provideHover: (document, position, cancellation) => this.answerHover(document, position, cancellation),
      }),
      vscode.languages.registerHoverProvider(selector, {
        provideHover: (document, position) => this.headerHover(document, position),
      }),
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length && this.ownsDocument(event.document)) this.invalidate();
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (this.ownsDocument(document)) this.invalidate();
      }),
      ...Object.entries(COMMANDS).map(([action, command]) =>
        vscode.commands.registerCommand(command, (token: unknown) => this.action(action as Action, token))),
    );
  }

  async open(captured: SelectionSnapshot, initialQuestion?: string): Promise<void> {
    if (this.disposed) return;
    if (!vscode.workspace.isTrusted || !selectionIsCurrent(captured)) {
      throw new Error('Select the current code in a trusted workspace and ask again.');
    }
    this.invalidate();
    const pending: PendingQuestion = {
      capture: captured, token: randomUUID(), cancellation: new vscode.CancellationTokenSource(),
    };
    this.pending = pending;
    try {
      const question = await vscode.window.showInputBox({
        title: 'Ask Droid',
        prompt: captured.label + ' · ' + captured.rangeLabel,
        placeHolder: 'Ask about the selected code',
        value: initialQuestion,
        validateInput: validateQuestion,
      }, pending.cancellation.token);
      if (question === undefined || !this.isPending(pending)) return;
      const error = validateQuestion(question);
      if (error) throw new Error(error);
      const editor = await vscode.window.showTextDocument(captured.document, {
        viewColumn: captured.column, selection: captured.range, preserveFocus: false,
      });
      if (!this.isPending(pending)) return;
      // Preserve the entire highlighted range with its active caret at the
      // beginning, including selections that originally ended on the next line.
      editor.selection = new vscode.Selection(captured.range.end, captured.range.start);
      const entry: CardEntry = {
        capture: captured, token: pending.token, question: question.trim(), abort: new AbortController(),
      };
      this.pending = undefined;
      this.entry = entry;
      entry.completion = this.request(entry).then((answer) => {
        if (this.entry === entry) entry.answer = answer;
        return answer;
      });
      // This is the only automatic showHover call. Esc cancels the hover's
      // provider request, not the answer; a later hover can read the saved result.
      await vscode.commands.executeCommand('editor.action.showHover', { focus: 'autoFocusImmediately' });
    } catch (error) {
      if (this.pending === pending || this.entry?.token === pending.token) this.invalidate();
      throw error;
    } finally {
      if (this.pending === pending) this.pending = undefined;
      pending.cancellation.dispose();
    }
  }

  handles(document: vscode.TextDocument, position: vscode.Position): boolean {
    const entry = this.entry;
    return !!entry && this.isCurrent(entry) && entry.capture.document === document &&
      entry.capture.range.contains(position);
  }

  private headerHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    if (!this.handles(document, position)) return;
    const entry = this.entry!;
    const header = new vscode.MarkdownString('**Ask Droid**\n\n');
    header.appendText(entry.question);
    return new vscode.Hover([header, controls(entry.token, [['close', 'Close']])], entry.capture.range);
  }

  private async answerHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    cancellation: vscode.CancellationToken,
  ): Promise<vscode.Hover | undefined> {
    if (!this.handles(document, position)) return;
    const entry = this.entry!;
    const answer = entry.answer ?? await waitForAnswer(entry.completion!, cancellation);
    if (!answer || answer.kind === 'cancelled' || cancellation.isCancellationRequested || !this.isCurrent(entry)) return;
    if (answer.kind === 'error') {
      const message = new vscode.MarkdownString('**Could not answer**\n\n');
      message.appendText(answer.message);
      return new vscode.Hover([message, controls(entry.token, [['retry', 'Retry'], ['again', 'Ask again']])], entry.capture.range);
    }
    const markdown = new vscode.MarkdownString(answer.text);
    markdown.isTrusted = false;
    markdown.supportHtml = false;
    return new vscode.Hover([markdown, controls(entry.token, [['copy', 'Copy'], ['again', 'Ask again']])], entry.capture.range);
  }

  private async request(entry: CardEntry): Promise<Answer> {
    const started = Date.now();
    try {
      const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Window, title: 'Droid: Answering…',
      }, async () => {
        if (!this.isCurrent(entry)) throw new Error('The selected code changed.');
        // Read when submitting, not when the input box originally opened.
        const settings = this.readSettings();
        return runEditorAssistance({
          cwd: entry.capture.cwd, selection: entry.capture.context,
          modelId: settings?.modelId,
          reasoningEffort: settings?.reasoningEffort as ReasoningEffort | undefined,
          mode: 'ask', instruction: entry.question, signal: entry.abort.signal,
        });
      });
      if (!this.isCurrent(entry)) return { kind: 'cancelled' };
      this.record('completed', started);
      return { kind: 'answer', text: result.text };
    } catch (error) {
      if (!this.isCurrent(entry)) {
        this.record('cancelled', started);
        return { kind: 'cancelled' };
      }
      this.record('failed', started);
      return { kind: 'error', message: safeError(error) };
    }
  }

  private async action(action: Action, token: unknown): Promise<void> {
    const entry = this.entry;
    if (!entry || token !== entry.token || !this.isCurrent(entry)) return;
    try {
      if (action === 'close') {
        this.invalidate();
        await vscode.commands.executeCommand('editor.action.hideHover');
      } else if (action === 'copy' && entry.answer?.kind === 'answer') {
        await vscode.env.clipboard.writeText(entry.answer.text);
      } else if (action === 'again') {
        await this.open(entry.capture);
      } else if (action === 'retry' && entry.answer?.kind === 'error') {
        await this.open(entry.capture, entry.question);
      }
    } catch (error) {
      if (!this.disposed) await vscode.window.showErrorMessage(safeError(error));
    }
  }

  private ownsDocument(document: vscode.TextDocument): boolean {
    return this.pending?.capture.document === document || this.entry?.capture.document === document;
  }
  private isPending(pending: PendingQuestion): boolean {
    return !this.disposed && this.pending === pending && vscode.workspace.isTrusted &&
      !pending.cancellation.token.isCancellationRequested && selectionIsCurrent(pending.capture);
  }
  private isCurrent(entry: CardEntry): boolean {
    return !this.disposed && this.entry === entry && !entry.abort.signal.aborted &&
      vscode.workspace.isTrusted && selectionIsCurrent(entry.capture);
  }
  private invalidate(): void {
    const pending = this.pending, entry = this.entry;
    this.pending = undefined;
    this.entry = undefined;
    pending?.cancellation.cancel();
    entry?.abort.abort();
  }
  private record(outcome: string, started: number): void {
    try {
      this.diagnostics?.record({
        level: outcome === 'failed' ? 'warn' : 'info', name: 'editor-assistance.ask-card.' + outcome,
        attributes: { elapsedMs: Date.now() - started },
      });
    } catch { /* Diagnostics must not change the result or interrupt native hover delivery. */ }
  }
  dispose(): void {
    this.disposed = true;
    this.invalidate();
    this.subscriptions.forEach((subscription) => subscription.dispose());
  }
}

function controls(token: string, actions: readonly (readonly [Action, string])[]): vscode.MarkdownString {
  const args = encodeURIComponent(JSON.stringify([token]));
  const markdown = new vscode.MarkdownString(actions.map(([action, label]) =>
    '[' + label + '](command:' + COMMANDS[action] + '?' + args + ')').join('  ·  '));
  markdown.isTrusted = { enabledCommands: actions.map(([action]) => COMMANDS[action]) };
  return markdown;
}

function validateQuestion(value: string): string | undefined {
  if (value.length > MAX_EDITOR_INSTRUCTION) return 'Keep the question under ' + MAX_EDITOR_INSTRUCTION + ' characters.';
  if (!value.trim()) return 'Enter a question about the selected code.';
  return undefined;
}

function safeError(error: unknown): string {
  return scrubCredentialAssignments(error instanceof Error ? error.message : 'Droid could not answer this question.').slice(0, 2048);
}

function waitForAnswer(answer: Promise<Answer>, cancellation: vscode.CancellationToken): Promise<Answer | undefined> {
  if (cancellation.isCancellationRequested) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let settled = false;
    let listener: vscode.Disposable | undefined;
    const finish = (value: Answer | undefined) => {
      if (settled) return;
      settled = true;
      listener?.dispose();
      resolve(value);
    };
    listener = cancellation.onCancellationRequested(() => finish(undefined));
    if (settled || cancellation.isCancellationRequested) { listener.dispose(); finish(undefined); }
    void answer.then(finish);
  });
}
