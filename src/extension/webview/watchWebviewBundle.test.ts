import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const host = vi.hoisted(() => ({
  changeListeners: new Set<() => void>(),
}));

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
afterEach(async () => {
  host.changeListeners.clear();
  await Promise.all(directories.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
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
