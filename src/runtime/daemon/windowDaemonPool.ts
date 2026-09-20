import { randomUUID } from 'node:crypto';
import type { IdeState } from '../../shared/protocol/ideProtocol';
import { createNativeIdeRelay, type NativeIdeRelay } from '../ide/nativeIdeRelay';
import type { DaemonApi, DaemonNotification, DaemonSessionHandle } from './api';
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
  readonly ide?: NativeIdeRelay;
}
export interface WindowDaemonPoolOptions {
  prepare(): Promise<WindowDaemonBinding>;
  record(event: {
    level: 'info' | 'warn' | 'error'; name: string;
    attributes?: Record<string, string | number | boolean>; detail?: string;
  }): void;
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
  private readonly allocations = new Map<string, Promise<WindowDaemonEntry>>();
  private readonly ideListeners = new Set<() => void>();
  private readonly ideSubscriptions = new Map<string, () => void>();
  private nextIdeRelay = 0;
  private disposed = false;
  private binding: WindowDaemonBinding | undefined;

  constructor(private readonly options: WindowDaemonPoolOptions) {}

  get preparation(): WindowDaemonBinding | undefined { return this.binding; }

  onIdeChange(listener: () => void): () => void {
    this.ideListeners.add(listener);
    return () => { this.ideListeners.delete(listener); };
  }

  private emitIdeChange(): void {
    for (const listener of this.ideListeners) listener();
  }

  private observeIde(ide: NativeIdeRelay): () => void {
    const relay = ++this.nextIdeRelay;
    const startedAt = Date.now();
    const recordState = () => {
      const state = ide.read();
      this.options.record({
        level: state.status === 'error' || state.status === 'disconnected' ? 'warn' : 'info',
        name: 'ide.native.relay-state',
        attributes: { relay, status: state.status, durationMs: Date.now() - startedAt },
        // Relay messages are fixed lifecycle explanations, never request payloads.
        detail: state.message,
      });
    };
    const unsubscribe = ide.subscribe(() => { recordState(); this.emitIdeChange(); });
    recordState();
    return unsubscribe;
  }

  readIde(sessionId: string | null): Pick<IdeState, 'status' | 'message'> {
    if (!this.binding) return { status: 'preparing', message: 'Preparing the native IDE service.' };
    if (this.binding.port === null) return {
      status: 'unavailable', message: this.binding.detail ?? 'The native IDE service is unavailable. Chat remains available.',
    };
    if (!sessionId) return { status: 'disconnected', message: 'Open a chat to connect its native IDE channel.' };
    const entry = this.owners.get(sessionId);
    if (!entry) return { status: 'preparing', message: 'Connecting this chat to the native IDE service.' };
    if (this.needsReconnect(sessionId)) return {
      status: 'reconnect-required', message: 'This chat needs its own IDE connection. Reconnect when its background tasks finish.',
    };
    const state = entry.ide!.read();
    return { ...state, status: state.status === 'connecting' ? 'preparing' : state.status };
  }

  async waitForIde(sessionId: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const entry = this.owners.get(sessionId);
    if (!entry || this.disposed) throw new Error('The chat backend is no longer available.');
    if (this.binding?.port === null) return;
    if (this.needsReconnect(sessionId)) {
      throw new Error('Reconnect IDE before sending: this chat is still attached to an earlier backend.');
    }
    await entry.ide!.waitUntilReady(signal);
    signal.throwIfAborted();
    if (this.owners.get(sessionId) !== entry || this.disposed) {
      throw new Error('The chat backend changed before the message was sent.');
    }
  }

  async isDelegatedSession(sessionId: string, entry: WindowDaemonEntry): Promise<boolean> {
    if (entry.record.rootSessionId === sessionId) return false;
    const opened = await entry.connection.droid.sessions.listOpened({ filter: { includeBtwForks: true } });
    const row = opened.find((session) => session.id === sessionId);
    return row?.parentSessionId != null || row?.tags?.some((tag) => tag.name === 'btw-fork') === true;
  }

