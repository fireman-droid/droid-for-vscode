// mcp: moved verbatim from ChatController.ts (structure-only
// refactor; bodies unchanged except mechanical this. -> ctl.).
import type {
  McpAuthPhase,
  McpServerAddMessage,
  McpServerSummary,
  SessionMcpState,
} from '../../shared/bridgeMessages';
import type {
  DroidRuntime,
  RuntimeMcpServer,
} from '../../runtime/DroidRuntime';
import {
  formatUnknownError,
  type ChatControllerInternals,
} from './internals';
import type { CapturedSessionIdentity } from './operationEligibility';

export const MCP_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not expose MCP servers.';

export const MCP_LOAD_FAILED_MESSAGE =
  'Droid did not return the MCP catalog. Retry from the MCP panel.';

export const MCP_TOGGLE_FAILED_MESSAGE =
  'Droid could not update that MCP server. The list may be stale; refresh it.';

export const MCP_ADD_FAILED_MESSAGE =
  'Droid could not add that MCP server. Check the command or URL and retry.';

export const MCP_REMOVE_FAILED_MESSAGE =
  'Droid could not remove that MCP server. The list may be stale; refresh it.';

export const MCP_AUTH_UNSUPPORTED_MESSAGE =
  'This Droid runtime does not support MCP authentication.';

export const MCP_AUTH_START_FAILED_MESSAGE =
  'Droid could not start authentication for that MCP server.';

export const MCP_AUTH_BROWSER_MESSAGE =
  'Complete the sign-in in your browser.';

export const MCP_AUTH_NO_URL_MESSAGE =
  'Droid did not start a browser sign-in. The server may already be authenticated; refresh the MCP list to check.';

export const MCP_AUTH_BROWSER_FAILED_MESSAGE =
  'The sign-in page could not be opened in a browser.';

export const MCP_AUTH_TIMEOUT_MESSAGE =
  'Stopped waiting for browser authentication. Refresh the MCP list to check the result.';

export /**
 * How long the host waits for an MCP auth outcome before giving up.
 * Kept short: a browser OAuth round-trip either completes within a
 * couple of minutes or the user has abandoned it, and the previous
 * 10-minute wait outlived every real session.
 */
const MCP_AUTH_WAIT_TIMEOUT_MS = 2 * 60_000;

export const MCP_REQUEST_DROPPED_MESSAGE =
  'Droid could not accept that MCP change right now. Retry in a moment.';

export /**
 * Ceiling for one MCP catalog read or mutation round-trip. Adding a
 * stdio server spawns its command and waits for the MCP handshake,
 * so a spawnable-but-wrong command (`node` with no script) otherwise
 * hangs the daemon RPC forever and pins the panel in 'loading' with
 * every control disabled. Fail closed to an error state instead.
 */
const MCP_OPERATION_TIMEOUT_MS = 30_000;

export function handleMcpRefresh(
  ctl: ChatControllerInternals,
  sessionId: string): void {
    const runtime = ctl.runtime;
    const dropReason = ctl.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      ctl.recordDroppedPanelRequest(
        'mcp.refresh',
        dropReason ?? 'no-runtime',
      );
      return;
    }
    loadMcp(ctl,
      runtime,
      ctl.runtimeGeneration,
      sessionId,
      ctl.activeRuntimeCwd!,
    );
}

/**
 * Loads activation metadata only for the session identity captured by
 * `loadSessionMetadata`. User requests take the normal panel path.
 */
export function pushActivationMcp(
  ctl: ChatControllerInternals,
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
  loadMcp(
    ctl,
    identity.runtime,
    identity.generation,
    identity.sessionId,
    identity.cwd,
  );
}

