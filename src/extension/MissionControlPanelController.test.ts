import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
    readonly webview = new FakeWebview();
    revealCalls = 0;
    disposed = false;
    private readonly listeners: Array<() => void> = [];
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
  const configurationListeners: Array<(event: {
    affectsConfiguration(section: string): boolean;
  }) => void> = [];
  const themeListeners: Array<() => void> = [];
  return {
    Uri: FakeUri,
    ViewColumn: { Active: -1 },
    ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3 },
    window: {
      activeColorTheme: { kind: 1 },
      createWebviewPanel: vi.fn(() => {
        const panel = new FakePanel();
        panels.push(panel);
        return panel;
      }),
      onDidChangeActiveColorTheme: vi.fn((listener: () => void) => {
        themeListeners.push(listener);
        return { dispose: () => undefined };
      }),
    },
    workspace: {
      getConfiguration: vi.fn(() => ({
        get: (_key: string, fallback: string) => fallback,
      })),
      onDidChangeConfiguration: vi.fn(
        (
          listener: (event: {
            affectsConfiguration(section: string): boolean;
          }) => void,
        ) => {
          configurationListeners.push(listener);
          return { dispose: () => undefined };
        },
      ),
    },
    __panels: panels,
    __configurationListeners: configurationListeners,
    __themeListeners: themeListeners,
  };
});

vi.mock('vscode', () => vscodeMock);

import {
  MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
  type MissionControlCatalogRow,
} from '../shared/missionControlPanelProtocol';
import { LocalDiagnostics } from './LocalDiagnostics';
import { MissionControlPanelController } from './MissionControlPanelController';

