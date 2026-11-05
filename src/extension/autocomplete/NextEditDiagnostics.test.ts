import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';

const state = vi.hoisted(() => ({ editor: undefined as unknown, edit: vi.fn(),
  changed: undefined as ((event: unknown) => void) | undefined }));
vi.mock('vscode', () => ({
  Position: class { constructor(public line: number, public character: number) {} },
  Range: class { constructor(public start: vscode.Position, public end: vscode.Position) {} },
  Selection: class { active: vscode.Position; isEmpty = true;
    constructor(public anchor: vscode.Position, active: vscode.Position) { this.active = active; } },
  InlineCompletionItem: class {
    constructor(public insertText: string, public range: vscode.Range, public command: vscode.Command) {} },
  EndOfLine: { LF: 1, CRLF: 2 }, ThemeColor: class {}, OverviewRulerLane: { Left: 1 },
  commands: { executeCommand: vi.fn(async () => undefined) },
  workspace: { isTrusted: true, onDidChangeTextDocument: (callback: (event: unknown) => void) => {
    state.changed = callback; return { dispose() {} };
  } },
  window: {
    get activeTextEditor() { return state.editor; }, visibleTextEditors: [],
    createTextEditorDecorationType: () => ({ dispose() {} }),
    onDidChangeActiveTextEditor: () => ({ dispose() {} }),
    onDidChangeTextEditorSelection: () => ({ dispose() {} }),
  },
}));

import { NextEditPresenter } from './kilo/next-edit/NextEditPresenter';
import { NextEditSuggestionManager } from './kilo/next-edit/NextEditSuggestionManager';

let manager: NextEditSuggestionManager;
const events = vi.fn(), accepted = vi.fn();
beforeEach(() => {
  events.mockClear(); accepted.mockClear(); state.edit.mockReset().mockResolvedValue(true);
  manager = new NextEditSuggestionManager(accepted, events);
});
afterEach(() => manager.dispose());

function document(text = 'const oldName = 1;') {
  const lines = text.split('\n');
  const doc = {
    version: 1, eol: 1, lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line], firstNonWhitespaceCharacterIndex: 0,
      range: new vscode.Range(new vscode.Position(line, 0), new vscode.Position(line, lines[line].length)) }),
    getText: (range?: vscode.Range) => {
      if (!range) return lines.join('\n');
      return lines.slice(range.start.line, range.end.line + 1).map((line, index, selected) =>
        line.slice(index === 0 ? range.start.character : 0, index === selected.length - 1 ? range.end.character : undefined)).join('\n');
    },
  } as unknown as vscode.TextDocument;
  const position = new vscode.Position(0, 13);
  const selection = { active: position, isEmpty: true };
  state.editor = { document: doc, selection, selections: [selection], edit: state.edit };
  return { doc, position, lines };
}

it('explains unchanged output without marking it as an offered edit', () => {
  const { doc, position } = document(), result = vi.fn();
  const presenter = new NextEditPresenter({ suggestionManager: manager, onSuggestion: result });
  expect(presenter.toCompletionItems(doc, position, { suggestionId: 31, replacement: doc.getText(),
    editableRegionStartLine: 0, editableRegionEndLine: 0, latencyMs: 37 })).toBeUndefined();
  expect(result).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    suggestionId: 31, shown: false, reason: 'unchanged-region', latencyMs: 37, presentation: 'none',
  }));
});

it('correlates a prefix-mismatched decoration with its successful application', async () => {
  const { doc, position } = document(), result = vi.fn();
  const presenter = new NextEditPresenter({ suggestionManager: manager, onSuggestion: result });
  presenter.toCompletionItems(doc, position, { suggestionId: 32, replacement: 'const newName = 1;',
    editableRegionStartLine: 0, editableRegionEndLine: 0, latencyMs: 10 });
  expect(result).toHaveBeenCalledWith(expect.objectContaining({
    suggestionId: 32, reason: 'cursor-prefix-mismatch', presentation: 'decoration',
  }));
  await manager.acceptOrJump();
  expect(events).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    name: 'accepted', attributes: expect.objectContaining({ suggestionId: 32, source: 'decoration', outcome: 'accepted' }),
  }));
  expect(accepted).toHaveBeenCalledOnce();
});

it('carries the request id into native inline acceptance', () => {
  const { doc } = document('const x = '), result = vi.fn();
  const presenter = new NextEditPresenter({ suggestionManager: manager, onSuggestion: result });
  const items = presenter.toCompletionItems(doc, new vscode.Position(0, 10), { suggestionId: 33,
    replacement: 'const x = 42;', editableRegionStartLine: 0, editableRegionEndLine: 0, latencyMs: 10 });
  expect(items?.[0].command?.arguments).toEqual([33]);
  expect(result).toHaveBeenCalledWith(expect.objectContaining({ suggestionId: 33, reason: 'inline-candidate' }));
});

it.each(['version', 'content', 'dismiss'] as const)('records why a pending edit is dropped: %s', async kind => {
  const { doc, lines } = document();
  manager.setPending({ kind: 'replace', suggestionId: 34, document: doc, diffStartLine: 0, diffEndLine: 0,
    replacement: 'const newName = 1;', removesLines: false, originalText: doc.getText() });
  if (kind === 'version') Object.assign(doc, { version: 2 });
  if (kind === 'content') lines[0] = 'const changed = 2;';
  if (kind === 'dismiss') manager.clear('dismissed');
  else await manager.acceptOrJump();
  expect(events).toHaveBeenCalledWith(expect.objectContaining({
    name: kind === 'dismiss' ? 'dismissed' : 'discarded',
    attributes: expect.objectContaining({ suggestionId: 34,
      reason: kind === 'version' ? 'document-version' : kind === 'content' ? 'range-mismatch' : 'dismissed' }),
  }));
  expect(state.edit).not.toHaveBeenCalled();
  expect(accepted).not.toHaveBeenCalled();
});

it.each([false, 'throw'] as const)('does not count an unsuccessful editor application as accepted: %s', async outcome => {
  const { doc } = document();
  manager.setPending({ kind: 'replace', suggestionId: 35, document: doc, diffStartLine: 0, diffEndLine: 0,
    replacement: 'const newName = 1;', removesLines: false, originalText: doc.getText() });
  if (outcome === false) { state.edit.mockResolvedValue(false); await manager.acceptOrJump(); }
  else {
    state.edit.mockRejectedValue(new Error('synthetic editor failure'));
    await expect(manager.acceptOrJump()).rejects.toThrow('synthetic editor failure');
  }
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ name: 'apply-failed',
    attributes: expect.objectContaining({ suggestionId: 35, outcome: 'failed',
      reason: outcome === false ? 'editor-rejected' : 'editor-error' }) }));
  expect(accepted).not.toHaveBeenCalled();
});