function loadMcp(
  ctl: ChatControllerInternals,
  runtime: DroidRuntime,
  generation: number,
  sessionId: string,
  cwd: string,
  ): void {
    if (typeof runtime.listMcpServers !== 'function') {
      emitMcp(ctl, sessionId, {
        status: 'unsupported',
        items: [],
        message: MCP_UNSUPPORTED_MESSAGE,
      });
      return;
    }

    emitMcp(ctl, sessionId, { status: 'loading', items: [] });
    void withMcpTimeout(runtime.listMcpServers()).then(
      (servers) => {
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
        emitMcp(ctl, sessionId, {
          status: 'ready',
          items: servers.map(projectMcpServerSummary),
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
          'mcp-load-failed',
          formatUnknownError(error),
        );
        emitMcp(ctl, sessionId, {
          status: 'error',
          items: [],
          message: MCP_LOAD_FAILED_MESSAGE,
        });
      },
    );
}

export function handleMcpServerToggle(
  ctl: ChatControllerInternals,
    sessionId: string,
    name: string,
    enabled: boolean,
  ): void {
    const runtime = ctl.runtime;
    const dropReason = ctl.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      reportDroppedMcpMutation(ctl, 
        'mcp.server.toggle',
        sessionId,
        dropReason ?? 'no-runtime',
      );
      return;
    }
    if (
      typeof runtime.setMcpServerEnabled !== 'function' ||
      typeof runtime.listMcpServers !== 'function'
    ) {
      emitMcp(ctl, sessionId, {
        status: 'unsupported',
        items: [],
        message: MCP_UNSUPPORTED_MESSAGE,
      });
      return;
    }
    applyMcpMutation(ctl, 
      sessionId,
      runtime,
      'toggle',
      () => runtime.setMcpServerEnabled!(name, enabled),
      MCP_TOGGLE_FAILED_MESSAGE,
    );
}

export function handleMcpServerAdd(
  ctl: ChatControllerInternals,
    sessionId: string,
    params: Omit<McpServerAddMessage, 'type' | 'sessionId'>,
  ): void {
    const runtime = ctl.runtime;
    const dropReason = ctl.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      reportDroppedMcpMutation(ctl, 
        'mcp.server.add',
        sessionId,
        dropReason ?? 'no-runtime',
      );
      return;
    }
    if (
      typeof runtime.addMcpServer !== 'function' ||
      typeof runtime.listMcpServers !== 'function'
    ) {
      emitMcp(ctl, sessionId, {
        status: 'unsupported',
        items: [],
        message: MCP_UNSUPPORTED_MESSAGE,
      });
      return;
    }
    applyMcpMutation(ctl, 
      sessionId,
      runtime,
      'add',
      () => runtime.addMcpServer!(params),
      MCP_ADD_FAILED_MESSAGE,
    );
}

export function handleMcpServerRemove(
  ctl: ChatControllerInternals,
  sessionId: string, name: string): void {
    const runtime = ctl.runtime;
    const dropReason = ctl.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      reportDroppedMcpMutation(ctl, 
        'mcp.server.remove',
        sessionId,
        dropReason ?? 'no-runtime',
      );
      return;
    }
    if (
      typeof runtime.removeMcpServer !== 'function' ||
      typeof runtime.listMcpServers !== 'function'
    ) {
      emitMcp(ctl, sessionId, {
        status: 'unsupported',
        items: [],
        message: MCP_UNSUPPORTED_MESSAGE,
      });
      return;
    }
    applyMcpMutation(ctl, 
      sessionId,
      runtime,
      'remove',
      () => runtime.removeMcpServer!(name),
      MCP_REMOVE_FAILED_MESSAGE,
    );
}

/**
 * Logs a dropped MCP mutation and, when the request came from the
 * panel the user is looking at, surfaces a visible retry hint. A
 * dropped Add/Remove/Toggle must never look like a success.
 */
export function reportDroppedMcpMutation(
  ctl: ChatControllerInternals,
    op: string,
    sessionId: string,
    reason: string,
  ): void {
    ctl.recordDroppedPanelRequest(op, reason);
    if (reason !== 'session-mismatch' && sessionId === ctl.sessionId) {
      emitMcp(ctl, sessionId, {
        status: 'error',
        items: [],
        message: MCP_REQUEST_DROPPED_MESSAGE,
      });
    }
}

/**
 * Runs one MCP catalog mutation, then re-reads and broadcasts the
 * catalog. The caller must have verified `listMcpServers` support.
 * Failures still re-read the catalog: the mutation may have half
 * landed (Droid writes config before connecting), so the fresh
 * status badges are the trustworthy signal and the error message
 * rides along instead of blanking the list.
 */
