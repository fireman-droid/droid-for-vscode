import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http';
import { StringDecoder } from 'node:string_decoder';

const MAX_PENDING_FRAME_LENGTH = 512 * 1024;

interface EventStreamOptions {
  readonly initial: IncomingMessage;
  readonly request: ClientRequest;
  readonly downstream: ServerResponse;
  readonly recoveryTimeoutMs: number;
  readonly lastEventId?: string;
  connect(lastEventId: string | undefined): ClientRequest;
  canRecover(): boolean;
  interrupted(): void;
  restored(): void;
  frame(value: string): void;
  closed(): void;
}

/**
 * Keep the native client's GET open while its upstream event stream recovers.
 * Only complete SSE frames cross the boundary; a truncated frame is requested
 * again using the last delivered event id. No POST or tool call is replayed.
 */
export function forwardRecoverableIdeEvents(options: EventStreamOptions): void {
  let currentRequest = options.request;
  let currentResponse: IncomingMessage | undefined;
  let removeResponseListeners = () => {};
  let retryTimer: NodeJS.Timeout | undefined;
  let deadlineTimer: NodeJS.Timeout | undefined;
  let lastEventId = options.lastEventId;
  let attempts = 0;
  let stopped = false;
  let recovering = false;
  const retryBudget = Math.min(options.recoveryTimeoutMs, 10_000);

  const cleanup = () => {
    clearTimeout(retryTimer);
    clearTimeout(deadlineTimer);
    removeResponseListeners();
    currentRequest.off('error', recover);
    currentResponse?.destroy();
    currentRequest.destroy();
  };
  const finish = () => {
    if (stopped) return;
    stopped = true;
    cleanup();
    options.downstream.off('close', finish);
    options.downstream.destroy();
    options.closed();
  };
  const delivered = (frame: string) => {
    // An id without data also changes the SSE reconnect cursor.
    for (const line of frame.split(/\r?\n/u)) {
      if (line.startsWith('id:')) {
        const id = line.slice(3).replace(/^ /u, '');
        if (!id.includes('\0')) lastEventId = id || undefined;
      }
    }
    if (/^data:/mu.test(frame)) attempts = 0;
    options.frame(frame);
  };
  const attach = (response: IncomingMessage, resumed: boolean) => {
    if (stopped || (resumed && !options.canRecover())) {
      response.destroy();
      finish();
      return;
    }
    if (resumed && ((response.statusCode ?? 0) < 200 || (response.statusCode ?? 0) >= 300 ||
        !String(response.headers['content-type']).includes('text/event-stream'))) {
      response.destroy();
      // A rejected MCP session cannot be restored by repeatedly opening GET.
      finish();
      return;
    }
    currentResponse = response;
    recovering = false;
    clearTimeout(deadlineTimer);
    deadlineTimer = undefined;
    if (resumed) options.restored();
    const decoder = new StringDecoder('utf8');
    let pending = '';
    const data = (chunk: Buffer) => {
      pending += decoder.write(chunk);
      const delimiter = /\r?\n\r?\n/gu;
      let start = 0;
      for (let boundary = delimiter.exec(pending); boundary; boundary = delimiter.exec(pending)) {
        const frame = pending.slice(start, delimiter.lastIndex);
        start = delimiter.lastIndex;
        if (!options.downstream.write(frame)) response.pause();
        delivered(frame);
      }
      pending = pending.slice(start);
      // Match the relay's existing control-frame budget while buffering a frame
      // that has not reached its delimiter. Never pass an unrecoverable fragment.
      if (pending.length > MAX_PENDING_FRAME_LENGTH) finish();
    };
    const drain = () => response.resume();
    response.on('data', data);
    response.once('end', recover);
    response.once('aborted', recover);
    response.once('error', recover);
    options.downstream.on('drain', drain);
    removeResponseListeners = () => {
      response.off('data', data);
      response.off('end', recover);
      response.off('aborted', recover);
      response.off('error', recover);
      // Destroying an already aborted stream may still emit its final error.
      response.on('error', () => {});
      options.downstream.off('drain', drain);
    };
  };
  function recover(): void {
    if (stopped || recovering) return;
    if (!options.canRecover() || attempts >= 5) {
      finish();
      return;
    }
    recovering = true;
    removeResponseListeners();
    currentResponse?.destroy();
    currentRequest.off('error', recover);
    currentRequest.destroy();
    options.interrupted();
    if (!deadlineTimer) {
      deadlineTimer = setTimeout(finish, retryBudget);
      deadlineTimer.unref();
    }
    const delay = Math.min(200 * 2 ** attempts++, 2_000);
    retryTimer = setTimeout(() => {
      if (stopped || !options.canRecover()) { finish(); return; }
      const attempt = options.connect(lastEventId);
      currentRequest = attempt;
      let responseReceived = false;
      attempt.once('response', response => {
        responseReceived = true;
        attach(response, true);
      });
      attempt.once('error', () => {
        if (currentRequest !== attempt || stopped || responseReceived) return;
        recovering = false;
        recover();
      });
      attempt.end();
    }, delay);
    retryTimer.unref();
  }
  options.downstream.once('close', finish);
  currentRequest.on('error', recover);
  attach(options.initial, false);
}
