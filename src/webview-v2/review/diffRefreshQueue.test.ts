import { afterEach, expect, it, vi } from 'vitest';
import { createDiffRefreshQueue } from './diffRefreshQueue';

afterEach(() => vi.useRealTimers());

function queueFixture() {
  let sequence = 0;
  const send = vi.fn();
  const receive = vi.fn();
  const queue = createDiffRefreshQueue<string>({ createId: () => String(++sequence), send, receive, pending: vi.fn(), timeout: vi.fn() });
  return { queue, send, receive };
}

it('shows live snapshots and keeps reading while files change continuously', () => {
  vi.useFakeTimers();
  const { queue, send, receive } = queueFixture();
  queue.refresh(0);
  queue.refresh();
  vi.advanceTimersByTime(100);
  queue.refresh();
  queue.receive('1', 'first live snapshot');
  expect(receive).toHaveBeenLastCalledWith('first live snapshot');
  vi.advanceTimersByTime(100);
  expect(send).toHaveBeenLastCalledWith('2');
  queue.refresh();
  queue.receive('2', 'newer live snapshot');
  expect(receive).toHaveBeenLastCalledWith('newer live snapshot');
  vi.advanceTimersByTime(200);
  expect(send).toHaveBeenLastCalledWith('3');
  queue.dispose();
});

it('discards a live response after settlement and preserves response order', () => {
  vi.useFakeTimers();
  const { queue, send, receive } = queueFixture();
  queue.refresh(0);
  queue.refresh(0, true);
  queue.receive('1', 'obsolete live snapshot');
  expect(receive).not.toHaveBeenCalled();
  expect(send).toHaveBeenLastCalledWith('2');
  queue.receive('2', 'completed snapshot');
  queue.receive('1', 'late live duplicate');
  expect(receive.mock.calls).toEqual([['completed snapshot']]);
  queue.dispose();
});
