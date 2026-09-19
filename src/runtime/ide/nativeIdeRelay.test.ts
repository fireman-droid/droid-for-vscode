import { createServer, request } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNativeIdeRelay } from './nativeIdeRelay';

interface Fixture {
  readonly port: number;
  readonly closeRootStream: () => void;
  readonly heartbeat: () => void;
  readonly close: () => Promise<void>;
}

const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  try { await Promise.all(disposals.splice(0).map((dispose) => dispose())); }
  finally { vi.useRealTimers(); }
});

describe('native IDE relay', () => {
  it('gates readiness on the native initialize, initialized, and tool discovery sequence', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({
      sessionId: 'root-chat',
      upstreamPort: fixture.port,
      timeoutMs: 2_000,
    });
    disposals.push(() => relay.dispose(), fixture.close);
    const ready = relay.waitUntilReady();

    const initialized = await rpc(relay.port, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'factory-cli-mcp-client', version: '1.0.0' },
        protocolVersion: '2025-03-26',
        capabilities: {},
      },
    });
    expect(initialized.headers['mcp-session-id']).toBe('root-upstream');
    expect(relay.read().status).toBe('connecting');

    await rpc(relay.port, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }, 'root-upstream');
    expect(relay.read().status).toBe('connecting');

    await rpc(relay.port, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    }, 'root-upstream');
    await ready;

    expect(relay.read()).toEqual({
      status: 'connected',
      message: 'Native IDE tools are connected.',
    });
    expect(relay.sessionId).toBe('root-chat');
  });

  it('does not let non-native or later child clients satisfy or replace root readiness', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({
      sessionId: 'root-chat',
      upstreamPort: fixture.port,
      timeoutMs: 2_000,
    });
    disposals.push(() => relay.dispose(), fixture.close);

    await handshake(relay.port, 'other-client', 'child-0');
    expect(relay.read().status).toBe('connecting');

    await rpc(relay.port, nativeInitialize(10));
    await handshake(relay.port, 'factory-cli-mcp-client', 'child-2', 20);
    expect(relay.read().status).toBe('connecting');

    await rpc(relay.port, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }, 'root-upstream');
    await rpc(relay.port, {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/list',
      params: {},
    }, 'root-upstream');
    await relay.waitUntilReady();

    await http(relay.port, 'DELETE', undefined, 'root-upstream');
    expect(relay.read().status).toBe('disconnected');

    await handshake(relay.port, 'factory-cli-mcp-client', 'child-3', 30);
    expect(relay.read().status).toBe('disconnected');
  });

  it('reports root DELETE as a disconnect without treating completed POSTs as closure', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({
      sessionId: 'root-chat',
      upstreamPort: fixture.port,
      timeoutMs: 2_000,
    });
    disposals.push(() => relay.dispose(), fixture.close);
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');

    expect(relay.read().status).toBe('connected');
    await rpc(relay.port, {
      jsonrpc: '2.0',
      id: 90,
      method: 'ping',
    }, 'root-upstream');
    expect(relay.read().status).toBe('connected');

    await http(relay.port, 'DELETE', undefined, 'root-upstream');
    expect(relay.read()).toEqual({
      status: 'disconnected',
      message: 'The native IDE connection closed.',
    });
  });

  it('reports closure of the root SSE transport without using child activity as liveness', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({
      sessionId: 'root-chat',
      upstreamPort: fixture.port,
      timeoutMs: 2_000,
    });
    disposals.push(() => relay.dispose(), fixture.close);
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    await openStream(relay.port, 'root-upstream');

    fixture.closeRootStream();
    await waitFor(() => relay.read().status === 'disconnected');

    expect(relay.read()).toEqual({
      status: 'disconnected',
      message: 'The native IDE event stream closed.',
    });
  });

  it('bounds readiness timeout and supports waiter-local abort cancellation', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({
      sessionId: 'root-chat',
      upstreamPort: fixture.port,
      timeoutMs: 40,
    });
    disposals.push(() => relay.dispose(), fixture.close);
    const controller = new AbortController();
    const aborted = relay.waitUntilReady(controller.signal);
    controller.abort();

    await expect(aborted).rejects.toMatchObject({ name: 'AbortError' });
    expect(relay.read().status).toBe('connecting');
    await expect(relay.waitUntilReady()).rejects.toThrow(
      'Timed out waiting for the native IDE handshake.',
    );
    expect(relay.read().status).toBe('error');
  });

  it('requires initial IDE context in addition to successful tool discovery', async () => {
    const fixture = await createFixture(false);
    const relay = await createNativeIdeRelay({ sessionId: 'root-chat', upstreamPort: fixture.port, timeoutMs: 100 });
    disposals.push(() => relay.dispose(), fixture.close);
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    expect(relay.read().status).toBe('connecting');
    await expect(relay.waitUntilReady()).rejects.toThrow('Timed out');
  });

  it('tracks streamed root heartbeats and does not treat requests as heartbeat evidence', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({ sessionId: 'root-chat', upstreamPort: fixture.port });
    disposals.push(() => relay.dispose(), fixture.close);
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    let received!: () => void;
    const heartbeat = new Promise<void>((resolve) => { received = resolve; });
    await openStream(relay.port, 'root-upstream', (text) => {
      if (text.includes('notifications/heartbeat')) received();
    });

    vi.advanceTimersByTime(60_000);
    fixture.heartbeat();
    await heartbeat;
    vi.advanceTimersByTime(60_000);
    expect(relay.read().status).toBe('connected');
    await rpc(relay.port, { jsonrpc: '2.0', id: 95, method: 'ping' }, 'root-upstream');
    vi.advanceTimersByTime(20_000);
    expect(relay.read()).toEqual({ status: 'disconnected', message: 'The native IDE heartbeat expired.' });
  });
});

