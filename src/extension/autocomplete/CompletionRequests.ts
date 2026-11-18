/*! Adapted from Kilo Code 54de37a85dfef8feb828382d8a71f84139857121
 * (classic-auto-complete/AutocompleteInlineCompletionProvider.ts: debouncedFetchAndCacheSuggestion).
 * MIT; see third-party/KILO-LICENSE.txt.
 */
import { findCoveringPendingRequest } from './kilo/inline-utils';
import type { PendingRequest } from './kilo/types';

export class CompletionRequests {
  private readonly pendingRequests: PendingRequest[] = [];
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private debouncedPendingRequest?: PendingRequest;
  private isFirstCall = true;
  private readonly controllers = new Map<string, AbortController>();

  /** Leading/trailing debounce and covering-request reuse from Kilo classic. */
  run(scope: string, prefix: string, suffix: string, delayMs: number, immediate: boolean,
    fetchAndCache: (signal: AbortSignal) => Promise<void>): Promise<void> {
    const coveringRequest = findCoveringPendingRequest(scope, prefix, suffix, this.pendingRequests);
    if (coveringRequest) return coveringRequest.promise;

    if (immediate || this.isFirstCall && this.debounceTimer === undefined) {
      this.isFirstCall = false;
      if (immediate) this.settleDebouncedPendingRequest();
      const promise = this.fetch(scope, fetchAndCache);
      const leading: PendingRequest = { scope, prefix, suffix, promise };
      void promise.then(() => this.removePendingRequest(leading), () => this.removePendingRequest(leading));
      this.pendingRequests.push(leading);
      return promise;
    }

    this.settleDebouncedPendingRequest();
    const pendingRequest: PendingRequest = { scope, prefix, suffix, promise: undefined! };
    pendingRequest.promise = new Promise<void>((resolve, reject) => {
      pendingRequest.resolve = resolve;
      this.debounceTimer = setTimeout(() => {
        this.debounceTimer = undefined;
        this.debouncedPendingRequest = undefined;
        this.isFirstCall = true;
        this.fetch(scope, fetchAndCache).then(resolve, reject);
      }, delayMs);
    }).finally(() => this.removePendingRequest(pendingRequest));
    this.debouncedPendingRequest = pendingRequest;
    this.pendingRequests.push(pendingRequest);
    return pendingRequest.promise;
  }

  private removePendingRequest(request: PendingRequest): void {
    const index = this.pendingRequests.indexOf(request);
    if (index !== -1) this.pendingRequests.splice(index, 1);
  }

  private settleDebouncedPendingRequest(): void {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    const pending = this.debouncedPendingRequest;
    if (!pending) return;
    this.removePendingRequest(pending);
    pending.resolve?.();
    this.debouncedPendingRequest = undefined;
  }

  private async fetch(scope: string, start: (signal: AbortSignal) => Promise<void>): Promise<void> {
    this.controllers.get(scope)?.abort();
    const controller = new AbortController();
    this.controllers.set(scope, controller);
    try {
      await start(controller.signal);
    } finally {
      if (this.controllers.get(scope) === controller) this.controllers.delete(scope);
    }
  }

  clear(): void {
    this.settleDebouncedPendingRequest();
    this.pendingRequests.length = 0;
    this.isFirstCall = true;
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
  }
}
