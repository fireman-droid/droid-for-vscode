import type { CapabilitiesHostPort } from './metadataPorts';
import {
  type CommandSummary,
  type ModelCatalogState,
  type PluginScope,
  type PluginSummary,
  type SessionCommandsState,
  type SessionPluginsState,
  type SessionSkillsState,
  type SkillSummary,
} from '../../../shared/protocol/settings';
import { type SessionContextStats } from '../../../shared/bridgeMessages';
import {
  MAX_MODEL_CATALOG_ITEMS,
  MAX_PLUGIN_ID_LENGTH,
  MAX_PLUGIN_ITEMS,
  MAX_PLUGIN_MARKETPLACE_COUNT,
  MAX_PLUGIN_VERSION_LENGTH,
  PLUGIN_SCOPES,
  SESSION_REASONING_EFFORTS,
} from '../../../shared/protocol/bounds';
import type {
  DroidRuntime,
  RuntimeCommand,
  RuntimeContextWindow,
  RuntimeModelCatalog,
  RuntimeModelCatalogItem,
  RuntimeSkill,
} from '../../../runtime/DroidRuntime';
import type { InstalledPluginEntry } from '../../../runtime/daemon/DaemonPluginCatalog';
import type { TokenUsageBreakdown } from '../../../shared/protocol/tokenUsage';
import { isSafeDisplayName, isSafeModelId } from '../../../shared/validation/guards';
import { daemonFailureMessage, formatUnknownError, isEnumValue } from '../internals';
import type { CapturedSessionIdentity } from '../operationEligibility';

export const SKILLS_UNSUPPORTED_MESSAGE = 'This Droid runtime does not expose skills.';

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

export const MODEL_CATALOG_FAILED_MESSAGE = 'Droid models could not be loaded.';

export function handleContextRefresh(ctl: CapabilitiesHostPort, sessionId: string): void {
  if (
    sessionId !== ctl.sessionState.sessionId ||
    ctl.sessionState.runtime === null ||
    ctl.sessionState.connection.status !== 'connected' ||
    ctl.sessionState.sessionOperationInProgress ||
    ctl.metadata.context.status === 'loading' ||
    !ctl.ensureWorkspaceCurrent()
  ) {
    return;
  }

  refreshContext(
    ctl,
    ctl.sessionState.runtime,
    ctl.sessionState.runtimeGeneration,
    sessionId,
    ctl.sessionState.activeRuntimeCwd!,
  );
}

export function refreshContext(
  ctl: CapabilitiesHostPort,
  runtime: DroidRuntime,
  generation: number,
  sessionId: string,
  cwd: string,
  onSettled?: () => void,
): void {
  const request = ++ctl.metadata.contextGeneration;
  const confirmed =
    ctl.metadata.context.status === 'ready' || ctl.metadata.context.status === 'error'
      ? ctl.metadata.context.value
      : null;
  ctl.metadata.context = { status: 'loading', value: confirmed };
  emitContext(ctl, sessionId);
  void runtime
    .readContextWindow()
    .then((result) => {
      onSettled?.();
      if (
        request !== ctl.metadata.contextGeneration ||
        !ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)
      ) {
        return;
      }
      ctl.metadata.context = {
        status: 'ready',
        value: projectContextWindow(result),
      };
      emitContext(ctl, sessionId);
    })
    .catch(() => {
      onSettled?.();
      if (
        request !== ctl.metadata.contextGeneration ||
        !ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)
      ) {
        return;
      }
      ctl.metadata.context = {
        status: 'error',
        value: confirmed,
        message: CONTEXT_READ_FAILED_MESSAGE,
      };
      emitContext(ctl, sessionId);
    });
}

export function emitContext(ctl: CapabilitiesHostPort, sessionId: string): void {
  ctl.emit({
    type: 'session.context',
    sessionId,
    context: ctl.metadata.context,
  });
}

export function updateTokenUsage(
  ctl: CapabilitiesHostPort,
  sessionId: string,
  update: Partial<{
    cumulative: TokenUsageBreakdown;
    lastTurn: TokenUsageBreakdown;
  }>,
): void {
  if (ctl.sessionState.sessionId !== sessionId) {
    return;
  }
  ctl.metadata.tokenUsage = { ...ctl.metadata.tokenUsage, ...update };
  ctl.emit({
    type: 'session.tokenUsage',
    sessionId,
    tokenUsage: ctl.metadata.tokenUsage,
  });
}

