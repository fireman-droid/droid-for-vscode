import { randomUUID } from 'node:crypto';
import { basename } from 'node:path';
import * as vscode from 'vscode';
import type { EditorAssistanceSelection } from '../../runtime/editorAssistance/runEditorAssistance';

export interface SelectionSnapshot {
  readonly id: string;
  readonly document: vscode.TextDocument;
  readonly uri: vscode.Uri;
  readonly version: number;
  readonly range: vscode.Range;
  readonly original: string;
  readonly start: number;
  readonly end: number;
  readonly column: vscode.ViewColumn;
  readonly cwd: string;
  readonly label: string;
  readonly rangeLabel: string;
  readonly context: EditorAssistanceSelection;
}

export function captureSelection(
  editor = vscode.window.activeTextEditor,
  selection = editor?.selection,
): SelectionSnapshot {
  if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before using Droid editor assistance.');
  if (!editor || !['file', 'untitled'].includes(editor.document.uri.scheme)) {
    throw new Error('Select code in a local file or untitled editor first.');
  }
  if (!selection || selection.isEmpty || editor.selections.length !== 1) {
    throw new Error('Select one continuous code range for Quick Edit or Ask.');
  }
  const document = editor.document;
  const range = new vscode.Range(selection.start, selection.end);
  const original = document.getText();
  const start = document.offsetAt(range.start), end = document.offsetAt(range.end);
  if (original.length > 2_000_000 || end - start > 32_000) {
    throw new Error('Select at most 32,000 characters in a file under 2,000,000 characters.');
  }
  return {
    id: randomUUID(), document, uri: document.uri, version: document.version, range, original, start, end,
    column: editor.viewColumn ?? vscode.ViewColumn.One,
    cwd: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath ??
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
    label: basename(document.fileName),
    rangeLabel: range.start.line === range.end.line ? 'Line ' + (range.start.line + 1) :
      'Lines ' + (range.start.line + 1) + '–' + (range.end.line + (range.end.character > 0 ? 1 : 0)),
    context: {
      filePath: document.fileName, languageId: document.languageId,
      text: original.slice(start, end),
      prefix: original.slice(Math.max(0, start - 8000), start),
      suffix: original.slice(end, end + 8000),
    },
  };
}

export function selectionIsCurrent(snapshot: SelectionSnapshot): boolean {
  return !snapshot.document.isClosed && snapshot.document.version === snapshot.version &&
    vscode.workspace.textDocuments.includes(snapshot.document);
}

export const EDIT_PREVIEW_SCHEME = 'droid-quick-edit';

interface PreviewGeneration { readonly uris: readonly [vscode.Uri, vscode.Uri] }

/** Read-only, in-memory copies; generating or rejecting a preview cannot change the source. */
export class EditPreview implements vscode.Disposable, vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly generations = new Map<string, PreviewGeneration>();
  private disposed = false;
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.changed.event;
  private readonly registration = vscode.workspace.registerTextDocumentContentProvider(EDIT_PREVIEW_SCHEME, this);

  provideTextDocumentContent(uri: vscode.Uri): string {
    const content = this.contents.get(uri.toString());
    if (content === undefined) throw new Error('This Quick Edit preview has expired. Generate it again.');
    return content;
  }

  async open(snapshot: SelectionSnapshot, replacement: string): Promise<void> {
    if (this.disposed) return;
    const previous = this.generations.get(snapshot.id);
    const generation: PreviewGeneration = { uris: this.uris(snapshot, randomUUID()) };
    this.generations.set(snapshot.id, generation);
    const current = () => !this.disposed && this.generations.get(snapshot.id) === generation;
    const [before, after] = generation.uris;
    this.contents.set(before.toString(), snapshot.original);
    this.contents.set(after.toString(), snapshot.original.slice(0, snapshot.start) +
      replacement + snapshot.original.slice(snapshot.end));
    this.changed.fire(before); this.changed.fire(after);
    try {
      if (previous) await this.retire(previous);
      if (!current()) return;
      const documents = await Promise.all([vscode.workspace.openTextDocument(before), vscode.workspace.openTextDocument(after)]);
      if (!current()) return;
      await Promise.all(documents.map((document) => vscode.languages.setTextDocumentLanguage(document, snapshot.document.languageId)));
      if (!current()) return;
      await vscode.commands.executeCommand('vscode.diff', before, after,
        snapshot.label + ' · Quick Edit', {
          viewColumn: snapshot.column, preview: false, preserveFocus: true, selection: snapshot.range,
        });
    } catch (error) {
      // Closing while the virtual documents load can reject their content request.
      if (current()) {
        this.generations.delete(snapshot.id);
        throw error;
      }
    } finally {
      // A diff command already sent to VS Code may finish after Discard. Its
      // unique generation URI prevents this cleanup from closing a newer diff.
      if (!current()) await this.retire(generation);
    }
  }

  async close(snapshot: SelectionSnapshot): Promise<void> {
    const generation = this.generations.get(snapshot.id);
    if (!generation) return;
    this.generations.delete(snapshot.id);
    await this.retire(generation);
  }

  private async retire(generation: PreviewGeneration): Promise<void> {
    const [before, after] = generation.uris.map((uri) => uri.toString());
    this.contents.delete(before); this.contents.delete(after);
    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs).filter((tab) =>
      tab.input instanceof vscode.TabInputTextDiff &&
      tab.input.original.toString() === before && tab.input.modified.toString() === after);
    if (tabs.length) await vscode.window.tabGroups.close(tabs, true);
  }

  private uris(snapshot: SelectionSnapshot, generation: string): readonly [vscode.Uri, vscode.Uri] {
    return [
      vscode.Uri.from({ scheme: EDIT_PREVIEW_SCHEME, path: '/' + snapshot.id + '/' + generation + '/before/' + snapshot.label }),
      vscode.Uri.from({ scheme: EDIT_PREVIEW_SCHEME, path: '/' + snapshot.id + '/' + generation + '/after/' + snapshot.label }),
    ];
  }

  dispose(): void {
    this.disposed = true;
    const generations = [...this.generations.values()];
    this.generations.clear();
    for (const generation of generations) void this.retire(generation).catch(() => undefined);
    this.registration.dispose(); this.changed.dispose(); this.contents.clear();
  }
}
