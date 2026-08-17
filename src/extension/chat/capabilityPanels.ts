// capabilityPanels: moved verbatim from ChatController.ts (structure-only
// refactor; bodies unchanged except mechanical this. -> ctl.).
import type {
  CommandSummary,
  ModelCatalogState,
  PluginScope,
  PluginSummary,
  SessionCommandsState,
  SessionContextStats,
  SessionPluginsState,
  SessionSkillsState,
  SkillSummary,
} from '../../shared/bridgeMessages';
import {
  MAX_MODEL_CATALOG_ITEMS,
  MAX_PLUGIN_ID_LENGTH,
  MAX_PLUGIN_ITEMS,
  MAX_PLUGIN_MARKETPLACE_COUNT,
  MAX_PLUGIN_VERSION_LENGTH,
  PLUGIN_SCOPES,
  SESSION_REASONING_EFFORTS,
} from '../../shared/bridgeMessages';
import type {
  DroidRuntime,
  RuntimeCommand,
  RuntimeContextWindow,
  RuntimeModelCatalog,
  RuntimeModelCatalogItem,
  RuntimeSkill,
} from '../../runtime/DroidRuntime';
import type { InstalledPluginEntry } from '../../runtime/daemon/DaemonPluginCatalog';
import type { TokenUsageBreakdown } from '../../shared/tokenUsage';
import {
  isSafeDisplayName,
  isSafeModelId,
} from '../../shared/validateMessage';
import { ensureActiveRuntimeWorkspaceCurrent } from './runtimeLifecycle';
import {
  daemonFailureMessage,
  formatUnknownError,
  isEnumValue,
  type ChatControllerInternals,
} from './internals';
import { emitMissionSetupCapabilities } from './mission/setupProjection';

export const SKILLS_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not expose skills.';

export const SKILLS_LOAD_FAILED_MESSAGE =
  'Droid did not return the skill list. Retry from the skills panel.';

export const COMMANDS_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not expose custom commands.';

export const COMMANDS_LOAD_FAILED_MESSAGE =
  'Droid did not return the command list. Type / again to retry.';

export const SKILL_TOGGLE_FAILED_MESSAGE =
  'Droid could not update that skill. The list may be stale; refresh it.';

export const PLUGINS_UNSUPPORTED_MESSAGE =
  'Plugins are not available in this Droid runtime.';

export const PLUGINS_LOAD_FAILED_MESSAGE =
  'Droid did not return the plugin list. Retry from the plugins panel.';

export const PLUGINS_NOT_LOGGED_IN_MESSAGE =
  'Sign in with the droid CLI to view plugins.';

export const SKILL_REQUEST_DROPPED_MESSAGE =
  'Droid could not accept that skill change right now. Retry in a moment.';

export const CONTEXT_READ_FAILED_MESSAGE =
  'Droid did not return context usage. Retry, then open DroidVisX Logs if this continues.';

export const MODEL_CATALOG_UNSUPPORTED_MESSAGE =
  'Model selection is unavailable in this Droid runtime.';

export const MODEL_CATALOG_FAILED_MESSAGE =
  'Droid models could not be loaded.';

export function handleContextRefresh(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    if (
      sessionId !== ctl.sessionId ||
      ctl.runtime === null ||
      ctl.connection.status !== 'connected' ||
      ctl.sessionOperationInProgress ||
      ctl.context.status === 'loading' ||
      !ensureActiveRuntimeWorkspaceCurrent(ctl)
    ) {
      return;
    }

    refreshContext(ctl, 
      ctl.runtime,
      ctl.runtimeGeneration,
      sessionId,
      ctl.activeRuntimeCwd!,
    );
}