const row = (
  catalogId: string,
  title: string,
): MissionControlCatalogRow => ({
  catalogId,
  title,
  lifecycle: 'running',
  workspaceLabel: 'droidvisx',
  computerLabel: '—',
  progress: { completed: 1, total: 3 },
  createdAt: '2026-08-23T10:00:00.000Z',
  updatedAt: null,
  elapsedMs: null,
  attached: false,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function readyMessage() {
  return {
    type: 'missionControl.ready',
    protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
  };
}

function requestMessage(requestId: string, filter = 'all') {
  return {
    type: 'missionControl.catalog.request',
    protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    requestId,
    filter,
  };
}

function navigateMessage(
  requestId: string,
  catalogId = 'mission-catalog-one',
) {
  return {
    type: 'missionControl.navigate',
    protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
    requestId,
    route: 'detail',
    catalogId,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vscodeMock.__panels.length = 0;
  vscodeMock.__configurationListeners.length = 0;
  vscodeMock.__themeListeners.length = 0;
  vscodeMock.window.createWebviewPanel.mockClear();
});

afterEach(() => vi.useRealTimers());

describe('MissionControlPanelController', () => {
  it('owns one panel and one ready handshake independently of selected-chat state', async () => {
    const listCatalog = vi.fn().mockResolvedValue({
      status: 'ready',
      rows: [row('mission-catalog-one', 'Catalog foundation')],
    });
    const controller = new MissionControlPanelController(
      new vscodeMock.Uri('/extension') as never,
      { listCatalog },
    );

    controller.open();
    controller.open();
    const panel = vscodeMock.__panels[0]!;
    expect(vscodeMock.window.createWebviewPanel).toHaveBeenCalledOnce();
    expect(panel.revealCalls).toBe(1);
    expect(panel.webview.html).toContain('mission-control.js');
    expect(panel.webview.html).toContain('mission-control.css');
    expect(listCatalog).not.toHaveBeenCalled();

    panel.webview.receive(readyMessage());
    await settle();
    panel.webview.receive(readyMessage());
    await settle();

    expect(listCatalog).toHaveBeenCalledOnce();
    expect(panel.webview.posted).toContainEqual({
      type: 'missionControl.theme',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      preference: 'auto',
      resolved: 'light',
    });
    expect(panel.webview.posted).toContainEqual(
      expect.objectContaining({
        type: 'missionControl.catalog.result',
        status: 'ready',
        filter: 'all',
        rows: [expect.objectContaining({ title: 'Catalog foundation' })],
      }),
    );

    const postedAfterSettlement = [...panel.webview.posted];
    controller.open();
    expect(panel.revealCalls).toBe(2);
    expect(listCatalog).toHaveBeenCalledOnce();
    expect(panel.webview.posted).toEqual(postedAfterSettlement);
    controller.dispose();
  });

  it('navigates by safe identity without catalog mutation and returns repeated entry to catalog', async () => {
    const listCatalog = vi.fn().mockResolvedValue({
      status: 'ready',
      rows: [row('mission-catalog-one', 'Duplicate title')],
    });
    const controller = new MissionControlPanelController(
      new vscodeMock.Uri('/extension') as never,
      { listCatalog },
    );
    controller.open();
    const panel = vscodeMock.__panels[0]!;
    panel.webview.receive(readyMessage());
    await settle();

    panel.webview.receive(navigateMessage('detail-one'));
    expect(listCatalog).toHaveBeenCalledOnce();
    expect(controller.routeState()).toEqual({
      route: 'detail',
      catalogId: 'mission-catalog-one',
    });
    expect(controller.catalogState().rows[0]?.catalogId).toBe(
      'mission-catalog-one',
    );

    const postedBeforeReturn = panel.webview.posted.length;
    controller.open();
    expect(controller.routeState()).toEqual({
      route: 'catalog',
      catalogId: null,
    });
    expect(panel.revealCalls).toBe(1);
    expect(panel.webview.posted.at(-1)).toEqual({
      type: 'missionControl.route',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      route: 'catalog',
    });
    expect(
      panel.webview.posted.slice(postedBeforeReturn).filter(
        (message) =>
          (message as { type?: string }).type === 'missionControl.route',
      ),
    ).toHaveLength(1);
    expect(listCatalog).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('replaces an initial load canceled by Back and rejects the canceled result', async () => {
    const canceled = deferred<{
      status: 'ready';
      rows: readonly MissionControlCatalogRow[];
    }>();
    const replacement = deferred<{
      status: 'ready';
      rows: readonly MissionControlCatalogRow[];
    }>();
    const listCatalog = vi
      .fn()
      .mockReturnValueOnce(canceled.promise)
      .mockReturnValueOnce(replacement.promise);
    const controller = new MissionControlPanelController(
      new vscodeMock.Uri('/extension') as never,
      { listCatalog },
    );
    controller.open();
    const panel = vscodeMock.__panels[0]!;
    panel.webview.receive(readyMessage());

    panel.webview.receive({
      type: 'missionControl.navigate',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      requestId: 'new-mission',
      route: 'new-mission',
    });
    panel.webview.receive({
      type: 'missionControl.navigate',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      requestId: 'back-to-catalog',
      route: 'catalog',
    });
    expect(listCatalog).toHaveBeenCalledTimes(2);

    canceled.resolve({
      status: 'ready',
      rows: [row('mission-catalog-canceled', 'Canceled Mission')],
    });
    replacement.resolve({
      status: 'ready',
      rows: [row('mission-catalog-current', 'Current Mission')],
    });
    await settle();

    expect(JSON.stringify(panel.webview.posted)).not.toContain(
      'Canceled Mission',
    );
    expect(panel.webview.posted.at(-1)).toMatchObject({
      requestId: 'back-to-catalog',
      status: 'ready',
      rows: [{ title: 'Current Mission' }],
    });
    controller.dispose();
  });

  it('replaces a stale refresh canceled by a Host catalog route and retains rows and filter', async () => {
    const canceledRefresh = deferred<{
      status: 'ready';
      rows: readonly MissionControlCatalogRow[];
    }>();
    const replacement = deferred<{
      status: 'ready';
      rows: readonly MissionControlCatalogRow[];
    }>();
    const listCatalog = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'ready',
        rows: [row('mission-catalog-stale', 'Stale Mission')],
      })
      .mockReturnValueOnce(canceledRefresh.promise)
      .mockReturnValueOnce(replacement.promise);
    const controller = new MissionControlPanelController(
      new vscodeMock.Uri('/extension') as never,
      { listCatalog },
    );
    controller.open();
    const panel = vscodeMock.__panels[0]!;
    panel.webview.receive(readyMessage());
    await settle();

    panel.webview.receive(requestMessage('refresh-paused', 'paused'));
    panel.webview.receive(navigateMessage('detail-during-refresh'));
    controller.open();

    expect(listCatalog).toHaveBeenCalledTimes(3);
    expect(controller.catalogState()).toMatchObject({
      filter: 'paused',
      rows: [{ title: 'Stale Mission' }],
    });

    canceledRefresh.resolve({
      status: 'ready',
      rows: [row('mission-catalog-canceled', 'Canceled Refresh')],
    });
    replacement.resolve({
      status: 'ready',
      rows: [row('mission-catalog-current', 'Current Refresh')],
    });
    await settle();

    expect(JSON.stringify(panel.webview.posted)).not.toContain(
      'Canceled Refresh',
    );
    expect(panel.webview.posted.at(-1)).toMatchObject({
      filter: 'paused',
      status: 'ready',
      rows: [{ title: 'Current Refresh' }],
    });
    controller.dispose();
  });

  it('publishes only the latest request and replaces rows atomically', async () => {
    const initialRows = [row('mission-catalog-old', 'Old Mission')];
    const older = deferred<{
      status: 'ready';
      rows: readonly MissionControlCatalogRow[];
    }>();
    const latest = deferred<{
      status: 'ready';
      rows: readonly MissionControlCatalogRow[];
    }>();
    const listCatalog = vi
      .fn()
      .mockResolvedValueOnce({ status: 'ready', rows: initialRows })
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(latest.promise);
    const controller = new MissionControlPanelController(
      new vscodeMock.Uri('/extension') as never,
      { listCatalog },
    );
    controller.open();
    const panel = vscodeMock.__panels[0]!;
    panel.webview.receive(readyMessage());
    await settle();

    panel.webview.receive(requestMessage('refresh-older', 'running'));
    panel.webview.receive(requestMessage('refresh-latest', 'completed'));
    panel.webview.receive(requestMessage('refresh-latest', 'all'));
    expect(listCatalog).toHaveBeenCalledTimes(3);
    latest.resolve({
      status: 'ready',
      rows: [row('mission-catalog-latest', 'Latest Mission')],
    });
    await settle();
    older.resolve({
      status: 'ready',
      rows: [row('mission-catalog-superseded', 'Superseded Mission')],
    });
    await settle();

    const results = panel.webview.posted.filter(
      (message) =>
        (message as { type?: string }).type ===
        'missionControl.catalog.result',
    );
    expect(results).toHaveLength(2);
    expect(results.at(-1)).toMatchObject({
      requestId: 'refresh-latest',
      filter: 'completed',
      status: 'ready',
      revision: 3,
      rows: [{ title: 'Latest Mission' }],
    });
    expect(JSON.stringify(results)).not.toContain('Superseded Mission');
    controller.dispose();
  });

  it('retains stale rows and filter across refresh failure, timeout, and retry', async () => {
    const timedOut = deferred<{
      status: 'ready';
      rows: readonly MissionControlCatalogRow[];
    }>();
    const listCatalog = vi
      .fn()
      .mockResolvedValueOnce({
        status: 'ready',
        rows: [row('mission-catalog-stale', 'Stale Mission')],
      })
      .mockResolvedValueOnce({
        status: 'error',
        code: 'incomplete-list',
        message: 'raw daemon detail must not publish',
      })
      .mockReturnValueOnce(timedOut.promise)
      .mockResolvedValueOnce({
        status: 'ready',
        rows: [row('mission-catalog-recovered', 'Recovered Mission')],
      });
    const controller = new MissionControlPanelController(
      new vscodeMock.Uri('/extension') as never,
      { listCatalog },
      { deadlineMs: 1_000 },
    );
    controller.open();
    const panel = vscodeMock.__panels[0]!;
    panel.webview.receive(readyMessage());
    await settle();

    panel.webview.receive(requestMessage('refresh-error', 'paused'));
    await settle();
    expect(controller.catalogState()).toMatchObject({
      filter: 'paused',
      rows: [{ title: 'Stale Mission' }],
    });
    expect(panel.webview.posted.at(-1)).toMatchObject({
      requestId: 'refresh-error',
      filter: 'paused',
      status: 'error',
      error: {
        code: 'incomplete-list',
        message: 'The complete Mission catalog could not be loaded.',
        retryable: true,
      },
    });

    panel.webview.receive(requestMessage('refresh-timeout', 'paused'));
    await vi.advanceTimersByTimeAsync(1_000);
    await settle();
    expect(panel.webview.posted.at(-1)).toMatchObject({
      requestId: 'refresh-timeout',
      status: 'error',
      error: { code: 'unavailable', retryable: true },
    });
    timedOut.resolve({
      status: 'ready',
      rows: [row('mission-catalog-late', 'Late Mission')],
    });
    await settle();
    expect(JSON.stringify(panel.webview.posted)).not.toContain('Late Mission');

    panel.webview.receive(requestMessage('retry-owned', 'paused'));
    await settle();
    expect(panel.webview.posted.at(-1)).toMatchObject({
      requestId: 'retry-owned',
      filter: 'paused',
      status: 'ready',
      rows: [{ title: 'Recovered Mission' }],
    });
    controller.dispose();
  });

  it('rejects late work after navigation away or disposal and broadcasts live themes', async () => {
    const navigated = deferred<{
      status: 'ready';
      rows: readonly MissionControlCatalogRow[];
    }>();
    const disposed = deferred<{
      status: 'ready';
      rows: readonly MissionControlCatalogRow[];
    }>();
    const listCatalog = vi
      .fn()
      .mockResolvedValueOnce({ status: 'ready', rows: [] })
      .mockReturnValueOnce(navigated.promise)
      .mockReturnValueOnce(disposed.promise);
    const controller = new MissionControlPanelController(
      new vscodeMock.Uri('/extension') as never,
      { listCatalog },
    );
    controller.open();
    const panel = vscodeMock.__panels[0]!;
    panel.webview.receive(readyMessage());
    await settle();

    vscodeMock.__configurationListeners[0]?.({
      affectsConfiguration: (section) => section === 'droidvisx.theme',
    });
    expect(panel.webview.posted.at(-1)).toMatchObject({
      type: 'missionControl.theme',
    });

    panel.webview.receive(requestMessage('navigated-away'));
    controller.navigate('new-mission');
    navigated.resolve({
      status: 'ready',
      rows: [row('mission-catalog-navigated', 'Navigated result')],
    });
    await settle();
    expect(JSON.stringify(panel.webview.posted)).not.toContain(
      'Navigated result',
    );

    controller.navigate('catalog');
    panel.webview.receive(requestMessage('disposed-result'));
    panel.dispose();
    disposed.resolve({
      status: 'ready',
      rows: [row('mission-catalog-disposed', 'Disposed result')],
    });
    await settle();
    expect(JSON.stringify(panel.webview.posted)).not.toContain(
      'Disposed result',
    );
    expect(controller.catalogState()).toEqual({
      filter: 'all',
      rows: [],
      revision: 0,
    });

    controller.open();
    expect(vscodeMock.window.createWebviewPanel).toHaveBeenCalledTimes(2);
    controller.dispose();
  });

  it('records exact Webview diagnostics with credential-scrubbed local detail', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dvx-mission-control-'));
    const diagnostics = new LocalDiagnostics({
      directory,
      output: {
        appendLine: () => undefined,
        show: () => undefined,
        dispose: () => undefined,
      },
      now: () => new Date('2026-08-24T10:00:00.000Z'),
    });
    const controller = new MissionControlPanelController(
      new vscodeMock.Uri('/extension') as never,
      { listCatalog: vi.fn() },
      {},
      diagnostics,
    );

    try {
      controller.open();
      const panel = vscodeMock.__panels[0]!;
      panel.webview.receive({
        type: 'webview.diagnostic',
        kind: 'boot-timeout',
        detail: 'resource failed api_key=super-secret-value',
      });
      await diagnostics.flush();

      const contents = await readFile(diagnostics.filePath, 'utf8');
      expect(contents).toContain('"name":"missionControl.boot-timeout"');
      expect(contents).toContain('[REDACTED]');
      expect(contents).not.toContain('super-secret-value');
    } finally {
      controller.dispose();
      diagnostics.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('owns New Mission draft revisions and rejects stale Webview updates', () => {
    const authority = {
      workspaceAuthorityRevision: 4,
      chatOwnerRevision: 7,
      availability: 'unavailable' as const,
      reason: 'selected-chat-unavailable' as const,
      capabilities: null,
    };
    const controller = new MissionControlPanelController(
      new vscodeMock.Uri('/extension') as never,
      {
        listCatalog: vi.fn(),
        readSetup: () => authority,
      },
    );
    controller.openNewMission('Preserve this task');
    const panel = vscodeMock.__panels[0]!;
    panel.webview.receive(readyMessage());

    expect(panel.webview.posted.at(-1)).toMatchObject({
      type: 'missionControl.setup.snapshot',
      setupRevision: 1,
      draft: { task: 'Preserve this task' },
    });
    const update = {
      type: 'missionControl.setup.update',
      protocolVersion: MISSION_CONTROL_PANEL_PROTOCOL_VERSION,
      requestId: 'setup-one',
      setupRevision: 1,
      workspaceAuthorityRevision: 4,
      chatOwnerRevision: 7,
      draft: {
        task: 'Edited task',
        orchestrator: null,
        worker: null,
        validator: null,
        scrutinyEnabled: true,
        userTestingEnabled: true,
      },
    };
    panel.webview.receive(update);
    expect(panel.webview.posted.at(-1)).toMatchObject({
      type: 'missionControl.setup.snapshot',
      setupRevision: 2,
      draft: { task: 'Edited task' },
    });

    panel.webview.receive({
      ...update,
      requestId: 'setup-stale',
      draft: { ...update.draft, task: 'Stale task' },
    });
    expect(panel.webview.posted.at(-1)).toMatchObject({
      setupRevision: 2,
      draft: { task: 'Edited task' },
    });
    controller.dispose();
  });
});

async function settle(): Promise<void> {
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }
}
