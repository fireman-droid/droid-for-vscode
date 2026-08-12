import {
  ContextStatsAccuracy,
  SettingsLevel,
  type ConnectedDroid,
  type ConnectedDroidSession,
  type SessionSettings,
  type UpdateSessionSettingsOptions,
} from '@factory/droid-sdk';

import type {
  FactoryDroidSession,
  FactoryDroidSessionFactory,
} from '../FactoryDroidRuntime';
import type { RuntimeSessionTarget } from '../DroidRuntime';
import {
  createRuntimeInteractionCallbacks,
  type RuntimeInteractionCallbacks,
  type RuntimeInteractionHandler,
} from '../runtimeInteractions';

/**
 * Daemon-backed counterpart of `createLocalDroidSession` (daemon
 * Phase 2). Sessions are created/resumed over one persistent daemon
 * connection instead of a per-window `droid exec` child process, then
 * adapted onto the same `FactoryDroidSession` interface so
 * `FactoryDroidRuntime` runs unchanged.
 *
 * Known Phase 2 divergences from process mode (both fail closed):
 * - No `availableModels`: the daemon facade reports custom models
 *   without `supportedReasoningEfforts`, so the model catalog stays
 *   `unavailable` rather than guessing efforts.
 * - No `onNotification`/`authenticateMcpServer`: the daemon facade
 *   exposes no session-notification subscription, so browser MCP
 *   OAuth is unsupported (list/toggle/add/remove still work).
 */
export function createDaemonSessionFactory(
  getDroid: () => Promise<ConnectedDroid>,
  lease?: SessionLeaseHooks,
): FactoryDroidSessionFactory {
  return (options) =>
    createDaemonDroidSession({ ...options, getDroid, lease });
}

/**
 * Cross-window lease hooks (daemon Phase 3): with a shared daemon,
 * two windows must not attach the same session, because replacement
 * operations (rewind/compact/fork) are not coordinated by the daemon.
 * Absent hooks (Phase 2 private daemon) everything runs unguarded.
 */
export interface SessionLeaseHooks {
  acquire(
    sessionId: string,
  ): { acquired: true } | { acquired: false; heldByPid: number };
  release(sessionId: string): void;
}

export async function createDaemonDroidSession(options: {
  target: RuntimeSessionTarget;
  interactionHandler: RuntimeInteractionHandler;
  getDroid: () => Promise<ConnectedDroid>;
  lease?: SessionLeaseHooks;
}): Promise<FactoryDroidSession> {
  const droid = await options.getDroid();
  const callbacks = createRuntimeInteractionCallbacks(
    options.interactionHandler,
  );
  const lease = options.lease ?? noopLease;

  if (options.target.kind === 'resume') {
    const outcome = lease.acquire(options.target.sessionId);
    if (!outcome.acquired) {
      throw new Error(
        `Session is open in another window (pid ${String(outcome.heldByPid)}). Close it there or wait for that window to exit.`,
      );
    }
    try {
      const session = await droid.sessions.resume(options.target.sessionId, {
        ...callbacks,
      });
      return adaptDaemonSession(droid, session, callbacks, lease);
    } catch (error) {
      lease.release(options.target.sessionId);
      throw error;
    }
  }

  const session = await droid.sessions.create({
    cwd: options.target.cwd,
    // Native daemon channel: create (or reuse) a git worktree and run
    // the session there. Branch and directory naming are daemon-owned;
    // the actual working directory comes back as `session.cwd`.
    ...(options.target.worktree === true ? { worktree: true } : {}),
    ...callbacks,
  });
  // A freshly created session id cannot be contested, so the lease is
  // recorded after the fact purely to mark ownership.
  lease.acquire(session.id);
  return adaptDaemonSession(droid, session, callbacks, lease);
}

const noopLease: SessionLeaseHooks = {
  acquire: () => ({ acquired: true }),
  release: () => {},
};

/** Session-setting fields the daemon accepts and the runtime updates. */
type SupportedSettingsUpdate = Pick<
  UpdateSessionSettingsOptions,
  'interactionMode' | 'modelId' | 'reasoningEffort' | 'autonomyLevel'
>;