export function refreshContext(
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
    onSettled?: () => void,
  ): void {
    const request = ++ctl.contextGeneration;
    const confirmed =
      ctl.context.status === 'ready' ||
      ctl.context.status === 'error'
        ? ctl.context.value
        : null;
    ctl.context = { status: 'loading', value: confirmed };
    emitContext(ctl, sessionId);
    void runtime
      .readContextWindow()
      .then((result) => {
        onSettled?.();
        if (
          request !== ctl.contextGeneration ||
          !ctl.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          return;
        }
        ctl.context = {
          status: 'ready',
          value: projectContextWindow(result),
        };
        emitContext(ctl, sessionId);
      })
      .catch(() => {
        onSettled?.();
        if (
          request !== ctl.contextGeneration ||
          !ctl.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          return;
        }
        ctl.context = {
          status: 'error',
          value: confirmed,
          message: CONTEXT_READ_FAILED_MESSAGE,
        };
        emitContext(ctl, sessionId);
      });
}

export function emitContext(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    ctl.emit({
      type: 'session.context',
      sessionId,
      context: ctl.context,
    });
}

export function updateTokenUsage(
  ctl: ChatControllerInternals,
    sessionId: string,
    update: Partial<{
      cumulative: TokenUsageBreakdown;
      lastTurn: TokenUsageBreakdown;
    }>,
  ): void {
    if (ctl.sessionId !== sessionId) {
      return;
    }
    ctl.tokenUsage = { ...ctl.tokenUsage, ...update };
    ctl.emit({
      type: 'session.tokenUsage',
      sessionId,
      tokenUsage: ctl.tokenUsage,
    });
}

export function handleSkillsRefresh(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    const runtime = ctl.runtime;
    const dropReason = ctl.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      ctl.recordDroppedPanelRequest(
        'skills.refresh',
        dropReason ?? 'no-runtime',
      );
      return;
    }
    pushSkills(ctl, 
      runtime,
      ctl.runtimeGeneration,
      sessionId,
      ctl.activeRuntimeCwd!,
    );
}

/**
 * Loads and emits the skills catalog. Called from the user-request
 * guard chain and directly from session activation
 * (`loadSessionMetadata`), where `sessionOperationInProgress` is
 * still set and the request guard would wrongly drop the push.
 */
export function pushSkills(
  ctl: ChatControllerInternals,
    runtime: DroidRuntime,
    generation: number,
    sessionId: string,
    cwd: string,
  ): void {
    if (typeof runtime.listSkills !== 'function') {
      emitSkills(ctl, sessionId, {
        status: 'unsupported',
        items: [],
        message: SKILLS_UNSUPPORTED_MESSAGE,
      });
      return;
    }

    emitSkills(ctl, sessionId, { status: 'loading', items: [] });
    void runtime.listSkills().then(
      (skills) => {
        if (
          !ctl.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          return;
        }
        emitSkills(ctl, sessionId, {
          status: 'ready',
          items: skills.map(projectSkillSummary),
        });
      },
      (error) => {
        if (
          !ctl.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          return;
        }
        ctl.recordPanelFailure(
          'skills-load-failed',
          formatUnknownError(error),
        );
        emitSkills(ctl, sessionId, {
          status: 'error',
          items: [],
          message: SKILLS_LOAD_FAILED_MESSAGE,
        });
      },
    );
}