export function handleSkillsRefresh(ctl: CapabilitiesHostPort, sessionId: string): void {
  const runtime = ctl.sessionState.runtime;
  const dropReason = ctl.sessionRequestDropReason(sessionId);
  if (dropReason !== null || runtime === null) {
    ctl.recordDroppedPanelRequest('skills.refresh', dropReason ?? 'no-runtime');
    return;
  }
  loadSkills(
    ctl,
    runtime,
    ctl.sessionState.runtimeGeneration,
    sessionId,
    ctl.sessionState.activeRuntimeCwd!,
  );
}

/**
 * Loads activation metadata only for the session identity captured by
 * `loadSessionMetadata`. User requests take the normal panel path.
 */
export function pushActivationSkills(
  ctl: CapabilitiesHostPort,
  identity: CapturedSessionIdentity,
): void {
  if (
    !ctl.isCurrentSessionOperation(
      identity.runtime,
      identity.generation,
      identity.sessionId,
      identity.cwd,
    )
  ) {
    return;
  }
  loadSkills(
    ctl,
    identity.runtime,
    identity.generation,
    identity.sessionId,
    identity.cwd,
  );
}

function loadSkills(
  ctl: CapabilitiesHostPort,
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
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        return;
      }
      emitSkills(ctl, sessionId, {
        status: 'ready',
        items: skills.map(projectSkillSummary),
      });
    },
    (error) => {
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        return;
      }
      ctl.recordPanelFailure('skills-load-failed', formatUnknownError(error));
      emitSkills(ctl, sessionId, {
        status: 'error',
        items: [],
        message: SKILLS_LOAD_FAILED_MESSAGE,
      });
    },
  );
}

export function handleSkillToggle(
  ctl: CapabilitiesHostPort,
  sessionId: string,
  name: string,
  disabled: boolean,
): void {
  const runtime = ctl.sessionState.runtime;
  const dropReason = ctl.sessionRequestDropReason(sessionId);
  if (dropReason !== null || runtime === null) {
    const reason = dropReason ?? 'no-runtime';
    ctl.recordDroppedPanelRequest('skill.toggle', reason);
    if (reason !== 'session-mismatch' && sessionId === ctl.sessionState.sessionId) {
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
  const generation = ctl.sessionState.runtimeGeneration;
  const cwd = ctl.sessionState.activeRuntimeCwd!;
  void runtime
    .setSkillDisabled(name, disabled)
    .then(() => runtime.listSkills!())
    .then(
      (skills) => {
        if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
          return;
        }
        emitSkills(ctl, sessionId, {
          status: 'ready',
          items: skills.map(projectSkillSummary),
        });
      },
      (error) => {
        if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
          return;
        }
        ctl.recordPanelFailure('skill-toggle-failed', formatUnknownError(error));
        emitSkills(ctl, sessionId, {
          status: 'error',
          items: [],
          message: SKILL_TOGGLE_FAILED_MESSAGE,
        });
      },
    );
}

export function emitSkills(
  ctl: CapabilitiesHostPort,
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
 * session id for these RPCs). Daemon failures
 * surface as an explicit error state, never a silent empty list.
 */
