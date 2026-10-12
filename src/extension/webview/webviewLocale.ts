import * as vscode from 'vscode';
import { resolveUiLocale } from '@droidvisx/chat-ui/i18n/locale';
import { translate } from '@droidvisx/chat-ui/i18n/translate';
import { isLanguagePreference, isUiLocaleRead, type UiLocaleMessage } from '../../shared/protocol/localeProtocol';

export function readWebviewLocale(): UiLocaleMessage {
  const setting = vscode.workspace.getConfiguration('droidvisx').get<string>('language', 'auto');
  const preference = isLanguagePreference(setting) ? setting : 'auto';
  return { type: 'ui.locale', preference, resolved: resolveUiLocale(preference, vscode.env.language) };
}

export function hostText(message: string, params?: Readonly<Record<string, string | number>>): string {
  return translate(readWebviewLocale().resolved, message, params);
}

/** Every surface has its own binding; hidden panels also receive preference changes. */
export function bindWebviewLocale(webview: vscode.Webview): vscode.Disposable {
  let disposed = false;
  const post = () => { if (!disposed) void webview.postMessage(readWebviewLocale()); };
  const receive = webview.onDidReceiveMessage((message: unknown) => { if (isUiLocaleRead(message)) post(); });
  const configuration = vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('droidvisx.language')) post();
  });
  return new vscode.Disposable(() => { disposed = true; receive.dispose(); configuration.dispose(); });
}
