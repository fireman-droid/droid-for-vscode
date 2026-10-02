import type { DaemonApi, DaemonSessionHandle } from './api';
import {
  ContextStatsAccuracy,
  SettingsLevel,
  type ModelInfo,
  type SessionSettings,
  type UpdateSessionSettingsOptions,
} from '@factory/droid-sdk';

import {
  type FactoryDroidSession,
  type FactoryDroidSessionFactory,
} from '../session/sessionTypes';
import type { RuntimeSessionTarget } from '../DroidRuntime';
import { RewindAnchorConflictError, RewindAttachmentError } from '../session/rewindErrors';
import { projectCommandRows } from '../commands/FactoryCommandCatalog';
import type { RuntimeDiagnosticSink } from '../runtimeDiagnostics';
import {
  createRuntimeInteractionCallbacks,
  type RuntimeInteractionCallbacks,
  type RuntimeInteractionHandler,
} from '../events/runtimeInteractions';

/**
 * Daemon-backed counterpart of `createLocalDroidSession` (daemon
 * Phase 2). Sessions are created/resumed over one persistent daemon
 * connection instead of a per-window `droid exec` child process, then
 * adapted onto the same `FactoryDroidSession` interface so
 * `FactoryDroidRuntime` runs unchanged.
 *
 * Raw notifications use the same public controller as the retained session.
 * Browser MCP OAuth remains unavailable until its complete flow is enabled.
 *
 * The model catalog comes from the public `models.list()` API. Reads happen separately
 * from session startup, so a failed read can be retried on the same session.
 */
export function createDaemonSessionFactory(
  getDroid: () => Promise<DaemonApi>,
  lease?: SessionLeaseHooks,
  diagnostics?: Pick<RuntimeDiagnosticSink, 'record'>,
): FactoryDroidSessionFactory {
  return (options) =>
    createDaemonDroidSession({
      ...options,
      getDroid,
      lease,
      diagnostics,
    });
}

/**
 * Cross-window lease hooks (daemon Phase 3): with a shared daemon,
 * two windows must not attach the same session, because replacement
 * operations (rewind/compact/fork) are not coordinated by the daemon.
 * Absent hooks (Phase 2 private daemon) everything runs unguarded.
 */
export interface SessionLeaseHooks {
  acquire(sessionId: string): { acquired: true } | { acquired: false; heldByPid: number };
  release(sessionId: string): void;
}

/** How long a blocked resume keeps re-trying the lease. */
export const LEASE_RETRY_MAX_MS = 15_000;
/** Re-acquire cadence while blocked (the check is one file read). */
export const LEASE_RETRY_INTERVAL_MS = 500;

