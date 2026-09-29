import { afterEach, describe, expect, it, vi } from 'vitest';
import { CompletionHistory } from './CompletionHistory';
import { CompletionRequests } from './CompletionRequests';
import { ErrorBackoff } from './kilo/ErrorBackoff';
import { calcDebounceDelay } from './kilo/inline-utils';
import { FimCompletionError } from '../../runtime/autocomplete/completionTransport';

afterEach(() => vi.useRealTimers());
describe('Kilo completion history and scheduling', () => {
  it('reuses exact, forward-typed and backspaced suggestions without crossing scopes or suffixes', () => {
    const h = new CompletionHistory(); h.put('a', 'const x = ', ';', 'calculate()', 100);
    expect(h.find('a', 'const x = cal', ';', 200)).toBe('culate()');
    expect(h.find('a', 'const x =', ';', 200)).toBe(' calculate()');
    expect(h.find('b', 'const x = ', ';', 200)).toBeUndefined();
    expect(h.find('a', 'const x = ', 'other', 200)).toBeUndefined();
    expect(h.find('a', 'const x = ', ';', 30_101)).toBeUndefined();
  });
  it('keeps only the latest 20 suggestions and does not reuse empty rejections after deleting', () => {
    const h = new CompletionHistory();
    for (let i = 0; i < 21; i++) h.put('file'+i, 'x', '', 'y', 100);
    expect(h.find('file0', 'x', '', 101)).toBeUndefined();
    h.put('rejected', 'xyz', '', '', 100);
    expect(h.find('rejected', 'xy', '', 101)).toBeUndefined();
  });
  it('adapts latency while bounding the typing delay', () => {
    expect(calcDebounceDelay([])).toBe(150);
    expect(calcDebounceDelay([200, 400])).toBe(300);
    expect(calcDebounceDelay([9000])).toBe(1000);
  });
  it('stops authentication failures until reset and backs off repeated service failures', () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const b = new ErrorBackoff();
    b.failure(new FimCompletionError('http','safe',401)); vi.advanceTimersByTime(999_999);
    expect(b.blocked()).toBe(true); b.reset(); expect(b.blocked()).toBe(false);
    b.failure(new FimCompletionError('network','safe')); expect(b.blocked()).toBe(true);
    vi.advanceTimersByTime(2000); expect(b.blocked()).toBe(false);
    b.failure(new FimCompletionError('http','safe',429)); vi.advanceTimersByTime(3999);
    expect(b.blocked()).toBe(true); vi.advanceTimersByTime(1); expect(b.blocked()).toBe(false);
    b.success(); expect(b.blocked()).toBe(false);
  });
});

function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(r=>resolve=r); return { promise, resolve }; }
describe('in-flight completion handoff', () => {
  it('shares one transport and returns only the untyped remainder', async () => {
    const pool=new CompletionRequests(), result=deferred<string>();
    const start=vi.fn(()=>result.promise), a=new AbortController(), b=new AbortController();
    const first=pool.run('file','x=',';',a.signal,start);
    const firstResult=first.catch(e=>e.name);
    a.abort();
    const second=pool.run('file','x=hel',';',b.signal,start);
    result.resolve('hello');
    expect(await firstResult).toBe('AbortError');
    expect(await second).toBe('lo'); expect(start).toHaveBeenCalledTimes(1); pool.clear();
  });
  it('requests the new context when a shared reply no longer matches the typed token', async () => {
    const pool=new CompletionRequests(), result=deferred<string>(), a=new AbortController(), b=new AbortController();
    const first=pool.run('file','x=',';',a.signal,()=>result.promise);
    const firstResult=first.catch(e=>e.name); a.abort();
    const start=vi.fn(async()=> 'correct');
    const second=pool.run('file','x=4',';',b.signal,start); result.resolve('wrong');
    expect(await firstResult).toBe('AbortError'); expect(await second).toBe('correct');
    expect(start).toHaveBeenCalledTimes(1); pool.clear();
  });
  it('retains a compatible transport across context work longer than the handoff window', async () => {
    vi.useFakeTimers();
    const pool=new CompletionRequests(), result=deferred<string>(), a=new AbortController(), b=new AbortController();
    const start=vi.fn(()=>result.promise);
    const first=pool.run('file','x=',';',a.signal,start).catch(e=>e.name);
    a.abort();
    const release=pool.reserve('file','x=he',';',b.signal);
    expect(release).toBeDefined();
    await vi.advanceTimersByTimeAsync(300);
    result.resolve('hello');
    await vi.advanceTimersByTimeAsync(100);
    const second=await pool.run('file','x=he',';',b.signal,start);
    release?.();
    expect(await first).toBe('AbortError'); expect(second).toBe('llo');
    expect(start).toHaveBeenCalledTimes(1); pool.clear();
  });
  it('aborts an abandoned network request within the handoff window', async () => {
    vi.useFakeTimers(); const pool=new CompletionRequests(), source=new AbortController();
    let transport!: AbortSignal;
    const result=pool.run('a','x','',source.signal,signal=>{ transport=signal;return new Promise(()=>{}); });
    const caught=result.catch(e=>e.name); source.abort(); expect(await caught).toBe('AbortError');
    await vi.advanceTimersByTimeAsync(100); expect(transport.aborted).toBe(true); pool.clear();
  });
});
