import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import type { IdeState } from '../../shared/protocol/ideProtocol';
import type { NativeIdeRelay } from '../ide/nativeIdeRelay';
import { createPersistentIdeRelay, restorePersistentIdeRelay, type PersistentIdeRelay } from '../ide/persistentIdeRelay';
import type { DaemonApi, DaemonNotification, DaemonSessionHandle } from './api';
import { openDaemonConnection, type DaemonConnection } from './daemonConnection';
import { prepareIdeDaemonEnvironment, removeIdeDaemonSnapshot } from './ideDaemonFeatures';
import {
  resolveDaemonListenerPid, startDetachedDaemon, stopDaemon,
  verifyDaemonListeners, type DaemonListenerVerification,
} from './daemonLifecycle';
import {
  listWindowDaemons, readSessionDaemon, readWindowDaemon, removeWindowDaemon, windowDaemonUrl,
  writeSessionDaemon, writeWindowDaemon, type WindowDaemonRecord,
} from './windowDaemonRegistry';

export interface WindowDaemonBinding {
  readonly cwd: string;
  readonly port: number | null;
  readonly detail: string | null;
}
export interface WindowDaemonEntry {
  record: WindowDaemonRecord;
  readonly connection: DaemonConnection;
  ide?: PersistentIdeRelay;
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
  private readonly childOwnerWaiters = new Set<{
    sessionId: string;
    resolve(entry: WindowDaemonEntry): void;
    reject(error: unknown): void;
  }>();
  private readonly handles = new Map<string, DaemonSessionHandle>();
  private readonly listeners = new Set<(entry: WindowDaemonEntry) => void>();
  private readonly owned = new Set<string>();
  private readonly used = new Set<string>();
  private readonly allocations = new Map<string, Promise<WindowDaemonEntry>>();
  private readonly ideAttachments = new Map<string, Promise<WindowDaemonEntry>>();
  private discovery: Promise<WindowDaemonEntry[]> | undefined;
  private openedDiscovery: Promise<{
    entry: WindowDaemonEntry;
    opened: Awaited<ReturnType<DaemonApi['sessions']['listOpened']>>;
  }[]> | undefined;
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

