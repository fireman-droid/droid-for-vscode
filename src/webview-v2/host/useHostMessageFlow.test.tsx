// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { initialAssistantWebviewState } from '../state/initialState';
import { useHostMessageFlow } from './useHostMessageFlow';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('flushes a hidden-page backlog once on return without waiting for a throttled frame', () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  let hidden = true;
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  const dispatch = vi.fn();
  const handlers = {
    dispatch,
    getSequence: () => 0,
    observeTransitionMessage: vi.fn(),
    applyHostTheme: vi.fn(),
    appendCanvasDraft: vi.fn(),
    settleSend: vi.fn(),
  };
  renderHook(() =>
    useHostMessageFlow(
      { postMessage: vi.fn() },
      { ...initialAssistantWebviewState, sequence: 0 },
      handlers,
    ),
  );
  const messages = Array.from({ length: 100 }, (_, index) => ({
    type: 'assistant.delta',
    sequence: index + 1,
    sessionId: 'session',
    turnId: 'turn',
    delta: 'token ',
  }));
  act(() => {
    for (const message of messages)
      window.dispatchEvent(new MessageEvent('message', { data: message }));
  });
  expect(dispatch).not.toHaveBeenCalled();
  act(() => {
    hidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(dispatch).toHaveBeenCalledExactlyOnceWith({ type: 'host.batch', messages });
  act(() => vi.runOnlyPendingTimers());
  expect(dispatch).toHaveBeenCalledOnce();
});
import { createChatStore } from '../chat/store';
import { BRIDGE_PROTOCOL_VERSION } from '../../shared/bridgeMessages';
import type { WebviewToHostMessage } from '../../shared/bridgeMessages';

it('acknowledges only after real store application and leaves late dropped deltas unacknowledged', () => {
  vi.useFakeTimers();
  const store = createChatStore({ ...initialAssistantWebviewState, sequence: 0,
    sessionId: 'session', conversationId: 'conversation', connection: { status: 'connected' },
    turn: { turnId: 'turn', status: 'streaming' } });
  const postMessage = vi.fn((message: WebviewToHostMessage) => {
    if (message.type === 'webview.state-applied') {
      expect(store.getState().state.sequence).toBeGreaterThanOrEqual(Math.max(...message.sequences));
      expect(store.getState().state.transcript.some((item) => item.kind === 'assistant' && item.text === 'first third')).toBe(true);
    }
  });
  const port = { postMessage, getState: () => undefined, setState() {} };
  renderHook(() => useHostMessageFlow(port, store.getState().state, {
    dispatch: store.getState().dispatch, getSequence: () => store.getState().state.sequence,
    observeTransitionMessage: vi.fn(), applyHostTheme: vi.fn(), appendCanvasDraft: vi.fn(), settleSend: vi.fn(),
  }));
  const ready = postMessage.mock.calls.map(([message]) => message).find((message) => message.type === 'webview.ready')!;
  expect(ready).toMatchObject({ type: 'webview.ready', protocolVersion: BRIDGE_PROTOCOL_VERSION, pageId: expect.any(String) });
  const delta = (sequence: number, text: string) => window.dispatchEvent(new MessageEvent('message', { data: {
    type: 'assistant.delta', sequence, sessionId: 'session', turnId: 'turn', delta: text,
  } }));
  act(() => { delta(1, 'first '); delta(3, 'third'); vi.advanceTimersByTime(50); });
  const receipts = () => postMessage.mock.calls.map(([message]) => message).filter((message) => message.type === 'webview.state-applied');
  expect(receipts()).toEqual([{ type: 'webview.state-applied', pageId: (ready as {pageId: string}).pageId,
    sequences: [1, 3], snapshotSequence: null }]);
  act(() => { delta(2, 'late second'); vi.advanceTimersByTime(50); });
  expect(receipts()).toHaveLength(1);
});
