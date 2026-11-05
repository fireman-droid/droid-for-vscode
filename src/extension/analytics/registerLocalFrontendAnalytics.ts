import { join } from 'node:path';
import * as vscode from 'vscode';
import { SDK_VERSION } from '@factory/droid-sdk/node';
import { Ga4RelayReporter } from './Ga4RelayReporter';
import { LOCAL_ANALYTICS_DIRECTORY, LocalFrontendAnalytics } from './LocalFrontendAnalytics';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';
declare const __DROID_BUILD_ID__: string;

export function registerLocalFrontendAnalytics(
  context: vscode.ExtensionContext,
  logDirectory: string,
  options?: { readonly fetchImpl?: typeof fetch; readonly diagnostics?: RuntimeDiagnosticSink },
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
      editorVersion: vscode.version,
      sdkVersion: SDK_VERSION,
      buildId: typeof __DROID_BUILD_ID__ === 'string' ? __DROID_BUILD_ID__ : 'development',
      runtimeMode: vscode.workspace.getConfiguration('droidvisx').get<string>('runtime.mode', 'daemon'),
    },
    enabled: false,
    fetchImpl: options?.fetchImpl,
    onDelivery: event => options?.diagnostics?.record(event),
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
      enabled: vscode.env.isTelemetryEnabled === true && config.get<boolean>('telemetry.enabled', true) === true,
      endpoint: config.get<string>('telemetry.endpoint', ''),
    });
  };
  configure();
  context.subscriptions.push(
    analytics,
    vscode.env.onDidChangeTelemetryEnabled(configure),
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
