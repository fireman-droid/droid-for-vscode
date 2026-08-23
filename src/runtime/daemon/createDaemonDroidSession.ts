import {
  ContextStatsAccuracy,
  SettingsLevel,
  type AvailableModelConfig,
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
 * Known Phase 2 divergence from process mode (fails closed):
 * - No `onNotification`/`authenticateMcpServer`: the daemon facade
 *   exposes no session-notification subscription, so browser MCP
 *   OAuth is unsupported (list/toggle/add/remove still work).
 *
 * The model catalog comes from `settings.getDefaults()`, whose
 * `availableModels` carries the same full metadata process mode
 * captures from initialize/load responses (probe:
 * artifacts/probe-daemon-model-catalog.mjs, 2026-08-13). A defaults
 * read failure leaves the catalog `unavailable` without failing the
 * session.
 */
export function createDaemonSessionFactory(
  getDroid: () => Promise<ConnectedDroid>,
  lease?: SessionLeaseHooks,
): FactoryDroidSessionFactory {
  return (options) =>
    createDaemonDroidSession({
      ...options,
      getDroid,
      lease,
    });
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

/** How long a blocked resume keeps re-trying the lease. */
export const LEASE_RETRY_MAX_MS = 15_000;
/** Re-acquire cadence while blocked (the check is one file read). */
export const LEASE_RETRY_INTERVAL_MS = 500;

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
    // A window reload leaves the previous extension host process
    // alive for up to minutes, still holding this workspace's lease
    // (user hit 2026-08-13 19:44: resume failed in 1ms against a
    // holder that was already on its way out). The holder releases
    // on dispose or dies and gets preempted, so a blocked acquire
    // retries briefly instead of failing the whole resume.
    let outcome = lease.acquire(options.target.sessionId);
    const deadline = Date.now() + LEASE_RETRY_MAX_MS;
    while (!outcome.acquired && Date.now() < deadline) {
      await new Promise((resolve) =>
        setTimeout(resolve, LEASE_RETRY_INTERVAL_MS),
      );
      outcome = lease.acquire(options.target.sessionId);
    }
    if (!outcome.acquired) {
      throw new Error(
        `Session is open in another window (pid ${String(outcome.heldByPid)}). Close it there or wait for that window to exit.`,
      );
    }
    try {
      const session = await droid.sessions.resume(options.target.sessionId, {
        ...callbacks,
      });
      const availableModels = await readDaemonAvailableModels(droid);
      return adaptDaemonSession(
        droid,
        session,
        callbacks,
        lease,
        availableModels,
      );
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
  // A fresh id should never be contested, but registry lock failure
  // still means ownership was not established. Do not expose an
  // unleased handle that another window could also attach.
  const leaseOutcome = lease.acquire(session.id);
  if (!leaseOutcome.acquired) {
    await session.detach().catch(() => undefined);
    throw leaseConflictError(leaseOutcome.heldByPid);
  }
  const availableModels = await readDaemonAvailableModels(droid);
  return adaptDaemonSession(
    droid,
    session,
    callbacks,
    lease,
    availableModels,
  );
}

/**
 * Reads the connection-level model catalog. The daemon refreshes
 * `availableModels` on custom-model CRUD, so a fresh read per session
 * creation matches process mode's per-initialize/load capture. Any
 * failure degrades to an `unavailable` catalog instead of failing the
 * session: model selection is secondary to the chat itself.
 */
async function readDaemonAvailableModels(
  droid: ConnectedDroid,
): Promise<readonly AvailableModelConfig[] | undefined> {
  try {
    const models = (await droid.settings.getDefaults()).availableModels;
    // Rows the daemon marks disabled are not selectable; drop them
    // rather than surfacing dead picker entries.
    return models?.filter((model) => model.disabled !== true);
  } catch {
    return undefined;
  }
}

const noopLease: SessionLeaseHooks = {
  acquire: () => ({ acquired: true }),
  release: () => {},
};

/** Session-setting fields the daemon accepts and the runtime updates. */
type SupportedSettingsUpdate = Pick<
  UpdateSessionSettingsOptions,
  | 'interactionMode'
  | 'modelId'
  | 'reasoningEffort'
  | 'autonomyLevel'
  | 'specModeModelId'
  | 'specModeReasoningEffort'
  | 'missionSettings'
>;

/**
 * Overlay shape for a confirmed update: a spec override is reset by
 * writing null, but the snapshot reports an unset field as absent.
 */
function toSettingsOverlay(
  update: SupportedSettingsUpdate,
): Partial<SessionSettings> {
  const { specModeModelId, specModeReasoningEffort, ...rest } = update;
  return {
    ...rest,
    ...(specModeModelId === undefined
      ? {}
      : { specModeModelId: specModeModelId ?? undefined }),
    ...(specModeReasoningEffort === undefined
      ? {}
      : { specModeReasoningEffort: specModeReasoningEffort ?? undefined }),
  };
}

/** Adapts a retained daemon handle without creating or resuming another one. */
export function adaptConnectedDaemonSession(
  droid: ConnectedDroid,
  session: ConnectedDroidSession,
  interactionHandler: RuntimeInteractionHandler,
  lease: SessionLeaseHooks,
  availableModels?: readonly AvailableModelConfig[],
): FactoryDroidSession {
  const outcome = lease.acquire(session.id);
  if (!outcome.acquired) {
    throw leaseConflictError(outcome.heldByPid);
  }
  return adaptDaemonSession(
    droid,
    session,
    createRuntimeInteractionCallbacks(interactionHandler),
    lease,
    availableModels,
  );
}

function adaptDaemonSession(
  droid: ConnectedDroid,
  session: ConnectedDroidSession,
  callbacks: RuntimeInteractionCallbacks,
  lease: SessionLeaseHooks,
  availableModels?: readonly AvailableModelConfig[],
): FactoryDroidSession {
  // The daemon confirms `updateSettings` before the `settings_updated`
  // notification refreshes the handle's snapshot, so successful updates
  // are overlaid locally until the snapshot reports the same value.
  let pendingSettings: Partial<SessionSettings> = {};

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
    // The daemon replaces the old session with the new one, but the
    // replacement id still needs an explicit claim before attachment.
    const leaseOutcome = lease.acquire(newSessionId);
    if (!leaseOutcome.acquired) {
      throw leaseConflictError(leaseOutcome.heldByPid);
    }
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
    // The replacement keeps the already-read catalog (same connection,
    // no custom-model change happened inside rewind/compact/fork).
    return adaptDaemonSession(
      droid,
      next,
      callbacks,
      lease,
      availableModels,
    );
  };

  return {
    get id() {
      return session.id;
    },
    ...(availableModels === undefined
      ? {}
      : { availableModels: [...availableModels] }),
    get cwd(): string | undefined {
      return session.cwd;
    },
    get settings(): Readonly<SessionSettings> {
      const snapshot = session.settings;
      for (const key of Object.keys(
        pendingSettings,
      ) as (keyof SessionSettings)[]) {
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
    async readWorkingState() {
      // The daemon's opened-session registry is the authoritative view
      // of a session that kept running while no window was attached
      // (probe: artifacts/probe-get-messages.mjs phase 2). A missing
      // row means the daemon no longer tracks the session as open.
      const opened = await droid.sessions.listOpened();
      const row = opened.find((entry) => entry.id === session.id);
      return row === undefined ? null : String(row.workingState);
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
        // null is a real value here (reset to the session model /
        // model default), so only `undefined` means "not updating".
        ...(params.specModeModelId === undefined
          ? {}
          : { specModeModelId: params.specModeModelId }),
        ...(params.specModeReasoningEffort === undefined
          ? {}
          : { specModeReasoningEffort: params.specModeReasoningEffort }),
        ...(params.missionSettings === undefined
          ? {}
          : { missionSettings: params.missionSettings }),
      };
      const result = await droid.sessions.updateSettings(
        session.id,
        update,
      );
      pendingSettings = {
        ...pendingSettings,
        ...toSettingsOverlay(update),
      };
      return result;
    },
    async getContextStats() {
      // Retained for the SDK-compatible session facade and capability
      // probing. These cumulative totals do not drive DroidVisX's meter.
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
    async readContextWindowSource() {
      const breakdown = await droid.sessions.getContextBreakdown(
        session.id,
      );
      const lastCall = breakdown.lastCallCompactionTokens;
      // Range and rounding belong to projectContextWindow, which owns
      // the same normalization for both runtime modes.
      return {
        limit: breakdown.contextBudget,
        lastCallTokenUsage:
          lastCall === undefined
            ? { status: 'missing' }
            : { status: 'available', used: lastCall },
      };
    },
    async rewind(params) {
      const result = await session.rewind(params);
      return { session: await attachReplacement(result.newSessionId) };
    },
    async getRewindInfo(params) {
      return droid.sessions.getRewindInfo(session.id, params.messageId);
    },
    async getGitDiff() {
      // statsOnly keeps the full diff text off the wire; DroidVisX
      // opens native diffs per file instead of rendering patch text.
      const result = await droid.git.getDiff({
        sessionId: session.id,
        statsOnly: true,
      });
      if (!result.success) {
        throw new Error(result.unavailableReason);
      }
      return {
        branch: result.data.branch,
        baseBranch: result.data.baseBranch,
        files: result.data.files,
        totalAdditions: result.data.totalAdditions,
        totalDeletions: result.data.totalDeletions,
        commitCount: result.data.commits.length,
      };
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

function leaseConflictError(heldByPid: number): Error {
  return heldByPid > 0
    ? new Error(
        `Session is open in another window (pid ${String(heldByPid)}). Close it there or wait for that window to exit.`,
      )
    : new Error(
        'Session ownership could not be secured. Wait briefly and try again.',
      );
}
