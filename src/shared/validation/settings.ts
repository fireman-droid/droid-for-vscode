import {
  MAX_MCP_ARGS,
  MAX_MCP_ARG_LENGTH,
  MAX_MCP_COMMAND_LENGTH,
  MAX_MCP_NAME_LENGTH,
  MAX_MCP_URL_LENGTH,
  MAX_SKILL_NAME_LENGTH,
  MCP_SERVER_TYPES,
  SESSION_AUTONOMY_LEVELS,
  SESSION_INTERACTION_MODES,
  SESSION_REASONING_EFFORTS,
} from '../protocol/bounds';
import {
  type CommandsRefreshMessage,
  type McpRefreshMessage,
  type McpServerAddMessage,
  type McpServerAuthenticateMessage,
  type McpServerRemoveMessage,
  type McpServerToggleMessage,
  type McpServerType,
  type PluginsRefreshMessage,
  type SessionContextRefreshMessage,
  type SessionSettingUpdateMessage,
  type SkillToggleMessage,
  type SkillsRefreshMessage,
} from '../protocol/settings';
import { hasExactKeys, type UnknownRecord } from './strictValidation';
import { isEnumValue, isId, isNonEmptyBoundedString, isSafeModelId } from './guards';

export function parseSessionContextRefresh(
  value: UnknownRecord,
): SessionContextRefreshMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return {
    type: 'session.context.refresh',
    sessionId: value.sessionId,
  };
}

export function parseSkillsRefresh(
  value: UnknownRecord,
): SkillsRefreshMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return { type: 'skills.refresh', sessionId: value.sessionId };
}

export function parsePluginsRefresh(
  value: UnknownRecord,
): PluginsRefreshMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return { type: 'plugins.refresh', sessionId: value.sessionId };
}

export function parseSkillToggle(value: UnknownRecord): SkillToggleMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'name', 'disabled']) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.name, MAX_SKILL_NAME_LENGTH) ||
    typeof value.disabled !== 'boolean'
  ) {
    return undefined;
  }

  return {
    type: 'skill.toggle',
    sessionId: value.sessionId,
    name: value.name,
    disabled: value.disabled,
  };
}

export function parseCommandsRefresh(
  value: UnknownRecord,
): CommandsRefreshMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return { type: 'commands.refresh', sessionId: value.sessionId };
}

export function parseMcpRefresh(value: UnknownRecord): McpRefreshMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return { type: 'mcp.refresh', sessionId: value.sessionId };
}

export function parseMcpServerToggle(
  value: UnknownRecord,
): McpServerToggleMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'name', 'enabled']) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.name, MAX_MCP_NAME_LENGTH) ||
    typeof value.enabled !== 'boolean'
  ) {
    return undefined;
  }

  return {
    type: 'mcp.server.toggle',
    sessionId: value.sessionId,
    name: value.name,
    enabled: value.enabled,
  };
}

export function parseMcpServerAdd(value: UnknownRecord): McpServerAddMessage | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sessionId', 'name', 'serverType'],
      ['command', 'args', 'url'],
    ) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.name, MAX_MCP_NAME_LENGTH) ||
    !MCP_SERVER_TYPES.includes(value.serverType as McpServerType)
  ) {
    return undefined;
  }
  const serverType = value.serverType as McpServerType;

  if (serverType === 'stdio') {
    if (
      value.url !== undefined ||
      !isNonEmptyBoundedString(value.command, MAX_MCP_COMMAND_LENGTH)
    ) {
      return undefined;
    }
    let args: readonly string[] | undefined;
    if (value.args !== undefined) {
      if (
        !Array.isArray(value.args) ||
        value.args.length > MAX_MCP_ARGS ||
        !value.args.every((arg) => isNonEmptyBoundedString(arg, MAX_MCP_ARG_LENGTH))
      ) {
        return undefined;
      }
      args = value.args as readonly string[];
    }
    return {
      type: 'mcp.server.add',
      sessionId: value.sessionId,
      name: value.name,
      serverType,
      command: value.command,
      ...(args === undefined ? {} : { args }),
    };
  }

  if (
    value.command !== undefined ||
    value.args !== undefined ||
    !isNonEmptyBoundedString(value.url, MAX_MCP_URL_LENGTH) ||
    !/^https?:\/\//.test(value.url)
  ) {
    return undefined;
  }
  return {
    type: 'mcp.server.add',
    sessionId: value.sessionId,
    name: value.name,
    serverType,
    url: value.url,
  };
}

export function parseMcpServerRemove(
  value: UnknownRecord,
): McpServerRemoveMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'name']) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.name, MAX_MCP_NAME_LENGTH)
  ) {
    return undefined;
  }

  return {
    type: 'mcp.server.remove',
    sessionId: value.sessionId,
    name: value.name,
  };
}

export function parseMcpServerAuthenticate(
  value: UnknownRecord,
): McpServerAuthenticateMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'name']) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.name, MAX_MCP_NAME_LENGTH)
  ) {
    return undefined;
  }

  return {
    type: 'mcp.server.authenticate',
    sessionId: value.sessionId,
    name: value.name,
  };
}

export function parseSessionSettingUpdate(
  value: UnknownRecord,
): SessionSettingUpdateMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'field', 'value']) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }

  switch (value.field) {
    case 'interactionMode':
      return isEnumValue(value.value, SESSION_INTERACTION_MODES)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'interactionMode',
            value: value.value,
          }
        : undefined;
    case 'modelId':
      return isSafeModelId(value.value)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'modelId',
            value: value.value,
          }
        : undefined;
    case 'reasoningEffort':
      return isEnumValue(value.value, SESSION_REASONING_EFFORTS)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'reasoningEffort',
            value: value.value,
          }
        : undefined;
    case 'autonomyLevel':
      return isEnumValue(value.value, SESSION_AUTONOMY_LEVELS)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'autonomyLevel',
            value: value.value,
          }
        : undefined;
    case 'specModeModelId':
      return value.value === null || isSafeModelId(value.value)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'specModeModelId',
            value: value.value,
          }
        : undefined;
    case 'specModeReasoningEffort':
      return value.value === null || isEnumValue(value.value, SESSION_REASONING_EFFORTS)
        ? {
            type: 'session.setting.update',
            sessionId: value.sessionId,
            field: 'specModeReasoningEffort',
            value: value.value,
          }
        : undefined;
    default:
      return undefined;
  }
}
