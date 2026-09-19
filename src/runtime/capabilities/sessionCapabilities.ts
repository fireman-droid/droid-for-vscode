import {
  MAX_RUNTIME_MCP_AUTH_URL_LENGTH,
  MAX_RUNTIME_MCP_SERVERS,
  MAX_RUNTIME_MCP_TOOLS_PER_SERVER,
  MAX_RUNTIME_SKILL_ITEMS,
  type RuntimeMcpAuthOutcome,
  type RuntimeMcpAuthStart,
  type RuntimeMcpServer,
  type RuntimeMcpServerAddParams,
  type RuntimeMcpTool,
  type RuntimeSkill,
} from '../DroidRuntime';
import type { FactoryDroidSession } from '../session/sessionTypes';
import { projectMcpServer, projectMcpTool, projectSkill } from './projections';

/** How long to wait for the OAuth URL notification after an accepted
 * MCP authentication request. */
export const MCP_AUTH_URL_WAIT_MS = 15_000;

/** How long the one-shot MCP auth completion subscription stays alive
 * before it is dropped without an outcome. */
export const MCP_AUTH_COMPLETION_SUBSCRIPTION_MS = 10 * 60_000;

/**
 * Self-imposed cap on one MCP server toggle. Droid writes the config
 * immediately but only replies after its internal connect attempt
 * gives up, which rides the SDK's generic 30s request timeout; a
 * failing server otherwise leaves the panel waiting 30-60s.
 */
export const MCP_TOGGLE_TIMEOUT_MS = 12_000;

export async function listSkills(
  session: FactoryDroidSession,
): Promise<readonly RuntimeSkill[]> {
  if (typeof session.listSkills !== 'function') {
    throw new Error('The Droid session does not support skills.');
  }
  const result = await session.listSkills();
  if (!Array.isArray(result.skills)) {
    throw new Error('Droid returned an invalid skill list.');
  }
  const skills: RuntimeSkill[] = [];
  for (const raw of result.skills.slice(0, MAX_RUNTIME_SKILL_ITEMS)) {
    const skill = projectSkill(raw);
    if (skill !== null) {
      skills.push(skill);
    }
  }
  return skills;
}

export async function setSkillDisabled(
  session: FactoryDroidSession,
  name: string,
  disabled: boolean,
): Promise<void> {
  if (typeof session.setSkillDisabled !== 'function') {
    throw new Error('The Droid session does not support skills.');
  }
  const result = await session.setSkillDisabled({
    skillName: name,
    disabled,
  });
  if (result.success !== true) {
    throw new Error('Droid refused to update the skill.');
  }
}

export async function listMcpServers(
  session: FactoryDroidSession,
): Promise<readonly RuntimeMcpServer[]> {
  if (
    typeof session.listMcpServers !== 'function' ||
    typeof session.listMcpTools !== 'function'
  ) {
    throw new Error('The Droid session does not support MCP.');
  }
  const [serversResult, toolsResult] = await Promise.all([
    session.listMcpServers(),
    session.listMcpTools(),
  ]);
  if (!Array.isArray(serversResult.servers) || !Array.isArray(toolsResult)) {
    throw new Error('Droid returned an invalid MCP catalog.');
  }

  const toolsByServer = new Map<string, RuntimeMcpTool[]>();
  const seenToolNames = new Map<string, Set<string>>();
  for (const raw of toolsResult) {
    const projected = projectMcpTool(raw);
    if (projected === null) {
      continue;
    }
    const seen = seenToolNames.get(projected.serverName) ?? new Set<string>();
    if (seen.has(projected.tool.name)) {
      continue;
    }
    seen.add(projected.tool.name);
    seenToolNames.set(projected.serverName, seen);
    const bucket = toolsByServer.get(projected.serverName) ?? [];
    if (bucket.length < MAX_RUNTIME_MCP_TOOLS_PER_SERVER) {
      bucket.push(projected.tool);
      toolsByServer.set(projected.serverName, bucket);
    }
  }

  const servers: RuntimeMcpServer[] = [];
  const seenServerNames = new Set<string>();
  for (const raw of serversResult.servers.slice(0, MAX_RUNTIME_MCP_SERVERS)) {
    const server = projectMcpServer(raw, toolsByServer);
    if (server !== null && !seenServerNames.has(server.name)) {
      seenServerNames.add(server.name);
      servers.push(server);
    }
  }
  return servers;
}

