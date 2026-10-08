// @vitest-environment jsdom
import { useEffect, useRef } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { assistantWebviewReducer } from '../../state/store';
import { initialAssistantWebviewState } from '../../state/initialState';
import { useLocalImageSource, useLocalImageVisit } from './localImageSource';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('isolates remote image responses and pending requests when the active session changes', () => {
  const path = 'https://images.example.test/chart.png';
  const port = { postMessage: vi.fn() };
  let state = { ...initialAssistantWebviewState, sessionId: 'session-a' };
  function View() {
    const source = useLocalImageSource(port, state.sessionId, 'connected', state.localImages);
    useEffect(() => source.request(path), [source.request]);
    return null;
  }
  const { rerender } = render(<View />);
  expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'workspace.readImage', sessionId: 'session-a', path });
  state = { ...initialAssistantWebviewState, sessionId: 'session-b' };
  rerender(<View />);
  expect(port.postMessage).toHaveBeenLastCalledWith({ type: 'workspace.readImage', sessionId: 'session-b', path });
  const message = { type: 'workspace.imageData' as const, sequence: 1, sessionId: 'session-a', path,
    status: 'ok' as const, mediaType: 'image/png' as const, data: 'aGk=' };
  state = assistantWebviewReducer(state, { type: 'host.message', message });
  expect(state.localImages[path]).toBeUndefined();
  state = assistantWebviewReducer(state, { type: 'host.message', message: { ...message, sequence: 2, sessionId: 'session-b' } });
  expect(state.localImages[path]?.data).toBe('aGk=');
  rerender(<View />);
  expect(port.postMessage).toHaveBeenCalledTimes(2);
});

it('coalesces pending reads, allows a new visible visit after eviction, and does not loop while visible', () => {
  const observers: Array<IntersectionObserverCallback> = [];
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  const port = { postMessage: vi.fn() };
  let state = { ...initialAssistantWebviewState, sessionId: 'session-a' };
  function View() {
    const source = useLocalImageSource(
      port,
      state.sessionId,
      'connected',
      state.localImages,
    );
    const first = useRef<HTMLSpanElement | null>(null);
    const second = useRef<HTMLSpanElement | null>(null);
    useLocalImageVisit(first, 'first.png', source.request);
    useLocalImageVisit(second, 'first.png', source.request);
    return (
      <>
        <span ref={first} />
        <span ref={second} />
      </>
    );
  }
  const visit = (index: number, visible: boolean) =>
    act(() => {
      observers[index]!(
        [{ isIntersecting: visible } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      );
    });
  const { rerender } = render(<View />);
  visit(0, true);
  visit(1, true);
  expect(port.postMessage).toHaveBeenCalledTimes(1);
  const reply = (path: string, sequence: number) => {
    const message = {
      type: 'workspace.imageData' as const,
      sequence,
      sessionId: 'session-a',
      path,
      status: 'ok' as const,
      mediaType: 'image/png' as const,
      data: 'aGk=',
    };
    act(() => window.dispatchEvent(new MessageEvent('message', { data: message })));
    state = assistantWebviewReducer(state, { type: 'host.message', message });
  };
  reply('first.png', 1);
  for (let i = 0; i < 24; i++) reply(`image-${i}.png`, i + 2);
  expect(state.localImages['first.png']).toBeUndefined();
  rerender(<View />);
  expect(port.postMessage).toHaveBeenCalledTimes(1);
  visit(0, false);
  visit(0, true);
  expect(port.postMessage).toHaveBeenCalledTimes(2);
  reply('first.png', 26);
  rerender(<View />);
  visit(0, false);
  visit(0, true);
  expect(port.postMessage).toHaveBeenCalledTimes(2);
});