export function handlePluginsRefresh(ctl: CapabilitiesHostPort, sessionId: string): void {
  const runtime = ctl.sessionState.runtime;
  const dropReason = ctl.sessionRequestDropReason(sessionId);
  if (dropReason !== null || runtime === null) {
    ctl.recordDroppedPanelRequest('plugins.refresh', dropReason ?? 'no-runtime');
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
  const generation = ctl.sessionState.runtimeGeneration;
  const cwd = ctl.sessionState.activeRuntimeCwd!;
  void daemonPlugins()
    .then((catalog) => catalog.snapshot(sessionId))
    .then(
      (snapshot) => {
        if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
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
        if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
          return;
        }
        ctl.recordPanelFailure('plugins-load-failed', formatUnknownError(error));
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
  ctl: CapabilitiesHostPort,
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
  ctl: CapabilitiesHostPort,
  sessionId: string,
): void {
  const runtime = ctl.sessionState.runtime;
  const dropReason = ctl.sessionRequestDropReason(sessionId);
  if (
    dropReason !== null ||
    runtime === null ||
    ctl.metadata.commandsRefreshGeneration === ctl.sessionState.runtimeGeneration
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
  const generation = ctl.sessionState.runtimeGeneration;
  ctl.metadata.commandsRefreshGeneration = generation;
  const cwd = ctl.sessionState.activeRuntimeCwd!;
  void runtime.listCommands().then(
    (commands) => {
      if (ctl.metadata.commandsRefreshGeneration === generation) {
        ctl.metadata.commandsRefreshGeneration = null;
      }
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
        return;
      }
      const items = commands.map(projectCommandSummary);
      ctl.metadata.commandsCache = { sessionId, items };
      emitCommands(ctl, sessionId, {
        status: 'ready',
        items,
        recent: ctl.recentCommands.read(),
      });
    },
    () => {
      if (ctl.metadata.commandsRefreshGeneration === generation) {
        ctl.metadata.commandsRefreshGeneration = null;
      }
      if (!ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)) {
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
  ctl: CapabilitiesHostPort,
  sessionId: string,
): readonly CommandSummary[] {
  return ctl.metadata.commandsCache?.sessionId === sessionId
    ? ctl.metadata.commandsCache.items
    : [];
}

/**
 * Records a `/command` invocation in the recent list when the sent
 * text starts with a known custom command, then re-broadcasts the
 * catalog so the popup reorders immediately.
 */
export function recordRecentCommand(
  ctl: CapabilitiesHostPort,
  sessionId: string,
  text: string,
): void {
  if (!text.startsWith('/') || ctl.metadata.commandsCache?.sessionId !== sessionId) {
    return;
  }
  const slug = text.slice(1).split(/\s/, 1)[0]!.toLowerCase();
  const match = ctl.metadata.commandsCache.items.find(
    (item) => item.name.toLowerCase() === slug,
  );
  if (match === undefined) {
    return;
  }
  const recent = ctl.recentCommands.record(match.name);
  emitCommands(ctl, sessionId, {
    status: 'ready',
    items: ctl.metadata.commandsCache.items,
    recent,
  });
}

export function emitCommands(
  ctl: CapabilitiesHostPort,
  sessionId: string,
  commands: SessionCommandsState,
): void {
  ctl.emit({
    type: 'session.commands',
    sessionId,
    commands,
  });
}

export function emitModelCatalog(ctl: CapabilitiesHostPort, sessionId: string): void {
  ctl.emit({
    type: 'session.model-catalog',
    sessionId,
    modelCatalog: ctl.metadata.modelCatalog,
  });
  ctl.metadataChanged();
}

export function projectContextWindow(context: RuntimeContextWindow): SessionContextStats {
  if (
    context.estimatedTokens !== undefined &&
    !isSafeContextNumber(context.estimatedTokens)
  ) {
    throw new Error('Invalid runtime context estimate.');
  }
  const estimate =
    context.estimatedTokens === undefined
      ? {}
      : { estimatedTokens: context.estimatedTokens };
  if (context.availability === 'unavailable') {
    if (
      context.reason !== 'unsupported' &&
      context.reason !== 'awaiting-usage' &&
      context.reason !== 'invalid-breakdown'
    ) {
      throw new Error('Invalid runtime context window.');
    }
    return {
      availability: 'unavailable',
      reason: context.reason,
      ...estimate,
    };
  }
  if (
    context.availability !== 'available' ||
    !isSafeContextNumber(context.used) ||
    !isSafeContextNumber(context.remaining) ||
    !isSafeContextNumber(context.limit) ||
    context.limit === 0 ||
    context.remaining !== Math.max(0, context.limit - context.used)
  ) {
    throw new Error('Invalid runtime context window.');
  }
  return {
    availability: 'available',
    used: context.used,
    remaining: context.remaining,
    limit: context.limit,
    ...estimate,
  };
}

export function projectModelCatalog(catalog: RuntimeModelCatalog): ModelCatalogState {
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
      item.supportedReasoningEfforts.length > SESSION_REASONING_EFFORTS.length
    ) {
      throw new Error('Invalid runtime model catalog item.');
    }
    const efforts = new Set(item.supportedReasoningEfforts);
    if (
      efforts.size !== item.supportedReasoningEfforts.length ||
      item.supportedReasoningEfforts.some(
        (effort) => !isEnumValue(effort, SESSION_REASONING_EFFORTS),
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
