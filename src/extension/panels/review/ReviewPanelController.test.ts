import { beforeEach, expect, it, vi } from 'vitest';
const fake = vi.hoisted(() => {
  let receive: (message: unknown) => void = () => {};
  let close: () => void = () => {};
  const panel = { title: '', reveal: vi.fn(), dispose: () => close(),
    onDidDispose: (callback: () => void) => { close = callback; return { dispose() {} }; },
    webview: { html: '', postMessage: vi.fn(async () => true),
      onDidReceiveMessage: (callback: (message: unknown) => void) => { receive = callback; return { dispose() {} }; } } };
  return { panel, receive: (message: unknown) => receive(message), create: vi.fn(() => panel) };
});
vi.mock('vscode', () => ({
  Uri: { joinPath: (_base: unknown, ...parts: string[]) => parts.join('/') }, ViewColumn: { Active: -1 },
  window: { createWebviewPanel: fake.create, onDidChangeActiveColorTheme: () => ({ dispose() {} }) },
  workspace: { onDidChangeConfiguration: () => ({ dispose() {} }) },
}));
vi.mock('../../webview/webviewHtml', () => ({ getWebviewHtml: () => '<html>Review</html>' }));
vi.mock('../../webview/webviewTheme', () => ({ readWebviewBootTheme: () => ({ preference: 'dark', resolved: 'dark' }) }));
import { ReviewPanelController } from './ReviewPanelController';
import type { ChatController } from '../../chat/ChatController';
import type { ReviewCoordinator } from '../../review/reviewCoordinator';
import type { SessionViewerPanelController } from '../sessionViewer/SessionViewerPanelController';
import type { ReviewScopeState } from '../../../shared/protocol/reviewProtocol';
import type { WebviewToHostMessage } from '../../../shared/bridgeMessages';
beforeEach(() => vi.clearAllMocks());
it('reuses its editor tab, scopes messages to Chat and never stops Chat when closed', async () => {
  const handleMessage = vi.fn();
  const state = { sessionId: 's1', conversationId: null, activeRuntimeCwd: 'C:/work', connection: { status: 'connected' }, disposed: false };
  const chat = { sessionState: state, subscribe: () => ({ dispose() {} }), handleMessage,
    effects: { readLatestConversationChanges: () => ({ turnId: 't1', files: [] }) },
    recoveryState: { transcript: { transcript: [] } }, turnState: { turn: null } } as unknown as ChatController;
  const readFile = vi.fn(async () => ({ version: 'v1', patch: '@@ -1 +1 @@\n-a\n+b', truncated: false }));
  const panel = new ReviewPanelController({} as never, chat, { readFile } as unknown as ReviewCoordinator,
    { status: vi.fn(), commit: vi.fn() }, {} as SessionViewerPanelController);
  panel.open({ type: 'review.panel.open', sessionId: 's1', scopeKind: 'staged' });
  expect(handleMessage).not.toHaveBeenCalled();
  fake.receive({ type: 'reviewPanel.ready' });
  expect(handleMessage).toHaveBeenCalledWith({ type: 'review.open', sessionId: 's1', scopeKind: 'staged' });
  panel.open({ type: 'review.panel.open', sessionId: 's1', scopeKind: 'workspace' });
  expect(fake.create).toHaveBeenCalledOnce();
  expect(fake.panel.reveal).toHaveBeenCalledOnce();
  fake.receive({ type: 'reviewPanel.readFile', requestId: 'r1', reviewScopeId: 'scope1', baseline: 'head:index', path: 'a.ts', context: 3 });
  await vi.waitFor(() => expect(readFile).toHaveBeenCalledOnce());
  state.sessionId = 's2';
  fake.receive({ type: 'reviewPanel.readFile', requestId: 'r2', reviewScopeId: 'scope1', baseline: 'head:index', path: 'a.ts', context: 3 });
  expect(readFile).toHaveBeenCalledOnce();
  handleMessage.mockClear();
  panel.dispose();
  expect(handleMessage).not.toHaveBeenCalled();
});

function operationScope(turnId = 't1'): ReviewScopeState {
  return { sessionId: 's1', reviewScopeId: `scope-${turnId}`, scopeKind: 'operations', turnId,
    baseline: `baseline-${turnId}`, baselineLabel: 'Recorded Droid operations', lifecycle: 'settled',
    files: ['a.ts', 'b.ts'].map((path) => ({ path, additions: null, deletions: null,
      status: 'unreviewed', version: `version-${path}`, restorable: true })),
    currentIndex: 0, reviewedCount: 0, reviewableCount: 2 };
}

