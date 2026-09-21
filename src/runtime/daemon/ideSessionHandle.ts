import { ConcurrentStreamError } from '@factory/droid-sdk';
import type { DaemonSessionHandle, DaemonStreamOptions } from './api';

/** Hold submissions until this session's own native IDE channel is ready. */
export function bindSessionIde(
  session: DaemonSessionHandle,
  wait: (signal: AbortSignal) => Promise<void>,
  prepare?: (session: DaemonSessionHandle, signal: AbortSignal) => Promise<DaemonSessionHandle>,
): DaemonSessionHandle {
  let current = session;
  let detached = false;
  let releasing: Promise<void> | undefined;
  let streaming = false;
  const pending = new Set<AbortController>();
  const preparations = new Set<Promise<DaemonSessionHandle>>();
  const subscriptions = new Map<(notification: Record<string, unknown>) => void, () => void>();
  const replace = (next: DaemonSessionHandle): DaemonSessionHandle => {
    if (next === current) return current;
    for (const unsubscribe of subscriptions.values()) unsubscribe();
    current = next;
    for (const listener of subscriptions.keys()) subscriptions.set(listener, current.onNotification(listener));
    return current;
  };
  const cancelPending = (): boolean => {
    const hadPending = pending.size > 0;
    for (const cancellation of pending) cancellation.abort();
    return hadPending;
  };
  const onNotification = (listener: (notification: Record<string, unknown>) => void): (() => void) => {
    if (detached || releasing) throw new Error('Session handle is closing or detached');
    // Each registration keeps its own identity even when callers reuse a callback.
    const receive = (notification: Record<string, unknown>) => { if (!detached && !releasing) listener(notification); };
    subscriptions.set(receive, current.onNotification(receive));
    return () => { subscriptions.get(receive)?.(); subscriptions.delete(receive); };
  };
  const release = (method: 'close' | 'detach'): Promise<void> => {
    if (releasing) return releasing;
    if (detached) return Promise.resolve();
    cancelPending();
    // A source may already have closed when cancellation arrives. Let its
    // replacement finish attaching, then release the handle that actually owns it.
    const attempt = (async () => {
      await Promise.allSettled(preparations);
      await current[method]();
      detached = true;
      for (const unsubscribe of subscriptions.values()) unsubscribe();
      subscriptions.clear();
    })();
    releasing = attempt;
    // A rejected close RPC leaves the raw handle attached and remains retryable.
    const clear = () => { if (releasing === attempt) releasing = undefined; };
    void attempt.then(clear, clear);
    return attempt;
  };
  async function* stream(prompt: string, options: DaemonStreamOptions = {}) {
    if (detached || releasing) throw new Error('Session handle is closing or detached');
    if (streaming) throw new ConcurrentStreamError(current.id);
    streaming = true;
    const cancellation = new AbortController();
    const abort = () => cancellation.abort(options.abortSignal?.reason);
    options.abortSignal?.addEventListener('abort', abort, { once: true });
    if (options.abortSignal?.aborted) abort();
    pending.add(cancellation);
    try {
      const preparing = (async () => {
        await current.ensureLoaded(cancellation.signal);
        cancellation.signal.throwIfAborted();
        return replace(prepare ? await prepare(current, cancellation.signal) : current);
      })();
      preparations.add(preparing);
      let ready: DaemonSessionHandle;
      try { ready = await preparing; }
      finally { preparations.delete(preparing); }
      cancellation.signal.throwIfAborted();
      await wait(cancellation.signal);
      cancellation.signal.throwIfAborted();
      pending.delete(cancellation);
      // Pin this admitted turn to its worker. Recovery never resends an admitted prompt.
      if (options.includePartialMessages) {
        yield* ready.stream(prompt, { ...options, includePartialMessages: true });
      } else {
        yield* ready.stream(prompt, { ...options, includePartialMessages: false });
      }
    } catch (error) {
      cancellation.signal.throwIfAborted();
      throw error;
    } finally {
      streaming = false;
      pending.delete(cancellation);
      options.abortSignal?.removeEventListener('abort', abort);
    }
  }
  return new Proxy(session, {
    get(_target, name) {
      if (name === 'stream') return stream;
      if (name === 'onNotification') return onNotification;
      if (name === 'close' || name === 'detach') return () => release(name);
      if (name === 'interrupt') return async () => {
        // No prompt reached the daemon during preparation; cancelling it must
        // not interrupt child tasks or address a source that has already closed.
        if (!cancelPending()) await current.interrupt();
      };
      const value: unknown = Reflect.get(current, name, current);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => Reflect.apply(Reflect.get(current, name, current), current, args);
    },
  });
}
