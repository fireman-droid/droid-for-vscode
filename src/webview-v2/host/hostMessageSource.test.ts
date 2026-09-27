// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { subscribeHostMessages } from './hostMessageSource';

it('reports a rejected transcript message without its contents and keeps receiving later messages', () => {
  const received = vi.fn();
  const rejected = vi.fn();
  const unsubscribe = subscribeHostMessages(received, rejected);
  try {
    window.dispatchEvent(new MessageEvent('message', { data: {
      type: 'host.snapshot', sequence: 12, transcript: 'private malformed payload',
    } }));
    const next = { type: 'assistant.delta', sequence: 13, sessionId: 'session', turnId: 'turn', delta: 'Continued reply' };
    window.dispatchEvent(new MessageEvent('message', { data: next }));
    expect(rejected).toHaveBeenCalledExactlyOnceWith({ type: 'host.snapshot', sequence: 12 });
    expect(received).toHaveBeenCalledExactlyOnceWith(next);
  } finally {
    unsubscribe();
  }
});
