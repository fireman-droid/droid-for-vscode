import * as vscode from 'vscode';
import { parseClipboardWrite } from '../../shared/protocol/clipboardProtocol';
import { handleCodeReference } from './editorCodeReferences';

export function handleWebviewClipboard(value: unknown, webview: Pick<vscode.Webview, 'postMessage'>): boolean {
  if (handleCodeReference(value, message => webview.postMessage(message))) return true;
  const message = parseClipboardWrite(value);
  if (!message) return false;
  // Do not select text or invoke editor copy commands inside the webview.
  void vscode.env.clipboard.writeText(message.text).then(
    () => webview.postMessage({ type: 'clipboard.result', requestId: message.requestId, ok: true }),
    () => webview.postMessage({ type: 'clipboard.result', requestId: message.requestId, ok: false }),
  ).then(undefined, () => undefined); // The originating webview may have been disposed.
  return true;
}
