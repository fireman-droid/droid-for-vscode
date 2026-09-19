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