  async rebindIdleAttachment(sessionId: string, source: WindowDaemonEntry): Promise<WindowDaemonEntry> {
    if (!this.needsReconnect(sessionId) || this.binding?.port === null ||
        await this.isDelegatedSession(sessionId, source)) return source;
    const opened = await source.connection.droid.sessions.listOpened({ filter: { includeBtwForks: true } });
    if (!opened.some((session) => session.id === sessionId) || busySessionTree(opened, sessionId)) return source;
    if ((await source.connection.droid.terminals.list(sessionId, {})).length > 0) return source;
    const history = await source.connection.droid.sessions.getMessages(sessionId, { limit: 100 });
    if (!hasDurablePrompt(history)) return source;
    await this.reconnectIdle(sessionId, () => !this.disposed && this.owners.get(sessionId) === source, () => {});
    return this.owners.get(sessionId)!;
  }

  allocate(sessionId: string, cwd?: string): Promise<WindowDaemonEntry> {
    if (this.disposed) return Promise.reject(new Error('Window daemon is disposed.'));
    const existing = this.allocations.get(sessionId);
    if (existing) return existing;
    const attempt = this.start(sessionId, cwd);
    this.allocations.set(sessionId, attempt);
    void attempt.catch(() => {
      if (this.allocations.get(sessionId) === attempt) this.allocations.delete(sessionId);
    });
    return attempt;
  }

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

  async forSession(sessionId: string, attach = false): Promise<WindowDaemonEntry> {
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
    const entry = found ?? (attach
      ? await this.allocate(sessionId, owner?.cwd)
      : (owner ? await this.existing(owner) : null) ?? await this.current());
    if (found || attach) await this.remember(sessionId, entry);
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
    this.emitIdeChange();
  }

  needsReconnect(sessionId: string): boolean {
    const entry = this.owners.get(sessionId);
    return entry !== undefined && (!this.owned.has(entry.record.id) ||
      entry.record.rootSessionId !== sessionId || entry.ide === undefined ||
      entry.record.idePort !== this.binding?.port || entry.record.idePort === null);
  }

  observeSession(sessionId: string, entry: WindowDaemonEntry, notification?: DaemonNotification['notification']): boolean {
    const owner = this.owners.get(sessionId);
    if (owner && owner.record.id !== entry.record.id) return false;
    this.owners.set(sessionId, entry);
    if (this.owned.has(entry.record.id)) this.used.add(entry.record.id);
    if (notification?.type === 'session_inactivity' && entry.record.rootSessionId === sessionId) {
      entry.ide?.resetForSessionRestart();
      this.options.record({ level: 'info', name: 'ide.native.session-idle',
        detail: 'The daemon released the idle worker. Its next load will establish a new native IDE connection.' });
    }
    return true;
  }