function adaptDaemonSession(
  droid: ConnectedDroid,
  session: ConnectedDroidSession,
  callbacks: RuntimeInteractionCallbacks,
  lease: SessionLeaseHooks,
): FactoryDroidSession {
  // The daemon confirms `updateSettings` before the `settings_updated`
  // notification refreshes the handle's snapshot, so successful updates
  // are overlaid locally until the snapshot reports the same value.
  let pendingSettings: SupportedSettingsUpdate = {};

  /**
   * Replacement operations (rewind/compact/fork) leave the daemon-side
   * source handle usable and return a `newSessionId`; the runtime
   * contract instead expects a new session object. Attach the new
   * session first (keeping the old handle on failure), then detach the
   * old handle so it stops receiving events.
   */
  const attachReplacement = async (
    newSessionId: string,
  ): Promise<FactoryDroidSession> => {
    // The daemon replaces the old session with the new one, so the old
    // lease implies ownership of the replacement; record it and only
    // then swap handles.
    lease.acquire(newSessionId);
    let next: ConnectedDroidSession;
    try {
      next = await droid.sessions.resume(newSessionId, {
        ...callbacks,
      });
    } catch (error) {
      lease.release(newSessionId);
      throw error;
    }
    const oldSessionId = session.id;
    await session.detach();
    lease.release(oldSessionId);
    return adaptDaemonSession(droid, next, callbacks, lease);
  };

  return {
    get id() {
      return session.id;
    },
    get cwd(): string | undefined {
      return session.cwd;
    },
    get settings(): Readonly<SessionSettings> {
      const snapshot = session.settings;
      for (const key of Object.keys(
        pendingSettings,
      ) as (keyof SupportedSettingsUpdate)[]) {
        if (snapshot[key] === pendingSettings[key]) {
          delete pendingSettings[key];
        }
      }
      return Object.keys(pendingSettings).length === 0
        ? snapshot
        : { ...snapshot, ...pendingSettings };
    },
    stream(prompt, streamOptions) {
      return session.stream(prompt, streamOptions);
    },
    interrupt() {
      return session.interrupt();
    },
    async updateSettings(params) {
      const update: SupportedSettingsUpdate = {
        ...(params.interactionMode === undefined
          ? {}
          : { interactionMode: params.interactionMode }),
        ...(params.modelId === undefined
          ? {}
          : { modelId: params.modelId }),
        ...(params.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: params.reasoningEffort }),
        ...(params.autonomyLevel === undefined
          ? {}
          : { autonomyLevel: params.autonomyLevel }),
      };
      const result = await droid.sessions.updateSettings(
        session.id,
        update,
      );
      pendingSettings = { ...pendingSettings, ...update };
      return result;
    },
    async getContextStats() {
      // The daemon facade has no context-stats call; derive the meter
      // from the context breakdown and mark it estimated.
      const breakdown = await droid.sessions.getContextBreakdown(
        session.id,
      );
      return {
        used: Math.round(breakdown.usedTokens),
        remaining: Math.round(breakdown.freeTokens),
        limit: Math.round(breakdown.contextBudget),
        accuracy: ContextStatsAccuracy.Estimated,
        updatedAt: new Date().toISOString(),
      };
    },
    async rewind(params) {
      const result = await session.rewind(params);
      return { session: await attachReplacement(result.newSessionId) };
    },
    async getRewindInfo(params) {
      return droid.sessions.getRewindInfo(session.id, params.messageId);
    },
    async compact(params) {
      const result = await session.compact(params?.customInstructions);
      return {
        session: await attachReplacement(result.newSessionId),
        removedCount: result.removedCount,
      };
    },
    async fork(params) {
      const result = await session.fork(
        params?.title === undefined ? undefined : { title: params.title },
      );
      return attachReplacement(result.newSessionId);
    },
    rename(params) {
      return session.rename(params.title);
    },
    listSkills() {
      return droid.skills.list(session.id);
    },
    setSkillDisabled(params) {
      return droid.skills.setDisabled({
        sessionId: session.id,
        skillName: params.skillName,
        disabled: params.disabled,
      });
    },
    listMcpServers() {
      return droid.mcp.listServers(session.id);
    },
    listMcpTools() {
      return droid.mcp.listTools(session.id);
    },
    toggleMcpServer(params) {
      return droid.mcp.toggleServer({
        sessionId: session.id,
        serverName: params.serverName,
        enabled: params.enabled,
        settingsLevel: SettingsLevel.User,
      });
    },
    addMcpServer(params) {
      return droid.mcp.addServer({
        sessionId: session.id,
        name: params.name,
        type: params.type,
        ...(params.command === undefined
          ? {}
          : { command: params.command }),
        ...(params.args === undefined ? {} : { args: [...params.args] }),
        ...(params.url === undefined ? {} : { url: params.url }),
      });
    },
    removeMcpServer(params) {
      return droid.mcp.removeServer({
        sessionId: session.id,
        serverName: params.serverName,
        settingsLevel: SettingsLevel.User,
      });
    },
    // `authenticateMcpServer` and `onNotification` are intentionally
    // absent: see the factory doc comment.
    async close() {
      // Releasing the handle keeps the session alive in the daemon;
      // Phase 3's shared daemon lets it survive a window reload.
      await session.detach();
      lease.release(session.id);
    },
  };
}
