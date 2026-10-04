import { createServer, request } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createReloadableIdeEndpoint } from './reloadableIdeEndpoint';
import { createNativeIdeRelay } from './nativeIdeRelay';

const disposals: Array<() => Promise<void>> = [];
afterEach(async () => { await Promise.all(disposals.splice(0).map((dispose) => dispose())); vi.useRealTimers(); });
const initialize = (name: string) => ({ jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name, version: '1.0.0' } } });

describe('reloadable native IDE endpoint', () => {
  it('renews root and child liveness from real IDE discovery after the server heartbeat phase resets', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    const first = await fixture('first');
    const next = await fixture('next', false, false);
    next.refreshContextOnDiscovery();
    const endpoint = await createReloadableIdeEndpoint({ upstreamPort: first.port, recoveryTimeoutMs: 2_000 });
    const relay = await createNativeIdeRelay({ sessionId: 'chat', upstreamPort: endpoint.port, timeoutMs: 2_000 });
    disposals.push(endpoint.dispose, () => relay.dispose());
    const root = await handshake(relay.port, 'factory-cli-mcp-client');
    const child = await handshake(relay.port, 'child');
    const rootEvents = await events(relay.port, root);
    const childEvents = await events(relay.port, child);
    await rpc(relay.port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, root);
    await relay.waitUntilReady();
    await childEvents.waitFor('first-child');
    vi.advanceTimersByTime(40_000);
    await first.close();
    await endpoint.updateUpstream(next.port);
    await rootEvents.waitFor('notifications/heartbeat');
    await childEvents.waitFor('notifications/heartbeat');
    expect(rootEvents.text()).toContain('next-factory-cli-mcp-client');
    expect(childEvents.text()).toContain('next-child');
    expect(next.calls.filter(call => call.method === 'tools/list').map(call => call.client).sort())
      .toEqual(['child', 'factory-cli-mcp-client']);
    vi.advanceTimersByTime(40_000);
    expect(relay.read().status).toBe('connected');
    expect(endpoint.read()).toBe('connected');
    expect(rootEvents.closed()).toBe(false);
    expect(childEvents.closed()).toBe(false);
    expect(next.calls.some(call => call.method === 'tools/call')).toBe(false);
  });

  it('does not renew heartbeats when editor events arrive but discovery fails', async () => {
    const first = await fixture('first');
    const next = await fixture('next', false, false);
    next.refreshContextOnDiscovery();
    next.rejectDiscovery();
    const endpoint = await createReloadableIdeEndpoint({ upstreamPort: first.port, recoveryTimeoutMs: 100 });
    disposals.push(endpoint.dispose);
    const id = await handshake(endpoint.port, 'root');
    const stream = await events(endpoint.port, id);
    await stream.waitFor('first-root');
    await expect(endpoint.updateUpstream(next.port)).rejects.toThrow('could not be restored');
    expect(stream.text()).toContain('next-root');
    expect(stream.text()).not.toContain('notifications/heartbeat');
    expect(endpoint.read()).toBe('error');
  });

  it('preserves the native relay handshake and stream when the editor service reloads', async () => {
    const first = await fixture('first');
    const next = await fixture('next');
    first.useSseInitialization();
    next.useSseInitialization();
    const endpoint = await createReloadableIdeEndpoint({ upstreamPort: first.port, recoveryTimeoutMs: 2_000 });
    const relay = await createNativeIdeRelay({ sessionId: 'chat', upstreamPort: endpoint.port, timeoutMs: 2_000 });
    disposals.push(endpoint.dispose, () => relay.dispose());
    const id = await handshake(relay.port, 'factory-cli-mcp-client');
    const stream = await events(relay.port, id);
    await rpc(relay.port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, id);
    await relay.waitUntilReady();
    await first.close();
    await until(() => endpoint.read() === 'recovering');
    await endpoint.updateUpstream(next.port);
    await stream.waitFor('next-factory-cli-mcp-client');
    expect(relay.read().status).toBe('connected');
    expect(stream.closed()).toBe(false);
    expect((await rpc(relay.port, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'openFile' } }, id)).status).toBe(200);
    expect(next.calls.filter((call) => call.method === 'tools/call')).toHaveLength(1);
  });

  it('keeps two clients and their open event streams distinct across a real upstream replacement', async () => {
    const first = await fixture('first');
    const next = await fixture('next');
    const endpoint = await createReloadableIdeEndpoint({ upstreamPort: first.port, recoveryTimeoutMs: 2_000 });
    disposals.push(endpoint.dispose);
    const root = await handshake(endpoint.port, 'root');
    const child = await handshake(endpoint.port, 'child');
    const rootEvents = await events(endpoint.port, root);
    const childEvents = await events(endpoint.port, child);
    await rootEvents.waitFor('first-root');
    await childEvents.waitFor('first-child');
    await first.close();
    await until(() => endpoint.read() === 'recovering');
    expect(rootEvents.closed()).toBe(false);
    expect(childEvents.closed()).toBe(false);

    await endpoint.updateUpstream(next.port);
    expect(endpoint.read()).toBe('connected');
    await rootEvents.waitFor('next-root');
    await childEvents.waitFor('next-child');
    expect(rootEvents.text()).not.toContain('next-child');
    expect(childEvents.text()).not.toContain('next-root');
    expect(next.calls.filter((call) => call.method === 'initialize').map((call) => call.client).sort()).toEqual(['child', 'root']);
    expect(next.calls.filter((call) => call.method === 'notifications/initialized')).toHaveLength(2);

    const result = await rpc(endpoint.port, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'openFile' } }, root);
    expect(result.status).toBe(200);
    expect(result.body).toContain('next-root');
    expect(next.calls.filter((call) => call.method === 'tools/call')).toEqual([
      expect.objectContaining({ session: 'next-root', client: 'root' }),
    ]);
  });

  it('does not replay an interrupted tool call and forwards a new waiting call only once', async () => {
    const first = await fixture('first', true);
    const next = await fixture('next');
    const endpoint = await createReloadableIdeEndpoint({ upstreamPort: first.port, recoveryTimeoutMs: 2_000 });
    disposals.push(endpoint.dispose);
    const id = await handshake(endpoint.port, 'root');
    const stream = await events(endpoint.port, id);
    await stream.waitFor('first-root');
    const inFlight = rpc(endpoint.port, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'old' } }, id);
    await until(() => first.calls.some((call) => call.method === 'tools/call'));
    await first.close();
    expect((await inFlight).status).toBe(502);
    await until(() => endpoint.read() === 'recovering');
    const waiting = rpc(endpoint.port, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'new' } }, id);
    await endpoint.updateUpstream(next.port);
    expect((await waiting).status).toBe(200);
    expect(first.calls.filter((call) => call.method === 'tools/call')).toHaveLength(1);
    expect(next.calls.filter((call) => call.method === 'tools/call')).toEqual([
      expect.objectContaining({ params: { name: 'new' } }),
    ]);
  });

  it('does not invent heartbeats and closes unrecoverable streams within the configured bound', async () => {
    const first = await fixture('first');
    const endpoint = await createReloadableIdeEndpoint({ upstreamPort: first.port, recoveryTimeoutMs: 100 });
    disposals.push(endpoint.dispose);
    const id = await handshake(endpoint.port, 'root');
    const stream = await events(endpoint.port, id);
    await stream.waitFor('first-root');
    const before = stream.text();
    await first.close();
    await until(() => endpoint.read() === 'error');
    await until(stream.closed);
    expect(stream.text()).toBe(before);
    expect(stream.text()).not.toContain('notifications/heartbeat');
  });

  it('does not poison a healthy root when one child cannot restore its upstream session', async () => {
    const first = await fixture('first');
    const next = await fixture('next');
    next.rejectClient('child');
    const endpoint = await createReloadableIdeEndpoint({ upstreamPort: first.port, recoveryTimeoutMs: 100 });
    disposals.push(endpoint.dispose);
    const root = await handshake(endpoint.port, 'root');
    const child = await handshake(endpoint.port, 'child');
    const rootEvents = await events(endpoint.port, root);
    const childEvents = await events(endpoint.port, child);
    await childEvents.waitFor('first-child');
    await endpoint.updateUpstream(next.port);
    await rootEvents.waitFor('next-root');
    await until(childEvents.closed);
    expect(endpoint.read()).toBe('connected');
    expect(rootEvents.closed()).toBe(false);
    expect((await rpc(endpoint.port, { jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'openFile' } }, root)).status).toBe(200);
  });

  it('waits for a real replacement event stream before reporting a restored connection', async () => {
    const first = await fixture('first');
    const next = await fixture('next', false, false);
    const endpoint = await createReloadableIdeEndpoint({ upstreamPort: first.port, recoveryTimeoutMs: 2_000 });
    disposals.push(endpoint.dispose);
    const id = await handshake(endpoint.port, 'root');
    const stream = await events(endpoint.port, id);
    await stream.waitFor('first-root');
    let restored = false;
    const updating = endpoint.updateUpstream(next.port).then(() => { restored = true; });
    await until(() => next.streamCount() === 1);
    expect(restored).toBe(false);
    expect(endpoint.read()).toBe('recovering');
    next.emit('root', { jsonrpc: '2.0', method: 'notifications/heartbeat', params: { timestamp: 123 } });
    await updating;
    await stream.waitFor('"timestamp":123');
    expect(endpoint.read()).toBe('connected');
  });

  it('rejects browser origins and unknown sessions before forwarding to the IDE', async () => {
    const upstream = await fixture('first');
    const endpoint = await createReloadableIdeEndpoint({ upstreamPort: upstream.port });
    disposals.push(endpoint.dispose);
    expect((await rpc(endpoint.port, initialize('root'), undefined, { origin: 'https://example.com' })).status).toBe(403);
    expect((await rpc(endpoint.port, { jsonrpc: '2.0', id: 1, method: 'tools/call' }, 'missing')).status).toBe(404);
    expect(upstream.calls).toHaveLength(0);
  });

  it('allows a short GET reconnect, then retires abandoned children before the next Reload', async () => {
    const first = await fixture('first');
    const next = await fixture('next');
    const endpoint = await createReloadableIdeEndpoint({ upstreamPort: first.port, recoveryTimeoutMs: 100 });
    disposals.push(endpoint.dispose);
    const root = await handshake(endpoint.port, 'root');
    const child = await handshake(endpoint.port, 'child');
    const rootEvents = await events(endpoint.port, root);
    const childEvents = await events(endpoint.port, child);
    await childEvents.waitFor('first-child');
    childEvents.close();
    await until(() => first.streamCount() === 1);
    const reopened = await events(endpoint.port, child);
    await reopened.waitFor('first-child');
    await new Promise<void>(resolve => setTimeout(resolve, 150));
    expect((await rpc(endpoint.port, { jsonrpc: '2.0', id: 4, method: 'tools/list' }, child)).status).toBe(200);
    reopened.close();
    await until(() => first.streamCount() === 1);
    await new Promise<void>(resolve => setTimeout(resolve, 150));
    expect((await rpc(endpoint.port, { jsonrpc: '2.0', id: 5, method: 'tools/list' }, child)).status).toBe(404);

    await endpoint.updateUpstream(next.port);
    await rootEvents.waitFor('next-root');
    expect(next.calls.filter(call => call.method === 'initialize').map(call => call.client)).toEqual(['root']);
    expect(rootEvents.closed()).toBe(false);
    expect(endpoint.read()).toBe('connected');
    expect((await rpc(endpoint.port, { jsonrpc: '2.0', id: 6, method: 'tools/call' }, root)).status).toBe(200);
  });

  it('retires an initialized client that never opens an event stream', async () => {
    const upstream = await fixture('first');
    const endpoint = await createReloadableIdeEndpoint({ upstreamPort: upstream.port, recoveryTimeoutMs: 100 });
    disposals.push(endpoint.dispose);
    const initialized = await rpc(endpoint.port, initialize('abandoned'));
    const id = String(initialized.headers['mcp-session-id']);
    await new Promise<void>(resolve => setTimeout(resolve, 150));
    expect((await rpc(endpoint.port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, id)).status).toBe(404);
    expect(endpoint.read()).toBe('connected');
  });

  it('retains an in-flight POST without GET until it completes, then expires it normally', async () => {
    const upstream = await fixture('first', true);
    const endpoint = await createReloadableIdeEndpoint({ upstreamPort: upstream.port, recoveryTimeoutMs: 100 });
    disposals.push(endpoint.dispose);
    const id = await handshake(endpoint.port, 'child');
    const inFlight = rpc(endpoint.port, { jsonrpc: '2.0', id: 3, method: 'tools/call' }, id);
    await until(() => upstream.calls.some(call => call.method === 'tools/call'));
    await new Promise<void>(resolve => setTimeout(resolve, 150));
    const stream = await events(endpoint.port, id);
    await stream.waitFor('first-child');
    upstream.releaseTools();
    expect((await inFlight).status).toBe(200);
    stream.close();
    await until(() => upstream.streamCount() === 0);
    await new Promise<void>(resolve => setTimeout(resolve, 150));
    expect((await rpc(endpoint.port, { jsonrpc: '2.0', id: 4, method: 'tools/list' }, id)).status).toBe(404);
    expect(upstream.calls.filter(call => call.method === 'tools/call')).toHaveLength(1);
  });
});