export function applyMcpMutation(
  ctl: ChatControllerInternals,
    sessionId: string,
    runtime: DroidRuntime,
    op: string,
    mutation: () => Promise<void>,
    failureMessage: string,
  ): void {
    emitMcp(ctl, sessionId, { status: 'loading', items: [] });
    const generation = ctl.runtimeGeneration;
    const cwd = ctl.activeRuntimeCwd!;
    void withMcpTimeout(mutation()).then(
      () =>
        finishMcpMutation(ctl, 
          sessionId,
          runtime,
          generation,
          cwd,
          null,
        ),
      (error) => {
        ctl.recordPanelFailure(
          `mcp-${op}-failed`,
          formatUnknownError(error),
        );
        return finishMcpMutation(ctl, 
          sessionId,
          runtime,
          generation,
          cwd,
          failureMessage,
        );
      },
    );
}

/** Re-reads the MCP catalog after a mutation attempt and broadcasts
 * it, attaching `failureMessage` when the mutation failed. */
export async function finishMcpMutation(
  ctl: ChatControllerInternals,
    sessionId: string,
    runtime: DroidRuntime,
    generation: number,
    cwd: string,
    failureMessage: string | null,
  ): Promise<void> {
    let items: McpServerSummary[] | null = null;
    try {
      items = (await withMcpTimeout(runtime.listMcpServers!())).map(
        projectMcpServerSummary,
      );
    } catch (error) {
      ctl.recordPanelFailure(
        'mcp-load-failed',
        formatUnknownError(error),
      );
    }
    if (
      !ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)
    ) {
      return;
    }
    if (items === null) {
      // The webview store keeps the previous list on error states, so
      // an empty error payload degrades to "old list + message".
      emitMcp(ctl, sessionId, {
        status: 'error',
        items: [],
        message: failureMessage ?? MCP_LOAD_FAILED_MESSAGE,
      });
      return;
    }
    emitMcp(ctl, 
      sessionId,
      failureMessage === null
        ? { status: 'ready', items }
        : { status: 'error', items, message: failureMessage },
    );
}

export function handleMcpServerAuthenticate(
  ctl: ChatControllerInternals,
    sessionId: string,
    name: string,
  ): void {
    const runtime = ctl.runtime;
    const dropReason =
      ctl.mcpAuthServerName !== null
        ? 'auth-in-flight'
        : ctl.sessionRequestDropReason(sessionId);
    if (dropReason !== null || runtime === null) {
      ctl.recordDroppedPanelRequest(
        'mcp.server.authenticate',
        dropReason ?? 'no-runtime',
      );
      return;
    }
    if (typeof runtime.authenticateMcpServer !== 'function') {
      ctl.recordPanelFailure(
        'mcp-auth-unsupported',
        MCP_AUTH_UNSUPPORTED_MESSAGE,
      );
      emitMcpAuth(ctl, 
        sessionId,
        name,
        'error',
        MCP_AUTH_UNSUPPORTED_MESSAGE,
      );
      return;
    }

    ctl.mcpAuthServerName = name;
    ctl.recordHost({
      level: 'info',
      name: 'host.mcp.auth',
      attributes: { phase: 'started', serverName: name },
    });
    emitMcpAuth(ctl, sessionId, name, 'started', null);
    const generation = ctl.runtimeGeneration;
    const cwd = ctl.activeRuntimeCwd!;
    const isCurrentFlow = () =>
      ctl.mcpAuthServerName === name &&
      ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd);
    const finishFlow = () => {
      if (ctl.mcpAuthTimer !== null) {
        clearTimeout(ctl.mcpAuthTimer);
        ctl.mcpAuthTimer = null;
      }
      ctl.mcpAuthServerName = null;
    };
    ctl.mcpAuthTimer = setTimeout(() => {
      if (ctl.mcpAuthServerName !== name) {
        return;
      }
      finishFlow();
      ctl.recordPanelFailure(
        'mcp-auth-timeout',
        `${name}: ${MCP_AUTH_TIMEOUT_MESSAGE}`,
      );
      if (
        ctl.isCurrentSessionOperation(runtime, generation, sessionId, cwd)
      ) {
        emitMcpAuth(ctl, 
          sessionId,
          name,
          'error',
          MCP_AUTH_TIMEOUT_MESSAGE,
        );
      }
    }, MCP_AUTH_WAIT_TIMEOUT_MS);

    void runtime
      .authenticateMcpServer(name, (outcome) => {
        if (ctl.mcpAuthServerName !== name) {
          return;
        }
        const current = ctl.isCurrentSessionOperation(
          runtime,
          generation,
          sessionId,
          cwd,
        );
        finishFlow();
        ctl.recordHost({
          level: outcome === 'success' ? 'info' : 'warn',
          name: 'host.mcp.auth',
          attributes: { phase: outcome, serverName: name },
        });
        if (!current) {
          return;
        }
        emitMcpAuth(ctl, sessionId, name, outcome, null);
        if (outcome === 'success') {
          handleMcpRefresh(ctl, sessionId);
        }
      })
      .then(
        async ({ authUrl }) => {
          if (!isCurrentFlow()) {
            return;
          }
          if (authUrl === null) {
            // Droid accepted the request but never announced an OAuth
            // URL - typical for a server that is already signed in.
            // End the flow now instead of waiting minutes for a
            // completion notification that will not arrive.
            finishFlow();
            ctl.recordPanelFailure(
              'mcp-auth-no-url',
              `${name}: ${MCP_AUTH_NO_URL_MESSAGE}`,
            );
            emitMcpAuth(ctl, 
              sessionId,
              name,
              'error',
              MCP_AUTH_NO_URL_MESSAGE,
            );
            handleMcpRefresh(ctl, sessionId);
            return;
          }
          const opened = await ctl.externalUrl.openExternal(authUrl);
          if (!isCurrentFlow()) {
            return;
          }
          ctl.recordHost({
            level: opened ? 'info' : 'warn',
            name: 'host.mcp.auth',
            attributes: {
              phase: opened ? 'browser-opened' : 'browser-failed',
              serverName: name,
            },
          });
          emitMcpAuth(ctl, 
            sessionId,
            name,
            'browser',
            opened
              ? MCP_AUTH_BROWSER_MESSAGE
              : MCP_AUTH_BROWSER_FAILED_MESSAGE,
          );
        },
        () => {
          if (ctl.mcpAuthServerName !== name) {
            return;
          }
          const current = ctl.isCurrentSessionOperation(
            runtime,
            generation,
            sessionId,
            cwd,
          );
          finishFlow();
          ctl.recordPanelFailure(
            'mcp-auth-start-failed',
            `${name}: ${MCP_AUTH_START_FAILED_MESSAGE}`,
          );
          if (current) {
            emitMcpAuth(ctl, 
              sessionId,
              name,
              'error',
              MCP_AUTH_START_FAILED_MESSAGE,
            );
          }
        },
      );
}