function intentFixture() {
  type Listener = Parameters<ChatController['subscribe']>[0];
  type Publish = Parameters<ReviewCoordinator['replayTo']>[1];
  let listener: Listener = () => {};
  const replays: Array<{ publish: Publish; resolve: () => void }> = [];
  const state = { sessionId: 's1', conversationId: null, activeRuntimeCwd: 'C:/work',
    connection: { status: 'connected' }, disposed: false };
  const handleMessage = vi.fn((_message: WebviewToHostMessage) => {});
  const replayTo = vi.fn((_sessionId: string, publish: Publish) => new Promise<void>((resolve) => replays.push({ publish, resolve })));
  const chat = { sessionState: state, handleMessage,
    subscribe: (next: Listener) => { listener = next; return { dispose() {} }; },
    effects: { readLatestConversationChanges: () => undefined },
    recoveryState: { transcript: { transcript: [] } }, turnState: { turn: null } } as unknown as ChatController;
  const panel = new ReviewPanelController({} as never, chat, { replayTo } as unknown as ReviewCoordinator,
    { status: vi.fn(), commit: vi.fn() }, {} as SessionViewerPanelController);
  return { panel, state, handleMessage, replayTo,
    emit: (message: unknown) => listener(message as Parameters<Listener>[0]),
    release: async (index: number) => { replays[index]!.resolve(); await Promise.resolve(); },
    finish: (index: number, scope: ReviewScopeState) => {
      const replay = replays[index]!;
      replay.publish({ type: 'review.state', state: scope });
      replay.resolve();
    } };
}

function serialReview(current: ReturnType<typeof intentFixture>, failedTurnId: string) {
  let queued = Promise.resolve();
  let active = operationScope();
  let rejectOpen: () => void = () => {};
  const failure = new Promise<void>((resolve) => { rejectOpen = resolve; });
  const enqueue = (task: () => Promise<void>) => {
    const result = queued.then(task);
    queued = result.catch(() => {});
    return result;
  };
  current.handleMessage.mockImplementation((message) => {
    if (message.type !== 'review.open') return;
    void enqueue(async () => {
      if (message.turnId === failedTurnId) {
        await failure;
        throw new Error('Open failed');
      }
      active = operationScope(message.turnId);
      current.emit({ type: 'review.state', sequence: 20, state: active });
    }).catch(() => current.emit({ type: 'review.operationResult', sessionId: 's1', reviewScopeId: 'review',
      sequence: 21, operation: 'open', ok: false, message: 'Open failed' }));
  });
  current.replayTo.mockImplementation((_sessionId, publish) => enqueue(async () => {
    publish({ type: 'review.state', state: active });
  }));
  return { rejectOpen, drain: async () => {
    let previous: Promise<void> | undefined;
    while (previous !== queued) { previous = queued; await previous; }
  } };
}

it('does not let an older queued open failure cancel a newer undo request', async () => {
  const current = intentFixture();
  const serial = serialReview(current, 'old-turn');
  current.panel.open({ type: 'review.panel.open', sessionId: 's1', scopeKind: 'operations', turnId: 'old-turn' });
  fake.receive({ type: 'reviewPanel.ready' });
  current.panel.open({ type: 'review.panel.open', sessionId: 's1', scopeKind: 'operations', turnId: 't1', action: 'undo' });
  serial.rejectOpen();
  await serial.drain();
  expect(current.handleMessage).toHaveBeenLastCalledWith({ type: 'review.restorePreview', sessionId: 's1',
    reviewScopeId: 'scope-t1', baseline: 'baseline-t1', target: 'turn' });
  current.panel.dispose();
});

it('does not preview undo from an old same-scope state when the requested open fails', async () => {
  const current = intentFixture();
  const serial = serialReview(current, 't1');
  current.panel.open({ type: 'review.panel.open', sessionId: 's1', scopeKind: 'operations', turnId: 't1', action: 'undo' });
  fake.receive({ type: 'reviewPanel.ready' });
  serial.rejectOpen();
  await serial.drain();
  expect(current.handleMessage.mock.calls.map(([message]) => message.type)).toEqual(['review.open']);
  expect(fake.panel.webview.postMessage).toHaveBeenCalledWith(expect.objectContaining({
    type: 'review.operationResult', operation: 'open', ok: false, message: 'Open failed' }));
  current.panel.dispose();
});

it('selects the requested file only after its open completes and consumes that intent once', async () => {
  const current = intentFixture();
  current.panel.open({ type: 'review.panel.open', sessionId: 's1', scopeKind: 'operations', turnId: 't1', path: 'b.ts' });
  expect(current.handleMessage).not.toHaveBeenCalled();
  fake.receive({ type: 'reviewPanel.ready' });
  expect(current.replayTo).toHaveBeenCalledOnce();
  await current.release(0);
  current.emit({ type: 'review.state', sequence: 10, state: operationScope() });
  expect(current.handleMessage.mock.calls.map(([message]) => message.type)).toEqual(['review.open']);
  current.finish(1, operationScope());
  expect(current.handleMessage).toHaveBeenLastCalledWith({ type: 'review.selectFile', sessionId: 's1',
    reviewScopeId: 'scope-t1', baseline: 'baseline-t1', path: 'b.ts' });
  current.finish(1, operationScope());
  expect(current.handleMessage).toHaveBeenCalledTimes(2);
  current.panel.dispose();
});