export function handleSkillToggle(
  ctl: ChatControllerInternals,
    sessionId: string,
    name: string,
    disabled: boolean,
  ): void {
    const runtime = ctl.runtime;
    const dropReason = ctl.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      const reason = dropReason ?? 'no-runtime';
      ctl.recordDroppedPanelRequest('skill.toggle', reason);
      if (
        reason !== 'session-mismatch' &&
        sessionId === ctl.sessionId
      ) {
        emitSkills(ctl, sessionId, {
          status: 'error',
          items: [],
          message: SKILL_REQUEST_DROPPED_MESSAGE,
        });
      }
      return;
    }
    if (
      typeof runtime.setSkillDisabled !== 'function' ||
      typeof runtime.listSkills !== 'function'
    ) {
      emitSkills(ctl, sessionId, {
        status: 'unsupported',
        items: [],
        message: SKILLS_UNSUPPORTED_MESSAGE,
      });
      return;
    }

    emitSkills(ctl, sessionId, { status: 'loading', items: [] });
    const generation = ctl.runtimeGeneration;
    const cwd = ctl.activeRuntimeCwd!;
    void runtime
      .setSkillDisabled(name, disabled)
      .then(() => runtime.listSkills!())
      .then(
        (skills) => {
          if (
            !ctl.isCurrentSessionOperation(
              runtime,
              generation,
              sessionId,
              cwd,
            )
          ) {
            return;
          }
          emitSkills(ctl, sessionId, {
            status: 'ready',
            items: skills.map(projectSkillSummary),
          });
        },
        (error) => {
          if (
            !ctl.isCurrentSessionOperation(
              runtime,
              generation,
              sessionId,
              cwd,
            )
          ) {
            return;
          }
          ctl.recordPanelFailure(
            'skill-toggle-failed',
            formatUnknownError(error),
          );
          emitSkills(ctl, sessionId, {
            status: 'error',
            items: [],
            message: SKILL_TOGGLE_FAILED_MESSAGE,
          });
        },
      );
}

export function emitSkills(
  ctl: ChatControllerInternals,
    sessionId: string,
    skills: SessionSkillsState,
  ): void {
    ctl.emit({
      type: 'session.skills',
      sessionId,
      skills,
    });
}

/**
 * Serves the read-only plugins panel through the daemon sidecar:
 * `plugins.listInstalled` and `marketplaces.list` run concurrently
 * against the active session id (the daemon accepts any on-disk
 * session id for these RPCs — probe evidence in
 * docs/product/plugins-hooks-design.md §2.1). Daemon failures
 * surface as an explicit error state, never a silent empty list.
 */
export function handlePluginsRefresh(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    const runtime = ctl.runtime;
    const dropReason = ctl.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      ctl.recordDroppedPanelRequest(
        'plugins.refresh',
        dropReason ?? 'no-runtime',
      );
      return;
    }
    const daemonPlugins = ctl.daemonPlugins;
    if (daemonPlugins === undefined) {
      emitPlugins(ctl, sessionId, {
        status: 'unsupported',
        items: [],
        message: PLUGINS_UNSUPPORTED_MESSAGE,
      });
      return;
    }

    emitPlugins(ctl, sessionId, { status: 'loading', items: [] });
    const generation = ctl.runtimeGeneration;
    const cwd = ctl.activeRuntimeCwd!;
    void daemonPlugins()
      .then((catalog) => catalog.snapshot(sessionId))
      .then(
        (snapshot) => {
          if (
            !ctl.isCurrentSessionOperation(
              runtime,
              generation,
              sessionId,
              cwd,
            )
          ) {
            return;
          }
          emitPlugins(ctl, sessionId, {
            status: 'ready',
            items: projectPluginSummaries(snapshot.plugins),
            marketplaceCount: Math.min(
              snapshot.marketplaceCount,
              MAX_PLUGIN_MARKETPLACE_COUNT,
            ),
          });
        },
        (error) => {
          if (
            !ctl.isCurrentSessionOperation(
              runtime,
              generation,
              sessionId,
              cwd,
            )
          ) {
            return;
          }
          ctl.recordPanelFailure(
            'plugins-load-failed',
            formatUnknownError(error),
          );
          emitPlugins(ctl, sessionId, {
            status: 'error',
            items: [],
            message: daemonFailureMessage(
              error,
              PLUGINS_LOAD_FAILED_MESSAGE,
              PLUGINS_NOT_LOGGED_IN_MESSAGE,
            ),
          });
        },
      );
}

export function emitPlugins(
  ctl: ChatControllerInternals,
    sessionId: string,
    plugins: SessionPluginsState,
  ): void {
    ctl.emit({
      type: 'session.plugins',
      sessionId,
      plugins,
    });
}

