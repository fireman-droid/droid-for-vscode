import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { forwardRecoverableIdeEvents } from './recoverableIdeEventStream';

function response() {
  return Object.assign(new EventEmitter(), {
    statusCode: 200, headers: { 'content-type': 'text/event-stream' },
    destroy: vi.fn(), pause: vi.fn(), resume: vi.fn(),
  });
}

function fixture(timeout = 1000) {
  const initial = response();
  const downstream = Object.assign(new EventEmitter(), { destroy: vi.fn(), write: vi.fn(() => true) });
  const request = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() });
  const retries: typeof request[] = [];
  const options = {
    initial: initial as unknown as IncomingMessage,
    request: request as unknown as ClientRequest,
    downstream: downstream as unknown as ServerResponse,
    recoveryTimeoutMs: timeout,
    canRecover: vi.fn(() => true), interrupted: vi.fn(), restored: vi.fn(), frame: vi.fn(), closed: vi.fn(),
    connect: vi.fn((_cursor: string | undefined) => {
      const retry = Object.assign(new EventEmitter(), { destroy: vi.fn(), end: vi.fn() });
      retries.push(retry);
      return retry as unknown as ClientRequest;
    }),
  };
  forwardRecoverableIdeEvents(options);
  return { initial, downstream, request, retries, options };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('recoverable native event stream', () => {
  it('waits for whole UTF-8 frames and resumes from delivered ids, including a cursor reset', async () => {
    const state = fixture();
    const first = Buffer.from('id: cursor-1\r\ndata: {"text":"进度"}\r\n\r\n');
    const split = first.indexOf(Buffer.from('进')) + 1;
    state.initial.emit('data', first.subarray(0, split));
    expect(state.downstream.write).not.toHaveBeenCalled();
    state.initial.emit('data', first.subarray(split));
    state.initial.emit('data', Buffer.from('id: unsent\ndata: incomplete'));
    state.initial.emit('end');
    await vi.advanceTimersByTimeAsync(200);
    expect(state.options.connect).toHaveBeenCalledExactlyOnceWith('cursor-1');
    expect(state.downstream.write).toHaveBeenCalledExactlyOnceWith(first.toString('utf8'));
    const restored = response();
    state.retries[0]!.emit('response', restored);
    restored.emit('data', Buffer.from('id:\n\n'));
    restored.emit('end');
    await vi.advanceTimersByTimeAsync(400);
    expect(state.options.connect).toHaveBeenLastCalledWith(undefined);
    expect(state.downstream.destroy).not.toHaveBeenCalled();
    state.downstream.emit('close');
  });

  it('bounds a replacement GET that never responds and closes both sides once', async () => {
    const state = fixture(600);
    state.initial.emit('aborted');
    state.initial.emit('end');
    await vi.advanceTimersByTimeAsync(200);
    expect(state.options.connect).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(400);
    expect(state.options.closed).toHaveBeenCalledOnce();
    expect(state.downstream.destroy).toHaveBeenCalledOnce();
    expect(state.retries[0]!.destroy).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(state.options.connect).toHaveBeenCalledOnce();
  });

  it('stops after five accepted-but-empty replacement streams instead of reconnecting forever', async () => {
    const state = fixture(10_000);
    state.initial.emit('end');
    for (const delay of [200, 400, 800, 1600, 2000]) {
      await vi.advanceTimersByTimeAsync(delay);
      const stream = response();
      state.retries.at(-1)!.emit('response', stream);
      stream.emit('data', Buffer.from(': connected\n\n'));
      stream.emit('end');
    }
    expect(state.options.connect).toHaveBeenCalledTimes(5);
    expect(state.options.closed).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state.options.connect).toHaveBeenCalledTimes(5);
  });

  it('retries a failed recovery GET within its original deadline', async () => {
    const state = fixture(700);
    state.initial.emit('end');
    await vi.advanceTimersByTimeAsync(200);
    state.retries[0]!.emit('error', new Error('ECONNRESET'));
    await vi.advanceTimersByTimeAsync(400);
    expect(state.options.connect).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(100);
    expect(state.options.closed).toHaveBeenCalledOnce();
  });

  it('cancels pending recovery when the native downstream closes', async () => {
    const state = fixture();
    state.initial.emit('end');
    state.downstream.emit('close');
    await vi.advanceTimersByTimeAsync(2000);
    expect(state.options.connect).not.toHaveBeenCalled();
    expect(state.options.closed).toHaveBeenCalledOnce();
    expect(state.downstream.listenerCount('drain')).toBe(0);
  });

  it('rejects a late response belonging to a retired relay generation', async () => {
    const state = fixture();
    state.initial.emit('end');
    await vi.advanceTimersByTimeAsync(200);
    state.options.canRecover.mockReturnValue(false);
    const late = response();
    state.retries[0]!.emit('response', late);
    expect(late.destroy).toHaveBeenCalled();
    expect(state.options.restored).not.toHaveBeenCalled();
    expect(state.options.closed).toHaveBeenCalledOnce();
  });
});