async function createFixture(includeContext = true): Promise<Fixture> {
  let nextSession = 0;
  const sessions = new Set<string>();
  let rootStream: ServerResponse | undefined;
  const server = createServer(async (request, response) => {
    const body = await readJson(request);
    const method = body?.method;
    let session = firstHeader(request.headers['mcp-session-id']);
    if (method === 'initialize' && session === undefined) {
      const name = (body?.params as { clientInfo?: { name?: string } } | undefined)
        ?.clientInfo?.name;
      session = name === 'factory-cli-mcp-client' && nextSession++ === 0
        ? 'root-upstream'
        : `child-${nextSession}`;
      sessions.add(session);
      response.setHeader('mcp-session-id', session);
      json(response, {
        jsonrpc: '2.0',
        id: body?.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'fixture', version: '1.0.0' },
        },
      });
      return;
    }
    if (session === undefined || !sessions.has(session)) {
      json(response, { error: 'missing session' }, 400);
      return;
    }
    if (request.method === 'GET') {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      response.write(': connected\n\n');
      rootStream = response;
      return;
    }
    if (request.method === 'DELETE') {
      sessions.delete(session);
      response.writeHead(204);
      response.end();
      return;
    }
    if (method === 'notifications/initialized') {
      response.writeHead(202);
      response.end();
      return;
    }
    if (method === 'tools/list') {
      sse(response, [
        ...(includeContext ? [{ jsonrpc: '2.0', method: 'notifications/openFiles', params: { files: [] } }] : []),
        {
          jsonrpc: '2.0',
          id: body?.id,
          result: { tools: [{ name: 'getActiveFile', inputSchema: { type: 'object' } }] },
        },
      ]);
      return;
    }
    json(response, { jsonrpc: '2.0', id: body?.id, result: {} });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Fixture failed to bind.');
  return {
    port: address.port,
    closeRootStream: () => rootStream?.end(),
    heartbeat: () => {
      rootStream?.write('event: message\r\n');
      rootStream?.write('data: {"jsonrpc":"2.0","method":"notifications/heartbeat","params":{"timestamp":1}}\r\n\r\n');
    },
    close: () => {
      rootStream?.end();
      return new Promise((resolve) => server.close(() => resolve()));
    },
  };
}

async function handshake(
  port: number,
  clientName: string,
  expectedSession: string,
  id = 1,
): Promise<void> {
  const initialized = await rpc(port, {
    ...nativeInitialize(id),
    params: {
      ...nativeInitialize(id).params,
      clientInfo: { name: clientName, version: '1.0.0' },
    },
  });
  const session = firstHeader(initialized.headers['mcp-session-id']);
  expect(session).toBe(expectedSession);
  await rpc(port, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
  }, session);
  await rpc(port, {
    jsonrpc: '2.0',
    id: id + 1,
    method: 'tools/list',
    params: {},
  }, session);
}

function nativeInitialize(id: number) {
  return {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      clientInfo: { name: 'factory-cli-mcp-client', version: '1.0.0' },
      protocolVersion: '2025-03-26',
      capabilities: {},
    },
  };
}

async function rpc(
  port: number,
  body: object,
  session?: string,
): Promise<{ headers: IncomingMessage['headers']; body: string }> {
  return http(port, 'POST', JSON.stringify(body), session);
}

function http(
  port: number,
  method: string,
  body?: string,
  session?: string,
): Promise<{ headers: IncomingMessage['headers']; body: string }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = {
      host: `127.0.0.1:${port}`,
    };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(body);
    }
    if (session !== undefined) headers['mcp-session-id'] = session;
    const outgoing = request({
      host: '127.0.0.1',
      port,
      path: '/mcp',
      method,
      headers,
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => resolve({
        headers: response.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    outgoing.on('error', reject);
    outgoing.end(body);
  });
}

function openStream(port: number, session: string, onData?: (text: string) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const outgoing = request({
      host: '127.0.0.1',
      port,
      path: '/mcp',
      method: 'GET',
      headers: {
        host: `127.0.0.1:${port}`,
        accept: 'text/event-stream',
        'mcp-session-id': session,
      },
    }, (response) => {
      if (onData) response.on('data', (chunk: Buffer) => onData(chunk.toString('utf8')));
      response.resume();
      resolve();
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for relay state.');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function json(response: ServerResponse, body: object, status = 200): void {
  const value = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(value),
  });
  response.end(value);
}

function sse(response: ServerResponse, events: object[]): void {
  const value = events.map((event) => `event: message\ndata: ${JSON.stringify(event)}\n\n`).join('');
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'content-length': Buffer.byteLength(value),
  });
  response.end(value);
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
