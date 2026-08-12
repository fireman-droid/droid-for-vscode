import { extname, isAbsolute, join } from 'node:path';

import * as vscode from 'vscode';

import type { OpenPathOutcome, PathOpener } from './pathOpener';

/**
 * Extensions routed straight to `vscode.open` (associated custom
 * editor or platform handler) instead of the text editor. Anything
 * not listed is tried as text first and falls back to `vscode.open`
 * when the editor rejects it as binary.
 */
const NON_TEXT_EXTENSIONS = new Set([
  '.pdf',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.ico',
  '.zip',
  '.7z',
  '.rar',
  '.gz',
  '.tar',
  '.exe',
  '.dll',
  '.vsix',
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.mp3',
  '.wav',
  '.mp4',
  '.mov',
  '.avi',
  '.mkv',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
]);

export function createVscodePathOpener(): PathOpener {
  return {
    async openPath(path, line, column): Promise<OpenPathOutcome> {
      const absolute = resolveAbsolute(path);
      if (absolute === null) {
        return 'failed';
      }
      const uri = vscode.Uri.file(absolute);

      let stat: vscode.FileStat;
      try {
        stat = await vscode.workspace.fs.stat(uri);
      } catch {
        return 'failed';
      }

      if ((stat.type & vscode.FileType.Directory) !== 0) {
        try {
          await vscode.commands.executeCommand('revealFileInOS', uri);
          return 'revealed';
        } catch {
          return 'failed';
        }
      }

      const extension = extname(absolute).toLowerCase();
      if (!NON_TEXT_EXTENSIONS.has(extension)) {
        try {
          await vscode.window.showTextDocument(uri, {
            preview: true,
            ...(line === undefined
              ? {}
              : { selection: cursorRange(line, column) }),
          });
          return 'opened';
        } catch {
          // Binary or otherwise not text-openable; try vscode.open.
        }
      }

      try {
        await vscode.commands.executeCommand('vscode.open', uri);
        return 'opened';
      } catch {
        return 'failed';
      }
    },
  };
}

function resolveAbsolute(path: string): string | null {
  if (isAbsolute(path)) {
    return path;
  }
  const root = vscode.workspace.workspaceFolders?.[0]?.uri;
  if (root === undefined) {
    return null;
  }
  return join(root.fsPath, path);
}

function cursorRange(line: number, column?: number): vscode.Range {
  const zeroBasedLine = line - 1;
  const zeroBasedColumn = (column ?? 1) - 1;
  return new vscode.Range(
    zeroBasedLine,
    zeroBasedColumn,
    zeroBasedLine,
    zeroBasedColumn,
  );
}
