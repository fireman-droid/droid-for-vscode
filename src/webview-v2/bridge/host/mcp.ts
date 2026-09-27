import { type HostToWebviewMessage } from '../../../shared/bridgeMessages';
import {
  MAX_MCP_AUTH_MESSAGE_LENGTH,
  MAX_MCP_NAME_LENGTH,
  MAX_MCP_SERVERS,
  MAX_MCP_TOOLS_PER_SERVER,
  MAX_MCP_TOOL_DESCRIPTION_LENGTH,
} from '../../../shared/protocol/bounds';
import {
  type McpServerSummary,
  type McpToolSummary,
  type SessionMcpState,
} from '../../../shared/protocol/settings';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import {
  MAX_STRING_LENGTH,
  isBoundedString,
  isCount,
  isId,
  isMcpAuthPhase,
  isMcpServerStatus,
  isNonEmptyBoundedString,
  isSequence,
  readStringDataProperty,
} from './guards';

export function parseSessionMcpMessage(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'session.mcp' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'mcp']) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId)
  ) {
    return undefined;
  }
  const mcp = parseSessionMcp(value.mcp);
  return mcp === undefined
    ? undefined
    : {
        type: 'session.mcp',
        sequence: value.sequence,
        sessionId: value.sessionId,
        mcp,
      };
}

export function parseSessionMcp(value: unknown): SessionMcpState | undefined {
  if (!isStrictRecord(value)) {
    return undefined;
  }
  const status = readStringDataProperty(value, 'status');
  if (status === undefined) {
    return undefined;
  }

  if (status === 'unsupported') {
    if (
      !hasExactKeys(value, ['status', 'items', 'message']) ||
      !isExactArray(value.items, 0, 0) ||
      !isBoundedString(value.message, MAX_STRING_LENGTH)
    ) {
      return undefined;
    }
    return {
      status: 'unsupported',
      items: [],
      message: value.message as string,
    };
  }

  if (status !== 'loading' && status !== 'ready' && status !== 'error') {
    return undefined;
  }
  if (
    !hasExactKeys(
      value,
      status === 'error' ? ['status', 'items', 'message'] : ['status', 'items'],
    ) ||
    !isExactArray(value.items, 0, MAX_MCP_SERVERS) ||
    (status === 'error' && !isBoundedString(value.message, MAX_STRING_LENGTH))
  ) {
    return undefined;
  }
  const items: McpServerSummary[] = [];
  const names = new Set<string>();
  for (const itemValue of value.items) {
    const item = parseMcpServerSummary(itemValue);
    if (item === undefined || names.has(item.name)) {
      return undefined;
    }
    names.add(item.name);
    items.push(item);
  }
  return status === 'error'
    ? { status: 'error', items, message: value.message as string }
    : status === 'loading'
      ? { status: 'loading', items }
      : { status: 'ready', items };
}

export function parseMcpServerSummary(value: unknown): McpServerSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, [
      'name',
      'status',
      'toolCount',
      'requiresAuth',
      'hasAuthTokens',
      'tools',
    ]) ||
    !isNonEmptyBoundedString(value.name, MAX_MCP_NAME_LENGTH) ||
    !isMcpServerStatus(value.status) ||
    (value.toolCount !== null && !isCount(value.toolCount)) ||
    typeof value.requiresAuth !== 'boolean' ||
    typeof value.hasAuthTokens !== 'boolean' ||
    !isExactArray(value.tools, 0, MAX_MCP_TOOLS_PER_SERVER)
  ) {
    return undefined;
  }
  const tools: McpToolSummary[] = [];
  const names = new Set<string>();
  for (const toolValue of value.tools) {
    const tool = parseMcpToolSummary(toolValue);
    if (tool === undefined || names.has(tool.name)) {
      return undefined;
    }
    names.add(tool.name);
    tools.push(tool);
  }
  return {
    name: value.name,
    status: value.status,
    toolCount: value.toolCount,
    requiresAuth: value.requiresAuth,
    hasAuthTokens: value.hasAuthTokens,
    tools,
  };
}

export function parseMcpToolSummary(value: unknown): McpToolSummary | undefined {
  if (
    !isStrictRecord(value) ||
    !hasExactKeys(value, ['name', 'description', 'enabled', 'readOnly']) ||
    !isNonEmptyBoundedString(value.name, MAX_MCP_NAME_LENGTH) ||
    (value.description !== null &&
      !isNonEmptyBoundedString(value.description, MAX_MCP_TOOL_DESCRIPTION_LENGTH)) ||
    typeof value.enabled !== 'boolean' ||
    typeof value.readOnly !== 'boolean'
  ) {
    return undefined;
  }
  return {
    name: value.name,
    description: value.description,
    enabled: value.enabled,
    readOnly: value.readOnly,
  };
}

export function parseMcpAuth(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'mcp.auth' }> | undefined {
  if (
    !hasExactKeys(value, [
      'type',
      'sequence',
      'sessionId',
      'serverName',
      'phase',
      'message',
    ]) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isNonEmptyBoundedString(value.serverName, MAX_MCP_NAME_LENGTH) ||
    !isMcpAuthPhase(value.phase) ||
    (value.message !== null &&
      !isNonEmptyBoundedString(value.message, MAX_MCP_AUTH_MESSAGE_LENGTH))
  ) {
    return undefined;
  }
  return {
    type: 'mcp.auth',
    sequence: value.sequence,
    sessionId: value.sessionId,
    serverName: value.serverName,
    phase: value.phase,
    message: value.message,
  };
}
