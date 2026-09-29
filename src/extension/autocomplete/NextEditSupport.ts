import * as vscode from 'vscode';
import path from 'node:path';
import type { CompletionContextService, ContextSnippet } from './context/CompletionContextService';
import { completionDocumentBlockReason, readCompletionSettings, type CompletionSettings } from './settings';
import { EditHistoryTracker } from './kilo/next-edit/editHistoryTracker';
import { NextEditSuggestionManager } from './kilo/next-edit/NextEditSuggestionManager';
import { NextEditPresenter } from './kilo/next-edit/NextEditPresenter';
import { computeEditableRegion } from './kilo/next-edit/editableRegion';
import type { MercuryEditContext } from '../../runtime/autocomplete/kilo/editPrompt';

/** Adapts Kilo's prediction/history/rendering to Droid's workspace policy and editor lifetime. */
export class NextEditSupport implements vscode.Disposable {
  readonly manager = new NextEditSuggestionManager(() => this.accepted());
  readonly presenter: NextEditPresenter;
  private readonly history: EditHistoryTracker;
  private readonly lifetime = new AbortController();
  private chainTimer?: ReturnType<typeof setTimeout>;

  constructor(private readonly context: CompletionContextService, onError: (error: unknown) => void,
    onSuggestion: (event: { shown: boolean; latencyMs: number; status: string }) => void) {
    this.presenter = new NextEditPresenter({ suggestionManager: this.manager, onSuggestion });
    this.history = new EditHistoryTracker({ onError, isFileAllowed: async fsPath => {
      if (this.lifetime.signal.aborted) return false;
      const document = vscode.workspace.textDocuments.find(d => d.uri.fsPath === fsPath);
      const active = vscode.window.activeTextEditor?.document;
      if (!document || !active) return false;
      const settings = readCompletionSettings(active.uri);
      if (!settings.enabled || completionDocumentBlockReason(document, settings)) return false;
      const root = vscode.workspace.getWorkspaceFolder(active.uri)?.uri.toString();
      if (!root) return document === active;
      if (vscode.workspace.getWorkspaceFolder(document.uri)?.uri.toString() !== root) return false;
      if (!settings.relatedFiles && document !== active) return false;
      return this.context.isAllowed(document, settings.excludePatterns, this.lifetime.signal);
    } });
  }

  async capture(document: vscode.TextDocument, position: vscode.Position, text: string,
    snippets: readonly ContextSnippet[], settings: CompletionSettings): Promise<MercuryEditContext> {
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    const region = computeEditableRegion({ cursorLine: position.line, totalLines: lines.length });
    await this.history.flush(document);
    return {
      currentFilePath: vscode.workspace.getWorkspaceFolder(document.uri)
        ? vscode.workspace.asRelativePath(document.uri, false) : path.basename(document.fileName || 'untitled'),
      currentFileContent: lines.join('\n'), cursorLine: position.line, cursorCharacter: position.character,
      editableRegionStartLine: region.startLine, editableRegionEndLine: region.endLine,
      recentlyViewedSnippets: settings.relatedFiles ? snippets.map(s => ({
        filepath: s.filepath, content: s.content,
      })) : [],
      editDiffHistory: await this.history.getRecentDiffs(),
    };
  }

  clear(): void {
    this.manager.clear();
    if (this.chainTimer) clearTimeout(this.chainTimer);
  }
  accepted(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const { document } = editor, version = document.version, position = editor.selection.active;
    if (this.chainTimer) clearTimeout(this.chainTimer);
    this.chainTimer = setTimeout(() => {
      const current = vscode.window.activeTextEditor, settings = readCompletionSettings(document.uri);
      if (!this.lifetime.signal.aborted && settings.enabled && settings.autoTrigger !== false && (settings.snoozeUntil ?? 0) <= Date.now() && settings.protocol === 'mercury-edit' &&
          current?.document === document && document.version === version &&
          current.selection.isEmpty && current.selection.active.isEqual(position)) {
        void vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
      }
    }, 60);
  }
  dispose(): void { this.lifetime.abort(); this.clear(); this.manager.dispose(); this.history.dispose(); }
}
