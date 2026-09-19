import { execFile } from 'node:child_process';
import { basename, extname, join } from 'node:path';

import * as vscode from 'vscode';

import {
  MAX_IMAGE_ATTACHMENT_BYTES,
  MAX_PDF_ATTACHMENT_BYTES,
  MAX_TEXT_ATTACHMENT_CHARS,
  selectionAttachmentPayload,
  type AttachmentCaptureOutcome,
  type AttachmentPayload,
  type AttachmentPickOutcome,
  type AttachmentSources,
} from './attachmentSources';
import { toOpenEditorRelativePaths } from '../workspace/openEditorTabs';
import type { RuntimeImageMediaType } from '../../runtime/DroidRuntime';
import { toWorkspaceRelativePath } from '../../runtime/tools/toolFilePath';
import { readPublicHttpsImage } from './remoteImageAttachment';
import type { DiffSelectionRegistry } from '../changes/diffSelectionRegistry';

const IMAGE_MEDIA_TYPES: Record<string, RuntimeImageMediaType> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

/**
 * Reads attachment content with VS Code APIs. Tracks the most recent
 * text editor because focusing the webview clears
 * `window.activeTextEditor`.
 */
export function createVscodeAttachmentSources(
  diffSelections?: DiffSelectionRegistry,
): AttachmentSources & {
  dispose(): void;
} {
  let lastTextEditor: vscode.TextEditor | undefined = vscode.window.activeTextEditor;
  const subscription = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor !== undefined) {
      lastTextEditor = editor;
    }
  });

  const currentEditor = (): vscode.TextEditor | undefined => {
    const active = vscode.window.activeTextEditor;
    if (active !== undefined) {
      return active;
    }
    if (lastTextEditor !== undefined && !lastTextEditor.document.isClosed) {
      return lastTextEditor;
    }
    return undefined;
  };

  return {
    async pickFiles(maxCount): Promise<AttachmentPickOutcome> {
      let uris: readonly vscode.Uri[] | undefined;
      try {
        uris = await vscode.window.showOpenDialog({
          canSelectMany: true,
          openLabel: 'Attach to Droid',
        });
      } catch {
        return { status: 'failed' };
      }
      if (uris === undefined || uris.length === 0) {
        return { status: 'cancelled' };
      }
      const items: AttachmentPayload[] = [];
      for (const uri of uris.slice(0, maxCount)) {
        let payload: AttachmentPayload | 'too-large' | 'unsupported-type';
        try {
          payload = await readFilePayload(uri);
        } catch {
          return { status: 'failed' };
        }
        if (payload === 'too-large' || payload === 'unsupported-type') {
          return { status: 'rejected', reason: payload };
        }
        items.push(payload);
      }
      return { status: 'picked', items };
    },

    readActiveEditor(): Promise<AttachmentCaptureOutcome> {
      const editor = currentEditor();
      if (editor === undefined) {
        return Promise.resolve({ status: 'empty' });
      }
      const text = editor.document.getText();
      if (text.length === 0) {
        return Promise.resolve({ status: 'empty' });
      }
      return Promise.resolve({
        status: 'captured',
        item: textPayload(displayName(editor.document), text),
      });
    },

    readActiveSelection(): Promise<AttachmentCaptureOutcome> {
      const editor = currentEditor();
      if (editor === undefined || editor.selection.isEmpty) {
        return Promise.resolve({ status: 'empty' });
      }
      const text = editor.document.getText(editor.selection);
      if (text.trim().length === 0) {
        return Promise.resolve({ status: 'empty' });
      }
      const { start, end } = editor.selection;
      const startLine = start.line + 1;
      // A selection ending at column 0 highlights nothing on that
      // line, so the range reports the previous line instead.
      const endLine =
        end.character === 0 && end.line > start.line ? end.line : end.line + 1;
      const diff = diffSelections?.resolve(editor.document.uri);
      return Promise.resolve({
        status: 'captured',
        item: selectionAttachmentPayload({
          displayName:
            diff === undefined
              ? displayName(editor.document)
              : `${displayNameFromPath(diff.path)} · ${diff.label}`,
          relativePath:
            diff === undefined
              ? workspaceRelativePath(editor.document)
              : `${diff.path} [${diff.label}; ${diff.side}; scope ${diff.reviewScopeId}]`,
          startLine,
          endLine,
          text,
          ...(diff === undefined ? {} : { sourceSessionId: diff.sessionId }),
        }),
      });
    },

    async searchWorkspaceFiles(query, maxResults): Promise<readonly string[]> {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (root === undefined) {
        return [];
      }
      // Escape glob-special characters so the query matches literally.
      const literal = query.replace(/[[\]{}()*?!]/g, '');
      if (literal.length === 0) {
        return [];
      }
      let uris: readonly vscode.Uri[];
      try {
        uris = await vscode.workspace.findFiles(
          `**/*${literal}*`,
          '{**/node_modules/**,**/.git/**,**/dist/**,**/out/**}',
          maxResults * 2,
        );
      } catch {
        return [];
      }
      const paths: string[] = [];
      for (const uri of uris) {
        const relativePath = toWorkspaceRelativePath(root.fsPath, uri.fsPath);
        if (relativePath !== undefined) {
          paths.push(relativePath);
        }
        if (paths.length >= maxResults) {
          break;
        }
      }
      return paths.sort((a, b) => a.length - b.length || a.localeCompare(b));
    },

    listOpenEditorFiles(maxResults): readonly string[] {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (root === undefined) {
        return [];
      }
      const tabFsPaths: string[] = [];
      for (const group of vscode.window.tabGroups.all) {
        for (const tab of group.tabs) {
          const input = tab.input;
          if (
            input instanceof vscode.TabInputText ||
            input instanceof vscode.TabInputCustom ||
            input instanceof vscode.TabInputNotebook
          ) {
            if (input.uri.scheme === 'file') {
              tabFsPaths.push(input.uri.fsPath);
            }
          }
        }
      }
      return toOpenEditorRelativePaths(root.fsPath, tabFsPaths, maxResults);
    },

    async readWorkspaceFile(relativePath): Promise<AttachmentPickOutcome> {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (root === undefined) {
        return { status: 'failed' };
      }
      const absolute = join(root.fsPath, relativePath);
      if (toWorkspaceRelativePath(root.fsPath, absolute) === undefined) {
        return { status: 'failed' };
      }
      let payload: AttachmentPayload | 'too-large' | 'unsupported-type';
      try {
        payload = await readFilePayload(vscode.Uri.file(absolute));
      } catch {
        return { status: 'failed' };
      }
      if (payload === 'too-large' || payload === 'unsupported-type') {
        return { status: 'rejected', reason: payload };
      }
      return { status: 'picked', items: [payload] };
    },

    readRemoteImage(url): Promise<AttachmentPickOutcome> {
      return readPublicHttpsImage(url);
    },

    readProblems(): Promise<AttachmentCaptureOutcome> {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (root === undefined) {
        return Promise.resolve({ status: 'empty' });
      }
      const lines: string[] = [];
      let count = 0;
      let omitted = false;
      try {
        problems: for (const [uri, diagnostics] of vscode.languages.getDiagnostics()) {
          if (diagnostics.length === 0 || uri.scheme !== 'file') {
            continue;
          }
          const path = toWorkspaceRelativePath(root.fsPath, uri.fsPath);
          if (path === undefined) {
            continue;
          }
          for (const diagnostic of diagnostics) {
            if (count >= MAX_PROBLEM_ITEMS) {
              omitted = true;
              break problems;
            }
            count += 1;
            const line = diagnostic.range.start.line + 1;
            const severity = severityLabel(diagnostic.severity);
            const source =
              diagnostic.source === undefined ? '' : ` (${diagnostic.source})`;
            lines.push(`${path}:${line} [${severity}]${source} ${diagnostic.message}`);
          }
        }
        if (omitted) {
          lines.push('… more problems omitted');
        }
      } catch {
        return Promise.resolve({ status: 'failed' });
      }
      if (lines.length === 0) {
        return Promise.resolve({ status: 'empty' });
      }
      return Promise.resolve({
        status: 'captured',
        item: textPayload('Problems', lines.join('\n')),
      });
    },

    async readGitChanges(): Promise<AttachmentCaptureOutcome> {
      const root = vscode.workspace.workspaceFolders?.[0]?.uri;
      if (root === undefined) {
        return { status: 'empty' };
      }
      let stdout: string;
      try {
        stdout = await runGit(
          ['diff', 'HEAD', '--no-color', '--no-ext-diff'],
          root.fsPath,
        );
      } catch {
        return { status: 'failed' };
      }
      if (stdout.trim().length === 0) {
        return { status: 'empty' };
      }
      return {
        status: 'captured',
        item: textPayload('Git changes', stdout),
      };
    },

    dispose(): void {
      subscription.dispose();
    },
  };
}

