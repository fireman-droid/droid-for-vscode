import { isAbsolute, join, relative } from 'node:path';

import * as vscode from 'vscode';

import type {
  FileDiffOpener,
  FileDiffOutcome,
} from './fileDiffOpener';

/**
 * Opens `<git HEAD> ↔ <working copy>` for a workspace-relative file
 * using the built-in git content provider, falling back to a plain
 * editor when git is unavailable or the file has no HEAD version.
 */
export function createVscodeFileDiffOpener(): FileDiffOpener {
  return {
    async openDiff(relativePath): Promise<FileDiffOutcome> {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (root === undefined) {
        return 'failed';
      }
      const absolute = join(root.fsPath, relativePath);
      const containment = relative(root.fsPath, absolute);
      if (
        containment.length === 0 ||
        containment.startsWith('..') ||
        isAbsolute(containment)
      ) {
        return 'failed';
      }

      const fileUri = vscode.Uri.file(absolute);
      try {
        await vscode.workspace.fs.stat(fileUri);
      } catch {
        return 'not-found';
      }

      if (await hasGitHeadVersion(fileUri)) {
        const headUri = fileUri.with({
          scheme: 'git',
          query: JSON.stringify({ path: fileUri.fsPath, ref: 'HEAD' }),
        });
        try {
          await vscode.commands.executeCommand(
            'vscode.diff',
            headUri,
            fileUri,
            `${relativePath} (HEAD ↔ Working)`,
            { preview: true },
          );
          return 'opened-diff';
        } catch {
          // Fall through to opening the plain file below.
        }
      }

      try {
        await vscode.window.showTextDocument(fileUri, {
          preview: true,
        });
        return 'opened-file';
      } catch {
        return 'failed';
      }
    },
  };
}

async function hasGitHeadVersion(fileUri: vscode.Uri): Promise<boolean> {
  const git = vscode.extensions.getExtension('vscode.git');
  if (git === undefined) {
    return false;
  }
  try {
    const exports: unknown = git.isActive
      ? git.exports
      : await git.activate();
    const api = (
      exports as {
        getAPI?: (version: number) => {
          repositories: ReadonlyArray<{
            rootUri: vscode.Uri;
            getObjectDetails?: (
              treeish: string,
              path: string,
            ) => Promise<unknown>;
          }>;
        };
      }
    ).getAPI?.(1);
    const repository = api?.repositories.find((candidate) =>
      fileUri.fsPath
        .toLowerCase()
        .startsWith(candidate.rootUri.fsPath.toLowerCase()),
    );
    if (repository === undefined) {
      return false;
    }
    if (repository.getObjectDetails === undefined) {
      return true;
    }
    await repository.getObjectDetails('HEAD', fileUri.fsPath);
    return true;
  } catch {
    return false;
  }
}
