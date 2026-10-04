import { createServer } from 'node:http';
import { createNativeIdeRelay } from './nativeIdeRelay';
import { createReloadableIdeEndpoint } from './reloadableIdeEndpoint';
import type { PersistentIdeRelaySnapshot } from './persistentIdeRelayProtocol';

interface Startup {
  sessionId: string;
  upstreamPort: number;
  timeoutMs: number;
  token: string;
  ownerPid: number;
}

async function run(options: Startup): Promise<void> {
  const endpoint = await createReloadableIdeEndpoint({ upstreamPort: options.upstreamPort, recoveryTimeoutMs: 60_000 });
  const relay = await createNativeIdeRelay({ sessionId: options.sessionId, upstreamPort: endpoint.port, timeoutMs: options.timeoutMs });
  let daemonPid: number | undefined;
  let ownerPid = options.ownerPid;
  let upstreamPort = options.upstreamPort;
  let updating: Promise<void> | undefined;
  let disposed = false;
  const startupDeadline = Date.now() + 60_000;
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/control' || req.headers.origin !== undefined
      || req.headers.host !== `127.0.0.1:${port}` || req.headers.authorization !== `Bearer ${options.token}`) {
      res.writeHead(403).end(); req.resume(); return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 4096) req.destroy();
    });
    req.on('error', () => res.destroy());
    req.on('end', () => {
      try {
        const input = JSON.parse(body) as Record<string, unknown>;
        if (input.sessionId !== options.sessionId) throw new Error('Identity mismatch');
        switch (input.command) {
          case 'read': break;
          case 'attach': {
            if (!validPort(input.upstreamPort)) throw new Error('Invalid upstream');
            if (!Number.isInteger(input.ownerPid) || (input.ownerPid as number) < 1
              || (ownerPid !== input.ownerPid && alive(ownerPid))) throw new Error('IDE owner is still active');
            ownerPid = input.ownerPid as number;
            if (input.upstreamPort !== upstreamPort || endpoint.read() === 'recovering') {
              upstreamPort = input.upstreamPort;
              const pending = endpoint.updateUpstream(upstreamPort);
              updating = pending;
              // The endpoint owns failure state and clears it only on a real handshake.
              void pending.catch(() => {}).finally(() => {
                if (updating === pending) updating = undefined;
              });
            }
            break;
          }
          case 'bind':
            if (!Number.isInteger(input.pid) || (input.pid as number) < 1 ||
              (daemonPid !== undefined && daemonPid !== input.pid)) throw new Error('Invalid daemon');
            daemonPid = input.pid as number;
            break;
          case 'reset': relay.resetForSessionRestart(); break;
          case 'prepare': void relay.waitUntilReady().catch(() => {}); break;
          case 'shutdown': res.once('finish', () => { void shutdown(); }); break;
          default: throw new Error('Unknown command');
        }
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(snapshot()));
      } catch { res.writeHead(400).end(); }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('IDE control listener failed');
  const port = address.port;
  const watcher = setInterval(() => {
    if (daemonPid !== undefined ? !alive(daemonPid) : Date.now() > startupDeadline) void shutdown();
  }, 1000);
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  process.stdout.write(JSON.stringify({ port, pid: process.pid, token: options.token }) + '\n');

  function snapshot(): PersistentIdeRelaySnapshot {
    let state = relay.read();
    const failed = endpoint.read() === 'error';
    if (failed) state = { status: 'error', message: 'The native IDE service could not be restored.' };
    else if ((updating || endpoint.read() === 'recovering') && state.status === 'connected') {
      state = { status: 'connecting', message: 'Restoring the native IDE connection after the editor restarted.' };
    }
    return { sessionId: options.sessionId, port: relay.port, state,
      requiresRestart: failed || relay.requiresSessionRestart() };
  }
  async function shutdown(): Promise<void> {
    if (disposed) return;
    disposed = true;
    clearInterval(watcher);
    server.close();
    server.closeAllConnections();
    await Promise.allSettled([relay.dispose(), endpoint.dispose()]);
    process.exit(0);
  }
}

function validPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535;
}
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== 'ESRCH'; }
}

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  input += chunk;
  if (input.length > 8192) process.exit(1);
});
process.stdin.on('end', () => {
  try {
    const options = JSON.parse(input) as Startup;
    if (!options || typeof options.sessionId !== 'string' || options.sessionId.length === 0
      || options.sessionId.length > 256 || !validPort(options.upstreamPort)
      || !Number.isInteger(options.ownerPid) || options.ownerPid < 1
      || typeof options.token !== 'string' || !/^[a-f0-9]{64}$/u.test(options.token)
      || !Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('Invalid startup');
    void run(options).catch(() => process.exit(1));
  } catch { process.exit(1); }
});
