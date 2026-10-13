import { randomUUID } from 'node:crypto';
import { isAbsolute, resolve } from 'node:path';
import * as vscode from 'vscode';
import { CODE_REFERENCE_LIMIT, type CodeReference } from '@droidvisx/chat-ui/chat/codeReferences';
import { parseCodeReferenceRequest } from '../../shared/protocol/codeReferenceProtocol';

const copies = new Map<string, CodeReference | null>();

/** Observe actual editor copy operations without replacing Copy/Cut or changing plain text. */
export function registerEditorCodeReferences(): vscode.Disposable {
  let registration: vscode.Disposable | undefined;
  let disposed = false;
  const register = () => {
    if (disposed) return;
    const marker = `application/vnd.droid.copy.${randomUUID()}`;
    const previous = registration;
    registration = vscode.languages.registerDocumentPasteEditProvider({ scheme: 'file' }, {
      prepareDocumentPaste(document, ranges) {
        // VS Code includes providerCopyMimeTypes in its native copy metadata.
        // Rotate the marker for every operation: old clipboard history must never
        // acquire the source of a later copy with identical text.
        queueMicrotask(register);
        // Registration crosses the extension-host boundary. If another copy
        // races the rotation, this marker is ambiguous and must stay plain text.
        if (copies.has(marker)) { copies.set(marker, null); return; }
        copies.set(marker, null);
        while (copies.size > 32) copies.delete(copies.keys().next().value!);
        if (ranges.length !== 1) return;
        const range = ranges[0]!;
        const text = document.getText(range);
        if (!text.trim() || text.length > CODE_REFERENCE_LIMIT) return;
        copies.set(marker, { path: document.uri.fsPath, text, startLine: range.start.line + 1,
          endLine: range.end.character === 0 && range.end.line > range.start.line ? range.end.line : range.end.line + 1 });
      },
      provideDocumentPasteEdits() { return undefined; },
    }, { providedPasteEditKinds: [], copyMimeTypes: [marker], pasteMimeTypes: [] });
    previous?.dispose();
  };
  register();
  return new vscode.Disposable(() => { disposed = true; registration?.dispose(); copies.clear(); });
}

export function handleCodeReference(value: unknown, post: (message: unknown) => unknown): boolean {
  const request = parseCodeReferenceRequest(value);
  if (!request) return false;
  if (request.type === 'codeReference.resolve') {
    const copied = request.markers.map(marker => copies.get(marker)).find(Boolean);
    const reference = copied && copied.text.replace(/\r\n/g, '\n') === request.text.replace(/\r\n/g, '\n')
      ? { ...copied, text: request.text } : null;
    post({ type: 'codeReference.result', requestId: request.requestId, reference });
  } else {
    const reference = request.reference;
    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!isAbsolute(reference.path) && !root) return true;
    const path = isAbsolute(reference.path) ? reference.path : resolve(root!, reference.path);
    // Text editor only: never invoke an external file association or command URI.
    void vscode.workspace.openTextDocument(vscode.Uri.file(path)).then(document => {
      const start = Math.min(reference.startLine - 1, document.lineCount - 1);
      const end = Math.min(reference.endLine - 1, document.lineCount - 1);
      return vscode.window.showTextDocument(document, { preview: true,
        selection: new vscode.Range(start, 0, end, document.lineAt(end).text.length) });
    }).then(undefined, () => vscode.window.showWarningMessage(`Could not open ${reference.path}.`));
  }
  return true;
}
