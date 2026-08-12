import { isAbsolute, join, relative } from 'node:path';

import * as vscode from 'vscode';

import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
import { MAX_INLINE_PREVIEW_HTML_LENGTH } from '../shared/bridgeMessages';
import {
  isPreviewableFilePath,
  isSafeWorkspaceRelativePath,
} from '../shared/validateMessage';
import { hasExactKeys, isStrictRecord } from '../shared/strictValidation';
import {
  buildPreviewShellHtml,
  MAX_PREVIEW_SOURCE_BYTES,
} from './previewHtml';
import type {
  PrototypePreviewOpener,
  PrototypePreviewOutcome,
} from './prototypePreview';

export const PREVIEW_PANEL_VIEW_TYPE = 'droidvisx.preview';

type PreviewFailure =
  | 'no-workspace'
  | 'outside-workspace'
  | 'not-previewable'
  | 'not-found'
  | 'too-large'
  | 'read-failed';

type PrototypeRead =
  | { readonly kind: 'document'; readonly html: string; readonly bytes: number }
  | { readonly kind: 'error'; readonly reason: PreviewFailure };

/**
 * What the panel is currently showing: a workspace prototype file
 * (re-read from disk on Reload) or an inline chat snippet (kept in
 * memory; Reload re-renders the identical content).
 */
type PreviewSource =
  | { readonly kind: 'file'; readonly path: string }
  | { readonly kind: 'inline'; readonly html: string };

const INLINE_FILE_NAME = 'Chat snippet';
const INLINE_SOURCE_LABEL = 'Inline HTML from the chat transcript';

/**
 * Single-instance "Preview" WebviewPanel for Droid-written HTML
 * prototypes. The panel is a strict-CSP shell around a sandboxed
 * `srcdoc` iframe (see previewHtml.ts for the full security model);
 * this class owns path revalidation, file reads, and the panel
 * lifecycle. No `retainContextWhenHidden`: the panel's whole state is
 * one workspace-relative path, so rebuilding on demand is free.
 */
