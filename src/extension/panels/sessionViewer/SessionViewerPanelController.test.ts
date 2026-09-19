import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const vscodeMock = vi.hoisted(() => {
  class FakeUri {
    constructor(readonly fsPath: string) {}
    static joinPath(base: FakeUri, ...parts: string[]): FakeUri {
      return new FakeUri([base.fsPath, ...parts].join('/'));
    }
    toString(): string {
      return `file://${this.fsPath}`;
    }
  }

  class FakeWebview {
    html = '';
    readonly cspSource = 'vscode-webview:';
    readonly posted: unknown[] = [];
    private listener: ((message: unknown) => void) | null = null;
    asWebviewUri(uri: FakeUri): FakeUri {
      return uri;
    }
    postMessage(message: unknown): Promise<boolean> {
      this.posted.push(message);
      return Promise.resolve(true);
    }
    onDidReceiveMessage(listener: (message: unknown) => void) {
      this.listener = listener;
      return {
        dispose: () => {
          this.listener = null;
        },
      };
    }
    receive(message: unknown): void {
      this.listener?.(message);
    }
  }

  class FakePanel {
    title: string;
    readonly webview = new FakeWebview();
    revealCalls = 0;
    disposed = false;
    private readonly listeners: Array<() => void> = [];
    constructor(title: string) {
      this.title = title;
    }
    reveal(): void {
      this.revealCalls += 1;
    }
    onDidDispose(listener: () => void) {
      this.listeners.push(listener);
      return { dispose: () => undefined };
    }
    dispose(): void {
      if (this.disposed) return;
      this.disposed = true;
      this.listeners.forEach((listener) => listener());
    }
  }

  const panels: FakePanel[] = [];
  return {
    Uri: FakeUri,
    ViewColumn: { Active: -1 },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3 },
    window: {
      activeColorTheme: { kind: 1 },
      createWebviewPanel: vi.fn((_type: string, title: string) => {
        const panel = new FakePanel(title);
        panels.push(panel);
        return panel;
      }),
      onDidChangeActiveColorTheme: vi.fn(() => ({
        dispose: () => undefined,
      })),
    },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: (_key: string, fallback: string) => fallback,
      })),
      onDidChangeConfiguration: vi.fn(() => ({
        dispose: () => undefined,
      })),
    },
    __panels: panels,
  };
});

vi.mock('vscode', () => vscodeMock);

import { SESSION_VIEWER_PROTOCOL_VERSION } from '../../../shared/protocol/sessionViewerProtocol';
import {
  SESSION_VIEWER_REFRESH_MS,
  SessionViewerPanelController,
} from './SessionViewerPanelController';

function createFixture() {
  const loadHistory = vi.fn().mockResolvedValue({
    status: 'available',
    state: {
      transcript: [{ id: 'u1', kind: 'user', text: 'Investigate' }],
      historyStatus: 'complete',
      truncated: false,
    },
  });
  const isRunning = vi.fn().mockResolvedValue(true);
  const stop = vi.fn().mockResolvedValue('accepted');
  const controller = new SessionViewerPanelController(
    new vscodeMock.Uri('/extension') as never,
    { loadHistory },
    () => ({ isRunning, stop }),
  );
  return { controller, loadHistory, isRunning, stop };
}

const target = {
  kind: 'daemon-session' as const,
  mode: 'standard' as const,
  sessionId: 'exec-1',
  title: 'Worker Session',
  cwd: 'd:/work',
};

beforeEach(() => {
  vi.useFakeTimers();
  vscodeMock.__panels.length = 0;
  vscodeMock.window.createWebviewPanel.mockClear();
});

afterEach(() => vi.useRealTimers());

describe('SessionViewerPanelController', () => {
  it('creates one read-only editor tab and posts a live snapshot', async () => {
    const { controller, loadHistory, isRunning } = createFixture();
    controller.open(target);
    await settle();

    expect(vscodeMock.window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(loadHistory).toHaveBeenCalledWith({
      cwd: 'd:/work',
      sessionId: 'exec-1',
    });
    expect(isRunning).toHaveBeenCalledWith(target);
    expect(vscodeMock.__panels[0]?.webview.posted).toContainEqual(
      expect.objectContaining({
        type: 'sessionViewer.snapshot',
        status: 'ready',
        running: true,
        target: {
          kind: 'daemon-session',
          mode: 'standard',
          sessionId: 'exec-1',
          title: 'Worker Session',
        },
      }),
    );
    controller.dispose();
  });

  it('focuses an existing target instead of creating a second tab', async () => {
    const { controller } = createFixture();
    controller.open(target);
    await settle();
    controller.open({ ...target, title: 'Updated Agent' });
    await settle();

    expect(vscodeMock.window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(vscodeMock.__panels[0]?.title).toBe('Updated Agent');
    expect(vscodeMock.__panels[0]?.revealCalls).toBe(1);
    controller.dispose();
  });

  it('keeps the final tab and stops polling after one settled refresh interval', async () => {
    const { controller, loadHistory, isRunning } = createFixture();
    isRunning.mockResolvedValue(false);
    controller.open(target);
    await settle();
    expect(loadHistory).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(SESSION_VIEWER_REFRESH_MS);
    await settle();
    expect(loadHistory).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(SESSION_VIEWER_REFRESH_MS * 2);
    expect(loadHistory).toHaveBeenCalledTimes(2);
    expect(vscodeMock.__panels[0]?.disposed).toBe(false);
    controller.dispose();
  });

  it('single-flights Stop and refreshes the final transcript', async () => {
    const { controller, isRunning, stop } = createFixture();
    let releaseStop: ((outcome: 'accepted') => void) | null = null;
    stop.mockImplementation(
      () =>
        new Promise<'accepted'>((resolve) => {
          releaseStop = resolve;
        }),
    );
    isRunning.mockResolvedValueOnce(true).mockResolvedValue(false);
    controller.open(target);
    await settle();
    const panel = vscodeMock.__panels[0]!;

    panel.webview.receive({
      type: 'sessionViewer.stop',
      protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
    });
    panel.webview.receive({
      type: 'sessionViewer.stop',
      protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
    });
    expect(stop).toHaveBeenCalledOnce();
    expect(panel.webview.posted).toContainEqual(
      expect.objectContaining({ stopping: true }),
    );
    releaseStop!('accepted');
    await settle();
    expect(panel.webview.posted).toContainEqual(
      expect.objectContaining({ running: false, stopping: false }),
    );
    expect(panel.disposed).toBe(false);
    controller.dispose();
  });

  it('keeps a running tab usable when its source rejects Stop', async () => {
    const { controller, stop } = createFixture();
    stop.mockRejectedValue(new Error('daemon offline'));
    controller.open(target);
    await settle();
    const panel = vscodeMock.__panels[0]!;

    panel.webview.receive({
      type: 'sessionViewer.stop',
      protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
    });
    await settle();
    expect(panel.webview.posted).toContainEqual(
      expect.objectContaining({
        running: true,
        stopping: false,
        stopError: true,
      }),
    );
    controller.dispose();
  });

  it('rejects forged Stop in Mission read-only mode', async () => {
    const { controller, stop } = createFixture();
    controller.open({ ...target, mode: 'mission-readonly' });
    await settle();
    vscodeMock.__panels[0]!.webview.receive({
      type: 'sessionViewer.stop',
      protocolVersion: SESSION_VIEWER_PROTOCOL_VERSION,
    });
    await settle();
    expect(stop).not.toHaveBeenCalled();
    expect(JSON.stringify(vscodeMock.__panels[0]!.webview.posted)).not.toContain(
      'exec-1',
    );
    controller.dispose();
  });
});

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
