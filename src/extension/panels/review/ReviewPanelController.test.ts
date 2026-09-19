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
beforeEach(() => vi.clearAllMocks());
it('reuses its editor tab, scopes messages to Chat and never stops Chat when closed', async () => {
  const handleMessage = vi.fn();
  const state = { sessionId: 's1', activeRuntimeCwd: 'C:/work', connection: { status: 'connected' }, disposed: false };
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