async function handshake(port: number, client: string): Promise<string> {
  const initialized = await rpc(port, initialize(client));
  expect(initialized.status).toBe(200);
  const id = String(initialized.headers['mcp-session-id']);
  expect(id).not.toContain(client);
  expect((await rpc(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, id)).status).toBe(202);
  return id;
}

async function fixture(prefix: string, holdTools = false, sendInitialEvent = true) {
  const calls: Array<{ method: string; session?: string; client?: string; params?: unknown }> = [];
  const clients = new Map<string, string>();
  const streams = new Map<string, ServerResponse>();
  const heldTools: Array<() => void> = [];
  let closed = false;
  let sseInitialization = false;
  let rejectedClient: string | undefined;
  let refreshContext = false;
  let discoveryFails = false;
  const server = createServer((request, response) => {
    const id = typeof request.headers['mcp-session-id'] === 'string' ? request.headers['mcp-session-id'] : undefined;
    if (request.method === 'GET') {
      if (!id || !clients.has(id)) { response.writeHead(404).end(); return; }
      streams.set(id, response);
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.flushHeaders();
      if (sendInitialEvent) response.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/activeFile', params: { fileName: id } })}\n\n`);
      response.once('close', () => streams.delete(id));
      return;
    }
    const parts: Buffer[] = [];
    request.on('data', (chunk: Buffer) => parts.push(chunk));
    request.on('end', () => {
      const message = JSON.parse(Buffer.concat(parts).toString('utf8'));
      const client = message.method === 'initialize' ? message.params.clientInfo.name : clients.get(id!);
      calls.push({ method: message.method, ...(id ? { session: id } : {}), client, params: message.params });
      if (message.method === 'initialize') {
        if (client === rejectedClient) { response.writeHead(503).end(); return; }
        const session = `${prefix}-${client}`;
        clients.set(session, client);
        response.writeHead(200, { 'content-type': sseInitialization ? 'text/event-stream' : 'application/json', 'mcp-session-id': session });
        const initialized = JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: prefix, version: '1' } } });
        response.end(sseInitialization ? `event: message\ndata: ${initialized}\n\n` : initialized);
      } else if (message.method === 'notifications/initialized') response.writeHead(202).end();
      else {
        const reply = () => {
          if (message.method === 'tools/list' && refreshContext) {
            streams.get(id!)?.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/openFiles', params: { files: [id] } })}\n\n`);
          }
          response.writeHead(200, { 'content-type': 'application/json' });
          if (message.method === 'tools/list' && discoveryFails) {
            response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: 'IDE failed' } }));
            return;
          }
          response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id,
            result: message.method === 'tools/list' ? { tools: [] } : { session: id } }));
        };
        if (holdTools && message.method === 'tools/call') heldTools.push(reply);
        else reply();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const close = async () => {
    if (closed) return;
    closed = true;
    await new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections(); });
  };
  disposals.push(close);
  return { port, calls, close, streamCount: () => streams.size,
    releaseTools: () => { for (const reply of heldTools.splice(0)) reply(); },
    useSseInitialization: () => { sseInitialization = true; },
    refreshContextOnDiscovery: () => { refreshContext = true; },
    rejectDiscovery: () => { discoveryFails = true; },
    rejectClient: (client: string) => { rejectedClient = client; },
    emit: (client: string, event: unknown) => streams.get(`${prefix}-${client}`)?.write(`data: ${JSON.stringify(event)}\n\n`) };
}

