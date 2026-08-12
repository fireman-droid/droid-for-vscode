import { isAbsolute, join, relative } from 'node:path';

import * as vscode from 'vscode';

import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
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
  private currentPath: string | undefined;
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

    this.currentPath = relativePath;
    this.render(relativePath, {
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

  dispose(): void {
    this.disposed = true;
    this.panel?.dispose();
    this.panel = undefined;
    this.currentPath = undefined;
  }

  /**
   * Re-reads the current prototype from disk and rebuilds the shell. A
   * missing or unreadable file degrades to an in-panel notice (with
   * Reload still available) instead of a broken frame.
   */
  private async reload(): Promise<void> {
    const relativePath = this.currentPath;
    if (this.disposed || relativePath === undefined) {
      return;
    }
    const target = this.resolveTarget(relativePath);
    const read =
      typeof target === 'string'
        ? ({ kind: 'error', reason: target } as const)
        : await readPrototype(target);
    if (read.kind === 'error') {
      this.render(relativePath, {
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
    this.render(relativePath, { kind: 'document', html: read.html });
    this.diagnostics?.record({
      level: 'info',
      name: 'host.preview.reloaded',
      attributes: { path: relativePath, bytes: read.bytes },
    });
  }

  private async openInEditor(): Promise<void> {
    const relativePath = this.currentPath;
    if (this.disposed || relativePath === undefined) {
      return;
    }
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

  private render(
    relativePath: string,
    content:
      | { readonly kind: 'document'; readonly html: string }
      | { readonly kind: 'notice'; readonly message: string },
  ): void {
    const fileName = relativePath.split('/').at(-1) ?? relativePath;
    const panel = this.ensurePanel();
    panel.title = `Preview · ${fileName}`;
    panel.webview.html = buildPreviewShellHtml({
      fileName,
      relativePath,
      content,
    });
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
        this.currentPath = undefined;
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
