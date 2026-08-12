import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  workspaceRoot: '/repo' as string | undefined,
  files: new Map<string, string>(),
}));

const vscodeMock = vi.hoisted(() => {
  class FakeUri {
    private constructor(readonly fsPath: string) {}
    static file(fsPath: string): FakeUri {
      return new FakeUri(fsPath);
    }
    toString(): string {
      return `file://${this.fsPath}`;
    }
  }

  const panels: FakePanel[] = [];

  class FakePanel {
    title = '';
    readonly webview = new FakeWebview();
    revealCalls = 0;
    disposed = false;
    private readonly disposeListeners: Array<() => void> = [];
    reveal(): void {
      this.revealCalls += 1;
    }
    onDidDispose(listener: () => void): { dispose(): void } {
      this.disposeListeners.push(listener);
      return { dispose: () => undefined };
    }
    dispose(): void {
      if (this.disposed) {
        return;
      }
      this.disposed = true;
      for (const listener of this.disposeListeners) {
        listener();
      }
    }
  }

  class FakeWebview {
    html = '';
    options: unknown;
    private handler: ((message: unknown) => void) | undefined;
    onDidReceiveMessage(
      listener: (message: unknown) => void,
    ): { dispose(): void } {
      this.handler = listener;
      return { dispose: () => undefined };
    }
    receive(message: unknown): void {
      this.handler?.(message);
    }
  }

  const showTextDocument = vi.fn(async () => undefined);

  return {
    Uri: FakeUri,
    ViewColumn: { Active: -1 },
    window: {
      createWebviewPanel: vi.fn(
        (_viewType: string, _title: string, _column: unknown, options: unknown) => {
          const panel = new FakePanel();
          panel.webview.options = options;
          panels.push(panel);
          return panel;
        },
      ),
      showTextDocument,
    },
    workspace: {
      get workspaceFolders() {
        return state.workspaceRoot === undefined
          ? undefined
          : [{ uri: FakeUri.file(state.workspaceRoot) }];
      },
      fs: {
        stat: vi.fn(async (uri: { fsPath: string }) => {
          const key = normalize(uri.fsPath);
          const content = state.files.get(key);
          if (content === undefined) {
            throw new Error('ENOENT');
          }
          return { size: Buffer.byteLength(content, 'utf8') };
        }),
        readFile: vi.fn(async (uri: { fsPath: string }) => {
          const key = normalize(uri.fsPath);
          const content = state.files.get(key);
          if (content === undefined) {
            throw new Error('ENOENT');
          }
          return new Uint8Array(Buffer.from(content, 'utf8'));
        }),
      },
    },
    __panels: panels,
    __showTextDocument: showTextDocument,
  };
});

function normalize(fsPath: string): string {
  return fsPath.replace(/\\/g, '/');
}

vi.mock('vscode', () => vscodeMock);

import { PreviewPanelController } from './PreviewPanelController';

interface DiagnosticRecord {
  readonly level: string;
  readonly name: string;
  readonly attributes?: Record<string, unknown>;
  readonly detail?: string;
}

function createDiagnostics() {
  const records: DiagnosticRecord[] = [];
  return {
    sink: { record: (event: DiagnosticRecord) => records.push(event) },
    records,
  };
}

function lastPanel() {
  const panels = vscodeMock.__panels;
  return panels.at(-1);
}

beforeEach(() => {
  state.workspaceRoot = '/repo';
  state.files.clear();
  vscodeMock.__panels.length = 0;
  vscodeMock.window.createWebviewPanel.mockClear();
  vscodeMock.__showTextDocument.mockClear();
});

