import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import { captureSelection, type SelectionSnapshot } from './selection';

const SELECTION_SETTLE_MS = 160;

interface SelectedCode {
  readonly editor: vscode.TextEditor;
  readonly version: number;
  readonly selection: vscode.Selection;
  readonly token: string;
}

export interface SelectionActions extends vscode.Disposable {
  capture(token: unknown): SelectionSnapshot | undefined;
}

/** Native action links above the selected code; no hover, focus changes or source edits. */
export function registerAutomaticSelectionActions(): SelectionActions {
  const changed = new vscode.EventEmitter<void>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let selected: SelectedCode | undefined;
  let visible = false;
  let disposed = false;
  const clearPending = () => { clearTimeout(timer); timer = undefined; };
  const hide = (retainForClick = false) => {
    clearPending();
    if (!retainForClick) selected = undefined;
    if (visible) { visible = false; changed.fire(); }
  };
  const isCurrentDocument = (value: SelectedCode) =>
    !disposed && vscode.workspace.isTrusted && vscode.window.state.focused &&
    value.editor === vscode.window.activeTextEditor && !value.editor.document.isClosed &&
    value.editor.document.version === value.version;
  const hasSameSelection = (value: SelectedCode) => value.editor.selections.length === 1 &&
    value.editor.selection.anchor.isEqual(value.selection.anchor) &&
    value.editor.selection.active.isEqual(value.selection.active);
  const subscriptions = [
    vscode.languages.registerCodeLensProvider([{ scheme: 'file' }, { scheme: 'untitled' }], {
      onDidChangeCodeLenses: changed.event,
      provideCodeLenses(document) {
        if (!visible || !selected || selected.editor.document !== document ||
            !isCurrentDocument(selected) || !hasSameSelection(selected)) return [];
        const line = selected.selection.start.line;
        const range = new vscode.Range(line, 0, line, 0);
        return [
          new vscode.CodeLens(range, { title: 'Quick Edit', command: 'droidvisx.quickEdit', arguments: [selected.token] }),
          new vscode.CodeLens(range, { title: 'Ask Droid', command: 'droidvisx.askSelection', arguments: [selected.token] }),
          new vscode.CodeLens(range, { title: 'Add to Chat', command: 'droidvisx.selectionActions.addToChat', arguments: [selected.token] }),
        ];
      },
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      const editor = event.textEditor;
      if (editor !== vscode.window.activeTextEditor) return;
      const selection = editor.selection;
      // A native CodeLens mouse gesture may collapse the selection before its
      // command is delivered. Hide the row, but retain its opaque capture token.
      if (editor.selections.length === 1 && selection.isEmpty) { hide(true); return; }
      hide();
      if (!vscode.workspace.isTrusted || !vscode.window.state.focused ||
          !['file', 'untitled'].includes(editor.document.uri.scheme) || editor.selections.length !== 1 ||
          (event.kind !== vscode.TextEditorSelectionChangeKind.Mouse &&
           event.kind !== vscode.TextEditorSelectionChangeKind.Keyboard)) return;
      const candidate: SelectedCode = { editor, version: editor.document.version, selection, token: randomUUID() };
      timer = setTimeout(() => {
        timer = undefined;
        if (!isCurrentDocument(candidate) || !hasSameSelection(candidate)) return;
        selected = candidate;
        visible = true;
        changed.fire();
      }, SELECTION_SETTLE_MS);
    }),
    vscode.window.onDidChangeActiveTextEditor(() => hide()),
    vscode.window.onDidChangeWindowState((state) => { if (!state.focused) hide(); }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length && (event.document === selected?.editor.document ||
          event.document === vscode.window.activeTextEditor?.document)) hide();
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      if (document === selected?.editor.document) hide();
    }),
  ];
  return {
    capture(token) {
      if (!selected || token !== selected.token || !isCurrentDocument(selected)) return undefined;
      return captureSelection(selected.editor, selected.selection);
    },
    dispose() {
      disposed = true;
      hide();
      for (const subscription of subscriptions) subscription.dispose();
      changed.dispose();
    },
  };
}
