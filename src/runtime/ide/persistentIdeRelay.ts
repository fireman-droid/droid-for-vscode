import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { request } from 'node:http';
import { join } from 'node:path';
import type { NativeIdeRelay, NativeIdeRelayState } from './nativeIdeRelay';
import { isRelayDescriptor, type PersistentIdeRelayDescriptor, type PersistentIdeRelaySnapshot } from './persistentIdeRelayProtocol';

export interface PersistentIdeRelay extends NativeIdeRelay {
  readonly descriptor: PersistentIdeRelayDescriptor;
  bindDaemon(pid: number): Promise<void>;
  shutdown(): Promise<void>;
}

interface RelayOptions {
  sessionId: string;
  upstreamPort: number;
  timeoutMs?: number;
  /** The bundled helper path can be supplied by isolated process verification. */
  workerPath?: string;
}

export async function createPersistentIdeRelay(options: RelayOptions): Promise<PersistentIdeRelay> {
  const token = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [options.workerPath ?? join(__dirname, 'persistentIdeRelayWorker.cjs')], {
    detached: true, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  try {
    const descriptor = await new Promise<PersistentIdeRelayDescriptor>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => finish(new Error('The IDE relay process did not start.')), 15_000);
      const finish = (error?: Error, value?: PersistentIdeRelayDescriptor) => {
        clearTimeout(timer);
        child.removeListener('error', onError);
        child.removeListener('exit', onExit);
        child.stdout.removeListener('data', onData);
        if (error) reject(error); else resolve(value!);
      };
      const onError = () => finish(new Error('The IDE relay process could not be started.'));
      const onExit = () => finish(new Error('The IDE relay process exited during startup.'));
      const onData = (chunk: Buffer) => {
        output += chunk.toString('utf8');
        if (output.length > 4096) { finish(new Error('Invalid IDE relay startup response.')); return; }
        if (!output.includes('\n')) return;
        try {
          const value: unknown = JSON.parse(output.trim());
          if (!isRelayDescriptor(value) || value.pid !== child.pid || value.token !== token) throw new Error();
          finish(undefined, value);
        } catch { finish(new Error('Invalid IDE relay startup response.')); }
      };
      child.once('error', onError);
      child.once('exit', onExit);
      child.stdout.on('data', onData);
      child.stdin.on('error', onError);
      child.stdin.end(JSON.stringify({ sessionId: options.sessionId, upstreamPort: options.upstreamPort,
        timeoutMs: options.timeoutMs ?? 60_000, token, ownerPid: process.pid }));
    });
    child.stdout.destroy();
    child.unref();
    return await restorePersistentIdeRelay({ descriptor, sessionId: options.sessionId, upstreamPort: options.upstreamPort });
  } catch (error) {
    child.kill();
    throw error;
  }
}

export async function restorePersistentIdeRelay(options: {
  descriptor: PersistentIdeRelayDescriptor; sessionId: string; upstreamPort: number;
}): Promise<PersistentIdeRelay> {
  const snapshot = await control(options.descriptor, options.sessionId, 'attach', {
    upstreamPort: options.upstreamPort, ownerPid: process.pid,
  });
  return new RelayClient(options.descriptor, snapshot);
}

class RelayClient implements PersistentIdeRelay {
  readonly sessionId: string;
  readonly port: number;
  private snapshot: PersistentIdeRelaySnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly timer: NodeJS.Timeout;
  private disposed = false;
  private polling = false;
  private pending: Promise<void> = Promise.resolve();

