import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, request, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { restorePersistentIdeRelay } from './persistentIdeRelay';
import type { PersistentIdeRelayDescriptor } from './persistentIdeRelayProtocol';

let directory: string;
const cleanup: Array<() => Promise<void>> = [];
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'droid-ide-process-'));
  await build({ entryPoints: ['src/runtime/ide/persistentIdeRelayWorker.ts'], outfile: join(directory, 'relay.cjs'),
    bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
  await build({ stdin: { contents: `
    import { createPersistentIdeRelay } from './src/runtime/ide/persistentIdeRelay';
    const relay = await createPersistentIdeRelay({sessionId:'root-chat', upstreamPort:Number(process.argv[2]), workerPath:process.argv[3]});
    await relay.bindDaemon(Number(process.argv[4]));
    process.stdout.write(JSON.stringify({descriptor:relay.descriptor,port:relay.port})+'\\n');
    process.stdin.once('data',async()=>{await relay.dispose();process.exit(0);});
  `, resolveDir: resolve('.') }, outfile: join(directory, 'host.mjs'),
    bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' });
});
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); });
afterAll(async () => {
  if (!directory) return;
  if (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('droid-ide-process-')) {
    throw new Error('Unexpected isolated process fixture directory.');
  }
  await rm(directory, { recursive: true, force: true });
});

describe('persistent IDE relay process', () => {
  it('survives its host process exiting and reconnects root and child clients without restarting or replaying a tool', async () => {
    const first = await ide('first');
    const second = await ide('second');
    const daemon = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { windowsHide: true, stdio: 'ignore' });
    cleanup.push(() => terminate(daemon));
    const host = spawn(process.execPath, [join(directory, 'host.mjs'), String(first.port), join(directory, 'relay.cjs'), String(daemon.pid)],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    cleanup.push(() => terminate(host));
    const started = await startup(host);
    cleanup.push(async () => {
      if (alive(started.descriptor.pid)) process.kill(started.descriptor.pid);
    });
    const root = await handshake(started.port);
    const child = await handshake(started.port);
    const rootEvents = await events(started.port, root);
    const childEvents = await events(started.port, child);
    await vi.waitFor(() => expect(rootEvents.text()).toContain('first-1'));
    await vi.waitFor(() => expect(childEvents.text()).toContain('first-2'));
    await rpc(started.port, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'openFile' } }, root);
    // A second live editor cannot steal the relay from the first one.
    await expect(restorePersistentIdeRelay({ descriptor: started.descriptor, sessionId: 'root-chat', upstreamPort: second.port }))
      .rejects.toThrow('rejected');
    const exited = once(host, 'exit');
    host.stdin!.write('exit');
    await exited;
    expect(alive(started.descriptor.pid)).toBe(true);
    await first.close();
    const restored = await restorePersistentIdeRelay({ descriptor: started.descriptor, sessionId: 'root-chat', upstreamPort: second.port });
    cleanup.push(() => restored.dispose());
    await restored.waitUntilReady();
    expect(restored.port).toBe(started.port);
    expect(restored.descriptor.pid).toBe(started.descriptor.pid);
    expect(restored.read().status).toBe('connected');
    await vi.waitFor(() => expect(rootEvents.text()).toContain('second-1'));
    await vi.waitFor(() => expect(childEvents.text()).toContain('second-2'));
    expect(rootEvents.closed()).toBe(false);
    expect(childEvents.closed()).toBe(false);
    expect(second.toolCalls()).toBe(0);
    await rpc(restored.port, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'openFile' } }, root);
    expect(first.toolCalls()).toBe(1);
    expect(second.toolCalls()).toBe(1);
    // Daemon inactivity releases the old root worker; the same relay must admit its next real handshake.
    rootEvents.close();
    restored.resetForSessionRestart();
    await vi.waitFor(() => expect(restored.read().status).toBe('disconnected'));
    const resumedRoot = await handshake(restored.port);
    await events(restored.port, resumedRoot);
    await restored.waitUntilReady();
    expect(restored.read().status).toBe('connected');
    expect(restored.port).toBe(started.port);
    await terminate(daemon);
    await vi.waitFor(() => expect(alive(started.descriptor.pid)).toBe(false), { timeout: 4000 });
  }, 20_000);
});

async function startup(child: ChildProcess): Promise<{ descriptor: PersistentIdeRelayDescriptor; port: number }> {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Isolated host startup timed out.')), 10_000);
    child.once('exit', () => { clearTimeout(timer); if (!output.includes('\n')) reject(new Error('Isolated host exited.')); });
    child.stdout!.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(output.trim())); }
    });
  });
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
async function terminate(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit'); child.kill(); await exited;
}
async function ide(prefix: string) {
  let calls = 0;
  let next = 0;
  const sessions = new Set<string>();
  const streams = new Set<ServerResponse>();
  const server = createServer((req, res) => {
    const id = req.headers['mcp-session-id'] as string | undefined;
    if (req.method === 'GET') {
      if (!id || !sessions.has(id)) { res.writeHead(404).end(); return; }
      streams.add(res);
      res.once('close', () => streams.delete(res));
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/activeFile', params: { fileName: id } })}\n\n`);
      return;
    }
    let body = '';
    req.on('data', (chunk: Buffer) => { body += chunk.toString(); });
    req.on('end', () => {
      const value = JSON.parse(body);
      if (value.method === 'initialize') {
        const session = `${prefix}-${++next}`;
        sessions.add(session);
        res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': session });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: value.id, result: {
          protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'isolated-IDE', version: '1' },
        } }));
      } else if (!id || !sessions.has(id)) res.writeHead(404).end();
      else if (value.method === 'notifications/initialized') res.writeHead(202).end();
      else {
        if (value.method === 'tools/call') calls++;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', id: value.id, result: value.method === 'tools/list' ? { tools: [] } : { content: [] } }));
      }
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    for (const stream of streams) stream.destroy();
    await new Promise<void>(done => { server.close(() => done()); server.closeAllConnections(); });
  };
  cleanup.push(close);
  return { port: (server.address() as { port: number }).port, close, toolCalls: () => calls };
}
async function handshake(port: number): Promise<string> {
  const id = await rpc(port, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'factory-cli-mcp-client', version: '1.0.0' },
  } });
  await rpc(port, { jsonrpc: '2.0', method: 'notifications/initialized' }, id);
  await rpc(port, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, id);
  return id;
}
async function rpc(port: number, message: unknown, sessionId?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: '/mcp', method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}) } }, res => {
      res.resume();
      res.once('error', reject);
      res.once('end', () => {
        if ((res.statusCode ?? 500) >= 300) reject(new Error(`Isolated IDE returned ${res.statusCode}`));
        else resolve(String(res.headers['mcp-session-id'] ?? sessionId));
      });
    });
    req.once('error', reject); req.end(JSON.stringify(message));
  });
}
async function events(port: number, sessionId: string) {
  let text = '';
  let closed = false;
  const req = request({ host: '127.0.0.1', port, path: '/mcp', method: 'GET',
    headers: { accept: 'text/event-stream', 'mcp-session-id': sessionId } });
  const response = once(req, 'response'); req.end();
  const [res] = await response;
  res.on('data', (chunk: Buffer) => { text += chunk.toString(); });
  res.on('error', () => {});
  res.once('close', () => { closed = true; });
  cleanup.push(async () => { req.destroy(); });
  return { text: () => text, closed: () => closed, close: () => req.destroy() };
}
