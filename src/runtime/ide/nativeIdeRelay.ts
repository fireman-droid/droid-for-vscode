import { Agent, createServer, request as httpRequest } from 'node:http';
import type {
  ClientRequest,
  IncomingHttpHeaders,
  IncomingMessage,
  ServerResponse,
} from 'node:http';
import type { Socket } from 'node:net';
import { StringDecoder } from 'node:string_decoder';

export type NativeIdeRelayStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface NativeIdeRelayState {
  readonly status: NativeIdeRelayStatus;
  readonly message: string;
}

export interface NativeIdeRelay {
  readonly port: number;
  readonly sessionId: string;
  read(): NativeIdeRelayState;
  subscribe(listener: () => void): () => void;
  waitUntilReady(signal?: AbortSignal): Promise<void>;
  resetForSessionRestart(): void;
  dispose(): Promise<void>;
}

const DEFAULT_READY_TIMEOUT_MS = 20_000;
const ROOT_HEARTBEAT_EXPIRY_MS = 75_000;
const HEARTBEAT_CHECK_MS = 5_000;
const CONTROL_BODY_LIMIT = 512 * 1024;
const NATIVE_CLIENT_NAME = 'factory-cli-mcp-client';
const NATIVE_CLIENT_VERSION = '1.0.0';

interface JsonRpcEnvelope {
  readonly jsonrpc?: unknown;
  readonly id?: unknown;
  readonly method?: unknown;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: unknown;
}

interface RequestEvidence {
  readonly envelope: JsonRpcEnvelope | null;
  readonly overflowed: boolean;
}

interface RelayRequest {
  readonly generation: number;
  readonly evidence: Promise<RequestEvidence>;
  readonly method: string;
  readonly downstream: IncomingMessage;
  readonly response: ServerResponse;
  readonly upstream: ClientRequest;
  rootCandidate: boolean;
  rootRequest: boolean;
  upstreamEnded: boolean;
}

class NativeIdeRelayImpl implements NativeIdeRelay {
  readonly port: number;
  readonly sessionId: string;

  private state: NativeIdeRelayState = {
    status: 'connecting',
    message: 'Waiting for the native IDE client.',
  };
  private readonly listeners = new Set<() => void>();
  private readonly sockets = new Set<Socket>();
  private readonly upstreamRequests = new Set<ClientRequest>();
  private readonly rootEventStreams = new Set<RelayRequest>();
  private readonly upstreamAgent = new Agent({ keepAlive: true });
  private readonly server;
  private timeout: NodeJS.Timeout | undefined;
  private readonly heartbeat: NodeJS.Timeout;
  private disposed = false;
  private generation = 0;
  private awaitingRootRestart = false;
  private rootTerminated = false;
  private handshakeTimedOut = false;
  private rootClaimed = false;
  private rootSessionId: string | undefined;
  private rootLastActivity = 0;
  private initializeForwarded = false;
  private initializedForwarded = false;
  private toolsForwarded = false;
  private initialContextForwarded = false;

  constructor(
    port: number,
    sessionId: string,
    private readonly upstreamPort: number,
    private readonly timeoutMs: number,
    server: ReturnType<typeof createServer>,
  ) {
    this.port = port;
    this.sessionId = sessionId;
    this.server = server;
    this.armReadyTimeout();
    this.heartbeat = setInterval(() => {
      if (
        this.rootSessionId !== undefined
        && this.state.status !== 'disconnected'
        && this.state.status !== 'error'
        && Date.now() - this.rootLastActivity > ROOT_HEARTBEAT_EXPIRY_MS
      ) {
        this.disconnect('The native IDE heartbeat expired.');
      }
    }, HEARTBEAT_CHECK_MS);
    this.heartbeat.unref();

    server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    server.on('error', () => this.fail('The native IDE relay failed.'));
    server.on('request', (request, response) => this.handle(request, response));
  }

