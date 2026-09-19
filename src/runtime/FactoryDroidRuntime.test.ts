import {
  AutonomyLevel,
  ConnectionError,
  ContextStatsAccuracy,
  DroidInteractionMode,
  InvalidSessionCwdError,
  ModelProvider,
  ReasoningEffort,
  ToolConfirmationOutcome,
  ToolConfirmationType,
  type AvailableModelConfig,
  type ClientAskUserHandler,
  type ClientPermissionHandler,
  type DroidStreamEvent,
  type DroidObservability,
  type SessionSettings,
} from '@factory/droid-sdk/node';
import { describe, expect, it, vi } from 'vitest';

import { FactoryDroidRuntime } from './FactoryDroidRuntime';
import { createLocalDroidSession } from './process/createLocalDroidSession';
import {
  type FactoryDroidSession,
  type FactoryDroidSessionFactory,
} from './session/sessionTypes';
import { cancellingRuntimeInteractionHandler } from './events/runtimeInteractions';

describe('FactoryDroidRuntime', () => {
  it('creates one cwd-scoped session and streams a text turn', async () => {
    const session = createMockSession(async function* () {
      yield textDelta('hello');
      yield {
        type: 'assistant_text_complete',
        messageId: 'message-1',
        blockIndex: 0,
      };
      yield successfulResult();
    });
    const createSession = vi.fn(async () => session);
    const runtime = createRuntime(createSession);

    const first = await runtime.initialize('C:\\workspace');
    const second = await runtime.initialize('C:\\workspace');
    const events = await collect(runtime.sendTurn('Say hello'));

    expect(first).toMatchObject({
      status: 'available',
      sessionId: 'session-1',
      cliVersion: null,
      authenticationStatus: 'unknown',
    });
    expect(second).toEqual(first);
    expect(createSession).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledWith({
      target: {
        kind: 'new',
        cwd: 'C:\\workspace',
      },
      // The runtime wraps the handler to observe spec approvals, so the
      // session receives a delegating handler rather than the original.
      interactionHandler: expect.objectContaining({
        requestPermission: expect.any(Function),
        askUser: expect.any(Function),
      }),
    });
    expect(session.stream).toHaveBeenCalledWith('Say hello', {
      includePartialMessages: true,
    });
    expect(events).toEqual([
      { type: 'text-delta', text: 'hello' },
      {
        type: 'turn-complete',
        outcome: 'success',
      },
    ]);
  });

  it('reports the backend session cwd, and null before initialization', async () => {
    const session = {
      ...createMockSession(async function* () {}),
      cwd: 'C:\\workspace-wt-main-wt',
    };
    const runtime = createRuntime(async () => session);

    expect(runtime.getSessionCwd()).toBeNull();
    await runtime.initialize({
      kind: 'new',
      cwd: 'C:\\workspace',
      worktree: true,
    });
    expect(runtime.getSessionCwd()).toBe('C:\\workspace-wt-main-wt');
  });

  it('fails closed on working state and skips interruptSession in process mode', async () => {
    const session = createMockSession(async function* () {});
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    // Process sessions do not implement readWorkingState (their turns
    // cannot outlive the window), so the read must throw rather than
    // report a made-up idle state.
    await expect(runtime.readSessionWorkingState()).rejects.toThrow(
      'does not report a working state',
    );

    // interruptSession still forwards to the session handle: unlike
    // interrupt(), it must not require a locally streaming turn.
    await runtime.interruptSession();
    expect(session.interrupt).toHaveBeenCalledOnce();
  });

  it('interruptSession is a no-op before initialization', async () => {
    const runtime = createRuntime(async () => createMockSession(async function* () {}));
    await expect(runtime.interruptSession()).resolves.toBeUndefined();
  });

  it('treats worktree and plain targets as different sessions', async () => {
    const factory = vi.fn(async () => createMockSession(async function* () {}));
    const runtime = createRuntime(factory);

    await runtime.initialize({ kind: 'new', cwd: 'C:\\workspace' });
    // Same cwd but worktree flag differs: must not reuse the session.
    expect(() =>
      runtime.initialize({
        kind: 'new',
        cwd: 'C:\\workspace',
        worktree: true,
      }),
    ).toThrow(/another session target/i);
  });

  it('records full-fidelity lifecycle diagnostics with the prompt text', async () => {
    const session = createMockSession(async function* () {
      yield textDelta('hello');
      yield successfulResult();
    });
    const diagnostics = { record: vi.fn() };
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: async () => session,
      diagnostics,
    });

    await runtime.initialize('C:\\workspace');
    await collect(runtime.sendTurn('real prompt content'));

    expect(diagnostics.record).toHaveBeenCalledWith({
      level: 'info',
      name: 'runtime.turn.started',
      attributes: { textLength: 19, attachmentCount: 0 },
      detail: 'real prompt content',
    });
    expect(diagnostics.record).toHaveBeenCalledWith({
      level: 'info',
      name: 'runtime.turn.finished',
      attributes: {
        durationMs: expect.any(Number),
        outcome: 'success',
        projectedEventCount: 2,
        toolStartCount: 0,
        toolUniqueCount: 0,
        toolProgressCount: 0,
        toolResultCount: 0,
      },
    });
  });

  it('logs one tool.started per toolUseId despite delta re-emissions', async () => {
    const session = createMockSession(async function* () {
      yield toolCall('tool-1', 'Read');
      yield toolCall('tool-1', 'Read');
      yield toolCall('tool-2', 'Execute');
      yield toolResult('tool-1', 'Read');
      yield successfulResult();
    });
    const diagnostics = { record: vi.fn() };
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: async () => session,
      diagnostics,
    });

    await runtime.initialize('C:\\workspace');
    await collect(runtime.sendTurn('run the tools'));

    const started = diagnostics.record.mock.calls.filter(
      ([event]) => event.name === 'runtime.tool.started',
    );
    expect(started).toHaveLength(2);
    expect(started[0]?.[0]?.attributes).toMatchObject({
      tool: 'Read',
      toolUseId: 'tool-1',
    });
    expect(started[1]?.[0]?.attributes).toMatchObject({
      tool: 'Execute',
      toolUseId: 'tool-2',
    });
    expect(diagnostics.record).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'runtime.turn.finished',
        attributes: expect.objectContaining({
          toolStartCount: 3,
          toolUniqueCount: 2,
          toolResultCount: 1,
        }),
      }),
    );
  });

  it('forwards attachments to the SDK stream as images and files', async () => {
    const session = createMockSession(async function* () {
      yield textDelta('ok');
      yield successfulResult();
    });
    const runtime = createRuntime(async () => session);

    await runtime.initialize('C:\\workspace');
    await collect(
      runtime.sendTurn('describe these', [
        { kind: 'image', data: 'aW1n', mediaType: 'image/png' },
        { kind: 'pdf', data: 'cGRm', name: 'paper.pdf' },
        { kind: 'text', data: 'hello notes', name: 'notes.md' },
      ]),
    );

    expect(session.stream).toHaveBeenCalledWith('describe these', {
      includePartialMessages: true,
      images: [{ type: 'base64', data: 'aW1n', mediaType: 'image/png' }],
      files: [
        {
          type: 'base64',
          mediaType: 'application/pdf',
          data: 'cGRm',
          name: 'paper.pdf',
        },
        {
          type: 'text',
          mediaType: 'text/plain',
          data: 'hello notes',
          name: 'notes.md',
        },
      ],
    });
  });

  it('rejects a turn with too many attachments', async () => {
    const session = createMockSession(async function* () {});
    const runtime = createRuntime(async () => session);

    await runtime.initialize('C:\\workspace');
    const oversized = Array.from({ length: 9 }, (_, index) => ({
      kind: 'text' as const,
      data: 'x',
      name: `file-${index}.txt`,
    }));

    await expect(collect(runtime.sendTurn('too many', oversized))).rejects.toThrow(
      'Too many attachments',
    );
    expect(session.stream).not.toHaveBeenCalled();
  });

  it('initializes an explicit resumed session target once', async () => {
    const session = createMockSession(async function* () {});
    const createSession = vi.fn(async () => session);
    const runtime = createRuntime(createSession);
    const target = {
      kind: 'resume' as const,
      cwd: 'C:\\workspace',
      sessionId: 'saved-session',
    };

    const first = await runtime.initialize(target);
    const second = await runtime.initialize({ ...target });

    expect(first).toMatchObject({
      status: 'available',
      sessionId: 'session-1',
    });
    expect(second).toEqual(first);
    expect(createSession).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledWith({
      target,
      interactionHandler: expect.objectContaining({
        requestPermission: expect.any(Function),
        askUser: expect.any(Function),
      }),
    });
  });

  it('rewinds to a user message and adopts the forked session', async () => {
    const forked = {
      ...createMockSession(async function* () {
        yield textDelta('from fork');
        yield successfulResult();
      }),
      id: 'session-fork',
    };
    const session = Object.assign(
      createMockSession(async function* () {}),
      {
        rewind: vi.fn(async () => ({ session: forked })),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    const result = await runtime.rewind({
      messageId: 'sdk-msg-1',
      forkTitle: 'Edited prompt',
    });

    expect(result).toEqual({ sessionId: 'session-fork' });
    expect(session.rewind).toHaveBeenCalledWith({
      messageId: 'sdk-msg-1',
      filesToRestore: [],
      filesToDelete: [],
      forkTitle: 'Edited prompt',
    });

    const events = await collect(runtime.sendTurn('again'));
    expect(forked.stream).toHaveBeenCalledWith('again', {
      includePartialMessages: true,
    });
    expect(session.stream).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'text-delta', text: 'from fork' },
      { type: 'turn-complete', outcome: 'success' },
    ]);
  });

  it('reports rewind file info and restores files when asked', async () => {
    const forked = {
      ...createMockSession(async function* () {}),
      id: 'session-fork',
    };
    const info = {
      availableFiles: [
        { filePath: 'src/app.ts', contentHash: 'a', size: 10 },
        { filePath: '../outside.ts', contentHash: 'b', size: 4 },
      ],
      createdFiles: [{ filePath: 'docs/new.md' }],
      evictedFiles: [{ filePath: 'src/big.bin', reason: 'size-limit' }],
    };
    const session = Object.assign(
      createMockSession(async function* () {}),
      {
        rewind: vi.fn(async () => ({ session: forked })),
        getRewindInfo: vi.fn(async () => info),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(runtime.getRewindInfo('sdk-msg-1')).resolves.toMatchObject({
      restorableCount: 2,
      createdCount: 1,
      restorablePaths: ['src/app.ts'],
      createdPaths: ['docs/new.md'],
      evictedFiles: [{ path: 'src/big.bin', reason: 'size-limit' }],
    });
    expect(session.getRewindInfo).toHaveBeenCalledWith({
      messageId: 'sdk-msg-1',
    });

    await runtime.rewind({
      messageId: 'sdk-msg-1',
      forkTitle: 'Edited prompt',
      restoreFiles: true,
    });
    expect(session.rewind).toHaveBeenCalledWith({
      messageId: 'sdk-msg-1',
      filesToRestore: info.availableFiles,
      filesToDelete: info.createdFiles,
      forkTitle: 'Edited prompt',
    });
  });

  it('refuses to rewind without session support or during a turn', async () => {
    const session = createMockSession(async function* () {});
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(
      runtime.rewind({ messageId: 'sdk-msg-1', forkTitle: 'Edited' }),
    ).rejects.toThrow('does not support rewind');
  });

  it('compacts the session and adopts the continuation session', async () => {
    const continuation = {
      ...createMockSession(async function* () {
        yield textDelta('after compaction');
        yield successfulResult();
      }),
      id: 'session-compacted',
    };
    const session = Object.assign(
      createMockSession(async function* () {}),
      {
        compact: vi.fn(async () => ({
          session: continuation,
          removedCount: 12,
        })),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    const result = await runtime.compact();
    expect(result).toEqual({
      sessionId: 'session-compacted',
      removedCount: 12,
    });

    const events = await collect(runtime.sendTurn('next'));
    expect(continuation.stream).toHaveBeenCalledWith('next', {
      includePartialMessages: true,
    });
    expect(session.stream).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'text-delta', text: 'after compaction' },
      { type: 'turn-complete', outcome: 'success' },
    ]);

    const bare = createRuntime(async () => createMockSession(async function* () {}));
    await bare.initialize('C:\\workspace');
    await expect(bare.compact()).rejects.toThrow('does not support compaction');
  });

  it('forks the session and adopts the copy', async () => {
    const copy = {
      ...createMockSession(async function* () {
        yield textDelta('on the fork');
        yield successfulResult();
      }),
      id: 'session-fork',
    };
    const session = Object.assign(
      createMockSession(async function* () {}),
      {
        fork: vi.fn(async () => copy),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    const result = await runtime.fork('My session (fork)');
    expect(result).toEqual({ sessionId: 'session-fork' });
    expect(session.fork).toHaveBeenCalledWith({
      title: 'My session (fork)',
    });

    const events = await collect(runtime.sendTurn('next'));
    expect(copy.stream).toHaveBeenCalledWith('next', {
      includePartialMessages: true,
    });
    expect(session.stream).not.toHaveBeenCalled();
    expect(events).toEqual([
      { type: 'text-delta', text: 'on the fork' },
      { type: 'turn-complete', outcome: 'success' },
    ]);

    const bare = createRuntime(async () => createMockSession(async function* () {}));
    await bare.initialize('C:\\workspace');
    await expect(bare.fork('Title')).rejects.toThrow('does not support fork');
  });

  it('projects only safe skill fields and enforces toggle success', async () => {
    const session = Object.assign(
      createMockSession(async function* () {}),
      {
        listSkills: vi.fn(async () => ({
          skills: [
            {
              name: 'code-review',
              description: 'Reviews code changes.',
              location: 'project',
              filePath: 'C:\\secret\\SKILL.md',
              content: 'SECRET BODY',
              enabled: true,
              userInvocable: true,
            },
            {
              name: 'quiet-skill',
              location: 'builtin',
              filePath: 'C:\\secret\\other.md',
              enabled: false,
            },
            { name: 'broken', location: 'mars' },
            { name: '', location: 'project' },
          ],
        })),
        setSkillDisabled: vi.fn(async () => ({ success: false })),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    const skills = await runtime.listSkills();
    expect(skills).toEqual([
      {
        name: 'code-review',
        description: 'Reviews code changes.',
        location: 'project',
        enabled: true,
        userInvocable: true,
      },
      {
        name: 'quiet-skill',
        description: null,
        location: 'builtin',
        enabled: false,
        userInvocable: false,
      },
    ]);
    expect(JSON.stringify(skills)).not.toContain('secret');
    expect(JSON.stringify(skills)).not.toContain('SECRET BODY');

    await expect(runtime.setSkillDisabled('code-review', true)).rejects.toThrow(
      'refused',
    );
    expect(session.setSkillDisabled).toHaveBeenCalledWith({
      skillName: 'code-review',
      disabled: true,
    });

    const bare = createRuntime(async () => createMockSession(async function* () {}));
    await bare.initialize('C:\\workspace');
    await expect(bare.listSkills()).rejects.toThrow('does not support skills');
  });

  it('lists commands through the injected catalog loader', async () => {
    const loadSessionCommands = vi.fn(async () => [
      {
        name: 'deploy',
        description: 'Deploys the branch.',
        argumentHint: '<env>',
        isExecutable: false,
      },
    ]);
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: async () => createMockSession(async function* () {}),
      loadSessionCommands,
    });
    await runtime.initialize('C:\\workspace');

    const commands = await runtime.listCommands();
    expect(loadSessionCommands).toHaveBeenCalledWith({
      cwd: 'C:\\workspace',
      sessionId: 'session-1',
    });
    expect(commands).toEqual([
      {
        name: 'deploy',
        description: 'Deploys the branch.',
        argumentHint: '<env>',
        isExecutable: false,
      },
    ]);

    const failing = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: async () => createMockSession(async function* () {}),
      loadSessionCommands: vi.fn(async () => {
        throw new Error('list failed');
      }),
    });
    await failing.initialize('C:\\workspace');
    await expect(failing.listCommands()).rejects.toThrow('list failed');
  });

  it('projects safe MCP servers with grouped tools and enforces toggle success', async () => {
    const session = Object.assign(
      createMockSession(async function* () {}),
      {
        listMcpServers: vi.fn(async () => ({
          servers: [
            {
              name: 'linear',
              status: 'connected',
              toolCount: 2,
              requiresAuth: false,
              error: 'SECRET CONNECTION ERROR',
              authUrl: 'https://secret.example/auth',
            },
            {
              name: 'sentry',
              status: 'disabled',
              requiresAuth: true,
              hasAuthTokens: true,
            },
            { name: 'broken', status: 'on-fire' },
            { name: '', status: 'connected' },
            {
              name: 'linear',
              status: 'failed',
            },
          ],
        })),
        listMcpTools: vi.fn(async () => [
          {
            serverName: 'linear',
            name: 'list-issues',
            description: 'Lists issues.',
            isEnabled: true,
            isReadOnly: true,
            inputSchema: { type: 'object' },
          },
          {
            serverName: 'linear',
            name: 'create-issue',
            isEnabled: false,
          },
          // Duplicate tool names collapse to the first occurrence.
          {
            serverName: 'linear',
            name: 'list-issues',
            isEnabled: false,
          },
          { serverName: 'unknown-server', name: 'orphan' },
          { serverName: 'linear', name: '' },
        ]),
        toggleMcpServer: vi.fn(async () => ({ success: false })),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    const servers = await runtime.listMcpServers();
    expect(servers).toEqual([
      {
        name: 'linear',
        status: 'connected',
        toolCount: 2,
        requiresAuth: false,
        hasAuthTokens: false,
        tools: [
          {
            name: 'list-issues',
            description: 'Lists issues.',
            enabled: true,
            readOnly: true,
          },
          {
            name: 'create-issue',
            description: null,
            enabled: false,
            readOnly: false,
          },
        ],
      },
      {
        name: 'sentry',
        status: 'disabled',
        toolCount: null,
        requiresAuth: true,
        hasAuthTokens: true,
        tools: [],
      },
    ]);
    expect(JSON.stringify(servers)).not.toContain('SECRET');
    expect(JSON.stringify(servers)).not.toContain('secret.example');

    await expect(runtime.setMcpServerEnabled('linear', false)).rejects.toThrow('refused');
    expect(session.toggleMcpServer).toHaveBeenCalledWith({
      serverName: 'linear',
      enabled: false,
      settingsLevel: 'user',
    });

    const bare = createRuntime(async () => createMockSession(async function* () {}));
    await bare.initialize('C:\\workspace');
    await expect(bare.listMcpServers()).rejects.toThrow('does not support MCP');
  });

  it('caps a hung MCP toggle with its own timeout', async () => {
    // Droid only answers a toggle after its connect attempt gives up,
    // which used to leave the panel waiting on the SDK's generic 30s
    // timeout (or longer) for a failing server.
    vi.useFakeTimers();
    try {
      const session = Object.assign(
        createMockSession(async function* () {}),
        {
          toggleMcpServer: vi.fn(() => new Promise<never>(() => {})),
        },
      );
      const runtime = createRuntime(async () => session);
      await runtime.initialize('C:\\workspace');

      const toggle = runtime.setMcpServerEnabled('linear', true);
      const outcome = expect(toggle).rejects.toThrow(
        'did not finish starting within 12s',
      );
      await vi.advanceTimersByTimeAsync(12_000);
      await outcome;
    } finally {
      vi.useRealTimers();
    }
  });

  it('adds and removes MCP servers through the SDK session', async () => {
    const session = Object.assign(
      createMockSession(async function* () {}),
      {
        addMcpServer: vi.fn(async () => ({ success: true })),
        removeMcpServer: vi.fn(async () => ({ success: true })),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await runtime.addMcpServer({
      name: 'local-tools',
      serverType: 'stdio',
      command: 'npx',
      args: ['-y', 'my-mcp-server'],
    });
    expect(session.addMcpServer).toHaveBeenCalledWith({
      name: 'local-tools',
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'my-mcp-server'],
    });

    await runtime.addMcpServer({
      name: 'remote',
      serverType: 'http',
      url: 'https://example.com/mcp',
      // A stray command must not leak into http requests.
      command: 'npx',
    });
    expect(session.addMcpServer).toHaveBeenLastCalledWith({
      name: 'remote',
      type: 'http',
      url: 'https://example.com/mcp',
    });

    await runtime.removeMcpServer('remote');
    expect(session.removeMcpServer).toHaveBeenCalledWith({
      serverName: 'remote',
      settingsLevel: 'user',
    });

    session.addMcpServer.mockResolvedValueOnce({ success: false });
    await expect(
      runtime.addMcpServer({
        name: 'broken',
        serverType: 'sse',
        url: 'https://example.com/sse',
      }),
    ).rejects.toThrow('refused');
    session.removeMcpServer.mockResolvedValueOnce({ success: false });
    await expect(runtime.removeMcpServer('broken')).rejects.toThrow('refused');

    const bare = createRuntime(async () => createMockSession(async function* () {}));
    await bare.initialize('C:\\workspace');
    await expect(
      bare.addMcpServer({
        name: 'x',
        serverType: 'http',
        url: 'https://example.com',
      }),
    ).rejects.toThrow('does not support adding');
    await expect(bare.removeMcpServer('x')).rejects.toThrow('does not support removing');
  });

  it('starts MCP authentication and reports the OAuth URL and outcome', async () => {
    type NotificationListener = (notification: Record<string, unknown>) => void;
    const listeners = new Map<string, NotificationListener[]>();
    const session = Object.assign(
      createMockSession(async function* () {}),
      {
        authenticateMcpServer: vi.fn(async (params: { serverName: string }) => {
          queueMicrotask(() => {
            for (const listener of listeners.get('mcp_auth_required') ?? []) {
              listener({
                type: 'mcp_auth_required',
                serverName: params.serverName,
                authUrl: 'https://auth.example/flow',
                message: 'Sign in',
                state: 'abc',
              });
            }
          });
          return { success: true };
        }),
        onNotification: vi.fn(
          (listener: NotificationListener, filter?: { type?: string }) => {
            const key = filter?.type ?? '*';
            const bucket = listeners.get(key) ?? [];
            bucket.push(listener);
            listeners.set(key, bucket);
            return () => {
              const current = listeners.get(key) ?? [];
              listeners.set(
                key,
                current.filter((entry) => entry !== listener),
              );
            };
          },
        ),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    const onCompleted = vi.fn();
    const start = await runtime.authenticateMcpServer('sentry', onCompleted);
    expect(start).toEqual({ authUrl: 'https://auth.example/flow' });
    expect(session.authenticateMcpServer).toHaveBeenCalledWith({
      serverName: 'sentry',
    });

    // Completion notifications for other servers are ignored.
    for (const listener of listeners.get('mcp_auth_completed') ?? []) {
      listener({
        type: 'mcp_auth_completed',
        serverName: 'linear',
        outcome: 'failed',
        message: 'no',
      });
      listener({
        type: 'mcp_auth_completed',
        serverName: 'sentry',
        outcome: 'success',
        message: 'ok',
      });
      // A second outcome must not re-fire the callback.
      listener({
        type: 'mcp_auth_completed',
        serverName: 'sentry',
        outcome: 'failed',
        message: 'late',
      });
    }
    expect(onCompleted).toHaveBeenCalledTimes(1);
    expect(onCompleted).toHaveBeenCalledWith('success');
    // The URL listener is released once the start call resolves.
    expect(listeners.get('mcp_auth_required') ?? []).toHaveLength(0);

    const bare = createRuntime(async () => createMockSession(async function* () {}));
    await bare.initialize('C:\\workspace');
    await expect(bare.authenticateMcpServer('sentry', vi.fn())).rejects.toThrow(
      'does not support MCP authentication',
    );
  });

  it('renames the active session through the SDK', async () => {
    const session = Object.assign(
      createMockSession(async function* () {}),
      { rename: vi.fn(async () => {}) },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await runtime.rename('Fireworks demo');
    expect(session.rename).toHaveBeenCalledWith({
      title: 'Fireworks demo',
    });

    const bare = createMockSession(async function* () {});
    const bareRuntime = createRuntime(async () => bare);
    await bareRuntime.initialize('C:\\workspace');
    await expect(bareRuntime.rename('Nope')).rejects.toThrow('does not support rename');
  });

  it('projects settings and context through runtime-owned DTOs', async () => {
    const session = createMockSession(async function* () {});
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readSessionSettings()).resolves.toEqual({
      interactionMode: 'auto',
      modelId: 'model-1',
      reasoningEffort: 'high',
      autonomyLevel: 'medium',
      specModeModelId: null,
      specModeReasoningEffort: null,
    });
    await expect(runtime.readContextWindow()).resolves.toEqual({
      availability: 'available',
      used: 40,
      remaining: 60,
      limit: 100,
      estimatedTokens: 40,
    });
    await expect(runtime.readModelCatalog()).resolves.toEqual({
      status: 'unavailable',
    });
  });
  it('uses the official Context Breakdown instead of SDK token totals', async () => {
    const session = createMockSession(async function* () {});
    session.getContextStats.mockResolvedValue({
      used: 101,
      remaining: 108,
      limit: 100,
      accuracy: ContextStatsAccuracy.Estimated,
      updatedAt: new Date().toISOString(),
    });
    session.readContextBreakdown.mockResolvedValue({
      used: 500000,
      remaining: 0,
      limit: 11100,
      lastCallCompactionTokens: 11063,
    });
    const diagnostics = { record: vi.fn() };
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: async () => session,
      diagnostics,
    });
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readContextWindow()).resolves.toEqual({
      availability: 'available',
      used: 63,
      remaining: 37,
      limit: 100,
      estimatedTokens: 500000,
    });
    expect(session.getContextStats).not.toHaveBeenCalled();
    expect(diagnostics.record).toHaveBeenCalledWith({
      level: 'info',
      name: 'runtime.context.finished',
      attributes: {
        durationMs: expect.any(Number),
        outcome: 'available',
        source: 'context-breakdown',
        used: 63,
        remaining: 37,
        limit: 100,
      },
    });
  });
  it('reports Context unavailable when the Runtime has no official breakdown', async () => {
    const session: FactoryDroidSession = createMockSession(async function* () {});
    session.readContextBreakdown = undefined;
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readContextWindow()).resolves.toEqual({
      availability: 'unavailable',
      reason: 'unsupported',
    });
  });
  it('projects only BYOK models from the real startup catalog', async () => {
    const session = createMockSession(async function* () {});
    session.availableModels = [
      availableModel('model-sol', 'Model Sol', [
        ReasoningEffort.Low,
        ReasoningEffort.Medium,
        ReasoningEffort.High,
      ]),
      availableModel('custom:model-pro', 'Model Pro', [ReasoningEffort.None]),
    ];
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readModelCatalog()).resolves.toEqual({
      status: 'available',
      items: [
        {
          id: 'custom:model-pro',
          displayName: 'Model Pro',
          supportedReasoningEfforts: ['none'],
        },
      ],
    });
  });

  it('fails closed when the captured model catalog is invalid', async () => {
    const session = createMockSession(async function* () {});
    session.availableModels = [
      availableModel('duplicate', 'Model One', [ReasoningEffort.Medium]),
      availableModel('duplicate', 'Model Two', [ReasoningEffort.High]),
    ];
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readModelCatalog()).rejects.toThrow(
      'Droid returned an invalid model catalog.',
    );
  });

  it('updates one setting and rereads authoritative session settings', async () => {
    const session = createMockSession(async function* () {});
    session.updateSettings.mockImplementation(async (params) => {
      expect(params).toEqual({
        interactionMode: DroidInteractionMode.Spec,
      });
      session.settings.interactionMode = DroidInteractionMode.Mission;
    });
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(
      runtime.updateSessionSetting({
        field: 'interactionMode',
        value: 'spec',
      }),
    ).resolves.toMatchObject({ interactionMode: 'mission' });
    expect(session.updateSettings).toHaveBeenCalledOnce();
  });

  it('projects autonomy updates to the Droid SDK session', async () => {
    const session = createMockSession(async function* () {});
    session.updateSettings.mockImplementation(async (params) => {
      expect(params).toEqual({
        autonomyLevel: AutonomyLevel.High,
      });
      session.settings.autonomyLevel = AutonomyLevel.High;
    });
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(
      runtime.updateSessionSetting({
        field: 'autonomyLevel',
        value: 'high',
      }),
    ).resolves.toMatchObject({ autonomyLevel: 'high' });
    expect(session.updateSettings).toHaveBeenCalledOnce();
  });

  it('handles malformed SDK settings, context, and update values safely', async () => {
    const session = createMockSession(async function* () {});
    const diagnostics = { record: vi.fn() };
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: async () => session,
      diagnostics,
    });
    await runtime.initialize('C:\\workspace');

    session.settings.interactionMode = DroidInteractionMode.AGI;
    await expect(runtime.readSessionSettings()).rejects.toThrow(
      'Droid returned invalid session settings.',
    );
    session.settings.interactionMode = DroidInteractionMode.Auto;
    session.readContextBreakdown.mockResolvedValue({
      used: 0,
      remaining: 0,
      limit: -1,
    });
    await expect(runtime.readContextWindow()).resolves.toEqual({
      availability: 'unavailable',
      reason: 'invalid-breakdown',
    });
    expect(diagnostics.record).toHaveBeenCalledWith({
      level: 'info',
      name: 'runtime.context.finished',
      attributes: {
        durationMs: expect.any(Number),
        outcome: 'unavailable',
        reason: 'invalid-breakdown',
      },
    });
    await expect(
      runtime.updateSessionSetting({
        field: 'modelId',
        value: 'x'.repeat(257),
      }),
    ).rejects.toThrow('Invalid session setting update.');
    await expect(
      runtime.updateSessionSetting(
        new Proxy(
          { field: 'autonomyLevel', value: 'high' },
          {
            ownKeys() {
              throw new Error('sensitive hostile trap');
            },
          },
        ) as never,
      ),
    ).rejects.toThrow('Invalid session setting update.');
    expect(session.updateSettings).not.toHaveBeenCalled();
  });

  it('replaces SDK read and update errors with generic runtime failures', async () => {
    const session = createMockSession(async function* () {});
    session.readContextBreakdown.mockRejectedValue(
      new Error('sensitive context failure'),
    );
    session.updateSettings.mockRejectedValue(new Error('sensitive settings failure'));
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readContextWindow()).rejects.toThrow(
      'Droid context statistics could not be read.',
    );
    await expect(
      runtime.updateSessionSetting({
        field: 'autonomyLevel',
        value: 'high',
      }),
    ).rejects.toThrow('Droid session settings could not be updated.');
  });

  it('yields only defined semantic events from the SDK stream', async () => {
    const session = createMockSession(async function* () {
      yield {
        type: 'thinking_text_delta',
        messageId: 'message-1',
        blockIndex: 0,
        text: 'Considering',
      };
      yield {
        type: 'session_title_updated',
        title: 'Sensitive title',
      };
      yield {
        type: 'tool_progress',
        toolUseId: 'tool-1',
        toolName: 'Read',
        content: 'sensitive progress',
        update: {
          type: 'message',
          text: 'sensitive update',
        },
      };
    });
    const runtime = createRuntime(async () => session);

    await runtime.initialize('C:\\workspace');

    await expect(collect(runtime.sendTurn('Continue'))).resolves.toEqual([
      {
        type: 'thinking-delta',
        text: 'Considering',
        messageId: 'message-1',
        blockIndex: 0,
      },
      {
        type: 'tool-progress',
        toolUseId: 'tool-1',
        toolName: 'Read',
        action: 'Read workspace files',
        updateKind: 'message',
      },
    ]);
  });

  it('interrupts only an active turn and keeps the stream terminal event', async () => {
    const interrupted = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('before stop');
      await interrupted.promise;
      yield interruptedResult();
    });
    session.interrupt.mockImplementation(async () => interrupted.resolve());
    const runtime = createRuntime(async () => session);

    await runtime.initialize('C:\\workspace');
    await runtime.interrupt();

    const iterator = runtime.sendTurn('Keep writing')[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: 'text-delta', text: 'before stop' },
    });

    await runtime.interrupt();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        type: 'turn-complete',
        outcome: 'interrupted',
      },
    });
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });

    expect(session.interrupt).toHaveBeenCalledOnce();
  });

  it('rejects concurrent turns until the active stream is finished', async () => {
    const release = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('first');
      await release.promise;
      yield successfulResult();
    });
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');
    const first = runtime.sendTurn('First turn')[Symbol.asyncIterator]();
    await expect(first.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'text-delta', text: 'first' },
    });

    await expect(collect(runtime.sendTurn('Second turn'))).rejects.toThrow(
      'Droid runtime already has an active turn.',
    );

    release.resolve();
    await expect(first.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'turn-complete', outcome: 'success' },
    });
    await expect(first.next()).resolves.toMatchObject({ done: true });
    await expect(collect(runtime.sendTurn('Third turn'))).resolves.toHaveLength(2);
  });

  it('updates authoritative session settings during an active stream', async () => {
    const release = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('first');
      await release.promise;
      yield successfulResult();
    });
    session.updateSettings.mockImplementation(async (params) => {
      expect(params).toEqual({ autonomyLevel: AutonomyLevel.High });
      session.settings.autonomyLevel = AutonomyLevel.High;
      return {};
    });
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');
    const turn = runtime.sendTurn('Keep working')[Symbol.asyncIterator]();
    await expect(turn.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'text-delta', text: 'first' },
    });

    await expect(
      runtime.updateSessionSetting({
        field: 'autonomyLevel',
        value: 'high',
      }),
    ).resolves.toMatchObject({ autonomyLevel: 'high' });
    expect(session.updateSettings).toHaveBeenCalledOnce();

    release.resolve();
    await expect(turn.next()).resolves.toMatchObject({
      done: false,
      value: { type: 'turn-complete', outcome: 'success' },
    });
    await expect(turn.next()).resolves.toMatchObject({ done: true });
  });

  it('projects spec drafting overrides and null resets to the SDK', async () => {
    const session = createMockSession(async function* () {});
    session.updateSettings.mockImplementation(async (params) => {
      const update = params as Record<string, unknown>;
      const settings = session.settings as Record<string, unknown>;
      // Droid stores a null reset as an absent field.
      for (const [key, value] of Object.entries(update)) {
        if (value === null) {
          delete settings[key];
        } else {
          settings[key] = value;
        }
      }
      return {};
    });
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    await expect(
      runtime.updateSessionSetting({
        field: 'specModeModelId',
        value: 'model-2',
      }),
    ).resolves.toMatchObject({
      specModeModelId: 'model-2',
      specModeReasoningEffort: null,
    });
    expect(session.updateSettings).toHaveBeenCalledWith({
      specModeModelId: 'model-2',
    });

    await expect(
      runtime.updateSessionSetting({
        field: 'specModeReasoningEffort',
        value: 'medium',
      }),
    ).resolves.toMatchObject({ specModeReasoningEffort: 'medium' });
    expect(session.updateSettings).toHaveBeenCalledWith({
      specModeReasoningEffort: 'medium',
    });

    await expect(
      runtime.updateSessionSetting({
        field: 'specModeModelId',
        value: null,
      }),
    ).resolves.toMatchObject({ specModeModelId: null });
    expect(session.updateSettings).toHaveBeenCalledWith({
      specModeModelId: null,
    });

    await expect(
      runtime.updateSessionSetting({
        field: 'specModeReasoningEffort',
        value: null,
      }),
    ).resolves.toMatchObject({ specModeReasoningEffort: null });

    await expect(
      runtime.updateSessionSetting({
        field: 'specModeModelId',
        value: 'x'.repeat(257),
      }),
    ).rejects.toThrow('Invalid session setting update.');
  });

  it('emits spec-handoff before turn completion after a ProceedNewSession approval', async () => {
    type Listener = (notification: Record<string, unknown>) => void;
    const listeners: Listener[] = [];
    const notify = (sessionId: string, type: string, reason?: string) => {
      for (const listener of [...listeners]) {
        listener({
          method: 'droid.session_notification',
          params: {
            sessionId,
            notification: {
              type,
              ...(reason === undefined ? {} : { reason }),
            },
          },
        });
      }
    };
    let sessionHandler:
      | Parameters<FactoryDroidSessionFactory>[0]['interactionHandler']
      | undefined;
    const session = Object.assign(
      createMockSession(async function* () {
        yield textDelta('drafting the plan');
        const result = await sessionHandler!.requestPermission({
          options: [
            {
              label: 'Approve',
              value: 'proceed_new_session',
              requiresEditedSpec: false,
            },
          ],
          toolUses: [
            {
              toolUseId: 'tool-1',
              toolName: 'ExitSpecMode',
              confirmationKind: 'exit_spec_mode',
              title: 'Ready to build',
              detail: 'The plan',
              editableSpecContent: 'The plan',
            },
          ],
        });
        expect(result.selectedOption).toBe('proceed_new_session');
        // Same-session notifications and unrelated types never trigger
        // a handoff on their own.
        notify('session-1', 'agent_turn_completed', 'completed');
        notify('session-2', 'agent_turn_completed', 'spec_handoff');
        yield textDelta('implementing');
        yield successfulResult();
      }),
      {
        onNotification: vi.fn((listener: Listener) => {
          listeners.push(listener);
          return () => {
            const index = listeners.indexOf(listener);
            if (index !== -1) {
              listeners.splice(index, 1);
            }
          };
        }),
      },
    );
    const runtime = new FactoryDroidRuntime({
      interactionHandler: {
        requestPermission: async () => ({
          selectedOption: 'proceed_new_session',
        }),
        askUser: async () => ({ cancelled: true, answers: [] }),
      },
      createSdkSession: async (options) => {
        sessionHandler = options.interactionHandler;
        return session;
      },
    });
    await runtime.initialize('C:\\workspace');

    const events = await collect(runtime.sendTurn('draft a plan'));
    const handoffIndex = events.findIndex((event) => event.type === 'spec-handoff');
    const completeIndex = events.findIndex((event) => event.type === 'turn-complete');
    expect(events[handoffIndex]).toEqual({
      type: 'spec-handoff',
      implementationSessionId: 'session-2',
    });
    expect(handoffIndex).toBeGreaterThan(-1);
    expect(handoffIndex).toBeLessThan(completeIndex);
    // The spec watch is released once the turn finishes; only the
    // session-lifetime subagent watch remains subscribed.
    expect(listeners).toHaveLength(1);
  });

  it('does not emit spec-handoff for a plain approval or same-session notifications', async () => {
    type Listener = (notification: Record<string, unknown>) => void;
    const listeners: Listener[] = [];
    let sessionHandler:
      | Parameters<FactoryDroidSessionFactory>[0]['interactionHandler']
      | undefined;
    const session = Object.assign(
      createMockSession(async function* () {
        const result = await sessionHandler!.requestPermission({
          options: [
            {
              label: 'Approve',
              value: 'proceed_once',
              requiresEditedSpec: false,
            },
          ],
          toolUses: [
            {
              toolUseId: 'tool-1',
              toolName: 'ExitSpecMode',
              confirmationKind: 'exit_spec_mode',
              title: 'Ready to build',
              detail: 'The plan',
            },
          ],
        });
        expect(result.selectedOption).toBe('proceed_once');
        yield successfulResult();
      }),
      {
        onNotification: vi.fn((listener: Listener) => {
          listeners.push(listener);
          return () => {};
        }),
      },
    );
    const runtime = new FactoryDroidRuntime({
      interactionHandler: {
        requestPermission: async () => ({
          selectedOption: 'proceed_once',
        }),
        askUser: async () => ({ cancelled: true, answers: [] }),
      },
      createSdkSession: async (options) => {
        sessionHandler = options.interactionHandler;
        return session;
      },
    });
    await runtime.initialize('C:\\workspace');

    const events = await collect(runtime.sendTurn('draft a plan'));
    expect(events.some((event) => event.type === 'spec-handoff')).toBe(false);
    // No spec watch is armed without a proceed_new_session approval;
    // the single subscription is the session-lifetime subagent watch.
    expect(session.onNotification).toHaveBeenCalledTimes(1);
  });

  it('emits subagent-started before turn completion for child_session_available', async () => {
    type Listener = (notification: Record<string, unknown>) => void;
    const listeners: Listener[] = [];
    const notifyChild = (payload: Record<string, unknown>) => {
      for (const listener of [...listeners]) {
        listener({
          method: 'droid.session_notification',
          params: {
            sessionId: 'session-1',
            notification: {
              type: 'child_session_available',
              timestamp: 1,
              ...payload,
            },
          },
        });
      }
    };
    const session = Object.assign(
      createMockSession(async function* () {
        yield textDelta('delegating work');
        notifyChild({
          childSessionId: 'child-abc',
          toolUseId: 'call_task_1',
          subagentType: '  explore\u0000  agent ',
          description: 'Find\u0007 the API\n\n usage',
        });
        // Identity fields are optional in the SDK payload.
        notifyChild({ childSessionId: 'child-def' });
        yield successfulResult();
      }),
      {
        onNotification: vi.fn((listener: Listener) => {
          listeners.push(listener);
          return () => {
            const index = listeners.indexOf(listener);
            if (index !== -1) {
              listeners.splice(index, 1);
            }
          };
        }),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    const events = await collect(runtime.sendTurn('delegate this'));
    const started = events.filter((event) => event.type === 'subagent-started');
    expect(started).toEqual([
      {
        type: 'subagent-started',
        toolUseId: 'call_task_1',
        subagentType: 'explore agent',
        description: 'Find the API usage',
      },
      {
        type: 'subagent-started',
        toolUseId: null,
        subagentType: 'unknown',
        description: '',
      },
    ]);
    const completeIndex = events.findIndex((event) => event.type === 'turn-complete');
    expect(events.indexOf(started[1]!)).toBeLessThan(completeIndex);
    // The child session id never leaves the runtime.
    expect(JSON.stringify(events)).not.toContain('child-abc');
    expect(JSON.stringify(events)).not.toContain('child-def');
  });

  it('drops child_session_available outside an active turn and keeps the watch armed', async () => {
    type Listener = (notification: Record<string, unknown>) => void;
    const listeners: Listener[] = [];
    const session = Object.assign(
      createMockSession(async function* () {
        yield textDelta('quiet turn');
        yield successfulResult();
      }),
      {
        onNotification: vi.fn((listener: Listener) => {
          listeners.push(listener);
          return () => {
            const index = listeners.indexOf(listener);
            if (index !== -1) {
              listeners.splice(index, 1);
            }
          };
        }),
      },
    );
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');

    // Between turns there is no active turn to attach the event to.
    for (const listener of [...listeners]) {
      listener({
        method: 'droid.session_notification',
        params: {
          sessionId: 'session-1',
          notification: {
            type: 'child_session_available',
            timestamp: 1,
            childSessionId: 'child-xyz',
            subagentType: 'worker',
            description: 'stale',
          },
        },
      });
    }

    const events = await collect(runtime.sendTurn('plain turn'));
    expect(events.some((event) => event.type === 'subagent-started')).toBe(false);
    // The watch lives for the whole session, not one turn.
    expect(listeners).toHaveLength(1);

    await runtime.dispose();
    expect(listeners).toHaveLength(0);
  });

  it('drops late stream events and disposes an active session once', async () => {
    const lateEvent = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('before disposal');
      await lateEvent.promise;
      yield textDelta('late event');
    });
    session.interrupt.mockImplementation(async () => lateEvent.resolve());
    const runtime = createRuntime(async () => session);

    await runtime.initialize('C:\\workspace');
    const iterator = runtime.sendTurn('Keep writing')[Symbol.asyncIterator]();
    await iterator.next();

    const firstDisposal = runtime.dispose();
    const secondDisposal = runtime.dispose();

    expect(secondDisposal).toBe(firstDisposal);
    await firstDisposal;
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
    expect(session.interrupt).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
    expect(() => runtime.initialize('C:\\workspace')).toThrow(
      'Droid runtime is disposed.',
    );
  });

  it('retries a failed close without losing the owned session', async () => {
    const session = createMockSession(async function* () {});
    session.close
      .mockRejectedValueOnce(new Error('close failed'))
      .mockResolvedValueOnce();
    const createSession = vi.fn(async () => session);
    const runtime = createRuntime(createSession);
    await runtime.initialize('C:\\workspace');

    const firstDisposal = runtime.dispose();
    expect(runtime.dispose()).toBe(firstDisposal);
    await expect(firstDisposal).rejects.toThrow('close failed');
    expect(() => runtime.initialize('C:\\workspace')).toThrow(
      'Droid runtime is disposed.',
    );
    await expect(collect(runtime.sendTurn('No turn'))).rejects.toThrow(
      'Droid runtime is disposed.',
    );

    await expect(runtime.dispose()).resolves.toBeUndefined();

    expect(session.close).toHaveBeenCalledTimes(2);
    expect(createSession).toHaveBeenCalledOnce();
  });

  it('closes the owned session even when active-turn interruption fails', async () => {
    const waiting = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('active');
      await waiting.promise;
    });
    session.interrupt.mockRejectedValue(new Error('interrupt failed'));
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');
    const iterator = runtime.sendTurn('Keep writing')[Symbol.asyncIterator]();
    await iterator.next();

    await expect(runtime.dispose()).rejects.toThrow('interrupt failed');

    expect(session.interrupt).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(session.interrupt).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
    waiting.resolve();
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });

  it('reports background-turn support only for daemon-backed sessions', async () => {
    const processRuntime = createRuntime(async () =>
      createMockSession(async function* () {}),
    );
    expect(processRuntime.supportsBackgroundTurns()).toBe(false);
    await processRuntime.initialize('C:\\workspace');
    expect(processRuntime.supportsBackgroundTurns()).toBe(false);

    const daemonSession = {
      ...createMockSession(async function* () {}),
      readWorkingState: vi.fn(async () => 'working'),
    };
    const daemonRuntime = createRuntime(async () => daemonSession);
    await daemonRuntime.initialize('C:\\workspace');
    expect(daemonRuntime.supportsBackgroundTurns()).toBe(true);

    await daemonRuntime.dispose();
    expect(daemonRuntime.supportsBackgroundTurns()).toBe(false);
  });

  it('preserves a daemon turn on dispose when asked to', async () => {
    const waiting = deferred<void>();
    const session = {
      ...createMockSession(async function* () {
        yield textDelta('active');
        await waiting.promise;
      }),
      readWorkingState: vi.fn(async () => 'working'),
    };
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');
    const iterator = runtime.sendTurn('Keep going')[Symbol.asyncIterator]();
    await iterator.next();

    await runtime.dispose({ preserveBackendTurn: true });

    // The daemon keeps the detached turn alive, so disposal must not
    // interrupt it; closing the handle only detaches.
    expect(session.interrupt).not.toHaveBeenCalled();
    expect(session.close).toHaveBeenCalledOnce();
    waiting.resolve();
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });

  it('ignores preserveBackendTurn for process sessions', async () => {
    const waiting = deferred<void>();
    const session = createMockSession(async function* () {
      yield textDelta('active');
      await waiting.promise;
    });
    const runtime = createRuntime(async () => session);
    await runtime.initialize('C:\\workspace');
    const iterator = runtime.sendTurn('Keep going')[Symbol.asyncIterator]();
    await iterator.next();

    await runtime.dispose({ preserveBackendTurn: true });

    // A process session cannot continue detached; leaving the turn
    // uninterrupted would leak it, so the option must be ignored.
    expect(session.interrupt).toHaveBeenCalledOnce();
    expect(session.close).toHaveBeenCalledOnce();
    waiting.resolve();
    await expect(iterator.next()).resolves.toMatchObject({ done: true });
  });

  it('closes a session that arrives after disposal starts', async () => {
    const created = deferred<FactoryDroidSession>();
    const session = createMockSession(async function* () {});
    const runtime = createRuntime(() => created.promise);

    const initialization = runtime.initialize('C:\\workspace');
    const disposal = runtime.dispose();
    created.resolve(session);

    await expect(initialization).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'initialization-failed',
    });
    await disposal;
    expect(session.close).toHaveBeenCalledOnce();
  });

  it('surfaces close failures when disposal races initialization', async () => {
    const created = deferred<FactoryDroidSession>();
    const session = createMockSession(async function* () {});
    session.close
      .mockRejectedValueOnce(new Error('close failed'))
      .mockResolvedValueOnce();
    const runtime = createRuntime(() => created.promise);

    const initialization = runtime.initialize('C:\\workspace');
    const disposal = runtime.dispose();
    created.resolve(session);

    await expect(initialization).rejects.toThrow('close failed');
    await expect(disposal).rejects.toThrow('close failed');
    expect(session.close).toHaveBeenCalledOnce();

    await expect(runtime.dispose()).resolves.toBeUndefined();
    expect(session.close).toHaveBeenCalledTimes(2);
  });

  it('reports structured initialization failures without parsing messages', async () => {
    const invalidCwd = createRuntime(async ({ target }) => {
      throw new InvalidSessionCwdError(target.cwd, 'arbitrary SDK message');
    });
    const missingCli = createRuntime(async () => {
      throw new ConnectionError('arbitrary SDK message', {
        error: Object.assign(new Error('arbitrary system message'), {
          code: 'ENOENT',
        }),
      });
    });
    const unknownFailure = createRuntime(async () => {
      throw new Error('sensitive failure details');
    });

    await expect(invalidCwd.initialize('C:\\missing')).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'invalid-cwd',
      authenticationStatus: 'unknown',
    });
    await expect(missingCli.initialize('C:\\workspace')).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'cli-not-found',
      authenticationStatus: 'unknown',
    });
    await expect(unknownFailure.initialize('C:\\workspace')).resolves.toMatchObject({
      status: 'unavailable',
      reason: 'initialization-failed',
      message: 'The Droid SDK could not initialize a session.',
      authenticationStatus: 'unknown',
    });
  });
});

