import { expect, it, vi } from 'vitest';
import { navigateHistory } from './historyNavigation';
import { SessionHistoryWindow } from '../../../runtime/history/SessionHistoryWindow';
import { projectSessionMessages } from '../../../runtime/history/projectSessionHistory';
import type { ChatController } from '../ChatController';
import type { SessionHistoryResult } from '../../../runtime/history/SessionHistory';

it('deduplicates in-flight page requests and ignores a response after switching sessions', async () => {
  const row = { id: 'm1', role: 'user', createdAt: 1, content: [{ type: 'text', text: 'saved' }] };
  const projected = projectSessionMessages([row], { sourceSessionId: 'session' });
  if (projected.status !== 'available') throw new Error('fixture');
  const result = { ...projected, page: { messages: [row], nextCursor: 'next' } };
  let resolve!: (value: SessionHistoryResult) => void;
  const loader = { loadHistory: vi.fn(async () => result as SessionHistoryResult) };
  const window = new SessionHistoryWindow(loader, '/workspace', ['session']);
  await window.open();
  loader.loadHistory.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const ctl = { sessionState: { sessionId: 'session', runtimeGeneration: 1, disposed: false },
    recoveryState: { historyWindow: window, historyView: window.snapshot(), transcript: projected.state },
    sessionHistory: loader, emit: vi.fn(), recoveryStore: {} } as unknown as ChatController;
  const request = { type: 'history.navigate', sessionId: 'session', version: window.version,
    revision: window.snapshot()!.revision, direction: 'older' } as const;
  const first = navigateHistory(ctl, request);
  await navigateHistory(ctl, request);
  expect(loader.loadHistory).toHaveBeenCalledTimes(2);
  ctl.sessionState.sessionId = 'other';
  resolve({ ...result, page: { messages: [], nextCursor: null } });
  await first;
  expect(ctl.emit).toHaveBeenCalledTimes(1);
});