  constructor(readonly descriptor: PersistentIdeRelayDescriptor, snapshot: PersistentIdeRelaySnapshot) {
    this.snapshot = snapshot;
    this.sessionId = snapshot.sessionId;
    this.port = snapshot.port;
    this.timer = setInterval(() => { void this.poll(); }, 500);
    this.timer.unref();
  }
  read(): NativeIdeRelayState { return this.snapshot.state; }
  requiresSessionRestart(): boolean { return this.snapshot.requiresRestart; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  resetForSessionRestart(): void {
    this.pending = this.pending.then(async () => {
      this.apply(await control(this.descriptor, this.sessionId, 'reset'));
    }).catch(() => this.failed());
  }
  async bindDaemon(pid: number): Promise<void> {
    this.apply(await control(this.descriptor, this.sessionId, 'bind', { pid }));
  }
  async waitUntilReady(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await this.pending;
    this.apply(await control(this.descriptor, this.sessionId, 'prepare'));
    signal?.throwIfAborted();
    if (this.read().status === 'connected') return;
    if (this.read().status !== 'connecting') throw new Error(this.read().message);
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        unsubscribe(); signal?.removeEventListener('abort', abort); clearTimeout(timeout);
        if (error) reject(error); else resolve();
      };
      const check = () => {
        if (this.read().status === 'connected') finish();
        else if (this.read().status !== 'connecting') finish(new Error(this.read().message));
      };
      const unsubscribe = this.subscribe(check);
      const abort = () => finish(signal?.reason ?? new Error('IDE readiness wait aborted.'));
      const timeout = setTimeout(() => finish(new Error('Timed out waiting for the native IDE handshake.')), 60_000);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      else check();
    });
  }
  async dispose(): Promise<void> {
    this.disposed = true;
    clearInterval(this.timer);
    this.apply({ ...this.snapshot, state: { status: 'disconnected', message: 'The IDE observer was detached.' } });
    this.listeners.clear();
  }
  async shutdown(): Promise<void> {
    try { await control(this.descriptor, this.sessionId, 'shutdown'); }
    catch (error) {
      // The helper also exits when its daemon exits; cleanup may race that exit.
      try { process.kill(this.descriptor.pid, 0); }
      catch (probe) { if ((probe as NodeJS.ErrnoException).code === 'ESRCH') return; }
      throw error;
    }
    finally { await this.dispose(); }
  }
  private async poll(): Promise<void> {
    if (this.disposed || this.polling) return;
    this.polling = true;
    try {
      await this.pending;
      const snapshot = await control(this.descriptor, this.sessionId, 'read');
      if (!this.disposed) this.apply(snapshot);
    } catch { if (!this.disposed) this.failed(); }
    finally { this.polling = false; }
  }
  private failed(): void {
    this.apply({ ...this.snapshot, requiresRestart: true,
      state: { status: 'error', message: 'The persistent IDE relay is unavailable.' } });
  }
  private apply(snapshot: PersistentIdeRelaySnapshot): void {
    const changed = JSON.stringify(this.snapshot) !== JSON.stringify(snapshot);
    this.snapshot = snapshot;
    if (changed) for (const listener of this.listeners) listener();
  }
}

function control(descriptor: PersistentIdeRelayDescriptor, sessionId: string, command: string,
  parameters: Record<string, number> = {}): Promise<PersistentIdeRelaySnapshot> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ sessionId, command, ...parameters });
    const req = request({ host: '127.0.0.1', port: descriptor.port, path: '/control', method: 'POST',
      headers: { authorization: `Bearer ${descriptor.token}`, 'content-type': 'application/json',
        'content-length': Buffer.byteLength(body) } }, res => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        data += chunk;
        if (data.length > 8192) req.destroy(new Error('Invalid IDE relay response.'));
      });
      res.on('error', reject);
      res.on('end', () => {
        try {
          if (res.statusCode !== 200) throw new Error('The IDE relay rejected the control request.');
          const value = JSON.parse(data) as PersistentIdeRelaySnapshot;
          if (value.sessionId !== sessionId || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535
            || !value.state || !['connecting', 'connected', 'disconnected', 'error'].includes(value.state.status)
            || typeof value.state.message !== 'string' || typeof value.requiresRestart !== 'boolean') {
            throw new Error('Invalid IDE relay response.');
          }
          resolve(value);
        } catch (error) { reject(error); }
      });
    });
    const timeout = setTimeout(() => req.destroy(new Error('IDE relay control request timed out.')), 10_000);
    req.once('close', () => clearTimeout(timeout));
    req.on('error', reject);
    req.end(body);
  });
}