describe('createLocalDroidSession', () => {
  it('connects a cwd-scoped transport before creating the SDK session', async () => {
    const calls: string[] = [];
    const session = createMockSession(async function* () {});
    const transport = createMockTransport();
    transport.connect.mockImplementation(async () => {
      calls.push('connect');
    });
    const createSession = vi.fn(async (options) => {
      calls.push('createSession');
      expect(options).toMatchObject({
        cwd: 'C:\\workspace',
        transport: {
          send: expect.any(Function),
          onMessage: expect.any(Function),
          onError: expect.any(Function),
          close: expect.any(Function),
        },
        permissionHandler: expect.any(Function),
        askUserHandler: expect.any(Function),
      });
      expect(options.transport).not.toBe(transport);
      expect(options).not.toHaveProperty('apiKey');
      session.close.mockImplementation(options.transport.close);
      return session;
    });
    const createTransport = vi.fn(() => transport);

    const created = await createLocalDroidSession(
      {
        target: { kind: 'new', cwd: 'C:\\workspace' },
        interactionHandler: cancellingRuntimeInteractionHandler,
      },
      {
        createTransport,
        createSession,
        resumeSession: vi.fn(),
      },
    );
    expect(created.id).toBe(session.id);
    expect(created).not.toBe(session);

    expect(createTransport).toHaveBeenCalledWith({ cwd: 'C:\\workspace' });
    expect(calls).toEqual(['connect', 'createSession']);
    expect(transport.close).not.toHaveBeenCalled();
    await created.close();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it('rejects worktree targets fail-closed instead of degrading silently', async () => {
    const createTransport = vi.fn();
    const createSession = vi.fn();

    await expect(
      createLocalDroidSession(
        {
          target: { kind: 'new', cwd: 'C:\\workspace', worktree: true },
          interactionHandler: cancellingRuntimeInteractionHandler,
        },
        {
          createTransport,
          createSession,
          resumeSession: vi.fn(),
        },
      ),
    ).rejects.toThrow('Worktree sessions require the daemon runtime mode.');
    // Must not spawn a plain session in the main workspace.
    expect(createTransport).not.toHaveBeenCalled();
    expect(createSession).not.toHaveBeenCalled();
  });

  it('injects one observability bundle into transport and session', async () => {
    const session = createMockSession(async function* () {});
    const transport = createMockTransport();
    const observability: DroidObservability = {
      logger: { log: vi.fn() },
      metrics: { record: vi.fn() },
    };
    const createTransport = vi.fn(() => transport);
    const createSession = vi.fn(async () => session);

    await createLocalDroidSession(
      {
        target: { kind: 'new', cwd: 'C:\\workspace' },
        interactionHandler: cancellingRuntimeInteractionHandler,
        observability,
      },
      {
        createTransport,
        createSession,
        resumeSession: vi.fn(),
      },
    );

    expect(createTransport).toHaveBeenCalledWith({
      cwd: 'C:\\workspace',
      observability,
    });
    expect(createSession).toHaveBeenCalledWith(
      expect.objectContaining({ observability }),
    );
  });

  it('wires the runtime interaction handler into SDK session callbacks', async () => {
    const session = createMockSession(async function* () {});
    const transport = createMockTransport();
    let permissionHandler: ClientPermissionHandler | undefined;
    let askUserHandler: ClientAskUserHandler | undefined;
    const interactionHandler = {
      requestPermission: vi.fn(async () => ({
        selectedOption: ToolConfirmationOutcome.ProceedOnce,
      })),
      askUser: vi.fn(async () => ({
        answers: [{ index: 4, answer: 'TypeScript' }],
      })),
    };

    await createLocalDroidSession(
      {
        target: { kind: 'new', cwd: 'C:\\workspace' },
        interactionHandler,
      },
      {
        createTransport: () => transport,
        createSession: async (options) => {
          permissionHandler = options.permissionHandler;
          askUserHandler = options.askUserHandler;
          return session;
        },
        resumeSession: vi.fn(),
      },
    );

    await expect(
      permissionHandler?.({
        options: [
          {
            label: 'Allow once',
            value: ToolConfirmationOutcome.ProceedOnce,
          },
        ],
        toolUses: [
          {
            toolUse: {
              type: 'tool_use' as never,
              id: 'tool-1',
              name: 'Create',
              input: { secret: 'must not escape' },
            },
            confirmationType: ToolConfirmationType.Create,
            details: {
              type: ToolConfirmationType.Create,
              filePath: 'C:\\workspace\\file.ts',
              fileName: 'file.ts',
              content: 'content',
            },
          },
        ],
      }),
    ).resolves.toBe(ToolConfirmationOutcome.ProceedOnce);
    await expect(
      askUserHandler?.({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 4,
            topic: 'Language',
            question: 'Which language?',
            options: ['TypeScript'],
          },
        ],
      }),
    ).resolves.toEqual({
      answers: [
        {
          index: 4,
          question: 'Which language?',
          answer: 'TypeScript',
        },
      ],
    });
    expect(interactionHandler.requestPermission).toHaveBeenCalledOnce();
    expect(interactionHandler.askUser).toHaveBeenCalledOnce();
  });

  it('resumes through the connected cwd transport without passing cwd to the SDK', async () => {
    const calls: string[] = [];
    const session = createMockSession(async function* () {});
    const transport = createMockTransport();
    transport.connect.mockImplementation(async () => {
      calls.push('connect');
    });
    const createSession = vi.fn();
    let permissionHandler: ClientPermissionHandler | undefined;
    let askUserHandler: ClientAskUserHandler | undefined;
    const interactionHandler = {
      requestPermission: vi.fn(async () => ({
        selectedOption: ToolConfirmationOutcome.ProceedOnce,
      })),
      askUser: vi.fn(async () => ({
        answers: [{ index: 4, answer: 'TypeScript' }],
      })),
    };
    const resumeSession = vi.fn(async (sessionId, options) => {
      calls.push('resumeSession');
      expect(sessionId).toBe('saved-session');
      expect(options).toMatchObject({
        transport: {
          send: expect.any(Function),
          onMessage: expect.any(Function),
          onError: expect.any(Function),
          close: expect.any(Function),
        },
        permissionHandler: expect.any(Function),
        askUserHandler: expect.any(Function),
      });
      expect(options.transport).not.toBe(transport);
      expect(options).not.toHaveProperty('cwd');
      permissionHandler = options.permissionHandler;
      askUserHandler = options.askUserHandler;
      session.close.mockImplementation(options.transport.close);
      return session;
    });
    const createTransport = vi.fn(() => transport);

    const resumed = await createLocalDroidSession(
      {
        target: {
          kind: 'resume',
          cwd: 'C:\\workspace',
          sessionId: 'saved-session',
        },
        interactionHandler,
      },
      { createTransport, createSession, resumeSession },
    );
    expect(resumed.id).toBe(session.id);
    expect(resumed).not.toBe(session);

    expect(createTransport).toHaveBeenCalledWith({ cwd: 'C:\\workspace' });
    expect(createSession).not.toHaveBeenCalled();
    expect(calls).toEqual(['connect', 'resumeSession']);
    expect(transport.close).not.toHaveBeenCalled();
    await resumed.close();
    expect(transport.close).toHaveBeenCalledOnce();

    await expect(
      permissionHandler?.({
        options: [
          {
            label: 'Allow once',
            value: ToolConfirmationOutcome.ProceedOnce,
          },
        ],
        toolUses: [
          {
            toolUse: {
              type: 'tool_use' as never,
              id: 'tool-1',
              name: 'Create',
              input: { secret: 'must not escape' },
            },
            confirmationType: ToolConfirmationType.Create,
            details: {
              type: ToolConfirmationType.Create,
              filePath: 'C:\\workspace\\file.ts',
              fileName: 'file.ts',
              content: 'content',
            },
          },
        ],
      }),
    ).resolves.toBe(ToolConfirmationOutcome.ProceedOnce);
    await expect(
      askUserHandler?.({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 4,
            topic: 'Language',
            question: 'Which language?',
            options: ['TypeScript'],
          },
        ],
      }),
    ).resolves.toEqual({
      answers: [
        {
          index: 4,
          question: 'Which language?',
          answer: 'TypeScript',
        },
      ],
    });
    expect(interactionHandler.requestPermission).toHaveBeenCalledOnce();
    expect(interactionHandler.askUser).toHaveBeenCalledOnce();
  });

  it('closes the transport when connecting fails', async () => {
    const transport = createMockTransport();
    const failure = new ConnectionError('arbitrary SDK message');
    transport.connect.mockRejectedValue(failure);
    transport.close.mockRejectedValue(new Error('arbitrary cleanup failure'));
    const createSession = vi.fn();

    await expect(
      createLocalDroidSession(
        {
          target: { kind: 'new', cwd: 'C:\\workspace' },
          interactionHandler: cancellingRuntimeInteractionHandler,
        },
        {
          createTransport: () => transport,
          createSession,
          resumeSession: vi.fn(),
        },
      ),
    ).rejects.toBe(failure);

    expect(createSession).not.toHaveBeenCalled();
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it.each([
    ['create', 'factory', false],
    ['create', 'SDK', true],
    ['resume', 'factory', false],
    ['resume', 'SDK', true],
  ] as const)(
    'closes failed provisional transport once after %s (%s cleanup)',
    async (operation, _cleanupOwner, sdkCloses) => {
      const target =
        operation === 'resume'
          ? {
              kind: 'resume' as const,
              cwd: 'C:\\workspace',
              sessionId: 'saved-session',
            }
          : { kind: 'new' as const, cwd: 'C:\\workspace' };
      const transport = createMockTransport();
      const failure = new ConnectionError('arbitrary SDK message');
      const cleanupFailure = new Error('arbitrary cleanup failure');
      transport.close.mockRejectedValue(cleanupFailure);
      let sdkTransport: { close(): Promise<void> } | undefined;
      const failAfterSdkCleanup = async (capturedTransport: {
        close(): Promise<void>;
      }) => {
        sdkTransport = capturedTransport;
        if (sdkCloses) {
          await capturedTransport.close().catch(() => undefined);
        }
        throw failure;
      };
      const createSession = vi.fn(async ({ transport: capturedTransport }) =>
        failAfterSdkCleanup(capturedTransport),
      );
      const resumeSession = vi.fn(async (_sessionId, { transport: capturedTransport }) =>
        failAfterSdkCleanup(capturedTransport),
      );
      await expect(
        createLocalDroidSession(
          { target, interactionHandler: cancellingRuntimeInteractionHandler },
          { createTransport: () => transport, createSession, resumeSession },
        ),
      ).rejects.toBe(failure);
      expect(transport.close).toHaveBeenCalledOnce();
      await expect(sdkTransport!.close()).rejects.toBe(cleanupFailure);
      expect(transport.close).toHaveBeenCalledOnce();
      expect(createSession).toHaveBeenCalledTimes(operation === 'create' ? 1 : 0);
      expect(resumeSession).toHaveBeenCalledTimes(operation === 'resume' ? 1 : 0);
      if (operation === 'resume') {
        expect(resumeSession).toHaveBeenCalledWith(
          'saved-session',
          expect.objectContaining({ transport: expect.any(Object) }),
        );
      }
    },
  );
});