export function handleCommandsRefresh(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    const runtime = ctl.runtime;
    if (
      sessionId !== ctl.sessionId ||
      runtime === null ||
      ctl.connection.status !== 'connected' ||
      ctl.sessionOperationInProgress ||
      ctl.commandsRefreshGeneration === ctl.runtimeGeneration ||
      !ensureActiveRuntimeWorkspaceCurrent(ctl)
    ) {
      return;
    }
    if (typeof runtime.listCommands !== 'function') {
      emitCommands(ctl, sessionId, {
        status: 'unsupported',
        items: [],
        recent: [],
        message: COMMANDS_UNSUPPORTED_MESSAGE,
      });
      return;
    }

    const cachedItems = cachedCommandItems(ctl, sessionId);
    emitCommands(ctl, sessionId, {
      status: 'loading',
      items: cachedItems,
      recent: ctl.recentCommands.read(),
    });
    const generation = ctl.runtimeGeneration;
    ctl.commandsRefreshGeneration = generation;
    const cwd = ctl.activeRuntimeCwd!;
    void runtime.listCommands().then(
      (commands) => {
        if (ctl.commandsRefreshGeneration === generation) {
          ctl.commandsRefreshGeneration = null;
        }
        if (
          !ctl.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          return;
        }
        const items = commands.map(projectCommandSummary);
        ctl.commandsCache = { sessionId, items };
        emitCommands(ctl, sessionId, {
          status: 'ready',
          items,
          recent: ctl.recentCommands.read(),
        });
      },
      () => {
        if (ctl.commandsRefreshGeneration === generation) {
          ctl.commandsRefreshGeneration = null;
        }
        if (
          !ctl.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          )
        ) {
          return;
        }
        emitCommands(ctl, sessionId, {
          status: 'error',
          items: cachedCommandItems(ctl, sessionId),
          recent: ctl.recentCommands.read(),
          message: COMMANDS_LOAD_FAILED_MESSAGE,
        });
      },
    );
}

export function cachedCommandItems(
  ctl: ChatControllerInternals,
    sessionId: string,
  ): readonly CommandSummary[] {
    return ctl.commandsCache?.sessionId === sessionId
      ? ctl.commandsCache.items
      : [];
}

/**
 * Records a `/command` invocation in the recent list when the sent
 * text starts with a known custom command, then re-broadcasts the
 * catalog so the popup reorders immediately.
 */
export function recordRecentCommand(
  ctl: ChatControllerInternals,
  sessionId: string, text: string): void {
    if (
      !text.startsWith('/') ||
      ctl.commandsCache?.sessionId !== sessionId
    ) {
      return;
    }
    const slug = text
      .slice(1)
      .split(/\s/, 1)[0]!
      .toLowerCase();
    const match = ctl.commandsCache.items.find(
      (item) => item.name.toLowerCase() === slug,
    );
    if (match === undefined) {
      return;
    }
    const recent = ctl.recentCommands.record(match.name);
    emitCommands(ctl, sessionId, {
      status: 'ready',
      items: ctl.commandsCache.items,
      recent,
    });
}

export function emitCommands(
  ctl: ChatControllerInternals,
    sessionId: string,
    commands: SessionCommandsState,
  ): void {
    ctl.emit({
      type: 'session.commands',
      sessionId,
      commands,
    });
}

export function emitModelCatalog(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    ctl.emit({
      type: 'session.model-catalog',
      sessionId,
      modelCatalog: ctl.modelCatalog,
    });
    emitMissionSetupCapabilities(ctl);
}

export function projectContextWindow(
  context: RuntimeContextWindow,
): SessionContextStats {
  if (context.availability === 'unavailable') {
    if (
      context.reason !== 'no-last-call' &&
      context.reason !== 'invalid-last-call' &&
      context.reason !== 'invalid-budget'
    ) {
      throw new Error('Invalid runtime context window.');
    }
    return {
      availability: 'unavailable',
      reason: context.reason,
    };
  }
  if (
    context.availability !== 'available' ||
    !isSafeContextNumber(context.used) ||
    !isSafeContextNumber(context.remaining) ||
    !isSafeContextNumber(context.limit) ||
    context.limit === 0 ||
    context.used > context.limit ||
    context.remaining !== context.limit - context.used
  ) {
    throw new Error('Invalid runtime context window.');
  }
  return {
    availability: 'available',
    used: context.used,
    remaining: context.remaining,
    limit: context.limit,
  };
}

