import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  changeListeners: new Set<() => void>(),
  warning: vi.fn<(...args: string[]) => Promise<string | undefined>>(),
}));

vi.mock('./webviewLocale', () => ({ hostText: (message: string) => message }));
vi.mock('vscode', () => ({
  Disposable: class {
    constructor(private readonly fn: () => void) {}
    dispose(): void {
      this.fn();
    }
  },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
  },
  RelativePattern: class {
    constructor(
      readonly base: { fsPath: string },
      readonly pattern: string,
    ) {}
  },
  workspace: {
    createFileSystemWatcher: () => ({
      onDidChange: (listener: () => void) => {
        host.changeListeners.add(listener);
        return { dispose: () => host.changeListeners.delete(listener) };
      },
      onDidCreate: (listener: () => void) => {
        host.changeListeners.add(listener);
        return { dispose: () => host.changeListeners.delete(listener) };
      },
      dispose: vi.fn(),
    }),
  },
  commands: {
    executeCommand: vi.fn(async () => undefined),
  },
  window: { showWarningMessage: host.warning },
}));

import { watchWebviewBundle } from './watchWebviewBundle';

const ASSETS = [
  'webview.js',
  'webview.css',
  'management.js',
  'models.js',
  'review.js',
  'mission-control.js',
  'session-viewer.js',
] as const;

const directories: string[] = [];
beforeEach(() => { host.warning.mockReset().mockResolvedValue(undefined); });
afterEach(async () => {
  host.changeListeners.clear();
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function watchExtension(restartExtensionHost: () => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'droid-extension-watch-'));
  directories.push(directory);
  await writeBundle(directory, 'v1');
  await Promise.all(['extension.cjs', 'sessionCatalogWorker.cjs', 'persistentIdeRelayWorker.cjs', 'btwAnalysisWorker.cjs']
    .map(file => writeFile(join(directory, file), 'v1')));
  const record = vi.fn(), reloadWebviews = vi.fn(async () => undefined);
  const watcher = watchWebviewBundle({
    directory, extensionDirectory: directory, debounceMs: 10, restartConfirmationMs: 10,
    restartExtensionHost, reloadWebviews, diagnostics: { record },
  });
  await new Promise(resolve => setTimeout(resolve, 40));
  const update = async () => {
    await writeFile(join(directory, 'extension.cjs'), 'v2');
    await writeFile(join(directory, 'webview.js'), 'v2');
    host.changeListeners.forEach(fn => fn());
  };
  return { watcher, record, reloadWebviews, update };
}

it.each(['veto', 'command-error'] as const)('offers an explicit retry after %s without refreshing against the old backend', async reason => {
  const restart = vi.fn(async () => { if (reason === 'command-error') throw new Error('unavailable'); });
  host.warning.mockResolvedValueOnce('Retry').mockResolvedValue(undefined);
  const result = await watchExtension(restart);
  await result.update();
  await vi.waitFor(() => expect(host.warning).toHaveBeenCalledTimes(2));
  expect(restart).toHaveBeenCalledTimes(2);
  expect(result.reloadWebviews).not.toHaveBeenCalled();
  expect(result.record).toHaveBeenCalledWith(expect.objectContaining({
    name: 'host.extension.hot-reload-pending',
    attributes: { reason: reason === 'veto' ? 'not-confirmed' : 'command-failed' },
  }));
  await result.update();
  await new Promise(resolve => setTimeout(resolve, 60));
  expect(restart).toHaveBeenCalledTimes(2);
  result.watcher.dispose();
});

it('does not warn when a successful restart disposes the old activation', async () => {
  let watcher: { dispose(): void };
  const restart = vi.fn(async () => { watcher.dispose(); });
  const result = await watchExtension(restart);
  watcher = result.watcher;
  await result.update();
  await vi.waitFor(() => expect(restart).toHaveBeenCalledOnce());
  await new Promise(resolve => setTimeout(resolve, 30));
  expect(host.warning).not.toHaveBeenCalled();
  expect(result.reloadWebviews).not.toHaveBeenCalled();
});

async function writeBundle(directory: string, version: string): Promise<void> {
  await Promise.all(
    ASSETS.map(file => writeFile(join(directory, file), `/* ${file}:${version} */`, 'utf8')),
  );
}

describe('watchWebviewBundle', () => {
  it('reloads webviews once after debounced asset updates and ignores unchanged writes', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'droid-webview-watch-'));
    directories.push(directory);
    await writeBundle(directory, 'v1');

    const reloadWebviews = vi.fn(async () => undefined);
    const watcher = watchWebviewBundle({
      directory,
      debounceMs: 30,
      reloadWebviews,
    });

    await new Promise(resolve => setTimeout(resolve, 40));

    // Write identical content -> should not reload.
    await writeFile(join(directory, 'webview.css'), '/* webview.css:v1 */', 'utf8');
    host.changeListeners.forEach(fn => fn());
    await new Promise(resolve => setTimeout(resolve, 60));
    expect(reloadWebviews).not.toHaveBeenCalled();

    // Update multiple files in a burst -> should debounce and reload once.
    await writeFile(join(directory, 'webview.js'), '/* webview.js:v2 */', 'utf8');
    host.changeListeners.forEach(fn => fn());
    await writeFile(join(directory, 'webview.css'), '/* webview.css:v2 */', 'utf8');
    host.changeListeners.forEach(fn => fn());

    await vi.waitFor(() => {
      expect(reloadWebviews).toHaveBeenCalledTimes(1);
    }, { timeout: 1000 });

    watcher.dispose();
    expect(host.changeListeners.size).toBe(0);
  });
});