function createRuntime(createSdkSession: FactoryDroidSessionFactory) {
  return new FactoryDroidRuntime({
    interactionHandler: cancellingRuntimeInteractionHandler,
    createSdkSession,
  });
}

function createMockSession(
  streamImplementation: (
    prompt: string,
    options: { includePartialMessages: true },
  ) => AsyncGenerator<DroidStreamEvent>,
) {
  return {
    id: 'session-1',
    availableModels: undefined as readonly AvailableModelConfig[] | undefined,
    settings: {
      modelId: 'model-1',
      reasoningEffort: ReasoningEffort.High,
      interactionMode: DroidInteractionMode.Auto,
      autonomyLevel: AutonomyLevel.Medium,
    } as SessionSettings,
    stream: vi.fn(streamImplementation),
    interrupt: vi.fn(async () => {}),
    updateSettings: vi.fn<FactoryDroidSession['updateSettings']>(async () => ({})),
    getContextStats: vi.fn<FactoryDroidSession['getContextStats']>(async () => ({
      used: 40,
      remaining: 60,
      limit: 100,
      accuracy: ContextStatsAccuracy.Exact,
      updatedAt: new Date().toISOString(),
    })),
    readContextBreakdown: vi.fn<NonNullable<FactoryDroidSession['readContextBreakdown']>>(
      async () => ({
        used: 40,
        remaining: 11060,
        limit: 11100,
        lastCallCompactionTokens: 11040,
      }),
    ),
    close: vi.fn(async () => {}),
  };
}

