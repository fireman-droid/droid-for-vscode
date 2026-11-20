import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompletionRequests } from './CompletionRequests';

afterEach(() => vi.useRealTimers());

describe('Kilo classic pending requests', () => {
  it('joins a pending request for a continuing prefix and unchanged suffix', async () => {
    const requests = new CompletionRequests();
    const fetch = vi.fn(async () => {});
    const leading = requests.run('a', 'const value = ', ';', 300, false, fetch);
    const covering = requests.run('a', 'const value = 4', ';', 300, false, fetch);
    expect(covering).toBe(leading);
    await covering;
    expect(fetch).toHaveBeenCalledOnce();
    requests.clear();
  });

  it('uses a leading edge, coalesces incompatible work on the trailing edge and settles superseded waiters', async () => {
    vi.useFakeTimers();
    const requests = new CompletionRequests();
    const fetch = vi.fn(async () => {});
    await requests.run('a', 'x', 'first', 300, false, fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    const superseded = requests.run('a', 'x', 'second', 300, false, fetch);
    await vi.advanceTimersByTimeAsync(200);
    const trailing = requests.run('a', 'x', 'third', 300, false, fetch);
    await superseded;
    await vi.advanceTimersByTimeAsync(299);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await trailing;
    expect(fetch).toHaveBeenCalledTimes(2);
    await requests.run('a', 'x', 'fourth', 300, false, fetch);
    expect(fetch).toHaveBeenCalledTimes(3);
    requests.clear();
  });

  it('aborts an in-flight request and settles a trailing request on reset', async () => {
    vi.useFakeTimers();
    const requests = new CompletionRequests();
    let finish!: () => void;
    const fetch = vi.fn((_signal: AbortSignal) => new Promise<void>(resolve => { finish = resolve; }));
    const leading = requests.run('a', 'x', 'first', 300, false, fetch);
    const trailing = requests.run('a', 'x', 'second', 300, false, fetch);
    requests.clear();
    expect(fetch.mock.calls[0][0].aborted).toBe(true);
    finish();
    await Promise.all([leading, trailing]);
    await vi.advanceTimersByTimeAsync(300);
    expect(fetch).toHaveBeenCalledOnce();
  });
});