function displayNameFromPath(path: string): string {
  return path.split('/').at(-1) ?? path;
}

/** Most diagnostics included in one Problems attachment. */
const MAX_PROBLEM_ITEMS = 200;

function severityLabel(severity: vscode.DiagnosticSeverity): string {
  switch (severity) {
    case vscode.DiagnosticSeverity.Error:
      return 'error';
    case vscode.DiagnosticSeverity.Warning:
      return 'warning';
    case vscode.DiagnosticSeverity.Information:
      return 'info';
    case vscode.DiagnosticSeverity.Hint:
      return 'hint';
  }
}

function runGit(args: readonly string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      [...args],
      { cwd, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolve(stdout);
      },
    );
  });
}

async function readFilePayload(
  uri: vscode.Uri,
): Promise<AttachmentPayload | 'too-large' | 'unsupported-type'> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  const name = basename(uri.fsPath);
  const extension = extname(uri.fsPath).toLowerCase();

  const imageMediaType = IMAGE_MEDIA_TYPES[extension];
  if (imageMediaType !== undefined) {
    if (bytes.byteLength > MAX_IMAGE_ATTACHMENT_BYTES) {
      return 'too-large';
    }
    return {
      kind: 'image',
      name,
      data: Buffer.from(bytes).toString('base64'),
      mediaType: imageMediaType,
      sizeBytes: bytes.byteLength,
      truncated: false,
    };
  }

  if (extension === '.pdf') {
    if (bytes.byteLength > MAX_PDF_ATTACHMENT_BYTES) {
      return 'too-large';
    }
    return {
      kind: 'pdf',
      name,
      data: Buffer.from(bytes).toString('base64'),
      sizeBytes: bytes.byteLength,
      truncated: false,
    };
  }

  const text = Buffer.from(bytes).toString('utf8');
  if (text.includes('\u0000')) {
    return 'unsupported-type';
  }
  return textPayload(name, text);
}

function textPayload(name: string, text: string): AttachmentPayload {
  const truncated = text.length > MAX_TEXT_ATTACHMENT_CHARS;
  const data = truncated ? text.slice(0, MAX_TEXT_ATTACHMENT_CHARS) : text;
  return {
    kind: 'text',
    name,
    data,
    sizeBytes: Buffer.byteLength(data, 'utf8'),
    truncated,
  };
}

function displayName(document: vscode.TextDocument): string {
  return document.isUntitled ? 'Untitled' : basename(document.fileName);
}

/**
 * Workspace-relative forward-slash path for the selection header;
 * documents outside the workspace keep their full path so the
 * excerpt stays locatable.
 */
function workspaceRelativePath(document: vscode.TextDocument): string {
  if (document.isUntitled) {
    return displayName(document);
  }
  return vscode.workspace.asRelativePath(document.uri, false).replaceAll('\\', '/');
}
