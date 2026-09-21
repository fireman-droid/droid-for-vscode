import { createServer, request } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createNativeIdeRelay } from './nativeIdeRelay';
import { bindSessionIde } from '../daemon/ideSessionHandle';
import type { DaemonSessionHandle } from '../daemon/api';

interface Fixture {
  readonly port: number;
  readonly closeRootStream: (index?: number) => void;
  readonly destroyRootStream: (index?: number) => void;
  readonly heartbeat: (index?: number) => void;
  readonly failNextToolList: () => void;
  readonly rejectNextRootStream: () => void;
  readonly writeRootStream: (frame: string) => void;
  readonly streamRequests: Array<{ readonly lastEventId: string | undefined }>;
  readonly close: () => Promise<void>;
}

const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  try { await Promise.all(disposals.splice(0).map((dispose) => dispose())); }
  finally { vi.useRealTimers(); }
});

describe('native IDE relay', () => {
  it('resumes an idle worker before waiting for its real new IDE handshake and submits the prompt exactly once', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({ sessionId: 'root-chat', upstreamPort: fixture.port });
    disposals.push(() => relay.dispose(), fixture.close);
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    relay.resetForSessionRestart();
    let finishLoad!: () => void;
    const loaded = new Promise<void>((resolve) => { finishLoad = resolve; });
    const stream = vi.fn(async function* () { yield { type: 'assistant', text: 'resumed' }; });
    const handle = bindSessionIde({
      ensureLoaded: async () => {
        await rpc(relay.port, nativeInitialize(20));
        finishLoad();
      }, stream,
    } as unknown as DaemonSessionHandle, (signal) => relay.waitUntilReady(signal));
    const messages = handle.stream('continue the same conversation');
    const first = messages.next();
    await loaded;
    expect(stream).not.toHaveBeenCalled();
    await rpc(relay.port, { jsonrpc: '2.0', method: 'notifications/initialized' }, 'child-2');
    expect(stream).not.toHaveBeenCalled();
    await rpc(relay.port, { jsonrpc: '2.0', id: 21, method: 'tools/list', params: {} }, 'child-2');
    expect(await first).toMatchObject({ value: { text: 'resumed' } });
    await messages.next();
    expect(stream).toHaveBeenCalledExactlyOnceWith('continue the same conversation', { includePartialMessages: false });
    expect(relay.read().status).toBe('connected');
  });

  it('accepts a fresh root handshake after confirmed worker inactivity, including a load started by metadata reads', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({ sessionId: 'root-chat', upstreamPort: fixture.port, timeoutMs: 100 });
    disposals.push(() => relay.dispose(), fixture.close);
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    await openStream(relay.port, 'root-upstream');
    relay.resetForSessionRestart();

    // An idle worker has no running handshake deadline, however long it stays idle.
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    await vi.advanceTimersByTimeAsync(35 * 60_000);
    expect(relay.read()).toMatchObject({ status: 'disconnected', message: expect.stringContaining('idle') });
    vi.useRealTimers();

    // No send/readiness waiter has run yet: an ordinary SDK metadata request may
    // auto-load the worker and establish the new root before the next prompt.
    await handshake(relay.port, 'factory-cli-mcp-client', 'child-2', 20);
    await expect(relay.waitUntilReady()).resolves.toBeUndefined();
    fixture.destroyRootStream(0);
    await rpc(relay.port, { jsonrpc: '2.0', id: 22, method: 'ping' }, 'child-2');
    expect(relay.read().status).toBe('connected');

    relay.resetForSessionRestart();
    await handshake(relay.port, 'factory-cli-mcp-client', 'child-3', 30);
    await expect(relay.waitUntilReady()).resolves.toBeUndefined();
  });

  it('waits for all new root evidence and ignores previous-generation heartbeat, DELETE and closure', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({ sessionId: 'root-chat', upstreamPort: fixture.port });
    disposals.push(() => relay.dispose(), fixture.close);
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    let received!: () => void;
    await openStream(relay.port, 'root-upstream', (text) => {
      if (text.includes('notifications/heartbeat')) received?.();
    });
    relay.resetForSessionRestart();
    let ready = false;
    const pending = relay.waitUntilReady().then(() => { ready = true; });
    const oldHeartbeat = new Promise<void>((resolve) => { received = resolve; });
    fixture.heartbeat(0);
    await oldHeartbeat;
    expect(ready).toBe(false);
    await http(relay.port, 'DELETE', undefined, 'root-upstream');
    await rpc(relay.port, nativeInitialize(20));
    await rpc(relay.port, { jsonrpc: '2.0', method: 'notifications/initialized' }, 'child-2');
    expect(ready).toBe(false);
    await rpc(relay.port, { jsonrpc: '2.0', id: 21, method: 'tools/list', params: {} }, 'child-2');
    await pending;
    fixture.closeRootStream(0);
    await rpc(relay.port, { jsonrpc: '2.0', id: 22, method: 'ping' }, 'child-2');
    expect(relay.read().status).toBe('connected');
  });

  it('bounds a restarted handshake and keeps cancellation local to its waiter', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({ sessionId: 'root-chat', upstreamPort: fixture.port, timeoutMs: 50 });
    disposals.push(() => relay.dispose(), fixture.close);
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    relay.resetForSessionRestart();
    const controller = new AbortController();
    const canceled = expect(relay.waitUntilReady(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    const timedOut = expect(relay.waitUntilReady()).rejects.toThrow('Timed out');
    controller.abort();
    await canceled;
    await timedOut;
    expect(relay.read().status).toBe('error');
    await relay.dispose();
    await expect(relay.waitUntilReady()).rejects.toThrow();
  });

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

  it('requires a new native session when an upstream recovery GET rejects the old session', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({
      sessionId: 'root-chat',
      upstreamPort: fixture.port,
      timeoutMs: 2_000,
    });
    disposals.push(() => relay.dispose(), fixture.close);
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    const ended = vi.fn();
    await openStream(relay.port, 'root-upstream', undefined, ended);

    fixture.rejectNextRootStream();
    fixture.closeRootStream();
    await waitFor(() => relay.read().status === 'disconnected');

    expect(relay.read()).toEqual({
      status: 'disconnected',
      message: 'The native IDE event stream could not be restored.',
    });
    await waitFor(() => ended.mock.calls.length === 1);
    expect(relay.requiresSessionRestart()).toBe(true);
    expect(fixture.streamRequests).toHaveLength(2);
  });

  it.each(['end', 'destroy'] as const)('restores an upstream %s on the same downstream native connection', async closure => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({ sessionId: 'root-chat', upstreamPort: fixture.port });
    disposals.push(() => relay.dispose(), fixture.close);
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    const ended = vi.fn();
    let text = '';
    await openStream(relay.port, 'root-upstream', chunk => { text += chunk; }, ended);
    if (closure === 'end') fixture.closeRootStream();
    else fixture.destroyRootStream();
    await waitFor(() => relay.read().status === 'connecting');
    expect(relay.requiresSessionRestart()).toBe(false);
    await waitFor(() => fixture.streamRequests.length === 2 && relay.read().status === 'connected');
    fixture.heartbeat();
    await waitFor(() => text.includes('notifications/heartbeat'));
    expect(ended).not.toHaveBeenCalled();
    expect(relay.read().status).toBe('connected');
    await expect(relay.waitUntilReady()).resolves.toBeUndefined();

    await http(relay.port, 'DELETE', undefined, 'root-upstream');
    text = '';
    fixture.heartbeat();
    await waitFor(() => text.includes('notifications/heartbeat'));
    expect(relay.read().status).toBe('disconnected');
  });

  it('does not claim an abruptly disconnected native client recovered from late transport heartbeats', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({ sessionId: 'root-chat', upstreamPort: fixture.port });
    disposals.push(() => relay.dispose(), fixture.close);
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    await openStream(relay.port, 'root-upstream');
    fixture.rejectNextRootStream();
    fixture.destroyRootStream();
    await waitFor(() => relay.read().status === 'disconnected' || relay.read().status === 'error');
    let received!: () => void;
    const heartbeat = new Promise<void>(resolve => { received = resolve; });
    await openStream(relay.port, 'root-upstream', text => {
      if (text.includes('notifications/heartbeat')) received();
    });
    fixture.heartbeat();
    await heartbeat;
    await expect(relay.waitUntilReady()).rejects.toThrow();
    relay.resetForSessionRestart();
    await handshake(relay.port, 'factory-cli-mcp-client', 'child-2', 20);
    await expect(relay.waitUntilReady()).resolves.toBeUndefined();
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

  it('accepts a confirmed late handshake after the original readiness waiter times out', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({ sessionId: 'root-chat', upstreamPort: fixture.port, timeoutMs: 30 });
    disposals.push(() => relay.dispose(), fixture.close);
    await expect(relay.waitUntilReady()).rejects.toThrow('Timed out');
    expect(relay.read().status).toBe('error');

    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    expect(relay.read().status).toBe('connected');
    await expect(relay.waitUntilReady()).resolves.toBeUndefined();
  });

  it('does not revive an explicit handshake failure when later valid context arrives', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({ sessionId: 'root-chat', upstreamPort: fixture.port });
    disposals.push(() => relay.dispose(), fixture.close);
    fixture.failNextToolList();
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    await expect(relay.waitUntilReady()).rejects.toThrow('handshake failed');
    await rpc(relay.port, { jsonrpc: '2.0', id: 91, method: 'tools/list', params: {} }, 'root-upstream');
    expect(relay.read().status).toBe('error');
  });

  it.each(['end', 'destroy'] as const)('keeps a replacement root stream connected when the earlier stream closes late via %s', async (closure) => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({ sessionId: 'root-chat', upstreamPort: fixture.port });
    disposals.push(() => relay.dispose(), fixture.close);
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    let ended!: () => void;
    const oldStreamEnded = new Promise<void>((resolve) => { ended = resolve; });
    await openStream(relay.port, 'root-upstream', undefined, ended);
    let received!: () => void;
    const heartbeat = new Promise<void>((resolve) => { received = resolve; });
    await openStream(relay.port, 'root-upstream', (text) => {
      if (text.includes('notifications/heartbeat')) received();
    });
    fixture.heartbeat();
    await heartbeat;
    if (closure === 'destroy') fixture.destroyRootStream(0);
    else fixture.closeRootStream(0);
    await oldStreamEnded;
    expect(relay.read().status).toBe('connected');
    fixture.closeRootStream();
    await waitFor(() => fixture.streamRequests.length === 3 && relay.read().status === 'connected');
  });

  it('resumes after the last complete event without forwarding a truncated event', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({ sessionId: 'root-chat', upstreamPort: fixture.port });
    disposals.push(() => relay.dispose(), fixture.close);
    await handshake(relay.port, 'factory-cli-mcp-client', 'root-upstream');
    let text = '';
    const ended = vi.fn();
    await openStream(relay.port, 'root-upstream', chunk => { text += chunk; }, ended);
    fixture.writeRootStream('id: complete-1\ndata: {"value":"完整"}\n\n');
    await waitFor(() => text.includes('完整'));
    fixture.writeRootStream('id: partial-2\ndata: {"value":"fragment');
    fixture.closeRootStream();
    await waitFor(() => fixture.streamRequests.length === 2 && relay.read().status === 'connected');
    expect(fixture.streamRequests[1]?.lastEventId).toBe('complete-1');
    expect(text).not.toContain('fragment');
    fixture.writeRootStream('id: complete-2\ndata: {"value":"restored"}\n\n');
    await waitFor(() => text.includes('restored'));
    expect(text.match(/id: complete-1/gu)).toHaveLength(1);
    expect(ended).not.toHaveBeenCalled();
  });

  it('rejects pending and future readiness waits after disposal', async () => {
    const fixture = await createFixture();
    const relay = await createNativeIdeRelay({ sessionId: 'root-chat', upstreamPort: fixture.port });
    disposals.push(() => relay.dispose(), fixture.close);
    const pending = expect(relay.waitUntilReady()).rejects.toThrow('disposed');
    await relay.dispose();
    await pending;
    expect(relay.read().status).toBe('disconnected');
    await expect(relay.waitUntilReady()).rejects.toThrow('disposed');
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
    const resumedHeartbeat = new Promise<void>((resolve) => { received = resolve; });
    fixture.heartbeat();
    await resumedHeartbeat;
    expect(relay.read().status).toBe('disconnected');
    await expect(relay.waitUntilReady()).rejects.toThrow('heartbeat expired');
  });
});

