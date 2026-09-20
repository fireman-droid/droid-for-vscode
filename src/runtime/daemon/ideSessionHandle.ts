import type { DaemonSessionHandle, DaemonStreamOptions } from './api';

/** Hold submissions until this session's own native IDE channel is ready. */
export function bindSessionIde(
  session: DaemonSessionHandle,
  wait: (signal: AbortSignal) => Promise<void>,
): DaemonSessionHandle {
  const pending = new Set<AbortController>();
  async function* stream(prompt: string, options: DaemonStreamOptions = {}) {
    const cancellation = new AbortController();
    const abort = () => cancellation.abort(options.abortSignal?.reason);
    options.abortSignal?.addEventListener('abort', abort, { once: true });
    if (options.abortSignal?.aborted) abort();
    pending.add(cancellation);
    try {
      await session.ensureLoaded(cancellation.signal);
      cancellation.signal.throwIfAborted();
      await wait(cancellation.signal);
      cancellation.signal.throwIfAborted();
      if (options.includePartialMessages) {
        yield* session.stream(prompt, { ...options, includePartialMessages: true });
      } else {
        yield* session.stream(prompt, { ...options, includePartialMessages: false });
      }
    } finally {
      pending.delete(cancellation);
      options.abortSignal?.removeEventListener('abort', abort);
    }
  }
  return new Proxy(session, {
    get(target, name) {
      if (name === 'stream') return stream;
      const value: unknown = Reflect.get(target, name, target);
      if (typeof value !== 'function') return value;
      if (name === 'interrupt' || name === 'close' || name === 'detach') {
        return (...args: unknown[]) => {
          for (const cancellation of pending) cancellation.abort();
          return Reflect.apply(value, target, args);
        };
      }
      return value.bind(target);
    },
  });
}