  readIde(sessionId: string | null, attachment: 'root' | 'shared' = 'root'): Pick<IdeState, 'status' | 'message'> {
    if (!this.binding) return { status: 'preparing', message: 'Preparing the native IDE service.' };
    if (this.binding.port === null) return {
      status: 'unavailable', message: this.binding.detail ?? 'The native IDE service is unavailable. Chat remains available.',
    };
    if (!sessionId) return { status: 'disconnected', message: 'Open a chat to connect its native IDE channel.' };
    const entry = this.owners.get(sessionId);
    if (!entry) return { status: 'preparing', message: 'Connecting this chat to the native IDE service.' };
    const shared = attachment === 'shared';
    const sharesCurrentIde = shared && this.owned.has(entry.record.id) && entry.ide !== undefined &&
      entry.record.idePort === this.binding.port;
    if (this.needsReconnect(sessionId) && !sharesCurrentIde) return {
      status: 'reconnect-required', message: shared
        ? 'This agent uses its owning session’s IDE connection. Restore that connection from the parent chat; this agent can keep chatting.'
        : 'This chat needs its own IDE connection. Reconnect when its background tasks finish.',
    };
    const state = entry.ide!.read();
    return { ...state, status: state.status === 'connecting' ? 'preparing' : state.status,
      ...(shared ? { message: `This agent shares its owning session’s IDE connection. ${state.message}` } : {}) };
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

  async rebindIdleAttachment(
    sessionId: string,
    source: WindowDaemonEntry,
    isCurrent: () => boolean = () => true,
  ): Promise<WindowDaemonEntry> {
    if (!isCurrent() || (!this.needsReconnect(sessionId) && !source.ide?.requiresSessionRestart()) || this.binding?.port === null ||
        await this.isDelegatedSession(sessionId, source)) return source;
    const opened = await source.connection.droid.sessions.listOpened({ filter: { includeBtwForks: true } });
    if (!opened.some((session) => session.id === sessionId) || busySessionTree(opened, sessionId)) return source;
    if ((await source.connection.droid.terminals.list(sessionId, {})).length > 0) return source;
    await this.reconnectIdle(sessionId,
      () => !this.disposed && isCurrent() && this.owners.get(sessionId) === source, () => {});
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
    if (entry.connection.status() === 'recovering') await entry.connection.waitUntilReady?.();
    if (entry.connection.status() === 'connected') return entry;
    if (this.currentEntry !== pending) return this.current();
    const reconnect = this.existing(entry.record).then((restored) => restored ?? this.start());
    this.currentEntry = reconnect;
    void reconnect.catch(() => { if (this.currentEntry === reconnect) this.currentEntry = undefined; });
    return reconnect;
  }

  async forSession(sessionId: string, attach = false): Promise<WindowDaemonEntry> {
    const cached = this.owners.get(sessionId);
    if (cached?.connection.status() === 'recovering') await cached.connection.waitUntilReady?.();
    if (cached && cached.connection.status() === 'connected') return attach ? this.attachIde(cached) : cached;
    const ownerId = await readSessionDaemon(sessionId);
    const [owner, found] = await Promise.all([
      ownerId ? readWindowDaemon(ownerId) : null, this.findOpenedOwner(sessionId),
    ]);
    const entry = found ?? (attach
      ? await this.allocate(sessionId, owner?.cwd)
      : (owner ? await this.existing(owner) : null) ?? await this.current());
    if (attach) await this.attachIde(entry);
    if (found || attach) await this.remember(sessionId, entry);
    return entry;
  }

  /** An assigned child ID can precede its worker. Never route it to a new daemon. */
  forChildSession(sessionId: string): Promise<WindowDaemonEntry> {
    if (this.disposed) return Promise.reject(new Error('Window daemon is disposed.'));
    return new Promise((resolve, reject) => {
      const waiter = {
        sessionId,
        resolve: (entry: WindowDaemonEntry) => { cleanup(); resolve(entry); },
        reject: (error: unknown) => { cleanup(); reject(error); },
      };
      const timeout = setTimeout(() => waiter.reject(new Error(
        'The child session has not become available on its owning daemon. Retry opening this session.',
      )), 30_000);
      const cleanup = () => { clearTimeout(timeout); this.childOwnerWaiters.delete(waiter); };
      // Subscribe before discovery so an availability notification cannot fall
      // between the initial lookup and the wait. This is not a polling loop.
      this.childOwnerWaiters.add(waiter);
      void this.findChildOwner(sessionId).then(entry => {
        if (entry) waiter.resolve(entry);
      }, waiter.reject);
    });
  }

  private async findChildOwner(sessionId: string): Promise<WindowDaemonEntry | null> {
    const cached = this.owners.get(sessionId);
    if (cached?.connection.status() === 'recovering') await cached.connection.waitUntilReady?.();
    if (cached?.connection.status() === 'connected') return cached;
    const [ownerId, found] = await Promise.all([readSessionDaemon(sessionId), this.findOpenedOwner(sessionId)]);
    if (found) return found;
    // A previously attached child may be idle/unloaded. Its saved, verified
    // owner remains valid; a newly announced child has no such binding yet.
    const owner = ownerId ? await readWindowDaemon(ownerId) : null;
    return owner ? this.existing(owner) : null;
  }

  private async findOpenedOwner(sessionId: string): Promise<WindowDaemonEntry | undefined> {
    // Initial attachment still checks every live daemon for duplicate ownership.
    // Historical reads use the metadata daemon and never enter this discovery.
    let found: WindowDaemonEntry | undefined;
    for (const { entry, opened } of await this.discoverOpened()) {
      if (!opened.some((session) => session.id === sessionId)) continue;
      if (found && found.record.id !== entry.record.id) {
        throw new Error('This session is open on multiple daemons. Resolve its ownership before continuing.');
      }
      found = entry;
    }
    return found;
  }

  /** Only a real chat attachment may take over an exited window's relay. */
  attachIde(entry: WindowDaemonEntry): Promise<WindowDaemonEntry> {
    const existing = this.ideAttachments.get(entry.record.id);
    if (existing) return existing;
    const pending = this.restoreAttachedIde(entry);
    this.ideAttachments.set(entry.record.id, pending);
    const clear = () => {
      if (this.ideAttachments.get(entry.record.id) === pending) this.ideAttachments.delete(entry.record.id);
    };
    void pending.then(clear, clear);
    return pending;
  }

  private async restoreAttachedIde(entry: WindowDaemonEntry): Promise<WindowDaemonEntry> {
    if (this.owned.has(entry.record.id) || !entry.record.ideRelay || !entry.record.rootSessionId) return entry;
    const binding = await this.options.prepare();
    this.binding = binding;
    if (this.disposed || binding.port === null || !sameWorkspace(binding.cwd, entry.record.cwd)) return entry;
    const record = await readWindowDaemon(entry.record.id);
    if (!record?.ideRelay || !record.rootSessionId || record.pid !== entry.record.pid ||
        record.port !== entry.record.port || !sameWorkspace(binding.cwd, record.cwd) ||
        (record.ownerPid !== process.pid && isProcessAlive(record.ownerPid))) return entry;
    let ide: PersistentIdeRelay | undefined;
    try {
      ide = await restorePersistentIdeRelay({ descriptor: record.ideRelay,
        sessionId: record.rootSessionId, upstreamPort: binding.port });
      if (this.disposed) { await ide.dispose(); return entry; }
      const adopted = { ...record, ownerPid: process.pid, idePort: binding.port };
      await writeWindowDaemon(adopted);
      entry.record = adopted;
      entry.ide = ide;
      this.owned.add(record.id);
      this.ideSubscriptions.set(record.id, this.observeIde(ide));
      this.options.record({ level: 'info', name: 'ide.native.relay-restored',
        detail: 'The existing daemon and its workers retained their IDE relay after window reload.' });
      this.emitIdeChange();
    } catch {
      await ide?.dispose();
      this.options.record({ level: 'warn', name: 'ide.native.relay-restore-failed',
        detail: 'The existing IDE relay could not be restored. The conversation remains on its original daemon.' });
    }
    return entry;
  }

  async all(): Promise<WindowDaemonEntry[]> {
    const [current, discovered] = await Promise.all([this.current(), this.discoverEntries()]);
    const entries = new Map<string, WindowDaemonEntry>([[current.record.id, current]]);
    for (const entry of discovered) entries.set(entry.record.id, entry);
    return [...entries.values()];
  }

  private discoverEntries(): Promise<WindowDaemonEntry[]> {
    if (this.discovery) return this.discovery;
    const pending = (async () => {
      const startedAt = Date.now();
      const records = await listWindowDaemons();
      const uncached = records.filter((record) => !this.connections.has(record.id));
      const verified = await verifyDaemonListeners(uncached);
      const entries = await mapConcurrent(records, (record) => this.existing(record, verified.get(record.port)));
      const connected = entries.filter((entry): entry is WindowDaemonEntry => entry !== null);
      this.options.record({ level: 'info', name: 'daemon.discovery.finished', attributes: {
        records: records.length, connected: connected.length, durationMs: Date.now() - startedAt,
      } });
      return connected;
    })();
    this.discovery = pending;
    const clear = () => { if (this.discovery === pending) this.discovery = undefined; };
    void pending.then(clear, clear);
    return pending;
  }

  private discoverOpened(): NonNullable<WindowDaemonPool['openedDiscovery']> {
    if (this.openedDiscovery) return this.openedDiscovery;
    const pending = this.discoverEntries().then((entries) => mapConcurrent(entries, async (entry) => ({
      entry, opened: await entry.connection.droid.sessions.listOpened({ filter: { includeBtwForks: true } }),
    })));
    this.openedDiscovery = pending;
    const clear = () => { if (this.openedDiscovery === pending) this.openedDiscovery = undefined; };
    void pending.then(clear, clear);
    return pending;
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
    for (const waiter of this.childOwnerWaiters) if (waiter.sessionId === sessionId) waiter.resolve(entry);
    if (notification?.type === 'child_session_available' &&
        typeof notification.childSessionId === 'string' && notification.childSessionId.length > 0) {
      // The notification comes from the parent's connected daemon. Record the
      // child's owner before consumers try to hydrate or open its conversation.
      this.observeSession(notification.childSessionId, entry);
    }
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
    const handle = this.handles.get(sessionId);
    if (!handle) return blocked('The active session must be attached before reconnecting IDE.');
    if (!isCurrent()) return blocked('The selected session changed. IDE reconnection was cancelled.');
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
    // Native close otherwise reaps empty drafts, making the same ID impossible to resume.
    await handle.close({ preserveEmptyDraft: true });
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
    for (const waiter of this.childOwnerWaiters) waiter.reject(new Error('Window daemon is disposed.'));
    if (this.currentEntry) await this.currentEntry.catch(() => undefined);
    await Promise.allSettled(this.allocations.values());
    await Promise.allSettled(this.ideAttachments.values());
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
            if (!isProcessAlive(pid)) {
              await entry.ide?.shutdown();
              await removeWindowDaemon(entry.record);
            }
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
    this.ideAttachments.clear();
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
    await entry.ide?.shutdown();
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
    const instanceId = randomUUID();
    delete env.FACTORY_VSCODE_MCP_PORT;
    delete env.FACTORY_JETBRAINS_MCP_PORT;
    const ide = sessionId && binding.port !== null
      ? await createPersistentIdeRelay({ sessionId, upstreamPort: binding.port, timeoutMs: 60_000 })
      : undefined;
    const unsubscribeIde = ide ? this.observeIde(ide) : undefined;
    if (ide) env.FACTORY_VSCODE_MCP_PORT = String(ide.port);
    let endpoint: Awaited<ReturnType<typeof startDetachedDaemon>>;
    try {
      const daemonEnv = ide ? await prepareIdeDaemonEnvironment(instanceId, env) : env;
      endpoint = await startDetachedDaemon({ cwd: cwd ?? binding.cwd, env: daemonEnv });
    } catch (error) {
      unsubscribeIde?.();
      await ide?.shutdown().catch(() => {
        this.options.record({ level: 'warn', name: 'ide.native.relay-cleanup-failed' });
      });
      try { await removeIdeDaemonSnapshot(instanceId); }
      catch { this.options.record({ level: 'warn', name: 'daemon.feature-snapshot.cleanup-failed' }); }
      throw error;
    }
    const record: WindowDaemonRecord = {
      id: instanceId, port: endpoint.port, pid: endpoint.pid, ownerPid: process.pid,
      cwd: cwd ?? binding.cwd, idePort: sessionId ? binding.port : null,
      ...(sessionId ? { rootSessionId: sessionId } : {}),
      ...(ide ? { ideRelay: ide.descriptor } : {}),
    };
    const pending = (async () => {
      await ide?.bindDaemon(endpoint.pid);
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
      const cleanup = await Promise.allSettled([ide?.shutdown(), stopDaemon(endpoint)]);
      if (cleanup.some(result => result.status === 'rejected')) {
        this.options.record({ level: 'warn', name: 'daemon.session.cleanup-deferred' });
      }
      try {
        if (!isProcessAlive(endpoint.pid)) {
          await removeWindowDaemon(record);
          // Registration may have failed before its file existed.
          await removeIdeDaemonSnapshot(instanceId);
        }
      } catch { this.options.record({ level: 'warn', name: 'daemon.session.cleanup-deferred' }); }
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
    await entry.ide?.shutdown();
    entry.connection.dispose();
    await removeWindowDaemon(entry.record);
    this.connections.delete(entry.record.id);
    this.ideSubscriptions.get(entry.record.id)?.();
    this.ideSubscriptions.delete(entry.record.id);
  }

  private existing(record: WindowDaemonRecord, verified?: DaemonListenerVerification): Promise<WindowDaemonEntry | null> {
    const current = this.connecting.get(record.id);
    if (current) return current;
    const pending = this.restoreConnection(record, verified);
    this.connecting.set(record.id, pending);
    const clear = () => { if (this.connecting.get(record.id) === pending) this.connecting.delete(record.id); };
    void pending.then(clear, clear);
    return pending;
  }

  private async restoreConnection(
    record: WindowDaemonRecord, verified?: DaemonListenerVerification,
  ): Promise<WindowDaemonEntry | null> {
    const cached = this.connections.get(record.id);
    let ide: PersistentIdeRelay | undefined;
    if (cached) {
      const entry = await cached;
      if (entry.connection.status() === 'recovering') await entry.connection.waitUntilReady?.();
      if (entry.connection.status() === 'connected') return entry;
      ide = entry.ide;
      entry.connection.dispose();
      this.connections.delete(record.id);
    }
    const verification = verified ?? (await verifyDaemonListeners([record])).get(record.port);
    const pid = verification?.status === 'verified' ? verification.pid : null;
    const processReplaced = verification?.replacedPids?.includes(record.pid) === true;
    if (processReplaced || (pid !== record.pid && !isProcessAlive(record.pid))) {
      await ide?.dispose();
      if (record.rootSessionId) {
        const allocation = this.allocations.get(record.rootSessionId);
        if (allocation && (await allocation).record.id === record.id) {
          this.allocations.delete(record.rootSessionId);
        }
      }
      // A reused PID belongs to another process. Retire only the stale registry
      // entry; never stop that process or the current occupant of the old port.
      await removeWindowDaemon(record);
      this.options.record({ level: 'info', name: 'daemon.discovery.stale-record', attributes: {
        instanceId: record.id, pid: record.pid, port: record.port,
        reason: processReplaced ? 'process-replaced' : 'process-exited',
      } });
      return null;
    }
    if (pid === null) {
      // A matching or unverifiable live worker may still own running tasks.
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

async function mapConcurrent<T, R>(values: readonly T[], operation: (value: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(values.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(6, values.length) }, async () => {
    while (!failed) {
      const index = next++;
      if (index >= values.length) return;
      try { results[index] = await operation(values[index]!); }
      catch (error) { failed = true; failure = error; }
    }
  }));
  if (failed) throw failure;
  return results;
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
    throw error;
  }
}

function sameWorkspace(left: string, right: string): boolean {
  const normalize = (path: string) => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path);
  return normalize(left) === normalize(right);
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