describe('PreviewPanelController.openPreview', () => {
  it('renders a validated prototype in a sandboxed panel', async () => {
    state.files.set('/repo/demo/proto.html', '<head><script>ui()</script></head>');
    const { sink, records } = createDiagnostics();
    const controller = new PreviewPanelController(sink);

    const outcome = await controller.openPreview('demo/proto.html');

    expect(outcome).toBe('opened');
    const panel = lastPanel();
    expect(panel?.title).toBe('Preview · proto.html');
    expect(panel?.revealCalls).toBe(1);
    expect(panel?.webview.options).toMatchObject({
      enableScripts: true,
      enableForms: false,
      localResourceRoots: [],
    });
    expect(panel?.webview.html).toContain('sandbox="allow-scripts"');
    expect(panel?.webview.html).not.toContain('allow-same-origin');
    // Prototype content is present but escaped for the srcdoc attribute.
    expect(panel?.webview.html).toContain('&lt;script&gt;ui()&lt;/script&gt;');
    expect(
      records.some((record) => record.name === 'host.preview.opened'),
    ).toBe(true);
  });

  it('reuses a single panel across previews', async () => {
    state.files.set('/repo/a.html', '<p>a</p>');
    state.files.set('/repo/b.html', '<p>b</p>');
    const controller = new PreviewPanelController();

    await controller.openPreview('a.html');
    await controller.openPreview('b.html');

    expect(vscodeMock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(lastPanel()?.title).toBe('Preview · b.html');
  });

  it.each([
    ['../escape/proto.html', 'containment'],
    ['proto.tsx', 'extension'],
    ['proto.js', 'extension'],
  ])('fails closed for unsafe path %s', async (path) => {
    const { sink, records } = createDiagnostics();
    const controller = new PreviewPanelController(sink);

    const outcome = await controller.openPreview(path);

    expect(outcome).toBe('failed');
    expect(vscodeMock.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(
      records.some((record) => record.name === 'host.preview.failed'),
    ).toBe(true);
  });

  it('fails closed when the file does not exist', async () => {
    const controller = new PreviewPanelController();
    const outcome = await controller.openPreview('missing.html');
    expect(outcome).toBe('failed');
    expect(vscodeMock.window.createWebviewPanel).not.toHaveBeenCalled();
  });

  it('fails closed when there is no workspace', async () => {
    state.workspaceRoot = undefined;
    state.files.set('/repo/proto.html', '<p>hi</p>');
    const controller = new PreviewPanelController();
    const outcome = await controller.openPreview('proto.html');
    expect(outcome).toBe('failed');
  });

  it('fails closed for oversized prototypes', async () => {
    state.files.set(
      '/repo/big.html',
      `<p>${'x'.repeat(4 * 1024 * 1024 + 1)}</p>`,
    );
    const { sink, records } = createDiagnostics();
    const controller = new PreviewPanelController(sink);
    const outcome = await controller.openPreview('big.html');
    expect(outcome).toBe('failed');
    expect(
      records.find((record) => record.name === 'host.preview.failed')
        ?.attributes?.reason,
    ).toBe('too-large');
  });
});

describe('PreviewPanelController.openInlineHtml', () => {
  it('renders inline chat HTML in the sandboxed panel with an inline title', async () => {
    const { sink, records } = createDiagnostics();
    const controller = new PreviewPanelController(sink);

    const outcome = await controller.openInlineHtml(
      '<!DOCTYPE html><html><body><script>go()</script></body></html>',
    );

    expect(outcome).toBe('opened');
    const panel = lastPanel();
    expect(panel?.title).toBe('Preview · Chat snippet');
    expect(panel?.webview.html).toContain('sandbox="allow-scripts"');
    expect(panel?.webview.html).not.toContain('allow-same-origin');
    expect(panel?.webview.html).toContain('&lt;script&gt;go()&lt;/script&gt;');
    expect(panel?.webview.html).not.toContain('>Open in editor<');
    expect(
      records.find((record) => record.name === 'host.preview.opened')
        ?.attributes?.path,
    ).toBe('inline');
  });

  it('works without any workspace folder', async () => {
    state.workspaceRoot = undefined;
    const controller = new PreviewPanelController();
    const outcome = await controller.openInlineHtml('<p>standalone</p>');
    expect(outcome).toBe('opened');
  });

  it('fails closed for empty or oversized inline sources', async () => {
    const { sink, records } = createDiagnostics();
    const controller = new PreviewPanelController(sink);

    expect(await controller.openInlineHtml('')).toBe('failed');
    expect(
      await controller.openInlineHtml('x'.repeat(512 * 1024 + 1)),
    ).toBe('failed');
    expect(vscodeMock.window.createWebviewPanel).not.toHaveBeenCalled();
    expect(
      records.filter((record) => record.name === 'host.preview.failed'),
    ).toHaveLength(2);
  });

  it('reloads by re-rendering the identical inline content', async () => {
    const controller = new PreviewPanelController();
    await controller.openInlineHtml('<p>inline-v1</p>');
    const panel = lastPanel();

    panel!.webview.html = '';
    panel?.webview.receive({ type: 'preview.reload' });
    await flush();
    expect(panel?.webview.html).toContain('inline-v1');
  });

  it('ignores forged openInEditor messages for inline content', async () => {
    const controller = new PreviewPanelController();
    await controller.openInlineHtml('<p>inline</p>');
    lastPanel()?.webview.receive({ type: 'preview.openInEditor' });
    await flush();
    expect(vscodeMock.__showTextDocument).not.toHaveBeenCalled();
  });

  it('reuses the single panel across file and inline previews', async () => {
    state.files.set('/repo/a.html', '<p>a</p>');
    const controller = new PreviewPanelController();
    await controller.openPreview('a.html');
    await controller.openInlineHtml('<p>inline</p>');
    expect(vscodeMock.window.createWebviewPanel).toHaveBeenCalledTimes(1);
    expect(lastPanel()?.title).toBe('Preview · Chat snippet');

    // Reload after the switch re-renders the inline source, not the file.
    lastPanel()!.webview.html = '';
    lastPanel()?.webview.receive({ type: 'preview.reload' });
    await flush();
    expect(lastPanel()?.webview.html).toContain('inline');
    expect(lastPanel()?.webview.html).not.toContain('<p>a</p>');
  });
});

describe('PreviewPanelController toolbar commands', () => {
  it('reloads current prototype and degrades to a notice when deleted', async () => {
    state.files.set('/repo/proto.html', '<p>v1</p>');
    const controller = new PreviewPanelController();
    await controller.openPreview('proto.html');
    const panel = lastPanel();

    state.files.set('/repo/proto.html', '<p>v2</p>');
    panel?.webview.receive({ type: 'preview.reload' });
    await flush();
    expect(panel?.webview.html).toContain('v2');

    state.files.delete('/repo/proto.html');
    panel?.webview.receive({ type: 'preview.reload' });
    await flush();
    expect(panel?.webview.html).not.toContain('<iframe');
    expect(panel?.webview.html).toContain('was deleted');
    expect(panel?.webview.html).toContain('>Reload<');
  });

  it('opens the current prototype in an editor', async () => {
    state.files.set('/repo/proto.html', '<p>hi</p>');
    const controller = new PreviewPanelController();
    await controller.openPreview('proto.html');
    lastPanel()?.webview.receive({ type: 'preview.openInEditor' });
    await flush();
    expect(vscodeMock.__showTextDocument).toHaveBeenCalledTimes(1);
  });

  it('ignores messages that are not the two fixed commands', async () => {
    state.files.set('/repo/proto.html', '<p>hi</p>');
    const { sink, records } = createDiagnostics();
    const controller = new PreviewPanelController(sink);
    await controller.openPreview('proto.html');
    const panel = lastPanel();

    for (const hostile of [
      { type: 'preview.reload', path: '../../etc/passwd' },
      { type: 'preview.openInEditor', extra: 1 },
      { type: 'evil' },
      'preview.reload',
      { type: 'preview.reload', __proto__: { polluted: true } },
    ]) {
      panel?.webview.receive(hostile);
    }
    await flush();

    expect(vscodeMock.__showTextDocument).not.toHaveBeenCalled();
    expect(
      records.filter(
        (record) => record.name === 'host.preview.rejected-message',
      ).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it('drops toolbar messages after disposal', async () => {
    state.files.set('/repo/proto.html', '<p>hi</p>');
    const controller = new PreviewPanelController();
    await controller.openPreview('proto.html');
    const panel = lastPanel();
    controller.dispose();
    expect(panel?.disposed).toBe(true);
    panel?.webview.receive({ type: 'preview.openInEditor' });
    await flush();
    expect(vscodeMock.__showTextDocument).not.toHaveBeenCalled();
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
