import { join } from 'node:path';

import * as vscode from 'vscode';

import { toWorkspaceRelativePath } from '../runtime/toolFilePath';
import type {
  FileDiffOpener,
  FileDiffOutcome,
} from './fileDiffOpener';
import type { ChangeStatsReader } from './changeStats';
import { getGitApi } from './vscodeGitWorkflow';

const TURN_BASELINE_SCHEME = 'droidvisx-turn-baseline';
const MAX_OPEN_BASELINE_DOCUMENTS = 32;
const MAX_OPEN_BASELINE_BYTES = 16 * 1024 * 1024;

interface BaselineDocument {
  readonly key: string;
  readonly text: string;
  readonly bytes: number;
}

/**
 * Opens `<before this turn> ↔ <current file>` when the live turn
 * captured an in-memory baseline. Recovered turns fall back to
 * `<git HEAD> ↔ <working copy>`, then a plain editor when neither
 * comparison base exists.
 */
export function createVscodeFileDiffOpener(
  changeStats: ChangeStatsReader,
): FileDiffOpener {
  const baselineDocuments = new Map<string, BaselineDocument>();
  const baselinePaths = new Map<string, string>();
  let baselineSequence = 0;
  let baselineBytes = 0;
  const removeBaselineDocument = (path: string): void => {
    const document = baselineDocuments.get(path);
    if (document === undefined) {
      return;
    }
    baselineDocuments.delete(path);
    baselinePaths.delete(document.key);
    baselineBytes -= document.bytes;
  };
  const provider = vscode.workspace.registerTextDocumentContentProvider(
    TURN_BASELINE_SCHEME,
    {
      provideTextDocumentContent(uri): string {
        return baselineDocuments.get(uri.path)?.text ?? '';
      },
    },
  );
  const closeListener = vscode.workspace.onDidCloseTextDocument(
    (document) => {
      if (document.uri.scheme === TURN_BASELINE_SCHEME) {
        removeBaselineDocument(document.uri.path);
      }
    },
  );
  return {
    async openDiff(relativePath, scope): Promise<FileDiffOutcome> {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (root === undefined) {
        return 'failed';
      }
      const safePath = toWorkspaceRelativePath(
        root.fsPath,
        relativePath,
      );
      if (safePath === undefined) {
        return 'failed';
      }
      const absolute = join(root.fsPath, safePath);

      const fileUri = vscode.Uri.file(absolute);
      try {
        await vscode.workspace.fs.stat(fileUri);
      } catch {
        return 'not-found';
      }

      const baseline = await changeStats.readTurnBaseline?.(
        scope,
        relativePath,
      );
      if (baseline !== undefined) {
        const baselineKey = `${scope.sessionId}\u0000${scope.turnId}\u0000${relativePath}`;
        let baselinePath = baselinePaths.get(baselineKey);
        if (baselinePath === undefined) {
          const bytes = Buffer.byteLength(baseline, 'utf8');
          while (
            baselineDocuments.size >= MAX_OPEN_BASELINE_DOCUMENTS ||
            baselineBytes + bytes > MAX_OPEN_BASELINE_BYTES
          ) {
            const oldest = baselineDocuments.keys().next().value as
              | string
              | undefined;
            if (oldest === undefined) {
              break;
            }
            removeBaselineDocument(oldest);
          }
          if (bytes <= MAX_OPEN_BASELINE_BYTES) {
            baselinePath = `/${++baselineSequence}`;
            baselineDocuments.set(baselinePath, {
              key: baselineKey,
              text: baseline,
              bytes,
            });
            baselinePaths.set(baselineKey, baselinePath);
            baselineBytes += bytes;
          }
        }
        if (baselinePath !== undefined) {
          try {
            await vscode.commands.executeCommand(
              'vscode.diff',
              vscode.Uri.from({
                scheme: TURN_BASELINE_SCHEME,
                path: baselinePath,
              }),
              fileUri,
              `${relativePath} (Before turn ↔ Current)`,
              { preview: true },
            );
            return 'opened-diff';
          } catch {
            removeBaselineDocument(baselinePath);
            // Fall through to HEAD or the plain file.
          }
        }
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
    dispose() {
      baselineDocuments.clear();
      baselinePaths.clear();
      baselineBytes = 0;
      closeListener.dispose();
      provider.dispose();
    },
  };
}

async function hasGitHeadVersion(fileUri: vscode.Uri): Promise<boolean> {
  try {
    const api = await getGitApi();
    let repositoryPath: string | undefined;
    const repository = api?.repositories.find((candidate) => {
      const path = toWorkspaceRelativePath(
        candidate.rootUri.fsPath,
        fileUri.fsPath,
      );
      if (path === undefined) {
        return false;
      }
      repositoryPath = path;
      return true;
    });
    if (repository === undefined || repositoryPath === undefined) {
      return false;
    }
    if (repository.getObjectDetails === undefined) {
      return true;
    }
    await repository.getObjectDetails('HEAD', repositoryPath);
    return true;
  } catch {
    return false;
  }
}
