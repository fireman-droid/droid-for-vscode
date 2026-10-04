import { randomUUID } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import type { ClientRequest, IncomingMessage, ServerResponse } from 'node:http';
import {
  captureControl, envelope, failResponse, initializeResult, requestHeaders, responseHeaders,
  sendControl, singleHeader, type IdeHandshake,
} from './reloadableIdeHttp';
import { ReloadableIdeSession } from './reloadableIdeSession';

export interface ReloadableIdeEndpoint {
  readonly port: number;
  read(): 'connected' | 'recovering' | 'error';
  subscribe(listener: () => void): () => void;
  updateUpstream(port: number): Promise<void>;
  dispose(): Promise<void>;
}

/** The lifetime of this endpoint belongs to the detached relay process, not the editor. */
export async function createReloadableIdeEndpoint(options: {
  readonly upstreamPort: number;
  readonly recoveryTimeoutMs?: number;
}): Promise<ReloadableIdeEndpoint> {
  let upstreamPort = options.upstreamPort;
  let disposed = false;
  let failed = false;
  const listeners = new Set<() => void>();
  const changed = () => { for (const listener of listeners) listener(); };
  const sessions = new Map<string, ReloadableIdeSession>();
  const requests = new Set<ClientRequest>();
  const initialization = new Set<AbortController>();
  const timeoutMs = Math.min(options.recoveryTimeoutMs ?? 60_000, 70_000);
  const server = createServer((request, response) => { void handle(request, response).catch(() => failResponse(response, 502)); });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('IDE endpoint did not bind a port.');
  const port = address.port;

  async function initialize(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const body = await captureControl(request);
    const message = envelope(body);
    if (!body || message?.method !== 'initialize' || message.jsonrpc !== '2.0' ||
        (typeof message.id !== 'number' && typeof message.id !== 'string')) { failResponse(response, 400); return; }
    const handshake: IdeHandshake = { body, headers: request.headers, id: message.id };
    const abort = new AbortController();
    initialization.add(abort);
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    const close = () => { if (!response.writableFinished) abort.abort(); };
    response.once('close', close);
    try {
      const boundPort = upstreamPort;
      const result = await sendControl(boundPort, handshake, abort.signal);
      if (disposed || response.destroyed || boundPort !== upstreamPort) { failResponse(response, 503); return; }
      const upstreamId = singleHeader(result.headers['mcp-session-id']);
      if (result.status < 200 || result.status >= 300 || !upstreamId || !initializeResult(result.body, handshake.id)) {
        if (result.body === null) { failResponse(response, 502); return; }
        response.writeHead(result.status >= 400 ? result.status : 502, responseHeaders(result.headers));
        response.end(result.body);
        return;
      }
      const id = randomUUID();
      const session = new ReloadableIdeSession(id, handshake, upstreamPort, upstreamId, timeoutMs, changed, (failure) => {
        sessions.delete(id);
        failed ||= failure;
        changed();
      });
      sessions.set(id, session);
      failed = false;
      changed();
      response.writeHead(result.status, responseHeaders(result.headers, id));
      response.end(result.body);
    } finally {
      clearTimeout(timer);
      initialization.delete(abort);
      response.off('close', close);
    }
  }

  async function forward(session: ReloadableIdeSession, request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (response.destroyed) return;
    const release = session.retainRequest();
    response.once('finish', release);
    response.once('close', release);
    const target = await session.target();
    if (response.destroyed) return;
    const captured = request.method === 'POST' ? captureControl(request) : Promise.resolve(null);
    const upstream = httpRequest({ hostname: '127.0.0.1', port: target.port, path: '/mcp', method: request.method,
      headers: requestHeaders(request.headers, target.port, target.sessionId) });
    requests.add(upstream);
    upstream.once('close', () => requests.delete(upstream));
    upstream.once('error', () => failResponse(response, 502));
    upstream.once('response', (incoming) => {
      response.writeHead(incoming.statusCode ?? 502, responseHeaders(incoming.headers, session.id));
      incoming.on('error', () => response.destroy());
      incoming.once('aborted', () => response.destroy());
      incoming.pipe(response);
      incoming.once('end', () => {
        if (request.method === 'DELETE') session.close();
        if ((incoming.statusCode ?? 502) >= 200 && (incoming.statusCode ?? 502) < 300) {
          void captured.then((body) => {
            if (body && envelope(body)?.method === 'notifications/initialized') {
              session.initialized = { body, headers: request.headers, id: session.initialize.id };
            }
          });
        }
      });
    });
    response.once('close', () => { if (!response.writableFinished) upstream.destroy(); });
    request.once('aborted', () => upstream.destroy());
    request.once('error', () => upstream.destroy());
    request.pipe(upstream);
  }

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const host = singleHeader(request.headers.host);
    if (disposed || request.url !== '/mcp' || request.headers.origin !== undefined ||
        (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) ||
        !['GET', 'POST', 'DELETE'].includes(request.method ?? '')) {
      request.resume();
      failResponse(response, disposed ? 503 : 403);
      return;
    }
    const id = singleHeader(request.headers['mcp-session-id']);
    if (!id && request.method === 'POST') { await initialize(request, response); return; }
    const session = id ? sessions.get(id) : undefined;
    if (!session) { request.resume(); failResponse(response, 404); return; }
    if (request.method === 'GET') { await session.addEvents(response, request.headers); return; }
    await forward(session, request, response);
  }

  return {
    port,
    read: () => sessions.size === 0 && failed ? 'error'
      : [...sessions.values()].some((session) => session.read() === 'recovering') ? 'recovering' : 'connected',
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async updateUpstream(nextPort) {
      if (disposed) throw new Error('IDE endpoint disposed.');
      upstreamPort = nextPort;
      // A worker that closes during Reload must not prevent healthy sibling clients
      // from adopting the replacement IDE. Each failed client closes its own stream.
      await Promise.allSettled([...sessions.values()].map((session) => session.reconnect(nextPort)));
      if (sessions.size === 0 && failed) throw new Error('The IDE connection could not be restored.');
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const abort of initialization) abort.abort();
      for (const session of [...sessions.values()]) session.close();
      for (const request of requests) request.destroy();
      await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
      listeners.clear();
    },
  };
}