export function emitMcpAuth(
  ctl: ChatControllerInternals,
    sessionId: string,
    serverName: string,
    phase: McpAuthPhase,
    message: string | null,
  ): void {
    ctl.emit({
      type: 'mcp.auth',
      sessionId,
      serverName,
      phase,
      message,
    });
}

export function emitMcp(
  ctl: ChatControllerInternals,
  sessionId: string, mcp: SessionMcpState): void {
    ctl.emit({
      type: 'session.mcp',
      sessionId,
      mcp,
    });
}

export /**
 * Rejects when an MCP daemon round-trip outlives
 * `MCP_OPERATION_TIMEOUT_MS`, so a hung add/remove/toggle/list RPC
 * degrades into the normal failure path (error state + fresh
 * catalog read) instead of freezing the MCP panel in 'loading'.
 *
 * This abandons the operation but cannot cancel it: the DroidRuntime
 * MCP contract exposes no abort channel (the SDK RPCs take no
 * signal), so the orphan keeps occupying its daemon RPC slot until
 * the daemon answers or the connection drops. That is contained on
 * our side: this promise has already settled, making the orphan's
 * eventual resolve/reject a no-op, and every consumer re-checks
 * `isCurrentSessionOperation` (runtime identity + generation +
 * session + cwd) before emitting, so a late completion can never
 * mutate panel state.
 */
function withMcpTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `MCP operation timed out after ${MCP_OPERATION_TIMEOUT_MS}ms`,
        ),
      );
    }, MCP_OPERATION_TIMEOUT_MS);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export function projectMcpServerSummary(
  server: RuntimeMcpServer,
): McpServerSummary {
  return {
    name: server.name,
    status: server.status,
    toolCount: server.toolCount,
    requiresAuth: server.requiresAuth,
    hasAuthTokens: server.hasAuthTokens,
    tools: server.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      enabled: tool.enabled,
      readOnly: tool.readOnly,
    })),
  };
}
