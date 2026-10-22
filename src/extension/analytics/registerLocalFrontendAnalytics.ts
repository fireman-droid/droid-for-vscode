import { join } from 'node:path';
import * as vscode from 'vscode';
import { LOCAL_ANALYTICS_DIRECTORY, LocalFrontendAnalytics } from './LocalFrontendAnalytics';

export function registerLocalFrontendAnalytics(context: vscode.ExtensionContext, logDirectory: string): LocalFrontendAnalytics {
  const analytics = new LocalFrontendAnalytics({ directory: join(logDirectory, LOCAL_ANALYTICS_DIRECTORY),
    output: vscode.window.createOutputChannel('Droid Local Analytics') });
  const configure = () => analytics.configure(
    vscode.workspace.getConfiguration('droidvisx').get<boolean>('localAnalytics.enabled', true) === true,
  );
  configure();
  context.subscriptions.push(analytics,
    vscode.commands.registerCommand('droidvisx.openLocalAnalytics', () => analytics.show()),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('droidvisx.localAnalytics.enabled')) configure();
    }));
  return analytics;
}