function availableModel(
  id: string,
  displayName: string,
  supportedReasoningEfforts: readonly ReasoningEffort[],
): AvailableModelConfig {
  return {
    id,
    displayName,
    shortDisplayName: displayName,
    modelProvider: ModelProvider.FACTORY,
    supportedReasoningEfforts: [...supportedReasoningEfforts],
    defaultReasoningEffort: supportedReasoningEfforts[0] ?? ReasoningEffort.Medium,
    isCustom: id.startsWith('custom:'),
  };
}

function createMockTransport() {
  return {
    isConnected: false,
    connect: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
    onMessage: vi.fn(),
    onError: vi.fn(),
    close: vi.fn(async () => {}),
  };
}

function textDelta(text: string): DroidStreamEvent {
  return {
    type: 'assistant_text_delta',
    messageId: 'message-1',
    blockIndex: 0,
    text,
  };
}

function toolCall(toolUseId: string, name: string): DroidStreamEvent {
  return {
    type: 'tool_call',
    name,
    toolUseId,
    input: {},
  };
}

function toolResult(toolUseId: string, toolName: string): DroidStreamEvent {
  return {
    type: 'tool_result',
    toolUseId,
    toolName,
    content: '',
    isError: false,
  };
}

function successfulResult(): Extract<
  DroidStreamEvent,
  { type: 'result'; subtype: 'success' }
> {
  return {
    type: 'result',
    subtype: 'success',
    sessionId: 'session-1',
    durationMs: 10,
    tokenUsage: null,
    messages: [],
    text: '',
    turnCount: 1,
    success: true,
    interrupted: false,
    error: null,
  };
}

function interruptedResult(): Extract<
  DroidStreamEvent,
  { type: 'result'; subtype: 'interrupted' }
> {
  return {
    type: 'result',
    subtype: 'interrupted',
    sessionId: 'session-1',
    durationMs: 10,
    tokenUsage: null,
    messages: [],
    text: '',
    turnCount: 1,
    success: false,
    interrupted: true,
    error: null,
  };
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) {
    result.push(value);
  }
  return result;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}