  async reconnectIdle(
    sessionId: string,
    isCurrent: () => boolean,
    onClosingSource: () => void,
    deferIfBlocked = false,
  ): Promise<boolean> {
    const blocked = (message: string): false => {
      if (!deferIfBlocked) throw new Error(message);
      return false;
    };
    const source = await this.forSession(sessionId);
    const preparation = await this.options.prepare();
    this.binding = preparation;
    if (preparation.port === null) return blocked(preparation.detail ?? 'The IDE service is unavailable.');
    const droid = source.connection.droid;
    const opened = await droid.sessions.listOpened({ filter: { includeBtwForks: true } });
    const session = opened.find(({ id }) => id === sessionId);
    if (!session || busySessionTree(opened, sessionId)) {
      return blocked('Wait for the session and its child tasks to finish before reconnecting IDE.');
    }
    if ((await droid.terminals.list(sessionId, {})).length > 0) {
      return blocked('Close this session’s managed terminals before reconnecting IDE.');
    }
    const history = await droid.sessions.getMessages(sessionId, { limit: 100 });
    if (!hasDurablePrompt(history)) {
      // Native close may delete an empty draft; do not risk its identity.
      return blocked('Could not confirm durable user content. Use a new chat for IDE integration.');
    }
    const handle = this.handles.get(sessionId);
    if (!handle) return blocked('The active session must be attached before reconnecting IDE.');
    // Never move the live worker in place. Its replacement receives a fresh relay.
    this.allocations.delete(sessionId);
    const allocation = this.allocate(sessionId, source.record.cwd);
    const target = await allocation;
    const latest = await droid.sessions.listOpened({ filter: { includeBtwForks: true } });
    const unsafe = !latest.some(({ id }) => id === sessionId) || busySessionTree(latest, sessionId)
      ? 'The session became active. IDE reconnection was cancelled.'
      : (await droid.terminals.list(sessionId, {})).length > 0
        ? 'Close this session’s managed terminals before reconnecting IDE.'
        : !isCurrent() ? 'The selected session changed. IDE reconnection was cancelled.' : null;
    if (unsafe !== null) {
      if (this.allocations.get(sessionId) === allocation) this.allocations.delete(sessionId);
      try { await this.retireEmpty(target); }
      catch { this.options.record({ level: 'warn', name: 'daemon.session.cleanup-deferred' }); }
      return blocked(unsafe);
    }
    onClosingSource();
    await handle.close();
    this.handles.delete(sessionId);
    if ((await droid.sessions.listOpened()).some(({ id }) => id === sessionId)) {
      throw new Error('The original daemon has not confirmed session closure. IDE reconnection was not started.');
    }
    await this.remember(sessionId, target);
    try { await this.retireEmpty(source); }
    catch { this.options.record({ level: 'warn', name: 'daemon.session.cleanup-deferred' }); }
    return true;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    if (this.currentEntry) await this.currentEntry.catch(() => undefined);
    await Promise.allSettled(this.allocations.values());
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
        await entry.ide?.dispose();
        entry.connection.dispose();
      }
    }
    this.connections.clear();
    this.connecting.clear();
    this.listeners.clear();
    for (const unsubscribe of this.ideSubscriptions.values()) unsubscribe();
    this.ideSubscriptions.clear();
    this.ideListeners.clear();
    this.allocations.clear();
  }

  async shutdownCurrent(sessionId?: string | null): Promise<boolean> {
    const selected = sessionId ? this.owners.get(sessionId) : undefined;
    if (!selected && !this.currentEntry) return false;
    const entry = selected ?? await this.currentEntry!;
    if (!this.owned.has(entry.record.id)) return false;
    const pid = await resolveDaemonListenerPid(entry.record.port, '127.0.0.1');
    if (pid !== entry.record.pid) throw new Error('The window daemon identity could not be verified.');
    await stopDaemon({ url: windowDaemonUrl(entry.record), pid });
    if (isProcessAlive(pid)) throw new Error('The daemon has not confirmed shutdown. Its recovery record was retained.');
    entry.connection.dispose();
    await entry.ide?.dispose();
    await removeWindowDaemon(entry.record);
    if (!selected) this.currentEntry = undefined;
    if (entry.record.rootSessionId) this.allocations.delete(entry.record.rootSessionId);
    this.connections.delete(entry.record.id);
    this.ideSubscriptions.get(entry.record.id)?.();
    this.ideSubscriptions.delete(entry.record.id);
    for (const [id, owner] of this.owners) if (owner.record.id === entry.record.id) {
      this.owners.delete(id);
      this.handles.delete(id);
    }
    this.emitIdeChange();
    return true;
  }

  private async start(sessionId?: string, cwd?: string): Promise<WindowDaemonEntry> {
    const binding = await this.options.prepare();
    this.binding = binding;
    if (this.disposed) throw new Error('Window daemon is disposed.');
    const env = { ...process.env };
    delete env.FACTORY_VSCODE_MCP_PORT;
    delete env.FACTORY_JETBRAINS_MCP_PORT;
    const ide = sessionId && binding.port !== null
      ? await createNativeIdeRelay({ sessionId, upstreamPort: binding.port, timeoutMs: 60_000 })
      : undefined;
    const unsubscribeIde = ide ? this.observeIde(ide) : undefined;
    if (ide) env.FACTORY_VSCODE_MCP_PORT = String(ide.port);
    let endpoint: Awaited<ReturnType<typeof startDetachedDaemon>>;
    try {
      endpoint = await startDetachedDaemon({ cwd: cwd ?? binding.cwd, env });
    } catch (error) {
      unsubscribeIde?.();
      await ide?.dispose();
      throw error;
    }
    const record: WindowDaemonRecord = {
      id: randomUUID(), port: endpoint.port, pid: endpoint.pid, ownerPid: process.pid,
      cwd: cwd ?? binding.cwd, idePort: sessionId ? binding.port : null,
      ...(sessionId ? { rootSessionId: sessionId } : {}),
    };
    const pending = (async () => {
      await writeWindowDaemon(record);
      const connection = await openDaemonConnection(endpoint);
      if (this.disposed) {
        connection.dispose();
        throw new Error('Window daemon is disposed.');
      }
      const entry: WindowDaemonEntry = { record, connection, ...(ide ? { ide } : {}) };
      if (unsubscribeIde) this.ideSubscriptions.set(record.id, unsubscribeIde);
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
      unsubscribeIde?.();
      this.ideSubscriptions.delete(record.id);
      await ide?.dispose();
      await stopDaemon(endpoint);
      await removeWindowDaemon(record);
      throw error;
    }
  }

  private async retireEmpty(entry: WindowDaemonEntry): Promise<void> {
    if (!this.owned.has(entry.record.id)) return;
    const opened = await entry.connection.droid.sessions.listOpened({ filter: { includeBtwForks: true } });
    if (opened.length > 0) return;
    const pid = await resolveDaemonListenerPid(entry.record.port, '127.0.0.1');
    if (pid !== entry.record.pid) return;
    await stopDaemon({ url: windowDaemonUrl(entry.record), pid });
    if (isProcessAlive(pid)) return;
    await entry.ide?.dispose();
    entry.connection.dispose();
    await removeWindowDaemon(entry.record);
    this.connections.delete(entry.record.id);
    this.ideSubscriptions.get(entry.record.id)?.();
    this.ideSubscriptions.delete(entry.record.id);
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
    let ide: NativeIdeRelay | undefined;
    if (cached) {
      const entry = await cached;
      if (entry.connection.status() === 'connected') return entry;
      ide = entry.ide;
      entry.connection.dispose();
      this.connections.delete(record.id);
    }
    const pid = await resolveDaemonListenerPid(record.port, '127.0.0.1');
    if (pid === null) {
      // An alive owner with an unreachable service is not proof its work stopped.
      if (!isProcessAlive(record.pid)) {
        await ide?.dispose();
        if (record.rootSessionId) {
          const allocation = this.allocations.get(record.rootSessionId);
          if (allocation && (await allocation).record.id === record.id) {
            this.allocations.delete(record.rootSessionId);
          }
        }
        return null;
      }
      throw new Error('An existing session daemon is unavailable. Retry without starting a duplicate session.');
    }
    if (pid !== record.pid) throw new Error('Daemon discovery no longer matches its listener process.');
    const pending = openDaemonConnection({ url: windowDaemonUrl(record) }).then((connection) => {
      const entry: WindowDaemonEntry = { record, connection, ...(ide ? { ide } : {}) };
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

function hasDurablePrompt(messages: Awaited<ReturnType<DaemonApi['sessions']['getMessages']>>): boolean {
  return messages.some((message) => String(message.role) === 'user' &&
    message.content.some((block) => block.type === 'text' ? block.text.trim().length > 0 :
      block.type === 'image' || block.type === 'document'));
}