  private armReadyTimeout(): void {
    clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      if (this.state.status === 'connecting') {
        // Allocation can precede daemon startup and old-session closure. Fail
        // current waiters on time, but accept a subsequently confirmed handshake.
        this.handshakeTimedOut = true;
        this.update({ status: 'error', message: 'Timed out waiting for the native IDE handshake.' });
      }
    }, this.timeoutMs);
    this.timeout.unref();
  }

  read(): NativeIdeRelayState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Only the owning daemon's root-session inactivity notification authorizes this. */
  resetForSessionRestart(): void {
    if (this.disposed) return;
    ++this.generation;
    clearTimeout(this.timeout);
    this.rootEventStreams.clear();
    this.rootClaimed = false;
    this.rootSessionId = undefined;
    this.rootLastActivity = 0;
    this.rootTerminated = false;
    this.handshakeTimedOut = false;
    this.initializeForwarded = false;
    this.initializedForwarded = false;
    this.toolsForwarded = false;
    this.initialContextForwarded = false;
    this.awaitingRootRestart = true;
    this.update({ status: 'disconnected',
      message: 'This session is idle. IDE reconnects automatically when the conversation resumes.' });
  }

  private beginRootRestart(): void {
    if (this.disposed || this.rootTerminated || !this.awaitingRootRestart || this.state.status === 'connecting') return;
    this.handshakeTimedOut = false;
    this.update({ status: 'connecting', message: 'Restoring this session’s native IDE connection.' });
    this.armReadyTimeout();
  }

  waitUntilReady(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    this.beginRootRestart();
    if (this.state.status === 'connected') return Promise.resolve();
    if (this.state.status !== 'connecting') {
      return Promise.reject(new Error(this.state.message));
    }
    return new Promise<void>((resolve, reject) => {
      const unsubscribe = this.subscribe(() => {
        if (this.state.status === 'connected') {
          cleanup();
          resolve();
        } else if (this.state.status !== 'connecting') {
          cleanup();
          reject(new Error(this.state.message));
        }
      });
      const onAbort = () => {
        cleanup();
        reject(abortReason(signal));
      };
      const cleanup = () => {
        unsubscribe();
        signal?.removeEventListener('abort', onAbort);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.rootTerminated = true;
    clearTimeout(this.timeout);
    clearInterval(this.heartbeat);
    for (const request of this.upstreamRequests) request.destroy();
    this.upstreamAgent.destroy();
    for (const socket of this.sockets) socket.destroy();
    this.upstreamRequests.clear();
    this.rootEventStreams.clear();
    this.sockets.clear();
    await new Promise<void>((resolve) => {
      if (!this.server.listening) {
        resolve();
        return;
      }
      this.server.close(() => resolve());
      this.server.closeAllConnections();
    });
    if (this.state.status !== 'error') this.disconnect('The native IDE relay was disposed.');
    this.listeners.clear();
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    if (this.disposed) {
      respond(response, 503, 'Relay unavailable');
      return;
    }
    if (!this.accepts(request)) {
      respond(response, 403, 'Forbidden');
      request.resume();
      return;
    }

    const method = request.method ?? '';
    const capture = captureJsonBody(request);
    const headers = upstreamHeaders(request.headers, this.upstreamPort);
    const upstream = httpRequest({
      host: '127.0.0.1',
      port: this.upstreamPort,
      path: '/mcp',
      method,
      headers,
      agent: this.upstreamAgent,
    });
    const relayRequest: RelayRequest = {
      generation: this.generation,
      evidence: capture.evidence,
      method,
      downstream: request,
      response,
      upstream,
      rootCandidate: false,
      rootRequest: false,
      upstreamEnded: false,
    };
    this.upstreamRequests.add(upstream);
    upstream.once('close', () => this.upstreamRequests.delete(upstream));
    upstream.on('response', (upstreamResponse) => {
      void this.forwardResponse(relayRequest, upstreamResponse);
    });
    upstream.on('error', () => {
      if (!response.headersSent) respond(response, 502, 'IDE service unavailable');
      else response.destroy();
      if (relayRequest.generation !== this.generation) return;
      if (relayRequest.rootRequest && method === 'GET') {
        this.rootEventStreams.delete(relayRequest);
        if (this.rootEventStreams.size > 0) return;
      }
      if (relayRequest.rootCandidate || relayRequest.rootRequest) {
        this.fail('The native IDE transport failed.');
      } else if (!this.rootClaimed) {
        this.fail('The official IDE service is unavailable.');
      }
    });

    request.pipe(upstream);
    void relayRequest.evidence.then((evidence) => {
      if (relayRequest.generation !== this.generation) return;
      const envelope = evidence.envelope;
      const sessionHeader = headerValue(request.headers['mcp-session-id']);
      if (!this.rootClaimed && isNativeInitialize(envelope)) {
        this.beginRootRestart();
        this.awaitingRootRestart = false;
        this.rootClaimed = true;
        relayRequest.rootCandidate = true;
        this.touchRoot();
      } else if (sessionHeader !== undefined && sessionHeader === this.rootSessionId) {
        relayRequest.rootRequest = true;
      }
    });
  }

  private accepts(request: IncomingMessage): boolean {
    if (request.url !== '/mcp') return false;
    if (!['GET', 'POST', 'DELETE'].includes(request.method ?? '')) return false;
    if (request.headers.origin !== undefined) return false;
    const host = headerValue(request.headers.host);
    return host === `127.0.0.1:${this.port}` || host === `localhost:${this.port}`;
  }

  private async forwardResponse(
    relayRequest: RelayRequest,
    upstreamResponse: IncomingMessage,
  ): Promise<void> {
    const evidence = await relayRequest.evidence;
    const envelope = evidence.envelope;
    const sessionHeader = headerValue(relayRequest.downstream.headers['mcp-session-id']);
    if (relayRequest.generation === this.generation &&
        sessionHeader !== undefined && sessionHeader === this.rootSessionId) {
      relayRequest.rootRequest = true;
    }

    const controlResponse = relayRequest.rootCandidate
      || (relayRequest.rootRequest && isHandshakeMethod(envelope));
    const responseCapture = controlResponse ? boundedCapture(upstreamResponse) : undefined;
    const liveRootSse = relayRequest.generation === this.generation && relayRequest.rootRequest &&
      (upstreamResponse.statusCode ?? 0) >= 200 && (upstreamResponse.statusCode ?? 0) < 300 &&
      headerValue(upstreamResponse.headers['content-type'])?.includes('text/event-stream');
    const rootEventStream = liveRootSse && relayRequest.method === 'GET';
    if (rootEventStream) this.rootEventStreams.add(relayRequest);
    if (liveRootSse) {
      observeSse(upstreamResponse, (notification) => {
        if (relayRequest.generation !== this.generation) return;
        if (notification.method === 'notifications/heartbeat') {
          this.touchRoot();
          this.maybeReady(true);
        }
        if (notification.method === 'notifications/activeFile' ||
            notification.method === 'notifications/openFiles') {
          this.initialContextForwarded = true;
          this.maybeReady(true);
        }
      });
    }
    relayRequest.response.writeHead(
      upstreamResponse.statusCode ?? 502,
      relayHeaders(upstreamResponse.headers),
    );
    upstreamResponse.pipe(relayRequest.response);

    const endRootStream = (message: string, failed = false) => {
      if (relayRequest.generation !== this.generation) return;
      if (rootEventStream) {
        this.rootEventStreams.delete(relayRequest);
        // MCP may replace an SSE stream before its predecessor finishes closing.
        if (this.rootEventStreams.size > 0) return;
      }
      if (failed) this.fail(message);
      else this.disconnect(message);
    };
    const failRootStream = () => {
      if (
        (relayRequest.rootCandidate || relayRequest.rootRequest)
        && !relayRequest.upstreamEnded
      ) {
        endRootStream('The native IDE transport closed.');
      }
    };
    upstreamResponse.once('aborted', () => {
      failRootStream();
      relayRequest.response.destroy();
    });
    upstreamResponse.once('error', () => {
      if (relayRequest.rootCandidate || relayRequest.rootRequest) {
        endRootStream('The native IDE transport failed.', true);
      }
      relayRequest.response.destroy();
    });
    upstreamResponse.once('end', () => {
      relayRequest.upstreamEnded = true;
      if (relayRequest.rootCandidate || relayRequest.rootRequest) {
        if (relayRequest.method === 'GET') {
          endRootStream('The native IDE event stream closed.');
        }
      }
    });
    relayRequest.response.once('close', () => {
      if (!relayRequest.response.writableFinished) {
        failRootStream();
        upstreamResponse.destroy();
        relayRequest.upstream.destroy();
      }
    });
    relayRequest.response.once('finish', async () => {
      if (relayRequest.generation !== this.generation) return;
      if (!(relayRequest.rootCandidate || relayRequest.rootRequest)) return;
      if (relayRequest.method === 'DELETE') {
        this.rootTerminated = true;
        this.disconnect('The native IDE connection closed.');
        return;
      }
      const responseEvidence = responseCapture === undefined
        ? null
        : await responseCapture;
      this.observeHandshake(
        relayRequest,
        envelope,
        upstreamResponse.statusCode ?? 0,
        upstreamResponse.headers,
        responseEvidence,
      );
    });
  }

  private observeHandshake(
    request: RelayRequest,
    envelope: JsonRpcEnvelope | null,
    statusCode: number,
    headers: IncomingHttpHeaders,
    response: RequestEvidence | null,
  ): void {
    if (request.generation !== this.generation) return;
    if (statusCode < 200 || statusCode >= 300 || response?.overflowed) {
      if (request.rootCandidate || isHandshakeMethod(envelope)) {
        this.fail('The native IDE handshake failed.');
      }
      return;
    }
    if (request.rootCandidate) {
      const sessionId = headerValue(headers['mcp-session-id']);
      if (
        sessionId === undefined
        || !isSuccessfulResponse(response?.envelope ?? null, envelope?.id)
      ) {
        this.fail('The native IDE initialization was not confirmed.');
        return;
      }
      this.rootSessionId = sessionId;
      this.initializeForwarded = true;
      this.touchRoot();
    } else if (
      request.rootRequest
      && envelope?.method === 'notifications/initialized'
    ) {
      this.initializedForwarded = true;
    } else if (
      request.rootRequest
      && envelope?.method === 'tools/list'
      && isToolListResponse(response?.envelope ?? null, envelope.id)
    ) {
      this.toolsForwarded = true;
    }
    this.maybeReady();
  }

  private maybeReady(liveRootEvidence = false): void {
    if (
      !this.rootTerminated
      && (this.state.status === 'connecting' ||
        (this.state.status === 'error' && this.handshakeTimedOut) ||
        (liveRootEvidence && this.state.status === 'disconnected'))
      && this.initializeForwarded
      && this.initializedForwarded
      && this.toolsForwarded
      && this.initialContextForwarded
    ) {
      clearTimeout(this.timeout);
      this.touchRoot();
      this.update({
        status: 'connected',
        message: 'Native IDE tools are connected.',
      });
    }
  }

  private touchRoot(): void {
    this.rootLastActivity = Date.now();
  }

  private fail(message: string): void {
    if (this.disposed || this.state.status === 'disconnected') {
      return;
    }
    clearTimeout(this.timeout);
    this.rootTerminated = true;
    if (this.state.status === 'error') return;
    this.update({ status: 'error', message });
  }

  private disconnect(message: string): void {
    if (this.state.status === 'disconnected') return;
    clearTimeout(this.timeout);
    this.update({ status: 'disconnected', message });
  }

  private update(state: NativeIdeRelayState): void {
    if (this.state.status === state.status && this.state.message === state.message) return;
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}

export async function createNativeIdeRelay(options: {
  sessionId: string;
  upstreamPort: number;
  timeoutMs?: number;
}): Promise<NativeIdeRelay> {
  if (options.sessionId.trim().length === 0) throw new Error('A relay session ID is required.');
  if (!Number.isInteger(options.upstreamPort) || options.upstreamPort < 1 || options.upstreamPort > 65_535) {
    throw new Error('The upstream IDE port is invalid.');
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('The relay timeout must be positive.');
  }

  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host: '127.0.0.1', port: 0 });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('The native IDE relay did not bind a TCP port.');
  }
  return new NativeIdeRelayImpl(
    address.port,
    options.sessionId,
    options.upstreamPort,
    timeoutMs,
    server,
  );
}

