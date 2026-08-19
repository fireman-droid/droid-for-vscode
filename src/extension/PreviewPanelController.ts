import { createHash } from 'node:crypto';
import { dirname, isAbsolute, join, relative } from 'node:path';

import * as vscode from 'vscode';

import type { RuntimeDiagnosticSink } from '../runtime/runtimeDiagnostics';
import {
  MAX_CANVAS_BASELINES,
  MAX_CANVAS_CODE_SOURCE_LENGTH,
  MAX_CANVAS_FEEDBACK_LENGTH,
  parseCanvasPanelMessage,
  type CanvasInlineArtifact,
  type CanvasPanelMessage,
} from '../shared/canvasProtocol';
import { MAX_INLINE_PREVIEW_HTML_LENGTH } from '../shared/bridgeMessages';
import {
  isPreviewableFilePath,
  isSafeWorkspaceRelativePath,
} from '../shared/validateMessage';
import {
  buildPreviewShellHtml,
  MAX_PREVIEW_SOURCE_BYTES,
} from './previewHtml';
import type {
  PrototypePreviewOpener,
  PrototypePreviewOutcome,
} from './prototypePreview';

export const PREVIEW_PANEL_VIEW_TYPE = 'droidvisx.canvas';

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

interface ArtifactMemory {
  readonly baseline: string;
  readonly baselineTruncated: boolean;
  digest: string;
  revision: number;
}

type PreviewSource =
  | {
      readonly kind: 'file';
      readonly artifactId: string;
      readonly title: string;
      readonly path: string;
      readonly html: string;
      readonly memory: ArtifactMemory;
    }
  | {
      readonly kind: 'inline';
      readonly artifactId: string;
      readonly title: string;
      readonly html: string;
      readonly memory: ArtifactMemory;
    };

export type CanvasFeedbackHandler = (text: string) => void;

const INLINE_FILE_NAME = 'Interactive HTML artifact';
const INLINE_SOURCE_LABEL = 'Inline HTML from the chat transcript';
const WATCH_DEBOUNCE_MS = 180;

/**
 * Host-owned Canvas Studio state. It preserves the proven opaque-origin
 * srcdoc isolation while adding bounded source/diff views, responsive
 * viewport controls, file auto-refresh, element feedback, and stale
 * message rejection through generation + revision checks.
 */
