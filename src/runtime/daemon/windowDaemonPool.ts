import { randomUUID } from 'node:crypto';
import type { DaemonApi, DaemonSessionHandle } from './api';
import { openDaemonConnection, type DaemonConnection } from './daemonConnection';
import { resolveDaemonListenerPid, startDetachedDaemon, stopDaemon } from './daemonLifecycle';
import {
  listWindowDaemons, readSessionDaemon, removeWindowDaemon, windowDaemonUrl,
  writeSessionDaemon, writeWindowDaemon, type WindowDaemonRecord,
} from './windowDaemonRegistry';

export interface WindowDaemonBinding {
  readonly cwd: string;
  readonly port: number | null;
  readonly detail: string | null;
}
export interface WindowDaemonEntry {
  readonly record: WindowDaemonRecord;
  readonly connection: DaemonConnection;
}
export interface WindowDaemonPoolOptions {
  prepare(): Promise<WindowDaemonBinding>;
  record(event: { level: 'info' | 'warn' | 'error'; name: string; detail?: string }): void;
}

/** Session ownership is independent of the currently selected chat or window. */
export class WindowDaemonPool {
  private currentEntry: Promise<WindowDaemonEntry> | undefined;
  private readonly connections = new Map<string, Promise<WindowDaemonEntry>>();
  private readonly connecting = new Map<string, Promise<WindowDaemonEntry | null>>();
  private readonly owners = new Map<string, WindowDaemonEntry>();
  private readonly handles = new Map<string, DaemonSessionHandle>();
  private readonly listeners = new Set<(entry: WindowDaemonEntry) => void>();
  private readonly owned = new Set<string>();
  private readonly used = new Set<string>();
  private disposed = false;
  private binding: WindowDaemonBinding | undefined;

  constructor(private readonly options: WindowDaemonPoolOptions) {}

  get preparation(): WindowDaemonBinding | undefined { return this.binding; }

  onConnection(listener: (entry: WindowDaemonEntry) => void): () => void {
    this.listeners.add(listener);
    for (const pending of this.connections.values()) void pending.then(listener, () => undefined);
    return () => this.listeners.delete(listener);
  }

  async current(): Promise<WindowDaemonEntry> {
    if (this.disposed) throw new Error('Window daemon is disposed.');
    if (!this.currentEntry) {
      const attempt = this.start();
      this.currentEntry = attempt;
      void attempt.catch(() => { if (this.currentEntry === attempt) this.currentEntry = undefined; });
    }
    const pending = this.currentEntry;
    const entry = await pending;
    if (entry.connection.status() === 'connected') return entry;
    if (this.currentEntry !== pending) return this.current();
    const reconnect = this.existing(entry.record).then((restored) => restored ?? this.start());
    this.currentEntry = reconnect;
    void reconnect.catch(() => { if (this.currentEntry === reconnect) this.currentEntry = undefined; });
    return reconnect;
  }

  async forSession(sessionId: string): Promise<WindowDaemonEntry> {
    const cached = this.owners.get(sessionId);
    if (cached && cached.connection.status() === 'connected') return cached;
    const ownerId = await readSessionDaemon(sessionId);
    const records = await listWindowDaemons();
    // Inspect known original owners first; never resume on two live daemons.
    records.sort((a, b) => Number(b.id === ownerId) - Number(a.id === ownerId));
    let found: WindowDaemonEntry | undefined;
    for (const record of records) {
      const entry = await this.existing(record);
      if (!entry) continue;
      const opened = await entry.connection.droid.sessions.listOpened({ filter: { includeBtwForks: true } });
      if (!opened.some((session) => session.id === sessionId)) continue;
      if (found && found.record.id !== entry.record.id) {
        throw new Error('This session is open on multiple daemons. Resolve its ownership before continuing.');
      }
      found = entry;
    }
    const owner = ownerId ? records.find((record) => record.id === ownerId) : undefined;
    const entry = found ?? (owner ? await this.existing(owner) : null) ?? await this.current();
    await this.remember(sessionId, entry);
    return entry;
  }

  async all(): Promise<WindowDaemonEntry[]> {
    const current = await this.current();
    const entries = new Map<string, WindowDaemonEntry>([[current.record.id, current]]);
    for (const record of await listWindowDaemons()) {
      const entry = await this.existing(record);
      if (entry) entries.set(record.id, entry);
    }
    return [...entries.values()];
  }

