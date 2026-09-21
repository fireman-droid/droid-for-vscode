import { randomUUID } from 'node:crypto';
import type { DaemonApi, DaemonNotification, DaemonTerminalEvent } from './api';
import type { WindowDaemonPool, WindowDaemonEntry } from './windowDaemonPool';
import { bindSessionIde } from './ideSessionHandle';

/** Keep the existing session-scoped SDK resources on the session's actual daemon. */
export function createRoutedDaemon(pool: WindowDaemonPool): DaemonApi {
  const notifications = new Set<(event: DaemonNotification) => void>();
  const terminals = new Set<(event: DaemonTerminalEvent) => void>();
  const unsubscribes = new Map<string, (() => void)[]>();
  const unbind = pool.onConnection((entry) => {
    for (const unsubscribe of unsubscribes.get(entry.record.id) ?? []) unsubscribe();
    unsubscribes.set(entry.record.id, [
      entry.connection.droid.notifications.subscribe((event) => {
        if (!pool.observeSession(event.sessionId, entry, event.notification)) return;
        for (const listener of notifications) listener(event);
      }),
      entry.connection.droid.notifications.subscribeTerminal((event) => {
        for (const listener of terminals) listener(event);
      }),
    ]);
  });
  const choose = async (sessionId?: string): Promise<DaemonApi> =>
    (await (sessionId ? pool.forSession(sessionId) : pool.current())).connection.droid;

  function resource<Key extends keyof DaemonApi>(
    key: Key,
    sessionId: (method: string, args: unknown[]) => string | undefined,
  ): DaemonApi[Key] {
    return new Proxy({}, {
      get: (_target, name) => {
        if (typeof name !== 'string' || name === 'then') return undefined;
        return async (...args: unknown[]) => {
          const droid = await choose(sessionId(name, args));
          const target = droid[key] as unknown as Record<string, (...parameters: unknown[]) => unknown>;
          return Reflect.apply(target[name]!, target, args);
        };
      },
    }) as DaemonApi[Key];
  }
  const firstId = (_method: string, args: unknown[]) => typeof args[0] === 'string' ? args[0] : undefined;
  const objectId = (_method: string, args: unknown[]) => {
    const value = args[0] as { sessionId?: string } | undefined;
    return value?.sessionId;
  };
  const noId = () => undefined;
  const sessionResources = resource('sessions', (method, args) =>
    ['list', 'search'].includes(method) ? undefined : firstId(method, args));
  const rememberHandle = async (
    entry: WindowDaemonEntry,
    handle: Awaited<ReturnType<DaemonApi['sessions']['create']>>,
  ) => {
    try {
      const bound = await pool.isDelegatedSession(handle.id, entry)
        ? handle
        : bindSessionIde(handle, (signal) => pool.waitForIde(handle.id, signal));
      await pool.remember(handle.id, entry, bound);
      return bound;
    }
    catch (error) { await handle.detach(); throw error; }
  };
  return {
    sessions: {
      list: (...args) => sessionResources.list(...args),
      search: (...args) => sessionResources.search(...args),
      archive: (...args) => sessionResources.archive(...args),
      unarchive: (...args) => sessionResources.unarchive(...args),
      getMessages: (...args) => sessionResources.getMessages(...args),
      updateSettings: (...args) => sessionResources.updateSettings(...args),
      getContextBreakdown: (...args) => sessionResources.getContextBreakdown(...args),
      getRewindInfo: (...args) => sessionResources.getRewindInfo(...args),
      fork: (...args) => sessionResources.fork(...args),
      killWorker: (...args) => sessionResources.killWorker(...args),
      async listOpened(options) {
        const groups = await Promise.all((await pool.all()).map((entry) =>
          entry.connection.droid.sessions.listOpened(options)));
        return groups.flat();
      },
      async create(options) {
        const sessionId = options.sessionId ?? randomUUID();
        const entry = await pool.allocate(sessionId, options.cwd);
        return rememberHandle(entry, await entry.connection.droid.sessions.create({ ...options, sessionId }));
      },
      async resume(id, options) {
        const entry = await pool.forSession(id, true);
        let handle = await rememberHandle(entry, await entry.connection.droid.sessions.resume(id, options));
        try {
          const rebound = await pool.rebindIdleAttachment(id, entry);
          if (rebound !== entry) {
            handle = await rememberHandle(rebound, await rebound.connection.droid.sessions.resume(id, options));
          }
          // Restoring the handle alone does not repair a disconnected IDE client.
          // Only report a repaired root attachment after its real handshake;
          // blocked/running sessions remain attached to their original worker.
          if (rebound !== entry || (rebound.record.rootSessionId === id && rebound.ide &&
              !pool.needsReconnect(id) && !rebound.ide.requiresSessionRestart())) {
            await pool.waitForIde(id, new AbortController().signal);
          }
          return handle;
        } catch (error) {
          await handle.detach();
          throw error;
        }
      },
    },
    settings: resource('settings', noId),
    customModels: resource('customModels', noId),
    updates: resource('updates', noId),
    automations: resource('automations', noId),
    ssh: resource('ssh', noId),
    relay: resource('relay', noId),
    commands: resource('commands', firstId),
    skills: resource('skills', (method, args) => method === 'list' ? firstId(method, args) : objectId(method, args)),
    terminals: resource('terminals', firstId),
    plugins: resource('plugins', firstId),
    marketplaces: resource('marketplaces', firstId),
    feedback: resource('feedback', firstId),
    git: resource('git', (method, args) =>
      ['push', 'commit'].includes(method) ? firstId(method, args) : objectId(method, args)),
    workspace: resource('workspace', (method, args) =>
      ['listFiles', 'searchFiles'].includes(method) ? firstId(method, args) : objectId(method, args)),
    mcp: resource('mcp', (method, args) =>
      ['listServers', 'listTools', 'listRegistry', 'toggleTool'].includes(method)
        ? firstId(method, args) : objectId(method, args)),
    unstable: { missions: {
      inspectReadiness: async (cwd) => (await choose()).unstable.missions.inspectReadiness(cwd),
      acknowledgeReadinessWarning: async (cwd) => (await choose()).unstable.missions.acknowledgeReadinessWarning(cwd),
    } },
    notifications: {
      subscribe: (listener) => { notifications.add(listener); return () => { notifications.delete(listener); }; },
      subscribeTerminal: (listener) => { terminals.add(listener); return () => { terminals.delete(listener); }; },
      attachChild: async (id) => (await choose(id)).notifications.attachChild(id),
    },
    disconnect() {
      unbind();
      for (const group of unsubscribes.values()) for (const unsubscribe of group) unsubscribe();
      unsubscribes.clear();
      notifications.clear();
      terminals.clear();
    },
  };
}
