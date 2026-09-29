import { findCoveringPendingRequest } from './kilo/inline-utils';
import type { PendingRequest } from './kilo/types';
type Request = PendingRequest & {
  controller: AbortController; promise: Promise<string>; readers: number; settled?: boolean;
  cancelTimer?: ReturnType<typeof setTimeout>;
};
/** Shares a compatible Kilo-style pending request across consecutive editor invocations. */
export class CompletionRequests {
  private current?: Request;
  /** Retain compatible work while the next invocation checks policy and gathers context. */
  reserve(scope: string, prefix: string, suffix: string, signal: AbortSignal): (() => void) | undefined {
    const request = findCoveringPendingRequest(scope, prefix, suffix,
      this.current && !this.current.controller.signal.aborted ? [this.current] : []) as Request | null;
    if (!request || signal.aborted) return undefined;
    if (request.cancelTimer) clearTimeout(request.cancelTimer);
    request.readers++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      signal.removeEventListener('abort', release);
      this.release(request);
    };
    signal.addEventListener('abort', release, { once: true });
    return release;
  }
  private release(request: Request): void {
    request.readers--;
    if (request.readers !== 0 || this.current !== request) return;
    if (request.settled) { this.current = undefined; return; }
    request.cancelTimer = setTimeout(() => {
      if (request.readers === 0 && this.current === request) this.clear();
    }, 100);
  }
  async run(scope: string, prefix: string, suffix: string, signal: AbortSignal,
    start: (signal: AbortSignal) => Promise<string>): Promise<string> {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    let request = findCoveringPendingRequest(scope, prefix, suffix,
      this.current && !this.current.controller.signal.aborted ? [this.current] : []) as Request | null;
    if (!request) {
      this.clear();
      const controller = new AbortController();
      request = { scope, prefix, suffix, controller, readers: 0, promise: Promise.resolve('') };
      const created = request;
      created.promise = start(controller.signal).finally(() => {
        if (created.cancelTimer) clearTimeout(created.cancelTimer);
        created.settled = true;
        if (this.current === created && created.readers === 0) this.current = undefined;
      });
      void created.promise.catch(() => undefined);
      this.current = created;
    }
    if (request.cancelTimer) clearTimeout(request.cancelTimer);
    request.readers++;
    const captured = request;
    let rejectCancelled: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      rejectCancelled = () => reject(new DOMException('Cancelled', 'AbortError'));
      signal.addEventListener('abort', rejectCancelled, { once: true });
    });
    try {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const text = await Promise.race([captured.promise, cancelled]);
      const typed = prefix.slice(captured.prefix.length);
      if (text.startsWith(typed)) return text.slice(typed.length);
      if (this.current === captured) this.clear();
      return this.run(scope, prefix, suffix, signal, start);
    } finally {
      if (rejectCancelled) signal.removeEventListener('abort', rejectCancelled);
      this.release(captured);
    }
  }
  clear(): void {
    const request = this.current;
    this.current = undefined;
    if (request?.cancelTimer) clearTimeout(request.cancelTimer);
    request?.controller.abort();
  }
}
