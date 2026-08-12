import * as vscode from 'vscode';

import {
  createGitWorkflow,
  type GitApiLike,
  type GitWorkflow,
} from './gitWorkflow';

interface GitExtensionExports {
  readonly enabled: boolean;
  getAPI(version: 1): GitApiLike;
}

/**
 * Live accessor for the built-in `vscode.git` extension's v1 API.
 * Resolves to undefined (fail-soft, entry hidden in the UI) when the
 * extension is missing, disabled via `git.enabled`, or fails to
 * activate.
 */
async function getGitApi(): Promise<GitApiLike | undefined> {
  const extension =
    vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (extension === undefined) {
    return undefined;
  }
  try {
    const exports = extension.isActive
      ? extension.exports
      : await extension.activate();
    return exports.enabled ? exports.getAPI(1) : undefined;
  } catch {
    return undefined;
  }
}

export function createVscodeGitWorkflow(): GitWorkflow {
  return createGitWorkflow(getGitApi);
}
