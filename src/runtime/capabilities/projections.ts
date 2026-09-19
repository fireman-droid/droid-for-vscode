import {
  MAX_RUNTIME_MCP_NAME_LENGTH,
  MAX_RUNTIME_MCP_TOOL_DESCRIPTION_LENGTH,
  MAX_RUNTIME_SKILL_DESCRIPTION_LENGTH,
  MAX_RUNTIME_SKILL_NAME_LENGTH,
  RUNTIME_MCP_SERVER_STATUSES,
  RUNTIME_SKILL_LOCATIONS,
  type RuntimeMcpServer,
  type RuntimeMcpServerStatus,
  type RuntimeMcpTool,
  type RuntimeSkill,
  type RuntimeSkillLocation,
} from '../DroidRuntime';

export function projectSkill(raw: unknown): RuntimeSkill | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const name = record.name;
  const location = record.location;
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > MAX_RUNTIME_SKILL_NAME_LENGTH ||
    !isRuntimeSkillLocation(location)
  ) {
    return null;
  }
  const description =
    typeof record.description === 'string' && record.description.length > 0
      ? record.description.slice(0, MAX_RUNTIME_SKILL_DESCRIPTION_LENGTH)
      : null;
  return {
    name,
    description,
    location,
    enabled: record.enabled !== false,
    userInvocable: record.userInvocable === true,
  };
}

export function isRuntimeSkillLocation(value: unknown): value is RuntimeSkillLocation {
  return (
    typeof value === 'string' &&
    (RUNTIME_SKILL_LOCATIONS as readonly string[]).includes(value)
  );
}

/**
 * Projects an SDK MCP server record to safe display fields, dropping
 * connection errors, auth URLs, and configuration sources.
 */
export function projectMcpServer(
  raw: unknown,
  toolsByServer: ReadonlyMap<string, readonly RuntimeMcpTool[]>,
): RuntimeMcpServer | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const name = record.name;
  const status = record.status;
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > MAX_RUNTIME_MCP_NAME_LENGTH ||
    !isRuntimeMcpServerStatus(status)
  ) {
    return null;
  }
  const toolCount =
    Number.isSafeInteger(record.toolCount) && (record.toolCount as number) >= 0
      ? (record.toolCount as number)
      : null;
  return {
    name,
    status,
    toolCount,
    requiresAuth: record.requiresAuth === true,
    hasAuthTokens: record.hasAuthTokens === true,
    tools: toolsByServer.get(name) ?? [],
  };
}

export function projectMcpTool(
  raw: unknown,
): { serverName: string; tool: RuntimeMcpTool } | null {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const serverName = record.serverName;
  const name = record.name;
  if (
    typeof serverName !== 'string' ||
    serverName.length === 0 ||
    serverName.length > MAX_RUNTIME_MCP_NAME_LENGTH ||
    typeof name !== 'string' ||
    name.length === 0 ||
    name.length > MAX_RUNTIME_MCP_NAME_LENGTH
  ) {
    return null;
  }
  const description =
    typeof record.description === 'string' && record.description.length > 0
      ? record.description.slice(0, MAX_RUNTIME_MCP_TOOL_DESCRIPTION_LENGTH)
      : null;
  return {
    serverName,
    tool: {
      name,
      description,
      enabled: record.isEnabled !== false,
      readOnly: record.isReadOnly === true,
    },
  };
}

export function isRuntimeMcpServerStatus(
  value: unknown,
): value is RuntimeMcpServerStatus {
  return (
    typeof value === 'string' &&
    (RUNTIME_MCP_SERVER_STATUSES as readonly string[]).includes(value)
  );
}