it('reports a missing selected file instead of selecting a different file', async () => {
  const current = intentFixture();
  current.panel.open({ type: 'review.panel.open', sessionId: 's1', scopeKind: 'operations', turnId: 't1', path: 'removed.ts' });
  fake.receive({ type: 'reviewPanel.ready' });
  await current.release(0);
  current.finish(1, operationScope());
  expect(current.handleMessage.mock.calls.map(([message]) => message.type)).toEqual(['review.open']);
  expect(fake.panel.webview.postMessage).toHaveBeenCalledWith({ type: 'reviewPanel.error',
    message: 'This file is no longer available in the selected review.' });
  current.panel.dispose();
});

it('opens one undo preview without sending a restore mutation', async () => {
  const current = intentFixture();
  current.panel.open({ type: 'review.panel.open', sessionId: 's1', scopeKind: 'operations', turnId: 't1', action: 'undo' });
  fake.receive({ type: 'reviewPanel.ready' });
  await current.release(0);
  current.finish(1, operationScope());
  current.finish(1, operationScope());
  expect(current.handleMessage.mock.calls.map(([message]) => message.type)).toEqual(['review.open', 'review.restorePreview']);
  expect(current.handleMessage).toHaveBeenLastCalledWith({ type: 'review.restorePreview', sessionId: 's1',
    reviewScopeId: 'scope-t1', baseline: 'baseline-t1', target: 'turn' });
  current.panel.dispose();
});

it.each(['t1', 't2'])('cancels an earlier open even when reopening %s before its replay arrives', async (nextTurnId) => {
  const current = intentFixture();
  current.panel.open({ type: 'review.panel.open', sessionId: 's1', scopeKind: 'operations', turnId: 't1', action: 'undo' });
  fake.receive({ type: 'reviewPanel.ready' });
  await current.release(0);
  current.panel.open({ type: 'review.panel.open', sessionId: 's1', scopeKind: 'operations', turnId: nextTurnId, action: 'undo' });
  current.finish(1, operationScope());
  await current.release(2);
  expect(current.handleMessage.mock.calls.map(([message]) => message.type)).toEqual(['review.open', 'review.open']);
  current.finish(3, operationScope(nextTurnId));
  expect(current.handleMessage).toHaveBeenLastCalledWith({ type: 'review.restorePreview', sessionId: 's1',
    reviewScopeId: `scope-${nextTurnId}`, baseline: `baseline-${nextTurnId}`, target: 'turn' });
  expect(current.handleMessage).toHaveBeenCalledTimes(3);
  current.panel.dispose();
});

it.each(['disconnect', 'scope-switch', 'close'] as const)('cancels a pending undo on %s', async (reason) => {
  const current = intentFixture();
  current.panel.open({ type: 'review.panel.open', sessionId: 's1', scopeKind: 'operations', turnId: 't1', action: 'undo' });
  fake.receive({ type: 'reviewPanel.ready' });
  await current.release(0);
  if (reason === 'disconnect') {
    current.state.connection.status = 'disconnected';
    current.emit({ type: 'host.snapshot' });
    current.state.connection.status = 'connected';
    current.emit({ type: 'host.snapshot' });
  } else if (reason === 'scope-switch') fake.receive({ type: 'review.open', sessionId: 's1', scopeKind: 'workspace' });
  else current.panel.dispose();
  current.finish(1, operationScope());
  expect(current.handleMessage.mock.calls.some(([message]) => message.type === 'review.restorePreview')).toBe(false);
  current.panel.dispose();
});

it('rejects undo while delegated operations are still writing and does not retry it on settlement', async () => {
  const current = intentFixture();
  current.panel.open({ type: 'review.panel.open', sessionId: 's1', scopeKind: 'operations', turnId: 't1', action: 'undo' });
  fake.receive({ type: 'reviewPanel.ready' });
  await current.release(0);
  current.finish(1, { ...operationScope(), lifecycle: 'writing' });
  current.finish(1, operationScope());
  expect(current.handleMessage.mock.calls.map(([message]) => message.type)).toEqual(['review.open']);
  expect(fake.panel.webview.postMessage).toHaveBeenCalledWith({ type: 'reviewPanel.error',
    message: 'Wait for this turn and its delegated operations to finish before undoing changes.' });
  current.panel.dispose();
});
