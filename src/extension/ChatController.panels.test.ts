import { describe, expect, it, vi } from 'vitest';

import {
  available,
  catalogEntry,
  commandsMessages,
  createCatalog,
  createController,
  createMockRuntime,
  DaemonAvailabilityError,
  type DaemonPluginCatalog,
  mcpAuthMessages,
  mcpMessages,
  pluginsMessages,
  ready,
  retry,
  type RuntimeDiagnosticSink,
  send,
  skillsMessages,
  turnStates,
  waitForConnected,
} from './controllerTestHarness';
import { pushActivationSkills } from './chat/capabilityPanels';
import { pushActivationMcp } from './chat/mcp';

describe('ChatController', () => {
  it('orders user panel eligibility reasons once for representative handlers', async () => {
    const workspace = {
      cwd: 'C:\\workspace',
      trusted: true,
    };
    const runtime = createMockRuntime();
    const { controller, messages } = createController(
      () => runtime,
      workspace,
    );
    ready(controller);
    await waitForConnected(messages);

    expect(
      controller.sessionRequestDropReason('session-other'),
    ).toBe('session-mismatch');

    controller.runtime = null;
    expect(
      controller.sessionRequestDropReason('session-1'),
    ).toBe('no-runtime');

    controller.runtime = runtime;
    controller.connection = { status: 'unavailable', message: 'offline' };
    controller.sessionOperationInProgress = true;
    expect(
      controller.sessionRequestDropReason('session-1'),
    ).toBe('not-connected');

    controller.connection = { status: 'connected' };
    expect(
      controller.sessionRequestDropReason('session-1'),
    ).toBe('operation-in-progress');

    controller.sessionOperationInProgress = false;
    workspace.cwd = 'C:\\other-workspace';
    expect(
      controller.sessionRequestDropReason('session-1'),
    ).toBe('workspace-changed');
  });

  it('lists skills on request and re-lists after a toggle', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      // First read is consumed by the activation-time catalog push,
      // the second by the explicit refresh, the third by the toggle
      // re-list.
      listSkills: vi
        .fn()
        .mockResolvedValueOnce([
          {
            name: 'code-review',
            description: 'Reviews code changes.',
            location: 'project',
            enabled: true,
            userInvocable: true,
          },
        ])
        .mockResolvedValueOnce([
          {
            name: 'code-review',
            description: 'Reviews code changes.',
            location: 'project',
            enabled: true,
            userInvocable: true,
          },
        ])
        .mockResolvedValueOnce([
          {
            name: 'code-review',
            description: 'Reviews code changes.',
            location: 'project',
            enabled: false,
            userInvocable: true,
          },
        ]),
      setSkillDisabled: vi.fn(async () => {}),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'skills.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(skillsMessages(messages).at(-1)?.skills).toMatchObject({
        status: 'ready',
        items: [{ name: 'code-review', enabled: true }],
      });
    });
    expect(skillsMessages(messages)[0]?.skills.status).toBe('loading');

    controller.handleMessage({
      type: 'skill.toggle',
      sessionId: 'session-1',
      name: 'code-review',
      disabled: true,
    });
    expect(runtime.setSkillDisabled).toHaveBeenCalledWith(
      'code-review',
      true,
    );
    await vi.waitFor(() => {
      expect(skillsMessages(messages).at(-1)?.skills).toMatchObject({
        status: 'ready',
        items: [{ name: 'code-review', enabled: false }],
      });
    });

    // Wrong session id is ignored entirely.
    const before = skillsMessages(messages).length;
    controller.handleMessage({
      type: 'skills.refresh',
      sessionId: 'session-other',
    });
    expect(skillsMessages(messages)).toHaveLength(before);
  });

  it('reports unsupported and failed skill operations safely', async () => {
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'skills.refresh',
      sessionId: 'session-1',
    });
    expect(
      skillsMessages(unsupported.messages).at(-1)?.skills,
    ).toMatchObject({ status: 'unsupported' });

    const failing = Object.assign(createMockRuntime(), {
      listSkills: vi.fn(async () => {
        throw new Error('private skill failure');
      }),
      setSkillDisabled: vi.fn(async () => {}),
    });
    const { controller, messages } = createController(() => failing);
    ready(controller);
    await waitForConnected(messages);
    controller.handleMessage({
      type: 'skills.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(skillsMessages(messages).at(-1)?.skills).toMatchObject({
        status: 'error',
      });
    });
    expect(JSON.stringify(messages)).not.toContain(
      'private skill failure',
    );
  });

  it('lists installed plugins with the marketplace count via the daemon sidecar', async () => {
    const snapshot = vi.fn(async () => ({
      plugins: [
        {
          id: 'core@factory-plugins',
          scope: 'user',
          version: 'e3ff29f752fb',
          active: true,
        },
        // Unknown scope and duplicate id must be dropped at projection.
        { id: 'rogue@m', scope: 'global', version: '1', active: true },
        {
          id: 'core@factory-plugins',
          scope: 'project',
          version: '2',
          active: false,
        },
      ],
      marketplaceCount: 2,
    }));
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => ({ snapshot }) as unknown as DaemonPluginCatalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'plugins.refresh',
      sessionId: 'session-1',
    });
    expect(pluginsMessages(messages)[0]?.plugins).toMatchObject({
      status: 'loading',
      items: [],
    });
    await vi.waitFor(() => {
      expect(pluginsMessages(messages).at(-1)?.plugins).toMatchObject({
        status: 'ready',
        items: [
          {
            id: 'core@factory-plugins',
            scope: 'user',
            version: 'e3ff29f752fb',
            active: true,
          },
        ],
        marketplaceCount: 2,
      });
    });
    expect(snapshot).toHaveBeenCalledWith('session-1');

    // Wrong session id is dropped entirely.
    const before = pluginsMessages(messages).length;
    controller.handleMessage({
      type: 'plugins.refresh',
      sessionId: 'session-other',
    });
    expect(pluginsMessages(messages)).toHaveLength(before);
  });

  it('reports plugins unsupported without a daemon sidecar', async () => {
    const { controller, messages } = createController(
      () => createMockRuntime(),
    );
    ready(controller);
    await waitForConnected(messages);
    controller.handleMessage({
      type: 'plugins.refresh',
      sessionId: 'session-1',
    });
    expect(pluginsMessages(messages).at(-1)?.plugins).toMatchObject({
      status: 'unsupported',
      items: [],
      message: 'Plugins are not available in this Droid runtime.',
    });
  });

  it('maps plugin daemon failures to fixed messages without leaking details', async () => {
    const failures: readonly (readonly [unknown, string])[] = [
      [
        new DaemonAvailabilityError(
          'not-logged-in',
          'C:\\Users\\person\\.factory\\auth-detail-must-not-leak',
        ),
        'Sign in with the droid CLI to view plugins.',
      ],
      [
        new DaemonAvailabilityError(
          'refresh-failed',
          'refresh token auth-detail-must-not-leak',
        ),
        'The Droid CLI sign-in could not authenticate the local daemon. Sign in again, then retry.',
      ],
      [
        new DaemonAvailabilityError(
          'credentials-unreadable',
          'keyring auth-detail-must-not-leak',
        ),
        'DroidVisX could not read the current Droid CLI sign-in.',
      ],
      [
        new DaemonAvailabilityError(
          'connect-failed',
          'pipe path auth-detail-must-not-leak',
        ),
        'The local droid daemon is unavailable.',
      ],
      [
        new Error('private rpc auth-detail-must-not-leak'),
        'Droid did not return the plugin list. Retry from the plugins panel.',
      ],
    ];
    for (const [error, expected] of failures) {
      const { controller, messages } = createController(
        () => createMockRuntime(),
        undefined,
        createCatalog([]),
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        async () => {
          throw error;
        },
      );
      ready(controller);
      await waitForConnected(messages);
      controller.handleMessage({
        type: 'plugins.refresh',
        sessionId: 'session-1',
      });
      await vi.waitFor(() => {
        expect(pluginsMessages(messages).at(-1)?.plugins).toMatchObject({
          status: 'error',
          items: [],
          message: expected,
        });
      });
      expect(JSON.stringify(messages)).not.toContain(
        'auth-detail-must-not-leak',
      );
    }
  });

  it('lists custom commands on request and records recents on send', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      listCommands: vi.fn(async () => [
        {
          name: 'deploy',
          description: 'Deploys the branch.',
          argumentHint: '<env>',
          isExecutable: false,
        },
        {
          name: 'triage',
          description: null,
          argumentHint: null,
          isExecutable: true,
        },
      ]),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'commands.refresh',
      sessionId: 'session-1',
    });
    expect(commandsMessages(messages)[0]?.commands).toMatchObject({
      status: 'loading',
      items: [],
      recent: [],
    });
    await vi.waitFor(() => {
      expect(commandsMessages(messages).at(-1)?.commands).toMatchObject({
        status: 'ready',
        items: [{ name: 'deploy' }, { name: 'triage' }],
        recent: [],
      });
    });

    // Sending a cached command (case-insensitively) records the
    // canonical name and re-broadcasts the catalog.
    send(controller, 'session-1', 'turn-1', '/Deploy prod');
    const afterSend = commandsMessages(messages).at(-1)?.commands;
    expect(afterSend).toMatchObject({
      status: 'ready',
      recent: ['deploy'],
    });
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });

    // Unknown commands and plain text do not touch the recent list.
    const count = commandsMessages(messages).length;
    send(controller, 'session-1', 'turn-2', '/nope now');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    send(controller, 'session-1', 'turn-3', 'plain text');
    expect(commandsMessages(messages)).toHaveLength(count);

    // Wrong session id is ignored entirely.
    controller.handleMessage({
      type: 'commands.refresh',
      sessionId: 'session-other',
    });
    expect(commandsMessages(messages)).toHaveLength(count);
    expect(runtime.listCommands).toHaveBeenCalledTimes(1);
  });

  it('reports unsupported and failed command loads safely', async () => {
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'commands.refresh',
      sessionId: 'session-1',
    });
    expect(
      commandsMessages(unsupported.messages).at(-1)?.commands,
    ).toMatchObject({ status: 'unsupported' });

    const failing = Object.assign(createMockRuntime(), {
      listCommands: vi.fn(async () => {
        throw new Error('private command failure');
      }),
    });
    const { controller, messages } = createController(() => failing);
    ready(controller);
    await waitForConnected(messages);
    controller.handleMessage({
      type: 'commands.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(commandsMessages(messages).at(-1)?.commands).toMatchObject({
        status: 'error',
        items: [],
      });
    });
    expect(JSON.stringify(messages)).not.toContain(
      'private command failure',
    );
  });

  it('lists MCP servers on request and re-lists after a toggle', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      // First read is consumed by the activation-time catalog push,
      // the second by the explicit refresh, the third by the toggle
      // re-list.
      listMcpServers: vi
        .fn()
        .mockResolvedValueOnce([
          {
            name: 'linear',
            status: 'connected',
            toolCount: 1,
            requiresAuth: false,
            tools: [
              {
                name: 'list-issues',
                description: 'Lists issues.',
                enabled: true,
                readOnly: true,
              },
            ],
          },
        ])
        .mockResolvedValueOnce([
          {
            name: 'linear',
            status: 'connected',
            toolCount: 1,
            requiresAuth: false,
            tools: [
              {
                name: 'list-issues',
                description: 'Lists issues.',
                enabled: true,
                readOnly: true,
              },
            ],
          },
        ])
        .mockResolvedValueOnce([
          {
            name: 'linear',
            status: 'disabled',
            toolCount: 1,
            requiresAuth: false,
            tools: [],
          },
        ]),
      setMcpServerEnabled: vi.fn(async () => {}),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'mcp.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'ready',
        items: [
          {
            name: 'linear',
            status: 'connected',
            tools: [{ name: 'list-issues', readOnly: true }],
          },
        ],
      });
    });
    expect(mcpMessages(messages)[0]?.mcp.status).toBe('loading');

    controller.handleMessage({
      type: 'mcp.server.toggle',
      sessionId: 'session-1',
      name: 'linear',
      enabled: false,
    });
    expect(runtime.setMcpServerEnabled).toHaveBeenCalledWith(
      'linear',
      false,
    );
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'ready',
        items: [{ name: 'linear', status: 'disabled' }],
      });
    });

    // Wrong session id is ignored entirely.
    const before = mcpMessages(messages).length;
    controller.handleMessage({
      type: 'mcp.refresh',
      sessionId: 'session-other',
    });
    expect(mcpMessages(messages)).toHaveLength(before);
  });

  it('reports unsupported and failed MCP operations safely', async () => {
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'mcp.refresh',
      sessionId: 'session-1',
    });
    expect(mcpMessages(unsupported.messages).at(-1)?.mcp).toMatchObject({
      status: 'unsupported',
    });

    const failing = Object.assign(createMockRuntime(), {
      listMcpServers: vi.fn(async () => {
        throw new Error('private mcp failure');
      }),
      setMcpServerEnabled: vi.fn(async () => {}),
    });
    const { controller, messages } = createController(() => failing);
    ready(controller);
    await waitForConnected(messages);
    controller.handleMessage({
      type: 'mcp.refresh',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'error',
      });
    });
    expect(JSON.stringify(messages)).not.toContain('private mcp failure');
  });

  it('adds and removes MCP servers, then rebroadcasts the catalog', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      // The activation-time catalog push reads the pre-add catalog;
      // the add and remove re-lists follow.
      listMcpServers: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            name: 'local-tools',
            status: 'connected',
            toolCount: 0,
            requiresAuth: false,
            tools: [],
          },
        ])
        .mockResolvedValueOnce([]),
      addMcpServer: vi.fn(async () => {}),
      removeMcpServer: vi.fn(async () => {}),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'local-tools',
      serverType: 'stdio',
      command: 'npx',
      args: ['-y', 'my-mcp-server'],
    });
    expect(runtime.addMcpServer).toHaveBeenCalledWith({
      name: 'local-tools',
      serverType: 'stdio',
      command: 'npx',
      args: ['-y', 'my-mcp-server'],
    });
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'ready',
        items: [{ name: 'local-tools' }],
      });
    });

    controller.handleMessage({
      type: 'mcp.server.remove',
      sessionId: 'session-1',
      name: 'local-tools',
    });
    expect(runtime.removeMcpServer).toHaveBeenCalledWith('local-tools');
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'ready',
        items: [],
      });
    });

    // A failing add surfaces as a safe error state that still carries
    // the freshly re-read catalog instead of blanking the list.
    runtime.addMcpServer.mockRejectedValueOnce(
      new Error('private add failure'),
    );
    runtime.listMcpServers.mockResolvedValueOnce([
      {
        name: 'survivor',
        status: 'connected',
        toolCount: 0,
        requiresAuth: false,
        hasAuthTokens: false,
        tools: [],
      },
    ]);
    controller.handleMessage({
      type: 'mcp.server.add',
      sessionId: 'session-1',
      name: 'broken',
      serverType: 'http',
      url: 'https://example.com/mcp',
    });
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'error',
        items: [{ name: 'survivor' }],
      });
    });
    expect(JSON.stringify(messages)).not.toContain('private add failure');
  });

  it('fails a hung MCP add back to an interactive error state', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      listMcpServers: vi.fn(async () => []),
      // The daemon RPC never resolves (a spawnable-but-wrong stdio
      // command waits on an MCP handshake that never happens).
      addMcpServer: vi.fn(() => new Promise<void>(() => {})),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    vi.useFakeTimers();
    try {
      controller.handleMessage({
        type: 'mcp.server.add',
        sessionId: 'session-1',
        name: 'hung',
        serverType: 'stdio',
        command: 'node',
      });
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'loading',
      });
      // The timeout fails the mutation closed: the panel leaves
      // 'loading', carries the retry message, and stays interactive.
      await vi.advanceTimersByTimeAsync(30_001);
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'error',
        items: [],
      });
    });
    const finalMcp = mcpMessages(messages).at(-1)?.mcp;
    expect(
      finalMcp !== undefined && 'message' in finalMcp
        ? finalMcp.message
        : '',
    ).toContain('could not add');
  });

  it('ignores a timed-out MCP operation that completes late', async () => {
    // The timeout abandons but cannot cancel the daemon RPC; when the
    // orphan finally lands it must not mutate panel state.
    let resolveAdd: (() => void) | undefined;
    const runtime = Object.assign(createMockRuntime(), {
      listMcpServers: vi.fn(async () => []),
      addMcpServer: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            resolveAdd = resolve;
          }),
      ),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    vi.useFakeTimers();
    try {
      controller.handleMessage({
        type: 'mcp.server.add',
        sessionId: 'session-1',
        name: 'slow',
        serverType: 'stdio',
        command: 'node',
      });
      await vi.advanceTimersByTimeAsync(30_001);
    } finally {
      vi.useRealTimers();
    }
    await vi.waitFor(() => {
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'error',
      });
    });

    const emittedBefore = mcpMessages(messages).length;
    resolveAdd?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mcpMessages(messages).length).toBe(emittedBefore);
    expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
      status: 'error',
    });
  });

  it('limits activation Skills and MCP pushes to their captured identity', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      listSkills: vi.fn(async () => [
        {
          name: 'code-review',
          description: 'Reviews code changes.',
          location: 'project',
          enabled: true,
          userInvocable: true,
        },
      ]),
      listMcpServers: vi.fn(async () => [
        {
          name: 'linear',
          status: 'connected',
          toolCount: 0,
          requiresAuth: false,
          tools: [],
        },
      ]),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    // No panel request was issued: activation itself must push both
    // catalogs so a panel left open across a session switch converges
    // even when its own idle re-request was dropped mid-switch.
    await vi.waitFor(() => {
      expect(skillsMessages(messages).at(-1)?.skills).toMatchObject({
        status: 'ready',
        items: [{ name: 'code-review' }],
      });
      expect(mcpMessages(messages).at(-1)?.mcp).toMatchObject({
        status: 'ready',
        items: [{ name: 'linear' }],
      });
    });
    expect(runtime.listSkills).toHaveBeenCalledTimes(1);
    expect(runtime.listMcpServers).toHaveBeenCalledTimes(1);

    const activation = {
      runtime,
      generation: controller.runtimeGeneration,
      sessionId: controller.sessionId!,
      cwd: controller.activeRuntimeCwd!,
    };
    controller.sessionOperationInProgress = true;
    controller.handleMessage({
      type: 'skills.refresh',
      sessionId: 'session-1',
    });
    controller.handleMessage({
      type: 'mcp.refresh',
      sessionId: 'session-1',
    });
    expect(runtime.listSkills).toHaveBeenCalledTimes(1);
    expect(runtime.listMcpServers).toHaveBeenCalledTimes(1);

    pushActivationSkills(controller, activation);
    pushActivationMcp(controller, activation);
    await vi.waitFor(() => {
      expect(runtime.listSkills).toHaveBeenCalledTimes(2);
      expect(runtime.listMcpServers).toHaveBeenCalledTimes(2);
    });

    controller.runtimeGeneration += 1;
    pushActivationSkills(controller, activation);
    pushActivationMcp(controller, activation);
    await Promise.resolve();
    expect(runtime.listSkills).toHaveBeenCalledTimes(2);
    expect(runtime.listMcpServers).toHaveBeenCalledTimes(2);
  });

  it('logs a local diagnostic when the archived list load fails', async () => {
    const record = vi.fn();
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([catalogEntry('session-1')]),
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {
        throw new Error('daemon spawn lost the port race');
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { record } as unknown as RuntimeDiagnosticSink,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({ type: 'sessions.archivedRefresh' });

    await vi.waitFor(() => {
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'host.ui.diagnostic',
          attributes: expect.objectContaining({
            code: 'archived-load-failed',
          }),
        }),
      );
    });
    // The webview keeps the generic unavailable copy; the failure
    // detail lives only in the local log.
    const states = messages.filter(
      (message) => message.type === 'session.archived',
    );
    expect(states.at(-1)?.archived.status).toBe('error');
  });

  it('fast-fails MCP auth without an OAuth URL and frees the flow', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      listMcpServers: vi.fn(async () => []),
      authenticateMcpServer: vi.fn(async () => ({ authUrl: null })),
    });
    const opened: string[] = [];
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        openExternal: async (url) => {
          opened.push(url);
          return true;
        },
      },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'mcp.server.authenticate',
      sessionId: 'session-1',
      name: 'sentry',
    });
    await vi.waitFor(() => {
      expect(mcpAuthMessages(messages).map(({ phase }) => phase)).toEqual([
        'started',
        'error',
      ]);
    });
    expect(mcpAuthMessages(messages).at(-1)?.message).toContain(
      'already be authenticated',
    );
    expect(opened).toEqual([]);
    // The flow ended, so the list refreshes and a new attempt is accepted.
    await vi.waitFor(() => {
      expect(runtime.listMcpServers).toHaveBeenCalled();
    });
    controller.handleMessage({
      type: 'mcp.server.authenticate',
      sessionId: 'session-1',
      name: 'sentry',
    });
    expect(runtime.authenticateMcpServer).toHaveBeenCalledTimes(2);
  });
});