export function projectModelCatalog(
  catalog: RuntimeModelCatalog,
): ModelCatalogState {
  if (catalog.status === 'unavailable') {
    return {
      status: 'unsupported',
      items: [],
      message: MODEL_CATALOG_UNSUPPORTED_MESSAGE,
    };
  }
  if (
    catalog.status !== 'available' ||
    !Array.isArray(catalog.items) ||
    catalog.items.length > MAX_MODEL_CATALOG_ITEMS
  ) {
    throw new Error('Invalid runtime model catalog.');
  }

  const ids = new Set<string>();
  const items = catalog.items.map((item: RuntimeModelCatalogItem) => {
    if (
      !isSafeModelId(item.id) ||
      ids.has(item.id) ||
      !isSafeDisplayName(item.displayName) ||
      !Array.isArray(item.supportedReasoningEfforts) ||
      item.supportedReasoningEfforts.length === 0 ||
      item.supportedReasoningEfforts.length >
        SESSION_REASONING_EFFORTS.length
    ) {
      throw new Error('Invalid runtime model catalog item.');
    }
    const efforts = new Set(item.supportedReasoningEfforts);
    if (
      efforts.size !== item.supportedReasoningEfforts.length ||
      item.supportedReasoningEfforts.some(
        (effort) =>
          !isEnumValue(effort, SESSION_REASONING_EFFORTS),
      )
    ) {
      throw new Error('Invalid runtime model reasoning efforts.');
    }
    ids.add(item.id);
    return {
      id: item.id,
      displayName: item.displayName,
      supportedReasoningEfforts: [...item.supportedReasoningEfforts],
    };
  });
  return { status: 'ready', items };
}

export function projectSkillSummary(skill: RuntimeSkill): SkillSummary {
  return {
    name: skill.name,
    description: skill.description,
    location: skill.location,
    enabled: skill.enabled,
    userInvocable: skill.userInvocable,
  };
}

export /**
 * Projects daemon plugin rows into bounded Bridge summaries. Rows
 * that violate the contract — oversized or control-character ids,
 * duplicate ids, or a scope outside the user/project whitelist — are
 * dropped (fail closed) rather than displayed with invented values.
 */
function projectPluginSummaries(
  entries: readonly InstalledPluginEntry[],
): PluginSummary[] {
  const items: PluginSummary[] = [];
  const ids = new Set<string>();
  for (const entry of entries) {
    if (
      items.length >= MAX_PLUGIN_ITEMS ||
      entry.id.length === 0 ||
      entry.id.length > MAX_PLUGIN_ID_LENGTH ||
      /[\u0000-\u001f\u007f-\u009f]/.test(entry.id) ||
      ids.has(entry.id) ||
      !isPluginScope(entry.scope)
    ) {
      continue;
    }
    ids.add(entry.id);
    items.push({
      id: entry.id,
      scope: entry.scope,
      version: entry.version
        .replace(/[\u0000-\u001f\u007f-\u009f]+/g, '')
        .slice(0, MAX_PLUGIN_VERSION_LENGTH),
      active: entry.active,
    });
  }
  return items;
}

export function isPluginScope(value: string): value is PluginScope {
  return (PLUGIN_SCOPES as readonly string[]).includes(value);
}

export function projectCommandSummary(command: RuntimeCommand): CommandSummary {
  return {
    name: command.name,
    description: command.description,
    argumentHint: command.argumentHint,
    isExecutable: command.isExecutable,
  };
}

export function isSafeContextNumber(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
