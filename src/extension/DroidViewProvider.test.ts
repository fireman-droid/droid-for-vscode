import type * as vscodeTypes from 'vscode';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BRIDGE_PROTOCOL_VERSION,
  type HostToWebviewMessage,
} from '../shared/bridgeMessages';
import type { ChatController } from './ChatController';

const vscodeMock = vi.hoisted(() => ({
  Uri: {
    joinPath(base: FakeUri, ...parts: string[]): FakeUri {
      const path = [base.path, ...parts].join('/');
      return {
        path,
        fsPath: path,
        toString: () => path,
      };
    },
  },
}));

vi.mock('vscode', () => vscodeMock);

import { DroidViewProvider } from './DroidViewProvider';

describe('DroidViewProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses restricted local roots and routes validated bridge messages', () => {
    const controller = createController();
    const provider = new DroidViewProvider(
      uri('extension'),
      controller.value,
    );
    const view = createView();

    provider.resolveWebviewView(
      view.value,
      {} as vscodeTypes.WebviewViewResolveContext,
      {} as vscodeTypes.CancellationToken,
    );

    expect(view.webview.options.localResourceRoots).toEqual([
      expect.objectContaining({ path: 'extension/dist/webview' }),
      expect.objectContaining({ path: 'extension/resources' }),
    ]);
    expect(view.webview.html).toContain(
      'src="webview:extension/dist/webview/webview.js"',
    );
    expect(view.webview.html).toContain(
      'href="webview:extension/dist/webview/webview.css"',
    );
    expect(view.webview.html).toContain("default-src 'none'");
    expect(view.webview.html).toContain("connect-src 'none'");

    view.receive({ type: 'not-supported' });
    expect(controller.handleMessage).not.toHaveBeenCalled();
    view.receive({
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    });
    expect(controller.handleMessage).toHaveBeenCalledWith({
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    });

    const snapshot: HostToWebviewMessage = {
      type: 'host.snapshot',
      sequence: 0,
      sessionId: null,
      connection: { status: 'idle' },
      turn: null,
      sessions: { status: 'idle', items: [] },
      settings: { status: 'loading', value: null },
      context: { status: 'loading', value: null },
      modelCatalog: { status: 'loading', items: [] },
      transcript: [],
      historyStatus: 'unavailable',
      truncated: false,
    };
    controller.emit(snapshot);
    expect(view.webview.postMessage).toHaveBeenCalledWith(snapshot);
  });

  it('logs a dedicated event for a version-mismatched webview.ready', () => {
    const controller = createController();
    const diagnostics = { record: vi.fn() };
    const provider = new DroidViewProvider(
      uri('extension'),
      controller.value,
      diagnostics,
    );
    const view = createView();
    provider.resolveWebviewView(
      view.value,
      {} as vscodeTypes.WebviewViewResolveContext,
      {} as vscodeTypes.CancellationToken,
    );

    // A newer bundle greeting a stale in-memory host after a VSIX
    // overwrite install: the handshake must fail loudly, not blend
    // into the generic rejected stream.
    view.receive({
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION + 1,
    });
    expect(controller.handleMessage).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith({
      level: 'error',
      name: 'host.bridge.protocol-mismatch',
      attributes: {
        expected: BRIDGE_PROTOCOL_VERSION,
        received: BRIDGE_PROTOCOL_VERSION + 1,
      },
    });
    expect(diagnostics.record).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: 'host.bridge.rejected' }),
    );

    // Non-handshake garbage keeps the generic rejection record.
    diagnostics.record.mockClear();
    view.receive({ type: 'not-supported' });
    expect(diagnostics.record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'host.bridge.rejected' }),
    );

    // A matching-version ready with a malformed shape is not a
    // protocol mismatch.
    diagnostics.record.mockClear();
    view.receive({
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      extra: true,
    });
    expect(diagnostics.record).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'host.bridge.rejected' }),
    );
  });

  it('unsubscribes a disposed view without disposing the controller', () => {
    const controller = createController();
    const provider = new DroidViewProvider(
      uri('extension'),
      controller.value,
    );
    const first = createView();
    const second = createView();

    provider.resolveWebviewView(
      first.value,
      {} as vscodeTypes.WebviewViewResolveContext,
      {} as vscodeTypes.CancellationToken,
    );
    first.disposeView();
    expect(controller.unsubscribe).toHaveBeenCalledOnce();
    expect(controller.dispose).not.toHaveBeenCalled();

    provider.resolveWebviewView(
      second.value,
      {} as vscodeTypes.WebviewViewResolveContext,
      {} as vscodeTypes.CancellationToken,
    );
    second.receive({
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    });
    expect(controller.handleMessage).toHaveBeenCalledOnce();
    expect(controller.subscribe).toHaveBeenCalledTimes(2);

    provider.dispose();
    expect(controller.unsubscribe).toHaveBeenCalledTimes(2);
    expect(controller.dispose).not.toHaveBeenCalled();
  });

  it('replaces all old-view listeners and routes only to the reopened view', () => {
    const controller = createController();
    const provider = new DroidViewProvider(
      uri('extension'),
      controller.value,
    );
    const first = createView();
    const second = createView();

    provider.resolveWebviewView(
      first.value,
      {} as vscodeTypes.WebviewViewResolveContext,
      {} as vscodeTypes.CancellationToken,
    );
    provider.resolveWebviewView(
      second.value,
      {} as vscodeTypes.WebviewViewResolveContext,
      {} as vscodeTypes.CancellationToken,
    );

    expect(first.messageSubscription.dispose).toHaveBeenCalledOnce();
    expect(first.viewSubscription.dispose).toHaveBeenCalledOnce();
    expect(controller.unsubscribe).toHaveBeenCalledOnce();

    first.receive({
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    });
    expect(controller.handleMessage).not.toHaveBeenCalled();
    second.receive({
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    });
    expect(controller.handleMessage).toHaveBeenCalledOnce();

    const snapshot: HostToWebviewMessage = {
      type: 'host.snapshot',
      sequence: 0,
      sessionId: null,
      connection: { status: 'idle' },
      turn: null,
      sessions: { status: 'idle', items: [] },
      settings: { status: 'loading', value: null },
      context: { status: 'loading', value: null },
      modelCatalog: { status: 'loading', items: [] },
      transcript: [],
      historyStatus: 'unavailable',
      truncated: false,
    };
    controller.emit(snapshot);
    expect(first.webview.postMessage).not.toHaveBeenCalled();
    expect(second.webview.postMessage).toHaveBeenCalledWith(snapshot);

    first.disposeView();
    expect(controller.unsubscribe).toHaveBeenCalledOnce();
    second.disposeView();
    expect(controller.unsubscribe).toHaveBeenCalledTimes(2);
  });

  it('ignores resolve and messages after provider disposal', () => {
    const controller = createController();
    const provider = new DroidViewProvider(
      uri('extension'),
      controller.value,
    );
    const first = createView();
    const late = createView();

    provider.resolveWebviewView(
      first.value,
      {} as vscodeTypes.WebviewViewResolveContext,
      {} as vscodeTypes.CancellationToken,
    );
    provider.dispose();
    provider.dispose();
    provider.resolveWebviewView(
      late.value,
      {} as vscodeTypes.WebviewViewResolveContext,
      {} as vscodeTypes.CancellationToken,
    );

    first.receive({
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    });
    late.receive({
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    });
    expect(controller.handleMessage).not.toHaveBeenCalled();
    expect(controller.subscribe).toHaveBeenCalledOnce();
    expect(controller.unsubscribe).toHaveBeenCalledOnce();
    expect(late.webview.onDidReceiveMessage).not.toHaveBeenCalled();
  });

  it('resyncs an initialized controller when the retained view becomes visible again', () => {
    const controller = createController();
    const record = vi.fn();
    const provider = new DroidViewProvider(
      uri('extension'),
      controller.value,
      { record },
    );
    const view = createView();
    provider.resolveWebviewView(
      view.value,
      {} as vscodeTypes.WebviewViewResolveContext,
      {} as vscodeTypes.CancellationToken,
    );

    // Hiding a retained view only logs; nothing is driven while the
    // webview is suspended.
    view.setVisible(false);
    expect(record).toHaveBeenCalledWith({
      level: 'info',
      name: 'host.view.visibility',
      attributes: { visible: false },
    });
    expect(controller.handleMessage).not.toHaveBeenCalled();

    // Re-show drives the idempotent ready resync so any message the
    // suspended webview missed is reconciled by a fresh snapshot.
    view.setVisible(true);
    expect(record).toHaveBeenCalledWith({
      level: 'info',
      name: 'host.view.visibility',
      attributes: { visible: true },
    });
    expect(controller.handleMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'webview.ready',
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
    });
  });

  it('stops observing visibility once the view is replaced or disposed', () => {
    const controller = createController();
    const provider = new DroidViewProvider(
      uri('extension'),
      controller.value,
    );
    const first = createView();
    const second = createView();
    provider.resolveWebviewView(
      first.value,
      {} as vscodeTypes.WebviewViewResolveContext,
      {} as vscodeTypes.CancellationToken,
    );
    provider.resolveWebviewView(
      second.value,
      {} as vscodeTypes.WebviewViewResolveContext,
      {} as vscodeTypes.CancellationToken,
    );

    expect(first.visibilitySubscription.dispose).toHaveBeenCalledOnce();
    first.setVisible(true);
    expect(controller.handleMessage).not.toHaveBeenCalled();

    provider.dispose();
    expect(
      second.visibilitySubscription.dispose,
    ).toHaveBeenCalledOnce();
    second.setVisible(true);
    expect(controller.handleMessage).not.toHaveBeenCalled();
  });
});