export class PreviewPanelController
  implements PrototypePreviewOpener, vscode.Disposable
{
  private panel: vscode.WebviewPanel | undefined;
  private current: PreviewSource | undefined;
  private watcher: vscode.FileSystemWatcher | undefined;
  private watcherTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly artifacts = new Map<string, ArtifactMemory>();
  private feedbackHandler: CanvasFeedbackHandler | undefined;
  private generation = 0;
  private disposed = false;

  constructor(private readonly diagnostics?: RuntimeDiagnosticSink) {}

  setFeedbackHandler(handler: CanvasFeedbackHandler): void {
    this.feedbackHandler = handler;
  }

  async openPreview(
    relativePath: string,
  ): Promise<PrototypePreviewOutcome> {
    if (this.disposed) return 'failed';
    const target = this.resolveTarget(relativePath);
    if (typeof target === 'string') {
      this.recordFailure('host.preview.failed', relativePath, target);
      return 'failed';
    }
    const read = await readPrototype(target);
    if (read.kind === 'error') {
      this.recordFailure('host.preview.failed', relativePath, read.reason);
      return 'failed';
    }
    const artifactId = `file:${relativePath}`;
    const memory = this.remember(artifactId, read.html);
    const title = relativePath.split('/').at(-1) ?? relativePath;
    this.current = {
      kind: 'file',
      artifactId,
      title,
      path: relativePath,
      html: read.html,
      memory,
    };
    this.watch(target);
    this.renderCurrent();
    this.recordOpened(relativePath, read.bytes);
    return 'opened';
  }

  async openInlineHtml(
    html: string,
    artifact?: CanvasInlineArtifact,
  ): Promise<PrototypePreviewOutcome> {
    if (
      this.disposed ||
      html.length === 0 ||
      html.length > MAX_INLINE_PREVIEW_HTML_LENGTH
    ) {
      this.recordFailure('host.preview.failed', 'inline', 'too-large');
      return 'failed';
    }
    const artifactId =
      artifact?.artifactId ?? `inline:${digestSource(html).slice(0, 20)}`;
    const memory = this.remember(artifactId, html);
    this.current = {
      kind: 'inline',
      artifactId,
      title: artifact?.title ?? INLINE_FILE_NAME,
      html,
      memory,
    };
    this.stopWatching();
    this.renderCurrent();
    this.recordOpened('inline', Buffer.byteLength(html, 'utf8'));
    return 'opened';
  }

  dispose(): void {
    this.disposed = true;
    this.stopWatching();
    this.panel?.dispose();
    this.panel = undefined;
    this.current = undefined;
    this.artifacts.clear();
    this.feedbackHandler = undefined;
  }

  private remember(artifactId: string, html: string): ArtifactMemory {
    const digest = digestSource(html);
    const existing = this.artifacts.get(artifactId);
    if (existing !== undefined) {
      if (existing.digest !== digest) {
        existing.digest = digest;
        existing.revision += 1;
      }
      this.artifacts.delete(artifactId);
      this.artifacts.set(artifactId, existing);
      return existing;
    }
    const bounded = boundSource(html);
    const memory: ArtifactMemory = {
      baseline: bounded.text,
      baselineTruncated: bounded.truncated,
      digest,
      revision: 1,
    };
    this.artifacts.set(artifactId, memory);
    while (this.artifacts.size > MAX_CANVAS_BASELINES) {
      const oldest = this.artifacts.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.artifacts.delete(oldest);
    }
    return memory;
  }

  private async reload(): Promise<void> {
    const current = this.current;
    if (this.disposed || current === undefined) return;
    if (current.kind === 'inline') {
      this.renderCurrent();
      this.recordReloaded('inline', Buffer.byteLength(current.html, 'utf8'));
      return;
    }
    const target = this.resolveTarget(current.path);
    const read =
      typeof target === 'string'
        ? ({ kind: 'error', reason: target } as const)
        : await readPrototype(target);
    if (read.kind === 'error') {
      this.renderNotice(current, noticeFor(current.path, read.reason));
      this.recordFailure('host.preview.reload-failed', current.path, read.reason);
      return;
    }
    const memory = this.remember(current.artifactId, read.html);
    this.current = { ...current, html: read.html, memory };
    this.renderCurrent();
    this.recordReloaded(current.path, read.bytes);
  }

  private async openInEditor(): Promise<void> {
    const current = this.current;
    if (this.disposed || current?.kind !== 'file') return;
    const target = this.resolveTarget(current.path);
    if (typeof target === 'string') {
      this.recordFailure('host.preview.open-editor-failed', current.path, target);
      return;
    }
    try {
      await vscode.window.showTextDocument(target, { preview: true });
    } catch {
      this.recordFailure(
        'host.preview.open-editor-failed',
        current.path,
        'read-failed',
      );
    }
  }

  private handleFeedback(
    message: Extract<CanvasPanelMessage, { type: 'canvas.feedback' }>,
  ): void {
    const current = this.current;
    if (current === undefined || this.feedbackHandler === undefined) return;
    const selected =
      message.selection === undefined
        ? ''
        : `\nSelected element: <${message.selection.tag}> at ${message.selection.path}`;
    const prefix = `Canvas feedback for ${current.title}:${selected}\n\n`;
    const available = Math.max(0, MAX_CANVAS_FEEDBACK_LENGTH - prefix.length);
    this.feedbackHandler(`${prefix}${message.feedback.slice(0, available)}`);
  }

  private renderCurrent(): void {
    const current = this.current;
    if (current === undefined) return;
    const bounded = boundSource(current.html);
    this.renderShell(current.title, {
      fileName: current.title,
      relativePath:
        current.kind === 'file' ? current.path : INLINE_SOURCE_LABEL,
      content: { kind: 'document', html: current.html },
      displaySource: bounded.text,
      source: current.kind,
      revision: current.memory.revision,
      baseline: current.memory.baseline,
      baselineTruncated: current.memory.baselineTruncated,
      sourceTruncated: bounded.truncated,
    });
  }

  private renderNotice(current: PreviewSource, message: string): void {
    this.renderShell(current.title, {
      fileName: current.title,
      relativePath:
        current.kind === 'file' ? current.path : INLINE_SOURCE_LABEL,
      content: { kind: 'notice', message },
      source: current.kind,
      revision: current.memory.revision,
      baseline: current.memory.baseline,
    });
  }

  private renderShell(
    title: string,
    options: Parameters<typeof buildPreviewShellHtml>[0],
  ): void {
    const panel = this.ensurePanel();
    this.generation += 1;
    panel.title = `Canvas · ${title}`;
    panel.webview.html = buildPreviewShellHtml({
      ...options,
      generation: this.generation,
    });
    panel.reveal(undefined, false);
  }

  private ensurePanel(): vscode.WebviewPanel {
    if (this.panel !== undefined) return this.panel;
    const panel = vscode.window.createWebviewPanel(
      PREVIEW_PANEL_VIEW_TYPE,
      'Canvas',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        enableForms: false,
        localResourceRoots: [],
      },
    );
    panel.webview.onDidReceiveMessage((raw: unknown) => {
      if (this.panel !== panel) return;
      const message = parseCanvasPanelMessage(raw);
      const current = this.current;
      if (
        message === undefined ||
        current === undefined ||
        message.generation !== this.generation ||
        message.revision !== current.memory.revision
      ) {
        this.recordRejected(raw);
        return;
      }
      if (message.type === 'canvas.reload') {
        void this.reload();
      } else if (message.type === 'canvas.openInEditor') {
        void this.openInEditor();
      } else {
        this.handleFeedback(message);
      }
    });
    panel.onDidDispose(() => {
      if (this.panel === panel) {
        this.panel = undefined;
        this.current = undefined;
        this.stopWatching();
      }
    });
    this.panel = panel;
    return panel;
  }

  private watch(target: vscode.Uri): void {
    this.stopWatching();
    const directory = vscode.Uri.file(dirname(target.fsPath));
    this.watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(directory, target.fsPath.split(/[\\/]/u).at(-1) ?? ''),
    );
    const schedule = (changed: vscode.Uri): void => {
      if (!sameFsPath(changed.fsPath, target.fsPath) || this.disposed) return;
      if (this.watcherTimer !== undefined) clearTimeout(this.watcherTimer);
      this.watcherTimer = setTimeout(() => {
        this.watcherTimer = undefined;
        void this.reload();
      }, WATCH_DEBOUNCE_MS);
    };
    this.watcher.onDidChange(schedule);
    this.watcher.onDidCreate(schedule);
    this.watcher.onDidDelete(schedule);
  }

  private stopWatching(): void {
    if (this.watcherTimer !== undefined) {
      clearTimeout(this.watcherTimer);
      this.watcherTimer = undefined;
    }
    this.watcher?.dispose();
    this.watcher = undefined;
  }

  private resolveTarget(relativePath: string): vscode.Uri | PreviewFailure {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    if (root === undefined) return 'no-workspace';
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

  private recordOpened(path: string, bytes: number): void {
    this.diagnostics?.record({
      level: 'info',
      name: 'host.preview.opened',
      attributes: { path, bytes },
    });
  }

  private recordReloaded(path: string, bytes: number): void {
    this.diagnostics?.record({
      level: 'info',
      name: 'host.preview.reloaded',
      attributes: { path, bytes },
    });
  }

  private recordFailure(
    name: string,
    path: string,
    reason: PreviewFailure,
  ): void {
    this.diagnostics?.record({
      level: 'warn',
      name,
      attributes: { path, reason },
    });
  }

  private recordRejected(raw: unknown): void {
    this.diagnostics?.record({
      level: 'warn',
      name: 'host.preview.rejected-message',
      detail: safeStringify(raw),
    });
  }
}

async function readPrototype(target: vscode.Uri): Promise<PrototypeRead> {
  let size: number;
  try {
    size = (await vscode.workspace.fs.stat(target)).size;
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

function boundSource(html: string): {
  readonly text: string;
  readonly truncated: boolean;
} {
  if (html.length <= MAX_CANVAS_CODE_SOURCE_LENGTH) {
    return { text: html, truncated: false };
  }
  return {
    text: html.slice(0, MAX_CANVAS_CODE_SOURCE_LENGTH),
    truncated: true,
  };
}

function digestSource(html: string): string {
  return createHash('sha256').update(html).digest('hex');
}

function sameFsPath(left: string, right: string): boolean {
  return left.replaceAll('\\', '/').toLowerCase() ===
    right.replaceAll('\\', '/').toLowerCase();
}

function noticeFor(path: string, reason: PreviewFailure): string {
  return reason === 'too-large'
    ? `${path} is larger than the 4 MB Canvas limit. Shrink the file, then press Reload.`
    : `${path} was deleted or can no longer be read. Restore the file, then press Reload.`;
}

function safeStringify(value: unknown): string {
  try {
    return (JSON.stringify(value) ?? String(value)).slice(0, 512);
  } catch {
    return String(value).slice(0, 512);
  }
}