export async function setMcpServerEnabled(
  session: FactoryDroidSession,
  name: string,
  enabled: boolean,
): Promise<void> {
  if (typeof session.toggleMcpServer !== 'function') {
    throw new Error('The Droid session does not support MCP.');
  }
  // The config write lands before Droid's connect attempt resolves,
  // so a timeout here must be followed by a fresh list: the server's
  // own status badge (connecting/failed) is the reliable signal.
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `The MCP server did not finish ${
            enabled ? 'starting' : 'stopping'
          } within ${Math.round(MCP_TOGGLE_TIMEOUT_MS / 1000)}s.`,
        ),
      );
    }, MCP_TOGGLE_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([
      session.toggleMcpServer({
        serverName: name,
        enabled,
        settingsLevel: 'user',
      }),
      timeout,
    ]);
    if (result.success !== true) {
      throw new Error('Droid refused to update the MCP server.');
    }
  } finally {
    if (timer !== null) {
      clearTimeout(timer);
    }
  }
}

export async function addMcpServer(
  session: FactoryDroidSession,
  params: RuntimeMcpServerAddParams,
): Promise<void> {
  if (typeof session.addMcpServer !== 'function') {
    throw new Error('The Droid session does not support adding MCP servers.');
  }
  const request: Parameters<NonNullable<FactoryDroidSession['addMcpServer']>>[0] = {
    name: params.name,
    type: params.serverType,
  };
  if (params.serverType === 'stdio') {
    request.command = params.command;
    if (params.args !== undefined && params.args.length > 0) {
      request.args = [...params.args];
    }
  } else {
    request.url = params.url;
  }
  const result = await session.addMcpServer(request);
  if (result.success !== true) {
    throw new Error('Droid refused to add the MCP server.');
  }
}

export async function removeMcpServer(
  session: FactoryDroidSession,
  name: string,
): Promise<void> {
  if (typeof session.removeMcpServer !== 'function') {
    throw new Error('The Droid session does not support removing MCP servers.');
  }
  const result = await session.removeMcpServer({
    serverName: name,
    settingsLevel: 'user',
  });
  if (result.success !== true) {
    throw new Error('Droid refused to remove the MCP server.');
  }
}

export async function authenticateMcpServer(
  session: FactoryDroidSession,
  name: string,
  onCompleted: (outcome: RuntimeMcpAuthOutcome) => void,
): Promise<RuntimeMcpAuthStart> {
  if (
    typeof session.authenticateMcpServer !== 'function' ||
    typeof session.onNotification !== 'function'
  ) {
    throw new Error('The Droid session does not support MCP authentication.');
  }

  let authUrl: string | null = null;
  let resolveUrl: (() => void) | null = null;
  const urlArrived = new Promise<void>((resolve) => {
    resolveUrl = resolve;
  });
  const unsubscribeRequired = session.onNotification(
    (notification) => {
      if (notification['serverName'] !== name) {
        return;
      }
      const url = notification['authUrl'];
      if (
        typeof url === 'string' &&
        url.length > 0 &&
        url.length <= MAX_RUNTIME_MCP_AUTH_URL_LENGTH &&
        /^https?:\/\//.test(url)
      ) {
        authUrl = url;
      }
      resolveUrl?.();
    },
    { type: 'mcp_auth_required' },
  );

  let completionDone = false;
  let completionTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribeCompleted = () => {};
  const finishCompletion = () => {
    if (completionDone) {
      return;
    }
    completionDone = true;
    if (completionTimer !== null) {
      clearTimeout(completionTimer);
      completionTimer = null;
    }
    unsubscribeCompleted();
  };
  unsubscribeCompleted = session.onNotification(
    (notification) => {
      if (notification['serverName'] !== name || completionDone) {
        return;
      }
      const outcome = notification['outcome'];
      if (outcome === 'success' || outcome === 'cancelled' || outcome === 'failed') {
        finishCompletion();
        onCompleted(outcome);
      }
    },
    { type: 'mcp_auth_completed' },
  );
  // Stop listening eventually so an abandoned browser flow does not
  // leave a subscription behind for the session's whole lifetime.
  completionTimer = setTimeout(finishCompletion, MCP_AUTH_COMPLETION_SUBSCRIPTION_MS);

  try {
    const result = await session.authenticateMcpServer({
      serverName: name,
    });
    if (result.success !== true) {
      throw new Error('Droid refused to start MCP authentication.');
    }
    // The OAuth URL arrives as a separate notification shortly after
    // the request is accepted; wait briefly for it.
    await Promise.race([
      urlArrived,
      new Promise<void>((resolve) => {
        setTimeout(resolve, MCP_AUTH_URL_WAIT_MS);
      }),
    ]);
    return { authUrl };
  } catch (error) {
    finishCompletion();
    throw error;
  } finally {
    unsubscribeRequired();
  }
}
