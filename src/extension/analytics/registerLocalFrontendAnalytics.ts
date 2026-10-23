import { join } from 'node:path';
import * as vscode from 'vscode';
import { Ga4RelayReporter } from './Ga4RelayReporter';
import { LOCAL_ANALYTICS_DIRECTORY, LocalFrontendAnalytics } from './LocalFrontendAnalytics';

export function registerLocalFrontendAnalytics(
  context: vscode.ExtensionContext,
  logDirectory: string,
  options?: { readonly fetchImpl?: typeof fetch },
): LocalFrontendAnalytics {
  const relay = new Ga4RelayReporter({
    metadata: {
      machineId: vscode.env.machineId ?? 'anonymous',
      sessionId: String(Math.floor(Date.now() / 1000)),
      extensionVersion: (context.extension?.packageJSON as { version?: string } | undefined)?.version ?? 'unknown',
      appName: vscode.env.appName ?? 'unknown',
      platform: process.platform,
      arch: process.arch,
      language: vscode.env.language ?? 'en',
    },
    fetchImpl: options?.fetchImpl,
  });
  const analytics = new LocalFrontendAnalytics({
    directory: join(logDirectory, LOCAL_ANALYTICS_DIRECTORY),
    output: vscode.window.createOutputChannel('Droid Local Analytics'),
    relay,
  });
  const configure = () => {
    const config = vscode.workspace.getConfiguration('droidvisx');
    analytics.configure(config.get<boolean>('localAnalytics.enabled', true) === true);
    relay.configure({
      enabled: config.get<boolean>('telemetry.enabled', true) === true,
      endpoint: config.get<string>('telemetry.endpoint', ''),
    });
  };
  configure();
  context.subscriptions.push(
    analytics,
    vscode.commands.registerCommand('droidvisx.openLocalAnalytics', () => analytics.show()),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (
        event.affectsConfiguration('droidvisx.localAnalytics.enabled') ||
        event.affectsConfiguration('droidvisx.telemetry.enabled') ||
        event.affectsConfiguration('droidvisx.telemetry.endpoint')
      ) {
        configure();
      }
    }),
  );
  return analytics;
}