export async function createDaemonDroidSession(options: {
  target: RuntimeSessionTarget;
  interactionHandler: RuntimeInteractionHandler;
  getDroid: () => Promise<DaemonApi>;
  lease?: SessionLeaseHooks;
  diagnostics?: Pick<RuntimeDiagnosticSink, 'record'>;
}): Promise<FactoryDroidSession> {
  const droid = await options.getDroid();
  const callbacks = createRuntimeInteractionCallbacks(options.interactionHandler);
  const lease = options.lease ?? noopLease;

  if (options.target.kind === 'resume') {
    // A window reload leaves the previous extension host process
    // alive for up to minutes, still holding this workspace's lease
    // (user hit 2026-08-13 19:44: resume failed in 1ms against a
    // holder that was already on its way out). The holder releases
    // on dispose or dies and gets preempted, so a blocked acquire
    // retries briefly instead of failing the whole resume.
    let leaseOwned = false;
    let attachment: DaemonSessionHandle | undefined;
    try {
      let outcome = lease.acquire(options.target.sessionId);
      const deadline = Date.now() + LEASE_RETRY_MAX_MS;
      while (!outcome.acquired && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, LEASE_RETRY_INTERVAL_MS));
        outcome = lease.acquire(options.target.sessionId);
      }
      if (!outcome.acquired) {
        throw leaseConflictError(outcome.heldByPid);
      }
      leaseOwned = true;
      if (options.target.child) {
        if (!droid.sessions.attachChild) throw new Error('This Droid connection cannot attach worker conversations.');
        attachment = await droid.sessions.attachChild(options.target.sessionId, callbacks);
      } else {
        attachment = await droid.sessions.resume(options.target.sessionId, callbacks);
      }
      const adapted = adaptDaemonSession(
        droid,
        attachment,
        callbacks,
        lease,
        undefined,
        options.diagnostics,
      );
      attachment = undefined;
      leaseOwned = false;
      return adapted;
    } catch (error) {
      if (attachment !== undefined) {
        const attached = attachment;
        attachment = undefined;
        await detachProvisionalAttachment(attached, 'resume', options.diagnostics);
      }
      if (leaseOwned) {
        leaseOwned = false;
        releaseProvisionalLease(
          lease,
          options.target.sessionId,
          'resume',
          options.diagnostics,
        );
      }
      throw error;
    }
  }

  const session = await droid.sessions.create({
    cwd: options.target.cwd,
    ...(options.target.systemPrompt === undefined ? {} : { systemPrompt: options.target.systemPrompt }),
    // Native daemon channel: create (or reuse) a git worktree and run
    // the session there. Branch and directory naming are daemon-owned;
    // the actual working directory comes back as `session.cwd`.
    ...(options.target.worktree === true ? { worktree: true } : {}),
    ...callbacks,
  });
  let attachmentOwned = true;
  let leaseOwned = false;
  try {
    // A fresh id should never be contested, but registry lock failure
    // still means ownership was not established. Do not expose an
    // unleased handle that another window could also attach.
    const leaseOutcome = lease.acquire(session.id);
    if (!leaseOutcome.acquired) {
      throw leaseConflictError(leaseOutcome.heldByPid);
    }
    leaseOwned = true;
    const adapted = adaptDaemonSession(
      droid,
      session,
      callbacks,
      lease,
      undefined,
      options.diagnostics,
    );
    attachmentOwned = false;
    leaseOwned = false;
    return adapted;
  } catch (error) {
    if (attachmentOwned) {
      attachmentOwned = false;
      await detachProvisionalAttachment(session, 'create', options.diagnostics);
    }
    if (leaseOwned) {
      leaseOwned = false;
      releaseProvisionalLease(lease, session.id, 'create', options.diagnostics);
    }
    throw error;
  }
}

type ProvisionalOperation = 'create' | 'resume';
type ProvisionalResource = 'attachment' | 'lease';

async function detachProvisionalAttachment(
  session: DaemonSessionHandle,
  operation: ProvisionalOperation,
  diagnostics: Pick<RuntimeDiagnosticSink, 'record'> | undefined,
): Promise<void> {
  try {
    await session.detach();
  } catch {
    recordProvisionalCleanupFailure(diagnostics, operation, 'attachment');
  }
}

function releaseProvisionalLease(
  lease: SessionLeaseHooks,
  sessionId: string,
  operation: ProvisionalOperation,
  diagnostics: Pick<RuntimeDiagnosticSink, 'record'> | undefined,
): void {
  try {
    lease.release(sessionId);
  } catch {
    recordProvisionalCleanupFailure(diagnostics, operation, 'lease');
  }
}

function recordProvisionalCleanupFailure(
  diagnostics: Pick<RuntimeDiagnosticSink, 'record'> | undefined,
  operation: ProvisionalOperation,
  resource: ProvisionalResource,
): void {
  try {
    diagnostics?.record({
      level: 'warn',
      name: 'daemon.session.provisional-cleanup-failed',
      attributes: { operation, resource },
    });
  } catch {
    // Cleanup diagnostics must not replace the establishment error.
  }
}

type ReplacementResource = 'successor-attachment' | 'successor-lease' | 'source-lease';

async function detachReplacementSuccessor(
  successor: DaemonSessionHandle,
  diagnostics: Pick<RuntimeDiagnosticSink, 'record'> | undefined,
): Promise<void> {
  try {
    await successor.detach();
  } catch {
    recordReplacementCleanupFailure(diagnostics, 'successor-attachment');
  }
}

function releaseReplacementLease(
  lease: SessionLeaseHooks,
  sessionId: string,
  resource: Extract<ReplacementResource, `${string}-lease`>,
  diagnostics: Pick<RuntimeDiagnosticSink, 'record'> | undefined,
): void {
  try {
    lease.release(sessionId);
  } catch {
    recordReplacementCleanupFailure(diagnostics, resource);
  }
}

