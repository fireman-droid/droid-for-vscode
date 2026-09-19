import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { relative } from 'node:path';
import { isSafeWorkspaceRelativePath } from '../../shared/validation/guards';
import type { ChangeStatsWatcher } from './changeStats';

/** Watch the active runtime root, including worktrees, only for the active turn. */
export const watchWorkspaceChanges: ChangeStatsWatcher = (root, onPaths) => {
  const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(root), '**/*'));
  const pending = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const flush = () => {
    timer = undefined;
    const paths = [...pending];
    pending.clear();
    const child = execFile('git', ['check-ignore', '--stdin', '-z'], {
      cwd: root, windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024,
    }, (error, stdout) => {
      if (disposed) return;
      // A non-Git workspace uses private snapshots and has no Git ignore rules.
      if (error && error.code !== 1 && error.code !== 128) return;
      const ignored = new Set(stdout.split('\0').map((path) => path.replaceAll('\\', '/')));
      onPaths(paths.filter((path) => !ignored.has(path)));
    });
    // execFile's completion handles command failure, including early stdin closure.
    child.stdin?.on('error', () => {});
    child.stdin?.end(`${paths.join('\0')}\0`);
  };
  const queue = (path: string) => {
    if (disposed) return;
    if (pending.size < 200) pending.add(path);
    timer ??= setTimeout(flush, 100);
  };
  const changed = (uri: vscode.Uri) => {
    const path = relative(root, uri.fsPath).replaceAll('\\', '/');
    if (!isSafeWorkspaceRelativePath(path) || /(?:^|\/)(?:\.git|node_modules|\.venv)(?:\/|$)/u.test(path)) return;
    void stat(uri.fsPath).then(
      (file) => { if (file.isFile()) queue(path); },
      (error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') queue(path); },
    );
  };
  const subscriptions = [watcher.onDidCreate(changed), watcher.onDidChange(changed), watcher.onDidDelete(changed)];
  return { dispose() {
    disposed = true;
    clearTimeout(timer);
    pending.clear();
    for (const subscription of subscriptions) subscription.dispose();
    watcher.dispose();
  } };
};