export class PreviewPanelController
  implements PrototypePreviewOpener, vscode.Disposable
{
  private panel: vscode.WebviewPanel | undefined;
  private current: PreviewSource | undefined;
  private disposed = false;

  constructor(private readonly diagnostics?: RuntimeDiagnosticSink) {}

  async openPreview(
    relativePath: string,
  ): Promise<PrototypePreviewOutcome> {
    if (this.disposed) {
      return 'failed';
    }
    const target = this.resolveTarget(relativePath);
    if (typeof target === 'string') {
      this.recordFailure('host.preview.failed', relativePath, target);
      return 'failed';
    }
    const read = await readPrototype(target);
    if (read.kind === 'error') {
      this.recordFailure(
        'host.preview.failed',
        relativePath,
        read.reason,
      );
      return 'failed';
    }

    this.current = { kind: 'file', path: relativePath };
    this.renderFile(relativePath, {
      kind: 'document',
      html: read.html,
    });
    this.diagnostics?.record({
      level: 'info',
      name: 'host.preview.opened',
      attributes: { path: relativePath, bytes: read.bytes },
    });
    return 'opened';
  }

  /**
   * Renders bridge-validated inline HTML from the transcript. The
   * size limit is re-enforced here (defense in depth against a
   * non-bridge caller); the source is kept in memory so the toolbar's
   * Reload re-renders the identical content.
   */
  async openInlineHtml(html: string): Promise<PrototypePreviewOutcome> {
    if (this.disposed) {
      return 'failed';
    }
    if (html.length === 0 || html.length > MAX_INLINE_PREVIEW_HTML_LENGTH) {
      this.recordFailure('host.preview.failed', 'inline', 'too-large');
      return 'failed';
    }
    this.current = { kind: 'inline', html };
    this.renderInline(html);
    this.diagnostics?.record({
      level: 'info',
      name: 'host.preview.opened',
      attributes: { path: 'inline', bytes: Buffer.byteLength(html, 'utf8') },
    });
    return 'opened';
  }

  dispose(): void {
    this.disposed = true;
    this.panel?.dispose();
    this.panel = undefined;
    this.current = undefined;
  }

  /**
   * Rebuilds the shell for the current source. Files are re-read from
   * disk (a missing or unreadable file degrades to an in-panel notice
   * with Reload still available); inline snippets re-render the same
   * in-memory content, which restarts their scripts from scratch.
   */
  private async reload(): Promise<void> {
    const current = this.current;
    if (this.disposed || current === undefined) {
      return;
    }
    if (current.kind === 'inline') {
      this.renderInline(current.html);
      this.diagnostics?.record({
        level: 'info',
        name: 'host.preview.reloaded',
        attributes: {
          path: 'inline',
          bytes: Buffer.byteLength(current.html, 'utf8'),
        },
      });
      return;
    }
    const relativePath = current.path;
    const target = this.resolveTarget(relativePath);
    const read =
      typeof target === 'string'
        ? ({ kind: 'error', reason: target } as const)
        : await readPrototype(target);
    if (read.kind === 'error') {
      this.renderFile(relativePath, {
        kind: 'notice',
        message: noticeFor(relativePath, read.reason),
      });
      this.recordFailure(
        'host.preview.reload-failed',
        relativePath,
        read.reason,
      );
      return;
    }
    this.renderFile(relativePath, { kind: 'document', html: read.html });
    this.diagnostics?.record({
      level: 'info',
      name: 'host.preview.reloaded',
      attributes: { path: relativePath, bytes: read.bytes },
    });
  }

  private async openInEditor(): Promise<void> {
    const current = this.current;
    // Inline snippets render no "Open in editor" button; a forged
    // message for them is dropped here.
    if (this.disposed || current === undefined || current.kind !== 'file') {
      return;
    }
    const relativePath = current.path;
    const target = this.resolveTarget(relativePath);
    if (typeof target === 'string') {
      this.recordFailure(
        'host.preview.open-editor-failed',
        relativePath,
        target,
      );
      return;
    }
    try {
      await vscode.window.showTextDocument(target, { preview: true });
    } catch {
      this.recordFailure(
        'host.preview.open-editor-failed',
        relativePath,
        'read-failed',
      );
    }
  }

  private renderFile(
    relativePath: string,
    content:
      | { readonly kind: 'document'; readonly html: string }
      | { readonly kind: 'notice'; readonly message: string },
  ): void {
    const fileName = relativePath.split('/').at(-1) ?? relativePath;
    this.renderShell(fileName, {
      fileName,
      relativePath,
      content,
    });
  }

  private renderInline(html: string): void {
    this.renderShell(INLINE_FILE_NAME, {
      fileName: INLINE_FILE_NAME,
      relativePath: INLINE_SOURCE_LABEL,
      content: { kind: 'document', html },
      source: 'inline',
    });
  }

  private renderShell(
    fileName: string,
    options: Parameters<typeof buildPreviewShellHtml>[0],
  ): void {
    const panel = this.ensurePanel();
    panel.title = `Preview · ${fileName}`;
    panel.webview.html = buildPreviewShellHtml(options);
    panel.reveal(undefined, false);
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel !== undefined) {
      return this.panel;
    }
    const panel = vscode.window.createWebviewPanel(
      PREVIEW_PANEL_VIEW_TYPE,
      'Preview',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        // Forms default to enabled whenever scripts are; the prototype
        // must not submit anywhere.
        enableForms: false,
        // Empty array denies every local resource: the prototype is
        // inlined, so the panel needs zero file readability.
        localResourceRoots: [],
      },
    );
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (this.panel !== panel) {
        return;
      }
      // The only accepted messages are two fixed, payload-free
      // commands; the host acts purely on its own stored path, so a
      // hostile message can at most re-read or open the file already
      // being previewed.
      if (isExactCommand(raw, 'preview.reload')) {
        void this.reload();
        return;
      }
      if (isExactCommand(raw, 'preview.openInEditor')) {
        void this.openInEditor();
        return;
      }
      this.diagnostics?.record({
        level: 'warn',
        name: 'host.preview.rejected-message',
        detail: safeStringify(raw),
      });
    });
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
        this.current = undefined;
      }
    });
    this.panel = panel;
    return panel;
  }

  /**
   * Defense-in-depth revalidation of the bridge-validated path: the
   * same containment rule as file.openDiff plus the previewable
   * extension whitelist, resolved against the real workspace root.
   */
  private resolveTarget(
    relativePath: string,
  ): vscode.Uri | PreviewFailure {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (root === undefined) {
      return 'no-workspace';
    }
    if (
      !isSafeWorkspaceRelativePath(relativePath) ||
      !isPreviewableFilePath(relativePath)
    ) {
      return 'not-previewable';
    }
    const absolute = join(root.fsPath, relativePath);
    const containment = relative(root.fsPath, absolute);
    if (
      containment.length === 0 ||
      containment.startsWith('..') ||
      isAbsolute(containment)
    ) {
      return 'outside-workspace';
    }
    return vscode.Uri.file(absolute);
  }

  private recordFailure(
    name: string,
    relativePath: string,
    reason: PreviewFailure,
  ): void {
    this.diagnostics?.record({
      level: 'warn',
      name,
      attributes: { path: relativePath, reason },
    });
  }
}

async function readPrototype(
  target: vscode.Uri,
): Promise<PrototypeRead> {
  let size: number;
  try {
    const stat = await vscode.workspace.fs.stat(target);
    size = stat.size;
  } catch {
    return { kind: 'error', reason: 'not-found' };
  }
  if (size > MAX_PREVIEW_SOURCE_BYTES) {
    return { kind: 'error', reason: 'too-large' };
  }
  try {
    const bytes = await vscode.workspace.fs.readFile(target);
    return {
      kind: 'document',
      html: Buffer.from(bytes).toString('utf8'),
      bytes: bytes.byteLength,
    };
  } catch {
    return { kind: 'error', reason: 'read-failed' };
  }
}

function noticeFor(
  relativePath: string,
  reason: PreviewFailure,
): string {
  if (reason === 'too-large') {
    return (
      `${relativePath} is larger than the 4 MB preview limit. ` +
      'Shrink the file, then press Reload.'
    );
  }
  return (
    `${relativePath} was deleted or can no longer be read. ` +
    'Restore the file, then press Reload.'
  );
}

function isExactCommand(value: unknown, type: string): boolean {
  return (
    isStrictRecord(value) &&
    hasExactKeys(value, ['type']) &&
    value.type === type
  );
}

function safeStringify(value: unknown): string {
  try {
    return (JSON.stringify(value) ?? String(value)).slice(0, 512);
  } catch {
    return String(value).slice(0, 512);
  }
}
