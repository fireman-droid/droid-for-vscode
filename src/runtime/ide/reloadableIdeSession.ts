import type { ClientRequest, IncomingMessage, IncomingHttpHeaders, ServerResponse } from 'node:http';
import { StringDecoder } from 'node:string_decoder';
import { controlResult, initializeResult, openEvents, responseHeaders, sendControl, singleHeader, type IdeHandshake } from './reloadableIdeHttp';

interface EventPipe {
  readonly response: ServerResponse;
  readonly headers: IncomingHttpHeaders;
  live: boolean;
  request?: ClientRequest;
  upstream?: IncomingMessage;
  detach?: () => void;
  cancel?: () => void;
}

/** One native MCP client, with stable downstream identity across editor reloads. */
export class ReloadableIdeSession {
  initialized: IdeHandshake | undefined;
  private readonly events = new Set<EventPipe>();
  private recovery: { promise: Promise<void>; resolve(): void; reject(error: Error): void; deadline: NodeJS.Timeout } | undefined;
  private retry: NodeJS.Timeout | undefined;
  private idle: NodeJS.Timeout | undefined;
  private requests = 0;
  private attempt: AbortController | undefined;
  private epoch = 0;
  private closed = false;

  constructor(
    readonly id: string,
    readonly initialize: IdeHandshake,
    private upstreamPort: number,
    private upstreamId: string,
    private readonly timeoutMs: number,
    private readonly changed: () => void,
    private readonly onClose: (failed: boolean) => void,
  ) { this.scheduleIdle(); }

  read(): 'connected' | 'recovering' { return this.recovery ? 'recovering' : 'connected'; }

