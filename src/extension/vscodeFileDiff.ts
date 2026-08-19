import { basename, join } from 'node:path';

import * as vscode from 'vscode';

import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
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
 * captured an in-memory baseline. A latest turn committed through
 * DroidVisX survives Reload as `<commit^> ↔ <commit>`; otherwise
 * recovered turns fall back to `<git HEAD> ↔ <working copy>`, then
 * a plain editor when neither comparison base exists.
 */
export function createVscodeFileDiffOpener(
  changeStats: ChangeStatsReader,
  diagnostics: RuntimeDiagnosticSink,
): FileDiffOpener {
  const baselineDocuments = new Map<string, BaselineDocument>();
  const baselineIds = new Map<string, string>();
  let baselineSequence = 0;
  let baselineBytes = 0;
  const removeBaselineDocument = (id: string): void => {
    const document = baselineDocuments.get(id);
    if (document === undefined) {
      return;
    }
    baselineDocuments.delete(id);
    baselineIds.delete(document.key);
    baselineBytes -= document.bytes;
  };
  const virtualDocument = (
    key: string,
    path: string,
    text: string,
  ): vscode.Uri | undefined => {
    let id = baselineIds.get(key);
    if (id === undefined) {
      const bytes = Buffer.byteLength(text, 'utf8');
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
      if (bytes > MAX_OPEN_BASELINE_BYTES) {
        return undefined;
      }
      id = String(++baselineSequence);
      baselineDocuments.set(id, { key, text, bytes });
      baselineIds.set(key, id);
      baselineBytes += bytes;
    }
    return vscode.Uri.from({
      scheme: TURN_BASELINE_SCHEME,
      path: `/${id}-${basename(path)}`,
      query: id,
    });
  };
  const provider = vscode.workspace.registerTextDocumentContentProvider(
    TURN_BASELINE_SCHEME,
    {
      provideTextDocumentContent(uri): string | undefined {
        return baselineDocuments.get(uri.query)?.text;
      },
    },
  );
  const closeListener = vscode.workspace.onDidCloseTextDocument(
    (document) => {
      if (document.uri.scheme === TURN_BASELINE_SCHEME) {
        removeBaselineDocument(document.uri.query);
      }
    },
  );
  return {
    async openDiff(relativePath, scope, options): Promise<FileDiffOutcome> {
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
      let fileExists = true;
      try {
        await vscode.workspace.fs.stat(fileUri);
      } catch {
        fileExists = false;
      }

      const baseline = await changeStats.readTurnBaseline?.(
        scope,
        relativePath,
      );
      if (baseline !== undefined) {
        const baselineKey = `${scope.sessionId}\u0000${scope.turnId}\u0000${relativePath}`;
        const baselineUri = virtualDocument(
          baselineKey,
          safePath,
          baseline,
        );
        const currentUri = fileExists
          ? fileUri
          : virtualDocument(
              `${baselineKey}\u0000deleted`,
              safePath,
              '',
            );
        if (baselineUri !== undefined && currentUri !== undefined) {
          try {
            await vscode.commands.executeCommand(
              'vscode.diff',
              baselineUri,
              currentUri,
              `${relativePath} (Before turn ↔ Current)`,
              { preview: true },
            );
            recordOpenSuccess(diagnostics, 'turn-baseline', safePath);
            return 'opened-diff';
          } catch (error) {
            recordOpenFailure(
              diagnostics,
              'turn-baseline',
              safePath,
              error,
            );
            removeBaselineDocument(baselineUri.query);
            // Fall through to HEAD or the plain file.
          }
        }
      }

      if (
        options?.committedRef !== undefined &&
        await openCommittedDiff(
          options.committedRef,
          fileUri,
          safePath,
          virtualDocument,
          diagnostics,
        )
      ) {
        recordOpenSuccess(
          diagnostics,
          'committed-turn',
          safePath,
          options.committedRef,
        );
        return 'opened-diff';
      }

      if (await hasGitHeadVersion(fileUri)) {
        const headUri = fileUri.with({
          scheme: 'git',
          query: JSON.stringify({ path: fileUri.fsPath, ref: 'HEAD' }),
        });
        const workingUri = fileExists
          ? fileUri
          : virtualDocument(
              `head\u0000${safePath}\u0000deleted`,
              safePath,
              '',
            );
        if (workingUri !== undefined) {
          try {
            await vscode.commands.executeCommand(
              'vscode.diff',
              headUri,
              workingUri,
              `${relativePath} (HEAD ↔ Working)`,
              { preview: true },
            );
            recordOpenSuccess(diagnostics, 'git-head', safePath);
            return 'opened-diff';
          } catch (error) {
            recordOpenFailure(diagnostics, 'git-head', safePath, error);
            // Fall through to opening the plain file below.
          }
        }
      }

      if (!fileExists) {
        return 'not-found';
      }
      try {
        await vscode.window.showTextDocument(fileUri, {
          preview: true,
        });
        recordOpenSuccess(diagnostics, 'plain-file', safePath);
        return 'opened-file';
      } catch (error) {
        recordOpenFailure(diagnostics, 'plain-file', safePath, error);
        return 'failed';
      }
    },
    dispose() {
      baselineDocuments.clear();
      baselineIds.clear();
      baselineBytes = 0;
      closeListener.dispose();
      provider.dispose();
    },
  };
}