async function createFixture(includeContext = true): Promise<Fixture> {
  let nextSession = 0;
  const sessions = new Set<string>();
  let rootStream: ServerResponse | undefined;
  const rootStreams: ServerResponse[] = [];
  let failToolList = false;
  let rejectRootStream = false;
  const streamRequests: Fixture['streamRequests'] = [];
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
      streamRequests.push({ lastEventId: firstHeader(request.headers['last-event-id']) });
      if (rejectRootStream) {
        rejectRootStream = false;
        json(response, { error: 'expired session' }, 404);
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
      });
      response.write(': connected\n\n');
      rootStream = response;
      rootStreams.push(response);
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
      if (failToolList) {
        failToolList = false;
        json(response, { error: 'fixture handshake failure' }, 500);
        return;
      }
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
    closeRootStream: (index = -1) => rootStreams.at(index)?.end(),
    destroyRootStream: (index = -1) => rootStreams.at(index)?.destroy(),
    failNextToolList: () => { failToolList = true; },
    rejectNextRootStream: () => { rejectRootStream = true; },
    writeRootStream: frame => { rootStream?.write(frame); },
    streamRequests,
    heartbeat: (index) => {
      const stream = index === undefined ? rootStream : rootStreams.at(index);
      stream?.write('event: message\r\n');
      stream?.write('data: {"jsonrpc":"2.0","method":"notifications/heartbeat","params":{"timestamp":1}}\r\n\r\n');
    },
    close: () => {
      for (const stream of rootStreams) stream.end();
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

function openStream(port: number, session: string, onData?: (text: string) => void, onEnd?: () => void): Promise<void> {
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
      if (onEnd) response.once('close', onEnd);
      response.on('error', reject);
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
