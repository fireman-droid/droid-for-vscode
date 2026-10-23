import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';

const WATCHED_WEBVIEW_ASSETS = [
  'webview.js',
  'webview.css',
  'management.js',
  'models.js',
  'review.js',
  'mission-control.js',
  'session-viewer.js',
] as const;

const WATCHED_EXTENSION_ASSETS = [
  'extension.cjs',
  'sessionCatalogWorker.cjs',
  'sessionHistoryWorker.cjs',
  'persistentIdeRelayWorker.cjs',
  'btwAnalysisWorker.cjs',
] as const;

export interface WatchWebviewBundleOptions {
  readonly directory: string;
  readonly extensionDirectory?: string;
  readonly debounceMs?: number;
  readonly reloadWebviews?: () => Thenable<unknown>;
  readonly restartExtensionHost?: () => Thenable<unknown>;
  readonly diagnostics?: RuntimeDiagnosticSink;
}

async function computeAssetSignature(
  directory: string,
  assets: readonly string[],
): Promise<string | null> {
  const hash = createHash('sha256');
  try {
    for (const file of assets) {
      const content = await readFile(join(directory, file));
      if (content.byteLength === 0) return null;
      hash.update(file);
      hash.update(content);
    }
    return hash.digest('hex');
  } catch {
    return null;
  }
}

/**
 * Watches the installed extension's global `dist/webview` and `dist/extension`
 * directories so any open VS Code or Cursor window across any workspace folder
 * automatically refreshes its Droid webviews (or restarts the Extension Host
 * when backend `.cjs` bundles change) as soon as updated assets are synced to disk.
 */
export function watchWebviewBundle(options: WatchWebviewBundleOptions): vscode.Disposable {
  const debounceMs = options.debounceMs ?? 350;
  const reload =
    options.reloadWebviews ??
    (() => vscode.commands.executeCommand('workbench.action.webview.reloadWebviews'));
  const restartHost =
    options.restartExtensionHost ??
    (() => vscode.commands.executeCommand('workbench.action.restartExtensionHost'));

  let disposed = false;
  let webviewBaseline: string | null = null;
  let extensionBaseline: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watchers: vscode.FileSystemWatcher[] = [];
  const listeners: vscode.Disposable[] = [];

  void computeAssetSignature(options.directory, WATCHED_WEBVIEW_ASSETS).then(sig => {
    if (!disposed) webviewBaseline = sig;
  });
  if (options.extensionDirectory) {
    void computeAssetSignature(options.extensionDirectory, WATCHED_EXTENSION_ASSETS).then(sig => {
      if (!disposed) extensionBaseline = sig;
    });
  }

  const checkAndReload = async (): Promise<void> => {
    if (disposed) return;
    if (options.extensionDirectory) {
      const nextExt = await computeAssetSignature(options.extensionDirectory, WATCHED_EXTENSION_ASSETS);
      if (disposed) return;
      if (nextExt) {
        if (extensionBaseline === null) {
          extensionBaseline = nextExt;
        } else if (nextExt !== extensionBaseline) {
          extensionBaseline = nextExt;
          const nextWeb = await computeAssetSignature(options.directory, WATCHED_WEBVIEW_ASSETS);
          if (disposed) return;
          if (nextWeb) webviewBaseline = nextWeb;
          options.diagnostics?.record({
            level: 'info',
            name: 'host.extension.hot-reload',
            attributes: { signature: nextExt.slice(0, 12) },
          });
          try {
            await restartHost();
            return;
          } catch {
            // Fall through to webview reload if restartExtensionHost is unavailable.
          }
        }
      }
    }

    const next = await computeAssetSignature(options.directory, WATCHED_WEBVIEW_ASSETS);
    if (disposed || !next) return;
    if (webviewBaseline === null) {
      webviewBaseline = next;
      return;
    }
    if (next === webviewBaseline) return;
    webviewBaseline = next;
    options.diagnostics?.record({
      level: 'info',
      name: 'host.webview.hot-reload',
      attributes: { signature: next.slice(0, 12) },
    });
    try {
      await reload();
    } catch {
      // Never disrupt the extension host if the reload command is unavailable.
    }
  };

  const schedule = (): void => {
    if (disposed) return;
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void checkAndReload();
    }, debounceMs);
  };

  try {
    const webviewWatcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(options.directory), '*.{js,css}'),
    );
    watchers.push(webviewWatcher);
    listeners.push(
      webviewWatcher.onDidChange(schedule),
      webviewWatcher.onDidCreate(schedule),
    );
    if (options.extensionDirectory) {
      const extWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(vscode.Uri.file(options.extensionDirectory), '*.cjs'),
      );
      watchers.push(extWatcher);
      listeners.push(
        extWatcher.onDidChange(schedule),
        extWatcher.onDidCreate(schedule),
      );
    }
  } catch {
    // Watcher API may be absent in minimal unit-test mocks.
  }

  return new vscode.Disposable(() => {
    disposed = true;
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    for (const listener of listeners.splice(0)) {
      listener.dispose();
    }
    for (const watcher of watchers.splice(0)) {
      watcher.dispose();
    }
  });
}
