import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompletionRequests } from './CompletionRequests';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe('completion request handoffs', () => {
  it('retains a result that completes between cancelled and replacement readers', async () => {
    vi.useFakeTimers();
    const pool = new CompletionRequests(), output = deferred<string>();
    const firstReader = new AbortController(), nextReader = new AbortController();
    const start = vi.fn(() => output.promise);
    const first = pool.run('file', 'const x = ', ';', firstReader.signal, start).catch(error => error.name);
    firstReader.abort();
    expect(await first).toBe('AbortError');
    await vi.advanceTimersByTimeAsync(50);
    output.resolve('calculate()');
    await vi.advanceTimersByTimeAsync(25);
    const release = pool.reserve('file', 'const x = cal', ';', nextReader.signal);
    expect(release).toBeDefined();
    await vi.advanceTimersByTimeAsync(150);
    expect(await pool.run('file', 'const x = cal', ';', nextReader.signal, start)).toBe('culate()');
    expect(start).toHaveBeenCalledOnce();
    release?.(); pool.clear();
  });

  it('starts fresh work after a retained suggestion is fully consumed', async () => {
    const pool = new CompletionRequests(), reader = new AbortController();
    const start = vi.fn().mockResolvedValueOnce('value').mockResolvedValueOnce(' + 1');
    expect(await pool.run('file', 'x = ', ';', reader.signal, start)).toBe('value');
    expect(await pool.run('file', 'x = value', ';', reader.signal, start)).toBe(' + 1');
    expect(start).toHaveBeenCalledTimes(2); pool.clear();
  });

  it('keeps a genuinely empty result without repeatedly starting new work', async () => {
    const pool = new CompletionRequests(), reader = new AbortController();
    const start = vi.fn(async () => '');
    expect(await pool.run('file', 'if', '', reader.signal, start)).toBe('');
    expect(await pool.run('file', 'if', '', reader.signal, start)).toBe('');
    expect(start).toHaveBeenCalledOnce(); pool.clear();
  });

  it('expires a completed result within the same 100ms handoff window', async () => {
    vi.useFakeTimers();
    const pool = new CompletionRequests(), reader = new AbortController();
    const start = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    expect(await pool.run('file', 'x = ', ';', reader.signal, start)).toBe('old');
    await vi.advanceTimersByTimeAsync(100);
    expect(await pool.run('file', 'x = ', ';', reader.signal, start)).toBe('new');
    expect(start).toHaveBeenCalledTimes(2); pool.clear();
  });

  it('bounds an editor refresh handoff and restores the normal window after joining', async () => {
    vi.useFakeTimers();
    const pool = new CompletionRequests(), output = deferred<string>();
    const firstReader = new AbortController(), nextReader = new AbortController();
    let transport!: AbortSignal;
    const start = vi.fn((signal: AbortSignal) => { transport = signal; return output.promise; });
    const first = pool.run('file', 'x = ', ';', firstReader.signal, start).catch(error => error.name);
    pool.retainForEditorRefresh(); firstReader.abort();
    expect(await first).toBe('AbortError');
    await vi.advanceTimersByTimeAsync(180);
    expect(transport.aborted).toBe(false);
    const next = pool.run('file', 'x = ', ';', nextReader.signal, start).catch(error => error.name);
    nextReader.abort(); expect(await next).toBe('AbortError');
    await vi.advanceTimersByTimeAsync(100);
    expect(transport.aborted).toBe(true);
    expect(start).toHaveBeenCalledOnce(); pool.clear();
  });

  it('aborts an abandoned editor refresh after 250ms', async () => {
    vi.useFakeTimers();
    const pool = new CompletionRequests(), reader = new AbortController();
    let transport!: AbortSignal;
    const pending = pool.run('file', 'x = ', ';', reader.signal, signal => {
      transport = signal; return new Promise(() => {});
    }).catch(error => error.name);
    pool.retainForEditorRefresh(); reader.abort();
    expect(await pending).toBe('AbortError');
    await vi.advanceTimersByTimeAsync(249); expect(transport.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1); expect(transport.aborted).toBe(true);
    pool.clear();
  });

  it('does not preserve a failed request for a later reader', async () => {
    const pool = new CompletionRequests(), reader = new AbortController();
    const start = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce('retry');
    await expect(pool.run('file', 'if', '', reader.signal, start)).rejects.toThrow('unavailable');
    expect(await pool.run('file', 'if', '', reader.signal, start)).toBe('retry');
    expect(start).toHaveBeenCalledTimes(2); pool.clear();
  });

  it('does not restore cleared work when its old factory finishes late', async () => {
    const pool = new CompletionRequests(), output = deferred<string>();
    const firstReader = new AbortController(), nextReader = new AbortController();
    let oldSignal!: AbortSignal;
    const first = pool.run('file', 'if', '', firstReader.signal, signal => {
      oldSignal = signal; return output.promise;
    }).catch(error => error.name);
    firstReader.abort(); pool.clear();
    expect(await first).toBe('AbortError');
    expect(oldSignal.aborted).toBe(true);
    const start = vi.fn(async () => 'fresh');
    expect(await pool.run('file', 'if', '', nextReader.signal, start)).toBe('fresh');
    output.resolve('obsolete');
    await output.promise;
    expect(await pool.run('file', 'if', '', nextReader.signal, start)).toBe('fresh');
    expect(start).toHaveBeenCalledOnce(); pool.clear();
  });

  it.each([['different-file', ';'], ['file', ')']])('does not reuse completed work across scope/suffix changes: %s %s', async (scope, suffix) => {
    const pool = new CompletionRequests(), reader = new AbortController();
    const start = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');
    expect(await pool.run('file', 'x = ', ';', reader.signal, start)).toBe('old');
    expect(await pool.run(scope, 'x = ', suffix, reader.signal, start)).toBe('new');
    expect(start).toHaveBeenCalledTimes(2); pool.clear();
  });
});