  retainRequest(): () => void {
    if (this.closed) throw new Error('IDE session closed.');
    clearTimeout(this.idle);
    ++this.requests;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      --this.requests;
      this.scheduleIdle();
    };
  }

  private scheduleIdle(): void {
    clearTimeout(this.idle);
    if (this.closed || this.events.size > 0 || this.requests > 0) return;
    // Native client.close() aborts GET without DELETE. Allow transport reconnects,
    // then retire abandoned clients instead of reinitializing them on every Reload.
    this.idle = setTimeout(() => this.close(), this.timeoutMs);
    this.idle.unref();
  }

  async target(): Promise<{ port: number; sessionId: string }> {
    if (this.recovery) await this.recovery.promise;
    if (this.closed) throw new Error('IDE session closed.');
    return { port: this.upstreamPort, sessionId: this.upstreamId };
  }

  reconnect(port: number): Promise<void> {
    if (this.closed) return Promise.reject(new Error('IDE session closed.'));
    if (port === this.upstreamPort && !this.recovery) return Promise.resolve();
    this.upstreamPort = port;
    this.beginRecovery();
    this.runRecovery();
    return this.recovery!.promise;
  }

  async addEvents(response: ServerResponse, headers: IncomingHttpHeaders): Promise<void> {
    const release = this.retainRequest();
    try {
      await this.target();
      if (response.destroyed) return;
      const pipe: EventPipe = { response, headers, live: false };
      this.events.add(pipe);
      response.once('close', () => {
        this.events.delete(pipe);
        this.stopPipe(pipe);
        this.scheduleIdle();
      });
      // Once accepted, the session owns recovery and the downstream stream lifetime.
      // An interrupted first GET must not let the HTTP handler close that stream.
      void this.attach(pipe).catch(() => {});
    } finally { release(); }
  }

  close(failed = false): void {
    if (this.closed) return;
    this.closed = true;
    ++this.epoch;
    clearTimeout(this.retry);
    clearTimeout(this.idle);
    this.attempt?.abort();
    if (this.recovery) {
      clearTimeout(this.recovery.deadline);
      this.recovery.reject(new Error('The IDE connection could not be restored.'));
      this.recovery = undefined;
    }
    for (const pipe of this.events) { this.stopPipe(pipe); pipe.response.destroy(); }
    this.events.clear();
    this.onClose(failed);
  }

  private stopPipe(pipe: EventPipe): void {
    pipe.live = false;
    pipe.cancel?.();
    pipe.cancel = undefined;
    pipe.detach?.();
    pipe.detach = undefined;
    pipe.upstream?.destroy();
    pipe.request?.destroy();
  }

  private beginRecovery(): void {
    if (this.closed || this.recovery) return;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    // A disconnected SSE may have no HTTP waiter until the Host is available again.
    void promise.catch(() => {});
    const deadline = setTimeout(() => this.close(true), this.timeoutMs);
    deadline.unref();
    this.recovery = { promise, resolve, reject, deadline };
    this.changed();
    for (const pipe of this.events) this.stopPipe(pipe);
  }

  private runRecovery(): void {
    if (this.closed || !this.recovery) return;
    clearTimeout(this.retry);
    this.attempt?.abort();
    const attempt = new AbortController();
    this.attempt = attempt;
    const epoch = ++this.epoch;
    for (const pipe of this.events) this.stopPipe(pipe);
    const port = this.upstreamPort;
    void (async () => {
      const result = await sendControl(port, this.initialize, attempt.signal);
      const sessionId = singleHeader(result.headers['mcp-session-id']);
      if (result.status < 200 || result.status >= 300 || !sessionId ||
          !initializeResult(result.body, this.initialize.id)) throw new Error('IDE initialization failed.');
      if (this.initialized) {
        const confirmation = await sendControl(port, this.initialized, attempt.signal, sessionId);
        if (confirmation.status < 200 || confirmation.status >= 300) throw new Error('IDE initialization was not accepted.');
      }
      if (this.closed || epoch !== this.epoch) return;
      this.upstreamId = sessionId;
      await Promise.all([...this.events].map((pipe) => this.attach(pipe, attempt.signal)));
      if (this.closed || epoch !== this.epoch) return;
      if ([...this.events].some((pipe) => !pipe.live)) throw new Error('IDE event stream closed during recovery.');
      // Factory sends heartbeats every 60s from its server start time. A Reload
      // resets that phase, but the native client still has its old 75s deadline.
      // Renew liveness only after this new IDE answered tools/list AND delivered
      // real events. A disconnected or unresponsive upstream never reaches here.
      const heartbeat = `data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/heartbeat', params: { timestamp: Date.now() } })}\n\n`;
      for (const pipe of this.events) if (!pipe.response.write(heartbeat)) pipe.upstream?.pause();
      const recovery = this.recovery!;
      clearTimeout(recovery.deadline);
      this.recovery = undefined;
      recovery.resolve();
      this.changed();
    })().catch(() => {
      if (this.closed || epoch !== this.epoch) return;
      this.retry = setTimeout(() => this.runRecovery(), 500);
      this.retry.unref();
    });
  }

  private attach(pipe: EventPipe, recoverySignal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const epoch = this.epoch;
      let contextConfirmed = recoverySignal === undefined;
      const ready = () => { if (pipe.live && contextConfirmed) resolve(); };
      const request = openEvents(this.upstreamPort, pipe.headers, this.upstreamId);
      pipe.request = request;
      const interrupted = () => {
        pipe.live = false;
        reject(new Error('IDE event stream interrupted.'));
        if (this.closed || epoch !== this.epoch || !this.events.has(pipe)) return;
        if (this.recovery) return;
        this.beginRecovery();
        this.runRecovery();
      };
      request.once('error', interrupted);
      pipe.cancel = () => {
        request.off('error', interrupted);
        request.on('error', () => {});
        reject(new Error('IDE stream replaced.'));
      };
      request.once('response', (upstream) => {
        if (this.closed || epoch !== this.epoch || !this.events.has(pipe)) {
          upstream.destroy(); reject(new Error('IDE session changed.')); return;
        }
        pipe.upstream = upstream;
        if ((upstream.statusCode ?? 0) < 200 || (upstream.statusCode ?? 0) >= 300 ||
            !String(upstream.headers['content-type']).includes('text/event-stream')) {
          upstream.resume();
          interrupted();
          return;
        }
        if (!pipe.response.headersSent) {
          pipe.response.writeHead(upstream.statusCode ?? 200, responseHeaders(upstream.headers, this.id));
          pipe.response.flushHeaders();
        }
        const decoder = new StringDecoder('utf8');
        let pending = '';
        const data = (chunk: Buffer) => {
          pending += decoder.write(chunk);
          const frames = /\r?\n\r?\n/gu;
          let start = 0;
          for (let match = frames.exec(pending); match; match = frames.exec(pending)) {
            // Forward complete upstream frames; partial frames cannot confirm recovery.
            if (!pipe.response.write(pending.slice(start, frames.lastIndex))) upstream.pause();
            if (/^data:/mu.test(pending.slice(start, frames.lastIndex))) { pipe.live = true; ready(); }
            start = frames.lastIndex;
          }
          pending = pending.slice(start);
          if (pending.length > 512 * 1024) this.close(true);
        };
        const drain = () => upstream.resume();
        upstream.on('data', data);
        upstream.once('end', interrupted);
        upstream.once('aborted', interrupted);
        upstream.once('error', interrupted);
        pipe.response.on('drain', drain);
        pipe.detach = () => {
          upstream.off('data', data);
          upstream.off('end', interrupted);
          upstream.off('aborted', interrupted);
          upstream.off('error', interrupted);
          upstream.on('error', () => {});
          request.off('error', interrupted);
          request.on('error', () => {});
          pipe.response.off('drain', drain);
        };
        if (recoverySignal) {
          // Initial notifications sent during initialize have no GET listener yet.
          // The official tools/list handler refreshes editor context on this stream.
          const id = `droid-ide-reload-${epoch}`;
          const body = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/list' }));
          void sendControl(this.upstreamPort, { body, id, headers: this.initialize.headers }, recoverySignal, this.upstreamId)
            .then((result) => {
              if (this.closed || epoch !== this.epoch || !this.events.has(pipe)) return;
              if (result.status < 200 || result.status >= 300 || !Array.isArray(controlResult(result.body, id)?.tools)) {
                interrupted(); return;
              }
              contextConfirmed = true;
              ready();
            }, interrupted);
        }
      });
      request.end();
    });
  }
}