function captureJsonBody(request: IncomingMessage): { evidence: Promise<RequestEvidence> } {
  const chunks: Buffer[] = [];
  let size = 0;
  let overflowed = false;
  return {
    evidence: new Promise((resolve) => {
      request.on('data', (chunk: Buffer) => {
        if (overflowed) return;
        size += chunk.length;
        if (size > CONTROL_BODY_LIMIT) {
          overflowed = true;
          chunks.length = 0;
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      request.once('end', () => {
        resolve({
          envelope: overflowed ? null : parseEnvelope(Buffer.concat(chunks)),
          overflowed,
        });
      });
      request.once('aborted', () => resolve({ envelope: null, overflowed: true }));
      request.once('error', () => resolve({ envelope: null, overflowed: true }));
    }),
  };
}

function boundedCapture(response: IncomingMessage): Promise<RequestEvidence> {
  const chunks: Buffer[] = [];
  let size = 0;
  let overflowed = false;
  return new Promise((resolve) => {
    response.on('data', (chunk: Buffer) => {
      if (overflowed) return;
      size += chunk.length;
      if (size > CONTROL_BODY_LIMIT) {
        overflowed = true;
        chunks.length = 0;
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    response.once('end', () => {
      resolve({
        envelope: overflowed ? null : parseEnvelope(Buffer.concat(chunks)),
        overflowed,
      });
    });
    response.once('aborted', () => resolve({ envelope: null, overflowed: true }));
    response.once('error', () => resolve({ envelope: null, overflowed: true }));
  });
}

function observeSse(stream: IncomingMessage, receive: (value: JsonRpcEnvelope) => void): void {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  let dropping = false;
  stream.on('data', (chunk: Buffer) => {
    const text = pending + decoder.write(chunk);
    const delimiter = /\r?\n\r?\n/gu;
    let start = 0;
    for (let match = delimiter.exec(text); match; match = delimiter.exec(text)) {
      if (!dropping && match.index - start <= CONTROL_BODY_LIMIT) {
        const value = parseSseEnvelope(text.slice(start, match.index));
        if (value) receive(value);
      }
      dropping = false;
      start = delimiter.lastIndex;
    }
    pending = text.slice(start);
    if (pending.length > CONTROL_BODY_LIMIT) {
      pending = pending.slice(-3);
      dropping = true;
    }
  });
}

function parseEnvelope(body: Buffer): JsonRpcEnvelope | null {
  if (body.length === 0) return null;
  const text = body.toString('utf8');
  try {
    const value: unknown = JSON.parse(text);
    return isRecord(value) && !Array.isArray(value) ? value : null;
  } catch {
    return parseSseEnvelope(text);
  }
}

function parseSseEnvelope(body: string): JsonRpcEnvelope | null {
  let envelope: JsonRpcEnvelope | null = null;
  for (const event of body.split(/\r?\n\r?\n/u)) {
    const data = event
      .split(/\r?\n/u)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data.length === 0) continue;
    try {
      const value: unknown = JSON.parse(data);
      if (!isRecord(value) || Array.isArray(value)) return null;
      envelope = value;
    } catch {
      return null;
    }
  }
  return envelope;
}

function isNativeInitialize(envelope: JsonRpcEnvelope | null): boolean {
  if (envelope?.method !== 'initialize' || !isRecord(envelope.params)) return false;
  const clientInfo = envelope.params.clientInfo;
  return isRecord(clientInfo)
    && clientInfo.name === NATIVE_CLIENT_NAME
    && clientInfo.version === NATIVE_CLIENT_VERSION;
}

function isHandshakeMethod(envelope: JsonRpcEnvelope | null): boolean {
  return envelope?.method === 'initialize'
    || envelope?.method === 'notifications/initialized'
    || envelope?.method === 'tools/list';
}

function isSuccessfulResponse(envelope: JsonRpcEnvelope | null, id: unknown): boolean {
  return envelope?.jsonrpc === '2.0'
    && envelope.id === id
    && envelope.error === undefined
    && envelope.result !== undefined;
}

function isToolListResponse(envelope: JsonRpcEnvelope | null, id: unknown): boolean {
  return isSuccessfulResponse(envelope, id)
    && isRecord(envelope?.result)
    && Array.isArray(envelope.result.tools);
}

function upstreamHeaders(headers: IncomingHttpHeaders, upstreamPort: number): IncomingHttpHeaders {
  const result = relayHeaders(headers);
  result.host = `127.0.0.1:${upstreamPort}`;
  delete result.origin;
  return result;
}

function relayHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result = { ...headers };
  for (const name of [
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]) {
    delete result[name];
  }
  return result;
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function respond(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(message),
  });
  response.end(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function abortReason(signal: AbortSignal | undefined): Error {
  if (signal?.reason instanceof Error) return signal.reason;
  const error = new Error('The native IDE readiness wait was aborted.');
  error.name = 'AbortError';
  return error;
}
