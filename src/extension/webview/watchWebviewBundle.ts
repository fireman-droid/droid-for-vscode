import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as vscode from 'vscode';
import type { RuntimeDiagnosticSink } from '../../runtime/runtimeDiagnostics';

const WATCHED_ASSETS = [
  'webview.js',
  'webview.css',
  'management.js',
  'models.js',
  'review.js',
  'mission-control.js',
  'session-viewer.js',
] as const;

export interface WatchWebviewBundleOptions {
  readonly directory: string;
  readonly debounceMs?: number;
  readonly reloadWebviews?: () => Thenable<unknown>;
  readonly diagnostics?: RuntimeDiagnosticSink;
}

async function computeBundleSignature(directory: string): Promise<string | null> {
  const hash = createHash('sha256');
  try {
    for (const file of WATCHED_ASSETS) {
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
 * Watches the installed extension's global `dist/webview` directory so any open
 * VS Code or Cursor window across any workspace folder automatically refreshes
 * its Droid webviews as soon as updated webview assets are synced to disk.
 */
export function watchWebviewBundle(options: WatchWebviewBundleOptions): vscode.Disposable {
  const debounceMs = options.debounceMs ?? 350;
  const reload =
    options.reloadWebviews ??
    (() => vscode.commands.executeCommand('workbench.action.webview.reloadWebviews'));

  let disposed = false;
  let baseline: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watcher: vscode.FileSystemWatcher | undefined;
  const listeners: vscode.Disposable[] = [];

  void computeBundleSignature(options.directory).then(sig => {
    if (!disposed) baseline = sig;
  });

  const checkAndReload = async (): Promise<void> => {
    if (disposed) return;
    const next = await computeBundleSignature(options.directory);
    if (disposed || !next) return;
    if (baseline === null) {
      baseline = next;
      return;
    }
    if (next === baseline) return;
    baseline = next;
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
    watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(options.directory), '*.{js,css}'),
    );
    listeners.push(
      watcher.onDidChange(schedule),
      watcher.onDidCreate(schedule),
    );
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
    watcher?.dispose();
  });
}
