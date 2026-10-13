import { afterEach, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { registerEditorCodeReferences, handleCodeReference } from './editorCodeReferences';

vi.mock('vscode', () => ({
  Disposable: class { constructor(readonly dispose: () => void) {} },
  Range: class { constructor(readonly startLine: number, readonly startColumn: number, readonly endLine: number, readonly endColumn: number) {} },
  Uri: { file: vi.fn(path => ({ fsPath: path })) },
  languages: { registerDocumentPasteEditProvider: vi.fn(() => ({ dispose: vi.fn() })) },
  workspace: { workspaceFolders: [{ uri: { fsPath: 'C:/project' } }], openTextDocument: vi.fn() },
  window: { showTextDocument: vi.fn(), showWarningMessage: vi.fn() },
}));
afterEach(() => vi.clearAllMocks());
function capture(path: string, text: string) {
  const calls = vi.mocked(vscode.languages.registerDocumentPasteEditProvider).mock.calls;
  const [, provider, metadata] = calls.at(-1)!;
  provider.prepareDocumentPaste!({ uri: { fsPath: path }, getText: () => text } as unknown as vscode.TextDocument,
    [{ start: { line: 3, character: 0 }, end: { line: 5, character: 0 } }] as vscode.Range[], {} as vscode.DataTransfer, {} as vscode.CancellationToken);
  return metadata.copyMimeTypes![0]!;
}
function resolve(marker: string, text = 'same code') {
  const post = vi.fn();
  handleCodeReference({ type: 'codeReference.resolve', requestId: 'resolve', markers: [marker], text }, post);
  return post.mock.calls[0]![0].reference;
}
it('ties identical text to distinct real copy operations, keeps clipboard-history provenance and clears it on disposal', async () => {
  const registration = registerEditorCodeReferences();
  const first = capture('C:/project/first.ts', 'same code');
  await Promise.resolve();
  const second = capture('C:/project/second.ts', 'same code');
  expect(first).not.toBe(second);
  expect(resolve(first)).toEqual({ path: 'C:/project/first.ts', text: 'same code', startLine: 4, endLine: 5 });
  expect(resolve(second).path).toBe('C:/project/second.ts');
  expect(resolve(second, 'different code')).toBeNull();
  registration.dispose();
  await Promise.resolve();
  expect(resolve(second)).toBeNull();
});
it('does not attach a source when two copies race registration rotation', async () => {
  const registration = registerEditorCodeReferences();
  const marker = capture('C:/project/first.ts', 'same code');
  capture('C:/project/second.ts', 'same code');
  expect(resolve(marker)).toBeNull();
  registration.dispose();
  await Promise.resolve();
});
it('opens a text file and selects the copied range without invoking a file association', async () => {
  const document = { lineCount: 8, lineAt: () => ({ text: 'code' }) } as unknown as vscode.TextDocument;
  vi.mocked(vscode.workspace.openTextDocument).mockResolvedValue(document);
  handleCodeReference({ type: 'codeReference.open', reference: { path: 'C:/project/file.ts', startLine: 4, endLine: 5, text: 'code' } }, vi.fn());
  await Promise.resolve();
  expect(vscode.window.showTextDocument).toHaveBeenCalledWith(document, { preview: true,
    selection: expect.objectContaining({ startLine: 3, endLine: 4 }) });
});