type VirtualDocumentFactory = (
  key: string,
  path: string,
  text: string,
) => vscode.Uri | undefined;

async function openCommittedDiff(
  commitRef: string,
  fileUri: vscode.Uri,
  relativePath: string,
  virtualDocument: VirtualDocumentFactory,
  diagnostics: RuntimeDiagnosticSink,
): Promise<boolean> {
  if (!/^[0-9a-f]{4,40}$/.test(commitRef)) {
    return false;
  }
  const gitFile = await resolveGitFile(fileUri);
  if (
    gitFile === undefined ||
    gitFile.repository.getObjectDetails === undefined
  ) {
    return false;
  }
  const parentRef = `${commitRef}^`;
  const [beforeExists, afterExists] = await Promise.all([
    hasGitObject(gitFile.repository, parentRef, gitFile.path),
    hasGitObject(gitFile.repository, commitRef, gitFile.path),
  ]);
  if (!beforeExists && !afterExists) {
    return false;
  }
  const beforeUri = beforeExists
    ? gitObjectUri(fileUri, parentRef)
    : virtualDocument(
        `commit\u0000${commitRef}\u0000${relativePath}\u0000before`,
        relativePath,
        '',
      );
  const afterUri = afterExists
    ? gitObjectUri(fileUri, commitRef)
    : virtualDocument(
        `commit\u0000${commitRef}\u0000${relativePath}\u0000after`,
        relativePath,
        '',
      );
  if (beforeUri === undefined || afterUri === undefined) {
    return false;
  }
  try {
    await vscode.commands.executeCommand(
      'vscode.diff',
      beforeUri,
      afterUri,
      `${relativePath} (Committed ${commitRef.slice(0, 7)})`,
      { preview: true },
    );
    return true;
  } catch (error) {
    recordOpenFailure(
      diagnostics,
      'committed-turn',
      relativePath,
      error,
    );
    return false;
  }
}

function gitObjectUri(fileUri: vscode.Uri, ref: string): vscode.Uri {
  return fileUri.with({
    scheme: 'git',
    query: JSON.stringify({ path: fileUri.fsPath, ref }),
  });
}

async function hasGitObject(
  repository: {
    getObjectDetails?(ref: string, path: string): Promise<unknown>;
  },
  ref: string,
  path: string,
): Promise<boolean> {
  try {
    await repository.getObjectDetails?.(ref, path);
    return repository.getObjectDetails !== undefined;
  } catch {
    return false;
  }
}

function recordOpenFailure(
  diagnostics: RuntimeDiagnosticSink,
  phase:
    | 'turn-baseline'
    | 'committed-turn'
    | 'git-head'
    | 'plain-file',
  path: string,
  error: unknown,
): void {
  diagnostics.record({
    level: 'warn',
    name: 'host.file-diff.open-failed',
    attributes: { phase, path },
    detail:
      error instanceof Error
        ? error.stack ?? `${error.name}: ${error.message}`
        : String(error),
  });
}

function recordOpenSuccess(
  diagnostics: RuntimeDiagnosticSink,
  source: 'turn-baseline' | 'committed-turn' | 'git-head' | 'plain-file',
  path: string,
  ref?: string,
): void {
  diagnostics.record({
    level: 'info',
    name: 'host.file-diff.opened',
    attributes: {
      source,
      path,
      ...(ref === undefined ? {} : { ref }),
    },
  });
}

async function resolveGitFile(
  fileUri: vscode.Uri,
): Promise<
  | {
      readonly repository: {
        getObjectDetails?(
          ref: string,
          path: string,
        ): Promise<unknown>;
      };
      readonly path: string;
    }
  | undefined
> {
  try {
    const api = await getGitApi();
    for (const repository of api?.repositories ?? []) {
      const path = toWorkspaceRelativePath(
        repository.rootUri.fsPath,
        fileUri.fsPath,
      );
      if (path !== undefined) {
        return { repository, path };
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function hasGitHeadVersion(fileUri: vscode.Uri): Promise<boolean> {
  try {
    const gitFile = await resolveGitFile(fileUri);
    if (gitFile === undefined) {
      return false;
    }
    if (gitFile.repository.getObjectDetails === undefined) {
      return true;
    }
    await gitFile.repository.getObjectDetails('HEAD', gitFile.path);
    return true;
  } catch {
    return false;
  }
}
