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
): FactoryDroidSessionFactory {
  return (options) => createDaemonDroidSession({ ...options, getDroid });
}

export async function createDaemonDroidSession(options: {
  target: RuntimeSessionTarget;
  interactionHandler: RuntimeInteractionHandler;
  getDroid: () => Promise<ConnectedDroid>;
}): Promise<FactoryDroidSession> {
  const droid = await options.getDroid();
  const callbacks = createRuntimeInteractionCallbacks(
    options.interactionHandler,
  );

  const session =
    options.target.kind === 'resume'
      ? await droid.sessions.resume(options.target.sessionId, {
          ...callbacks,
        })
      : await droid.sessions.create({
          cwd: options.target.cwd,
          ...callbacks,
        });

  return adaptDaemonSession(droid, session, callbacks);
}

/** Session-setting fields the daemon accepts and the runtime updates. */
type SupportedSettingsUpdate = Pick<
  UpdateSessionSettingsOptions,
  'interactionMode' | 'modelId' | 'reasoningEffort' | 'autonomyLevel'
>;

function adaptDaemonSession(
  droid: ConnectedDroid,
  session: ConnectedDroidSession,
  callbacks: RuntimeInteractionCallbacks,
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
    const next = await droid.sessions.resume(newSessionId, {
      ...callbacks,
    });
    await session.detach();
    return adaptDaemonSession(droid, next, callbacks);
  };

  return {
    get id() {
      return session.id;
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
    close() {
      // Phase 2: releasing the handle keeps the session alive in the
      // daemon; the private daemon itself is still parent-pid bound.
      return session.detach();
    },
  };
}
