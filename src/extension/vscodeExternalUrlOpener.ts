import * as vscode from 'vscode';

import type { ExternalUrlOpener } from './externalUrlOpener';

/** Opens http(s) URLs in the default browser via `vscode.env`. */
export function createVscodeExternalUrlOpener(): ExternalUrlOpener {
  return {
    async openExternal(url): Promise<boolean> {
      if (!/^https?:\/\//.test(url)) {
        return false;
      }
      try {
        return await vscode.env.openExternal(vscode.Uri.parse(url, true));
      } catch {
        return false;
      }
    },
  };
}