  async remember(sessionId: string, entry: WindowDaemonEntry, handle?: DaemonSessionHandle): Promise<void> {
    await writeSessionDaemon(sessionId, entry.record.id);
    this.owners.set(sessionId, entry);
    if (handle) this.used.add(entry.record.id);
    if (handle) this.handles.set(sessionId, handle);
  }

  needsReconnect(sessionId: string): boolean {
    const entry = this.owners.get(sessionId);
    return entry !== undefined && (!this.owned.has(entry.record.id) ||
      entry.record.idePort !== this.binding?.port || entry.record.idePort === null);
  }

  observeSession(sessionId: string, entry: WindowDaemonEntry): boolean {
    const owner = this.owners.get(sessionId);
    if (owner && owner.record.id !== entry.record.id) return false;
    this.owners.set(sessionId, entry);
    if (this.owned.has(entry.record.id)) this.used.add(entry.record.id);
    return true;
  }

  async reconnectIdle(
    sessionId: string,
    isCurrent: () => boolean,
    onClosingSource: () => void,
  ): Promise<void> {
    const source = await this.forSession(sessionId);
    const preparation = await this.options.prepare();
    this.binding = preparation;
    if (preparation.port === null) throw new Error(preparation.detail ?? 'The IDE service is unavailable.');
    const droid = source.connection.droid;
    const opened = await droid.sessions.listOpened({ filter: { includeBtwForks: true } });
    const session = opened.find(({ id }) => id === sessionId);
    if (!session || busySessionTree(opened, sessionId)) {
      throw new Error('Wait for the session and its child tasks to finish before reconnecting IDE.');
    }
    if ((await droid.terminals.list(sessionId, {})).length > 0) {
      throw new Error('Close this session’s managed terminals before reconnecting IDE.');
    }
    const history = await droid.sessions.getMessages(sessionId, { limit: 100 });
    if (!history.some((message) => String(message.role) === 'user' &&
        message.content.some((block) => block.type === 'text' ? block.text.trim().length > 0 :
          block.type === 'image' || block.type === 'document'))) {
      // Native close may delete an empty draft; do not risk its identity.
      throw new Error('Could not confirm durable user content. Use a new chat for IDE integration.');
    }
    const handle = this.handles.get(sessionId);
    if (!handle) throw new Error('The active session must be attached before reconnecting IDE.');
    let target = await this.current();
    if (target.record.idePort !== preparation.port || target.record.cwd !== preparation.cwd ||
        source.record.id === target.record.id) {
      // SDK 0.7.0 cannot reconnect the native IDE client in an existing worker.
      this.currentEntry = undefined;
      target = await this.current();
    }
    const latest = await droid.sessions.listOpened({ filter: { includeBtwForks: true } });
    if (!latest.some(({ id }) => id === sessionId) || busySessionTree(latest, sessionId)) {
      throw new Error('The session became active. IDE reconnection was cancelled.');
    }
    if (!isCurrent()) throw new Error('The selected session changed. IDE reconnection was cancelled.');
    onClosingSource();
    await handle.close();
    this.handles.delete(sessionId);
    if ((await droid.sessions.listOpened()).some(({ id }) => id === sessionId)) {
      throw new Error('The original daemon has not confirmed session closure. IDE reconnection was not started.');
    }
    await this.remember(sessionId, target);
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.currentEntry) await this.currentEntry.catch(() => undefined);
    const entries = await Promise.allSettled(this.connections.values());
    for (const result of entries) {
      if (result.status !== 'fulfilled') continue;
      const entry = result.value;
      try {
        // Detached sessions (including idle ones) may still own tool processes.
        // Only an empty daemon created by this activation is eligible for cleanup.
        if (this.owned.has(entry.record.id) && !this.used.has(entry.record.id) &&
            entry.connection.status() === 'connected' &&
            (await entry.connection.droid.sessions.listOpened({ filter: { includeBtwForks: true } })).length === 0) {
          const pid = await resolveDaemonListenerPid(entry.record.port, '127.0.0.1');
          if (pid === entry.record.pid) {
            await stopDaemon({ url: windowDaemonUrl(entry.record), pid });
            if (!isProcessAlive(pid)) await removeWindowDaemon(entry.record);
          }
        }
      } catch {
        this.options.record({ level: 'warn', name: 'daemon.window.cleanup-deferred' });
      } finally {
        entry.connection.dispose();
      }
    }
    this.connections.clear();
    this.connecting.clear();
    this.listeners.clear();
  }

  async shutdownCurrent(): Promise<boolean> {
    if (!this.currentEntry) return false;
    const entry = await this.currentEntry;
    if (!this.owned.has(entry.record.id)) return false;
    const pid = await resolveDaemonListenerPid(entry.record.port, '127.0.0.1');
    if (pid !== entry.record.pid) throw new Error('The window daemon identity could not be verified.');
    await stopDaemon({ url: windowDaemonUrl(entry.record), pid });
    if (isProcessAlive(pid)) throw new Error('The daemon has not confirmed shutdown. Its recovery record was retained.');
    entry.connection.dispose();
    await removeWindowDaemon(entry.record);
    this.currentEntry = undefined;
    this.connections.delete(entry.record.id);
    for (const [id, owner] of this.owners) if (owner.record.id === entry.record.id) this.owners.delete(id);
    return true;
  }

  private async start(): Promise<WindowDaemonEntry> {
    const binding = await this.options.prepare();
    this.binding = binding;
    if (this.disposed) throw new Error('Window daemon is disposed.');
    const env = { ...process.env };
    delete env.FACTORY_VSCODE_MCP_PORT;
    delete env.FACTORY_JETBRAINS_MCP_PORT;
    if (binding.port !== null) env.FACTORY_VSCODE_MCP_PORT = String(binding.port);
    const endpoint = await startDetachedDaemon({ cwd: binding.cwd, env });
    const record: WindowDaemonRecord = {
      id: randomUUID(), port: endpoint.port, pid: endpoint.pid, ownerPid: process.pid,
      cwd: binding.cwd, idePort: binding.port,
    };
    const pending = (async () => {
      await writeWindowDaemon(record);
      const connection = await openDaemonConnection(endpoint);
      const entry = { record, connection };
      this.owned.add(record.id);
      for (const listener of this.listeners) listener(entry);
      this.options.record({ level: 'info', name: 'daemon.window.started' });
      return entry;
    })();
    this.connections.set(record.id, pending);
    try {
      return await pending;
    } catch (error) {
      this.connections.delete(record.id);
      await stopDaemon(endpoint);
      await removeWindowDaemon(record);
      throw error;
    }
  }

  private existing(record: WindowDaemonRecord): Promise<WindowDaemonEntry | null> {
    const current = this.connecting.get(record.id);
    if (current) return current;
    const pending = this.restoreConnection(record);
    this.connecting.set(record.id, pending);
    const clear = () => { if (this.connecting.get(record.id) === pending) this.connecting.delete(record.id); };
    void pending.then(clear, clear);
    return pending;
  }

  private async restoreConnection(record: WindowDaemonRecord): Promise<WindowDaemonEntry | null> {
    const cached = this.connections.get(record.id);
    if (cached) {
      const entry = await cached;
      if (entry.connection.status() === 'connected') return entry;
      entry.connection.dispose();
      this.connections.delete(record.id);
    }
    const pid = await resolveDaemonListenerPid(record.port, '127.0.0.1');
    if (pid === null) {
      // An alive owner with an unreachable service is not proof its work stopped.
      if (!isProcessAlive(record.pid)) return null;
      throw new Error('An existing session daemon is unavailable. Retry without starting a duplicate session.');
    }
    if (pid !== record.pid) throw new Error('Daemon discovery no longer matches its listener process.');
    const pending = openDaemonConnection({ url: windowDaemonUrl(record) }).then((connection) => {
      const entry = { record, connection };
      for (const listener of this.listeners) listener(entry);
      return entry;
    });
    this.connections.set(record.id, pending);
    try { return await pending; }
    catch (error) { this.connections.delete(record.id); throw error; }
  }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function busySessionTree(
  opened: Awaited<ReturnType<DaemonApi['sessions']['listOpened']>>,
  sessionId: string,
): boolean {
  const ids = new Set([sessionId]);
  let previous: number;
  do {
    previous = ids.size;
    for (const row of opened) if (row.parentSessionId && ids.has(row.parentSessionId)) ids.add(row.id);
  } while (ids.size !== previous);
  return opened.some((row) => ids.has(row.id) && String(row.workingState) !== 'idle');
}