interface FakeUri {
  readonly path: string;
  readonly fsPath: string;
  toString(): string;
}

function uri(path: string): vscodeTypes.Uri {
  return {
    path,
    fsPath: path,
    toString: () => path,
  } as unknown as vscodeTypes.Uri;
}

function createController() {
  let listener:
    | ((message: HostToWebviewMessage) => void)
    | undefined;
  const unsubscribe = vi.fn();
  const subscribe = vi.fn(
    (nextListener: (message: HostToWebviewMessage) => void) => {
      listener = nextListener;
      return { dispose: unsubscribe };
    },
  );
  const handleMessage = vi.fn();
  const dispose = vi.fn(async () => {});

  return {
    value: {
      subscribe,
      handleMessage,
      dispose,
    } as unknown as ChatController,
    subscribe,
    handleMessage,
    unsubscribe,
    dispose,
    emit(message: HostToWebviewMessage) {
      listener?.(message);
    },
  };
}

function createView() {
  let receiveMessage: ((message: unknown) => void) | undefined;
  let disposeViewListener: (() => void) | undefined;
  let visibilityListener: (() => void) | undefined;
  const messageSubscription = {
    dispose: vi.fn(() => {
      receiveMessage = undefined;
    }),
  };
  const viewSubscription = {
    dispose: vi.fn(() => {
      disposeViewListener = undefined;
    }),
  };
  const visibilitySubscription = {
    dispose: vi.fn(() => {
      visibilityListener = undefined;
    }),
  };
  const webview = {
    options: {
      enableScripts: false,
      localResourceRoots: [] as readonly vscodeTypes.Uri[],
    },
    html: '',
    cspSource: 'vscode-webview://source',
    asWebviewUri(value: vscodeTypes.Uri) {
      return uri(`webview:${value.toString()}`);
    },
    postMessage: vi.fn(async () => true),
    onDidReceiveMessage: vi.fn((listener: (message: unknown) => void) => {
      receiveMessage = listener;
      return messageSubscription;
    }),
  };
  const value = {
    webview,
    visible: true,
    onDidDispose(listener: () => void) {
      disposeViewListener = listener;
      return viewSubscription;
    },
    onDidChangeVisibility(listener: () => void) {
      visibilityListener = listener;
      return visibilitySubscription;
    },
  } as unknown as vscodeTypes.WebviewView;

  return {
    value,
    webview,
    messageSubscription,
    viewSubscription,
    visibilitySubscription,
    receive(message: unknown) {
      receiveMessage?.(message);
    },
    disposeView() {
      disposeViewListener?.();
    },
    setVisible(visible: boolean) {
      (value as { visible: boolean }).visible = visible;
      visibilityListener?.();
    },
  };
}