function recordReplacementCleanupFailure(
  diagnostics: Pick<RuntimeDiagnosticSink, 'record'> | undefined,
  resource: ReplacementResource,
): void {
  try {
    diagnostics?.record({
      level: 'warn',
      name: 'daemon.session.replacement-cleanup-failed',
      attributes: { resource },
    });
  } catch {
    // Cleanup diagnostics must not replace the replacement outcome.
  }
}

/**
 * Reads the connection-level model catalog, including custom-model changes.
 * Failures reach the model-list caller without replacing the chat session.
 */
async function readDaemonAvailableModels(
  droid: DaemonApi,
): Promise<readonly ModelInfo[]> {
  return droid.models.list({ includeDisabled: true });
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
function toSettingsOverlay(update: SupportedSettingsUpdate): Partial<SessionSettings> {
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
  droid: DaemonApi,
  session: DaemonSessionHandle,
  callbacks: RuntimeInteractionCallbacks,
  lease: SessionLeaseHooks,
  availableModels?: readonly ModelInfo[],
  diagnostics?: Pick<RuntimeDiagnosticSink, 'record'>,
): FactoryDroidSession {
  const outcome = lease.acquire(session.id);
  if (!outcome.acquired) {
    throw leaseConflictError(outcome.heldByPid);
  }
  return adaptDaemonSession(
    droid,
    session,
    callbacks,
    lease,
    availableModels,
    diagnostics,
  );
}

function adaptDaemonSession(
  droid: DaemonApi,
  session: DaemonSessionHandle,
  callbacks: RuntimeInteractionCallbacks,
  lease: SessionLeaseHooks,
  availableModels?: readonly ModelInfo[],
  diagnostics?: Pick<RuntimeDiagnosticSink, 'record'>,
): FactoryDroidSession {
  // The daemon confirms `updateSettings` before the `settings_updated`
  // notification refreshes the handle's snapshot, so successful updates
  // are overlaid locally until the snapshot reports the same value.
  let pendingSettings: Partial<SessionSettings> = {};
  let attachmentOwned = true;
  let leaseOwned = true;
  let closeInFlight: Promise<void> | undefined;
  let pendingRewind: { newSessionId: string; messageId: string } | undefined;

  const closeOwnedResources = async (): Promise<void> => {
    let cleanupFailed = false;
    let cleanupError: unknown;
    if (attachmentOwned) {
      try {
        await session.detach();
        attachmentOwned = false;
      } catch (error) {
        cleanupFailed = true;
        cleanupError = error;
      }
    }
    if (leaseOwned) {
      try {
        lease.release(session.id);
        leaseOwned = false;
      } catch (error) {
        if (!cleanupFailed) {
          cleanupFailed = true;
          cleanupError = error;
        }
      }
    }
    if (cleanupFailed) {
      throw cleanupError;
    }
  };

  const close = (): Promise<void> => {
    if (closeInFlight !== undefined) {
      return closeInFlight;
    }
    if (!attachmentOwned && !leaseOwned) {
      return Promise.resolve();
    }
    const attempt = closeOwnedResources();
    closeInFlight = attempt;
    const clearCloseInFlight = () => {
      if (closeInFlight === attempt) {
        closeInFlight = undefined;
      }
    };
    void attempt.then(clearCloseInFlight, clearCloseInFlight);
    return attempt;
  };

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
    const source = session;
    const sourceSessionId = source.id;
    // The daemon replaces the old session with the new one, but the
    // replacement id still needs an explicit claim before attachment.
    const leaseOutcome = lease.acquire(newSessionId);
    if (!leaseOutcome.acquired) {
      throw leaseConflictError(leaseOutcome.heldByPid);
    }
    let successorLeaseOwned = true;
    let successor: DaemonSessionHandle;
    try {
      const resume = droid.sessions.resumeReplacement?.bind(droid.sessions) ?? droid.sessions.resume.bind(droid.sessions);
      successor = await resume(newSessionId, {
        ...callbacks,
      });
    } catch (error) {
      successorLeaseOwned = false;
      releaseReplacementLease(lease, newSessionId, 'successor-lease', diagnostics);
      throw error;
    }

    try {
      await source.detach();
    } catch (error) {
      await detachReplacementSuccessor(successor, diagnostics);
      if (successorLeaseOwned) {
        successorLeaseOwned = false;
        releaseReplacementLease(lease, newSessionId, 'successor-lease', diagnostics);
      }
      throw error;
    }

    successorLeaseOwned = false;
    releaseReplacementLease(lease, sourceSessionId, 'source-lease', diagnostics);
    // Keep the last catalog; the replacement also retains its fresh reader.
    return adaptDaemonSession(
      droid,
      successor,
      callbacks,
      lease,
      availableModels,
      diagnostics,
    );
  };

  return {
    onNotification: (listener) => session.onNotification(listener),
    readMissionSnapshot: () => session.readMissionSnapshot(),
    subscribeMissionSnapshot: (listener) => session.subscribeMissionSnapshot(listener),
    ...(session.readTurnOutcome === undefined ? {} : {
      readTurnOutcome: (backendTurnId: string) => session.readTurnOutcome!(backendTurnId),
    }),
    listCommands: async () => projectCommandRows(await droid.commands.list(session.id)),
    get id() {
      return session.id;
    },
    get availableModels() {
      return availableModels === undefined ? undefined : [...availableModels];
    },
    async readAvailableModels() {
      availableModels = await readDaemonAvailableModels(droid);
      return availableModels;
    },
    get cwd(): string | undefined {
      return session.cwd;
    },
    get settings(): Readonly<SessionSettings> {
      const snapshot = session.settings;
      for (const key of Object.keys(pendingSettings) as (keyof SessionSettings)[]) {
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
        ...(params.modelId === undefined ? {} : { modelId: params.modelId }),
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
      const result = await droid.sessions.updateSettings(session.id, update);
      pendingSettings = {
        ...pendingSettings,
        ...toSettingsOverlay(update),
      };
      return result;
    },
    async getContextStats() {
      const breakdown = await droid.sessions.getContextBreakdown(session.id);
      return {
        used: Math.round(breakdown.usedTokens),
        remaining: Math.round(breakdown.freeTokens),
        limit: Math.round(breakdown.contextBudget),
        accuracy: ContextStatsAccuracy.Estimated,
        updatedAt: new Date().toISOString(),
      };
    },
    async readContextBreakdown() {
      const breakdown = await droid.sessions.getContextBreakdown(session.id);
      return {
        used: breakdown.usedTokens,
        remaining: breakdown.freeTokens,
        limit: breakdown.contextBudget,
        ...(breakdown.lastCallCompactionTokens === undefined
          ? {}
          : { lastCallCompactionTokens: breakdown.lastCallCompactionTokens }),
      };
    },
    async rewind(params) {
      if (pendingRewind !== undefined && pendingRewind.messageId !== params.messageId) {
        throw new RewindAnchorConflictError(pendingRewind.messageId);
      }
      if (pendingRewind === undefined) {
        const result = await session.rewind(params);
        pendingRewind = { newSessionId: result.newSessionId, messageId: params.messageId };
      }
      const completed = pendingRewind;
      try {
        const replacement = await attachReplacement(completed.newSessionId);
        pendingRewind = undefined;
        return { session: replacement };
      } catch (error) {
        throw new RewindAttachmentError(completed.newSessionId, completed.messageId, error);
      }
    },
    async getRewindInfo(params) {
      return droid.sessions.getRewindInfo(session.id, params.messageId);
    },
    async getGitDiff(options) {
      const result = await droid.git.getDiff({
        sessionId: session.id,
        statsOnly: options?.includePatch !== true,
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
        ...(options?.includePatch === true ? {
          comparisons: {
            branch: { files: result.data.committedFiles, patch: result.data.committedDiff },
            // Despite its name, the daemon's unstaged section is HEAD → worktree,
            // including staged changes and nonignored untracked files.
            workspace: { files: result.data.unstagedFiles, patch: result.data.unstagedDiff },
          },
        } : {}),
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
        ...(params.command === undefined ? {} : { command: params.command }),
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
    // Daemon OAuth uses mcpAuthentication.ts with native Host callback handling;
    // the Process-shaped session adapter deliberately does not own that flow.
    close() {
      // Releasing the handle keeps the session alive in the daemon;
      // Phase 3's shared daemon lets it survive a window reload.
      return close();
    },
  };
}

function leaseConflictError(heldByPid: number): Error {
  return heldByPid > 0
    ? new Error(
        `Session is open in another window (pid ${String(heldByPid)}). Close it there or wait for that window to exit.`,
      )
    : new Error('Session ownership could not be secured. Wait briefly and try again.');
}