async function rpc(port: number, body: unknown, session?: string, extraHeaders = {}): Promise<{
  status: number; body: string; headers: IncomingMessage['headers'];
}> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ hostname: '127.0.0.1', port, path: '/mcp', method: 'POST', headers: {
      'content-type': 'application/json', accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session } : {}), ...extraHeaders,
    } }, (response) => {
      let text = '';
      response.on('data', (chunk) => { text += chunk.toString(); });
      response.once('error', reject);
      response.once('end', () => resolve({ status: response.statusCode!, body: text, headers: response.headers }));
    });
    outgoing.once('error', reject);
    outgoing.end(JSON.stringify(body));
  });
}

async function events(port: number, session: string) {
  let text = '';
  let closed = false;
  const outgoing = request({ hostname: '127.0.0.1', port, path: '/mcp', method: 'GET',
    headers: { accept: 'text/event-stream', 'mcp-session-id': session } });
  const connected = new Promise<void>((resolve, reject) => {
    outgoing.once('error', reject);
    outgoing.once('response', (response) => {
      response.on('data', (chunk) => { text += chunk.toString(); });
      response.on('error', () => {});
      response.once('close', () => { closed = true; });
      resolve();
    });
  });
  outgoing.end();
  await connected;
  disposals.push(async () => { outgoing.destroy(); });
  return { text: () => text, closed: () => closed, close: () => outgoing.destroy(),
    waitFor: (value: string) => until(() => text.includes(value)) };
}

async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_500;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Expected IDE state was not observed.');
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
