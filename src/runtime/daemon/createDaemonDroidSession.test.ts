import {
  AutonomyLevel,
  DroidInteractionMode,
  ModelProvider,
  ReasoningEffort,
  ToolConfirmationOutcome,
  ToolConfirmationType,
  type ConnectedDroid,
  type DroidStreamEvent,
  type SessionSettings,
} from '@factory/droid-sdk';
import type {
  ClientAskUserHandler,
  ClientPermissionHandler,
} from '@factory/droid-sdk/node';
import { describe, expect, it, vi } from 'vitest';

import { FactoryDroidRuntime } from '../FactoryDroidRuntime';
import { cancellingRuntimeInteractionHandler } from '../runtimeInteractions';
import {
  createDaemonDroidSession,
  createDaemonSessionFactory,
} from './createDaemonDroidSession';

describe('createDaemonDroidSession', () => {
  it('creates a cwd-scoped daemon session with interaction handlers', async () => {
    const mock = createDroidMock();

    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
    });

    expect(mock.sessions.create).toHaveBeenCalledExactlyOnceWith({
      cwd: 'C:\\workspace',
      permissionHandler: expect.any(Function),
      askUserHandler: expect.any(Function),
    });
    expect(mock.sessions.resume).not.toHaveBeenCalled();
    expect(session.id).toBe('session-1');
    expect(session.settings).toEqual(mock.created.settings);
    // Remaining fail-closed daemon divergence: no session
    // notification channel for browser MCP auth.
    expect(session.onNotification).toBeUndefined();
    expect(session.authenticateMcpServer).toBeUndefined();
  });

  it('exposes the defaults model catalog, dropping disabled rows', async () => {
    const mock = createDroidMock();

    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
    });

    expect(mock.settings.getDefaults).toHaveBeenCalledOnce();
    expect(session.availableModels?.map(({ id }) => id)).toEqual([
      'model-1',
      'custom:Probe-0',
    ]);
  });

  it('leaves the catalog undefined when defaults omit it or fail', async () => {
    const withoutModels = createDroidMock();
    withoutModels.settings.getDefaults.mockResolvedValue({});
    const missing = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => withoutModels.droid,
    });
    expect(missing.availableModels).toBeUndefined();

    // A defaults read failure degrades the catalog only; the session
    // itself is still created.
    const failing = createDroidMock();
    failing.settings.getDefaults.mockRejectedValue(
      new Error('defaults unavailable'),
    );
    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => failing.droid,
    });
    expect(session.id).toBe('session-1');
    expect(session.availableModels).toBeUndefined();
  });

  it('serves the BYOK model catalog through the runtime', async () => {
    const mock = createDroidMock();
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: createDaemonSessionFactory(
        async () => mock.droid,
      ),
    });
    await runtime.initialize('C:\\workspace');

    // Only rows the SDK marks isCustom surface in the picker; the
    // built-in row gates reasoning-effort validation host-side.
    await expect(runtime.readModelCatalog()).resolves.toEqual({
      status: 'available',
      items: [
        {
          id: 'custom:Probe-0',
          displayName: 'Probe Model',
          supportedReasoningEfforts: ['off', 'high'],
        },
      ],
    });
  });

  it('keeps the catalog on replacement sessions without re-reading defaults', async () => {
    const mock = createDroidMock();
    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
    });

    const replaced = await session.compact?.({});

    expect(mock.settings.getDefaults).toHaveBeenCalledOnce();
    expect(
      replaced?.session.availableModels?.map(({ id }) => id),
    ).toEqual(['model-1', 'custom:Probe-0']);
  });

  it('passes worktree: true to daemon create only when the target asks for it', async () => {
    const mock = createDroidMock();

    await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace', worktree: true },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
    });

    expect(mock.sessions.create).toHaveBeenCalledExactlyOnceWith({
      cwd: 'C:\\workspace',
      worktree: true,
      permissionHandler: expect.any(Function),
      askUserHandler: expect.any(Function),
    });
  });

  it('exposes the actual session cwd the daemon reports (worktree path)', async () => {
    const mock = createDroidMock();
    // The daemon runs worktree sessions in the worktree directory, not
    // the requested cwd; the adapter must surface that actual cwd so
    // the host can bind worktree metadata to it.
    (mock.created as { cwd: string }).cwd =
      'C:\\workspace-wt-main-wt';

    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace', worktree: true },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
    });

    expect(session.cwd).toBe('C:\\workspace-wt-main-wt');
  });

  it('resumes an existing session id without passing cwd', async () => {
    const mock = createDroidMock();

    const session = await createDaemonDroidSession({
      target: {
        kind: 'resume',
        cwd: 'C:\\workspace',
        sessionId: 'saved-session',
      },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
    });

    expect(mock.sessions.resume).toHaveBeenCalledExactlyOnceWith(
      'saved-session',
      {
        permissionHandler: expect.any(Function),
        askUserHandler: expect.any(Function),
      },
    );
    expect(mock.sessions.create).not.toHaveBeenCalled();
    expect(session.id).toBe('saved-session');
  });

  it('wires the runtime interaction handler into daemon callbacks', async () => {
    const mock = createDroidMock();
    const interactionHandler = {
      requestPermission: vi.fn(async () => ({
        selectedOption: ToolConfirmationOutcome.ProceedOnce,
      })),
      askUser: vi.fn(async () => ({
        answers: [{ index: 4, answer: 'TypeScript' }],
      })),
    };

    await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler,
      getDroid: async () => mock.droid,
    });

    const [options] = mock.sessions.create.mock.calls[0] ?? [];
    await expect(
      options?.permissionHandler?.({
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
      options?.askUserHandler?.({
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
        { index: 4, question: 'Which language?', answer: 'TypeScript' },
      ],
    });
    expect(interactionHandler.requestPermission).toHaveBeenCalledOnce();
    expect(interactionHandler.askUser).toHaveBeenCalledOnce();
  });

  it('streams a turn through FactoryDroidRuntime under the daemon factory', async () => {
    const mock = createDroidMock(async function* () {
      yield textDelta('hello');
      yield successfulResult('session-1');
    });
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: createDaemonSessionFactory(
        async () => mock.droid,
      ),
    });

    const availability = await runtime.initialize('C:\\workspace');
    const events = await collect(runtime.sendTurn('Say hello'));

    expect(availability).toMatchObject({
      status: 'available',
      sessionId: 'session-1',
    });
    expect(mock.created.stream).toHaveBeenCalledWith('Say hello', {
      includePartialMessages: true,
    });
    expect(events).toEqual([
      { type: 'text-delta', text: 'hello' },
      { type: 'turn-complete', outcome: 'success' },
    ]);
  });

  it('delegates capability methods to daemon resources with the session id', async () => {
    const mock = createDroidMock();
    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
    });

    await expect(session.listSkills?.()).resolves.toEqual({
      skills: [],
    });
    expect(mock.skills.list).toHaveBeenCalledWith('session-1');

    await session.setSkillDisabled?.({
      skillName: 'review',
      disabled: true,
    });
    expect(mock.skills.setDisabled).toHaveBeenCalledWith({
      sessionId: 'session-1',
      skillName: 'review',
      disabled: true,
    });

    await session.listMcpServers?.();
    expect(mock.mcp.listServers).toHaveBeenCalledWith('session-1');
    await session.listMcpTools?.();
    expect(mock.mcp.listTools).toHaveBeenCalledWith('session-1');

    await session.toggleMcpServer?.({
      serverName: 'docs',
      enabled: false,
      settingsLevel: 'user',
    });
    expect(mock.mcp.toggleServer).toHaveBeenCalledWith({
      sessionId: 'session-1',
      serverName: 'docs',
      enabled: false,
      settingsLevel: 'user',
    });

    await session.addMcpServer?.({
      name: 'local-tools',
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
    });
    expect(mock.mcp.addServer).toHaveBeenCalledWith({
      sessionId: 'session-1',
      name: 'local-tools',
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
    });

    await session.removeMcpServer?.({
      serverName: 'docs',
      settingsLevel: 'user',
    });
    expect(mock.mcp.removeServer).toHaveBeenCalledWith({
      sessionId: 'session-1',
      serverName: 'docs',
      settingsLevel: 'user',
    });
  });

  it('uses daemon last-call tokens instead of cumulative breakdown totals', async () => {
    const mock = createDroidMock();
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: createDaemonSessionFactory(
        async () => mock.droid,
      ),
    });
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readContextWindow()).resolves.toEqual({
      availability: 'available',
      used: 25000,
      remaining: 75000,
      limit: 100000,
    });
    expect(mock.sessions.getContextBreakdown).toHaveBeenCalledWith(
      'session-1',
    );
  });

  it('fails closed when daemon last-call usage is missing', async () => {
    const mock = createDroidMock();
    mock.sessions.getContextBreakdown.mockResolvedValueOnce({
      modelId: 'model-1',
      modelDisplayName: 'Model 1',
      contextBudget: 100000,
      lastCallCompactionTokens: undefined,
      usedTokens: 40000.4,
      freeTokens: 59999.6,
      categories: [],
      skills: [],
      mcpServers: [],
      droids: [],
    });
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: createDaemonSessionFactory(
        async () => mock.droid,
      ),
    });
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readContextWindow()).resolves.toEqual({
      availability: 'unavailable',
      reason: 'no-last-call',
    });
  });

  it('overlays confirmed settings updates until the snapshot catches up', async () => {
    const mock = createDroidMock();
    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
    });

    await session.updateSettings({ modelId: 'model-2' });

    expect(mock.sessions.updateSettings).toHaveBeenCalledWith(
      'session-1',
      { modelId: 'model-2' },
    );
    // The daemon handle's snapshot has not seen the notification yet.
    expect(mock.created.settings.modelId).toBe('model-1');
    expect(session.settings.modelId).toBe('model-2');

    // Once the notification lands, the overlay retires and later
    // external changes show through again.
    mock.created.settings = {
      ...mock.created.settings,
      modelId: 'model-2',
    };
    expect(session.settings.modelId).toBe('model-2');
    mock.created.settings = {
      ...mock.created.settings,
      modelId: 'model-3',
    };
    expect(session.settings.modelId).toBe('model-3');
  });

  it('compacts into a resumed replacement session and detaches the source', async () => {
    const mock = createDroidMock();
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: createDaemonSessionFactory(
        async () => mock.droid,
      ),
    });
    await runtime.initialize('C:\\workspace');

    await expect(runtime.compact()).resolves.toEqual({
      sessionId: 'session-2',
      removedCount: 5,
    });
    expect(mock.created.compact).toHaveBeenCalledWith(undefined);
    expect(mock.sessions.resume).toHaveBeenCalledWith('session-2', {
      permissionHandler: expect.any(Function),
      askUserHandler: expect.any(Function),
    });
    expect(mock.created.detach).toHaveBeenCalledOnce();
  });

  it('rewinds to the returned new session id through the runtime', async () => {
    const mock = createDroidMock();
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: createDaemonSessionFactory(
        async () => mock.droid,
      ),
    });
    await runtime.initialize('C:\\workspace');

    await expect(
      runtime.rewind({
        messageId: 'message-9',
        forkTitle: 'Rewound',
      }),
    ).resolves.toEqual({ sessionId: 'session-2' });
    expect(mock.created.rewind).toHaveBeenCalledWith({
      messageId: 'message-9',
      filesToRestore: [],
      filesToDelete: [],
      forkTitle: 'Rewound',
    });
    expect(mock.created.detach).toHaveBeenCalledOnce();
  });

  it('forks and keeps the source handle when the replacement resume fails', async () => {
    const mock = createDroidMock();
    mock.sessions.resume.mockRejectedValue(
      new Error('arbitrary resume failure'),
    );
    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
    });

    await expect(session.fork?.({ title: 'Branch' })).rejects.toThrow(
      'arbitrary resume failure',
    );
    expect(mock.created.fork).toHaveBeenCalledWith({ title: 'Branch' });
    expect(mock.created.detach).not.toHaveBeenCalled();
  });

  it('refuses to resume a session leased to another live window', async () => {
    const mock = createDroidMock();

    // The blocked acquire retries for LEASE_RETRY_MAX_MS before it
    // gives up (reload-lingering holders usually die within that).
    vi.useFakeTimers();
    try {
      const pending = createDaemonDroidSession({
        target: {
          kind: 'resume',
          cwd: 'C:\\workspace',
          sessionId: 'saved-session',
        },
        interactionHandler: cancellingRuntimeInteractionHandler,
        getDroid: async () => mock.droid,
        lease: {
          acquire: () => ({ acquired: false, heldByPid: 4242 }),
          release: vi.fn(),
        },
      });
      const assertion = expect(pending).rejects.toThrow(
        'open in another window (pid 4242)',
      );
      await vi.advanceTimersByTimeAsync(15_600);
      await assertion;
      expect(mock.sessions.resume).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('resumes after a lingering holder frees the lease mid-retry', async () => {
    const mock = createDroidMock();
    // First two acquires hit the dying previous extension host; the
    // third preempts (holder exited). The resume then proceeds.
    let attempts = 0;
    const lease = {
      acquire: vi.fn(() => {
        attempts += 1;
        return attempts < 3
          ? ({ acquired: false, heldByPid: 4242 } as const)
          : ({ acquired: true } as const);
      }),
      release: vi.fn(),
    };

    vi.useFakeTimers();
    try {
      const pending = createDaemonDroidSession({
        target: {
          kind: 'resume',
          cwd: 'C:\\workspace',
          sessionId: 'saved-session',
        },
        interactionHandler: cancellingRuntimeInteractionHandler,
        getDroid: async () => mock.droid,
        lease,
      });
      await vi.advanceTimersByTimeAsync(1_100);
      await pending;
      expect(lease.acquire).toHaveBeenCalledTimes(3);
      expect(mock.sessions.resume).toHaveBeenCalledWith(
        'saved-session',
        expect.anything(),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases the lease when the leased resume fails', async () => {
    const mock = createDroidMock();
    mock.sessions.resume.mockRejectedValue(new Error('resume failed'));
    const lease = {
      acquire: vi.fn(() => ({ acquired: true }) as const),
      release: vi.fn(),
    };

    await expect(
      createDaemonDroidSession({
        target: {
          kind: 'resume',
          cwd: 'C:\\workspace',
          sessionId: 'saved-session',
        },
        interactionHandler: cancellingRuntimeInteractionHandler,
        getDroid: async () => mock.droid,
        lease,
      }),
    ).rejects.toThrow('resume failed');
    expect(lease.acquire).toHaveBeenCalledWith('saved-session');
    expect(lease.release).toHaveBeenCalledWith('saved-session');
  });

  it('detaches a new session when its ownership cannot be secured', async () => {
    const mock = createDroidMock();
    const lease = {
      acquire: vi.fn(() => ({ acquired: false, heldByPid: 4242 }) as const),
      release: vi.fn(),
    };

    await expect(
      createDaemonDroidSession({
        target: { kind: 'new', cwd: 'C:\\workspace' },
        interactionHandler: cancellingRuntimeInteractionHandler,
        getDroid: async () => mock.droid,
        lease,
      }),
    ).rejects.toThrow('open in another window (pid 4242)');
    expect(mock.created.detach).toHaveBeenCalledOnce();
    expect(mock.sessions.resume).not.toHaveBeenCalled();
  });

  it('moves the lease from the source to the replacement on compact', async () => {
    const mock = createDroidMock();
    const lease = {
      acquire: vi.fn((_id: string) => ({ acquired: true }) as const),
      release: vi.fn(),
    };
    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
      lease,
    });

    await session.compact?.({});

    expect(lease.acquire.mock.calls.map(([id]) => id)).toEqual([
      'session-1',
      'session-2',
    ]);
    expect(lease.release).toHaveBeenCalledExactlyOnceWith('session-1');
  });

  it('keeps the source attached when replacement ownership cannot be secured', async () => {
    const mock = createDroidMock();
    const lease = {
      acquire: vi
        .fn()
        .mockReturnValueOnce({ acquired: true })
        .mockReturnValueOnce({ acquired: false, heldByPid: 4242 }),
      release: vi.fn(),
    };
    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
      lease,
    });

    await expect(session.compact?.({})).rejects.toThrow(
      'open in another window (pid 4242)',
    );
    expect(mock.sessions.resume).not.toHaveBeenCalled();
    expect(mock.created.detach).not.toHaveBeenCalled();
    expect(lease.release).not.toHaveBeenCalled();
  });

  it('releases the lease on close', async () => {
    const mock = createDroidMock();
    const lease = {
      acquire: vi.fn(() => ({ acquired: true }) as const),
      release: vi.fn(),
    };
    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
      lease,
    });

    await session.close();

    expect(mock.created.detach).toHaveBeenCalledOnce();
    expect(lease.release).toHaveBeenCalledExactlyOnceWith('session-1');
  });

  it('reads the working state from the daemon opened-session registry', async () => {
    const mock = createDroidMock();
    mock.sessions.listOpened.mockResolvedValue([
      { id: 'other-session', workingState: 'idle' },
      { id: 'session-1', workingState: 'waiting_for_tool_confirmation' },
    ]);
    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
    });

    await expect(session.readWorkingState?.()).resolves.toBe(
      'waiting_for_tool_confirmation',
    );

    // A session the daemon no longer lists as open has no state.
    mock.sessions.listOpened.mockResolvedValue([
      { id: 'other-session', workingState: 'idle' },
    ]);
    await expect(session.readWorkingState?.()).resolves.toBeNull();
  });

  it('projects the daemon working state through the runtime', async () => {
    const mock = createDroidMock();
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: createDaemonSessionFactory(
        async () => mock.droid,
      ),
    });
    await runtime.initialize('C:\\workspace');

    const expectProjection = async (
      workingState: string,
      projected: string,
    ) => {
      mock.sessions.listOpened.mockResolvedValue([
        { id: 'session-1', workingState },
      ]);
      await expect(runtime.readSessionWorkingState()).resolves.toBe(
        projected,
      );
    };
    await expectProjection('idle', 'idle');
    await expectProjection(
      'waiting_for_tool_confirmation',
      'waiting-for-user',
    );
    await expectProjection('thinking', 'running');
    await expectProjection('streaming_assistant_message', 'running');
    await expectProjection('executing_tool', 'running');
    await expectProjection('compacting_conversation', 'running');
    // Unrecognized states and unlisted sessions both fail closed to
    // `unknown` instead of reading as idle.
    await expectProjection('some_future_state', 'unknown');
    mock.sessions.listOpened.mockResolvedValue([]);
    await expect(runtime.readSessionWorkingState()).resolves.toBe(
      'unknown',
    );
  });

  it('interruptSession interrupts the daemon turn without a local turn', async () => {
    const mock = createDroidMock();
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: createDaemonSessionFactory(
        async () => mock.droid,
      ),
    });
    await runtime.initialize('C:\\workspace');

    // `interrupt()` requires a locally streaming turn; a reloaded
    // window observing a daemon-side turn has none.
    await runtime.interrupt();
    expect(mock.created.interrupt).not.toHaveBeenCalled();

    await runtime.interruptSession();
    expect(mock.created.interrupt).toHaveBeenCalledOnce();
  });

  it('close detaches the handle so the session survives in the daemon', async () => {
    const mock = createDroidMock();
    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
    });

    await session.close();

    expect(mock.created.detach).toHaveBeenCalledOnce();
    expect(mock.created.close).not.toHaveBeenCalled();
  });
});

function createDaemonSessionMock(
  id: string,
  streamImplementation: () => AsyncGenerator<DroidStreamEvent> = async function* () {},
) {
  return {
    id,
    settings: {
      modelId: 'model-1',
      reasoningEffort: ReasoningEffort.High,
      interactionMode: DroidInteractionMode.Auto,
      autonomyLevel: AutonomyLevel.Medium,
    } as SessionSettings,
    cwd: 'C:\\workspace',
    stream: vi.fn(streamImplementation),
    interrupt: vi.fn(async () => {}),
    rename: vi.fn(async () => {}),
    compact: vi.fn(async () => ({
      newSessionId: 'session-2',
      removedCount: 5,
    })),
    fork: vi.fn(async () => ({ newSessionId: 'session-2' })),
    rewind: vi.fn(async () => ({
      newSessionId: 'session-2',
      restoredCount: 0,
      deletedCount: 0,
      failedRestoreCount: 0,
      failedDeleteCount: 0,
    })),
    detach: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function createDroidMock(
  streamImplementation?: () => AsyncGenerator<DroidStreamEvent>,
) {
  const created = createDaemonSessionMock(
    'session-1',
    streamImplementation,
  );
  const sessions = {
    create: vi.fn(
      async (_options: {
        cwd: string;
        permissionHandler?: ClientPermissionHandler;
        askUserHandler?: ClientAskUserHandler;
      }) => created,
    ),
    resume: vi.fn(async (sessionId: string) =>
      createDaemonSessionMock(sessionId),
    ),
    listOpened: vi.fn(
      async (): Promise<{ id: string; workingState: string }[]> => [],
    ),
    updateSettings: vi.fn(async () => ({})),
    getContextBreakdown: vi.fn(async () => ({
      modelId: 'model-1',
      modelDisplayName: 'Model 1',
      contextBudget: 100000,
      lastCallCompactionTokens: 25000 as number | undefined,
      usedTokens: 40000.4,
      freeTokens: 59999.6,
      categories: [],
      skills: [],
      mcpServers: [],
      droids: [],
    })),
    getRewindInfo: vi.fn(async () => ({
      availableFiles: [],
      createdFiles: [],
      evictedFiles: [],
    })),
  };
  const skills = {
    list: vi.fn(async () => ({ skills: [] })),
    setDisabled: vi.fn(async () => ({ success: true })),
  };
  const mcp = {
    listServers: vi.fn(async () => ({ servers: [] })),
    listTools: vi.fn(async () => []),
    toggleServer: vi.fn(async () => ({ success: true })),
    addServer: vi.fn(async () => ({ success: true })),
    removeServer: vi.fn(async () => ({ success: true })),
  };
  const settings = {
    getDefaults: vi.fn(
      async (): Promise<{ availableModels?: unknown[] }> => ({
        availableModels: [
          catalogModel({
            id: 'model-1',
            displayName: 'Model 1',
            isCustom: false,
          }),
          catalogModel({
            id: 'custom:Probe-0',
            displayName: 'Probe Model',
            isCustom: true,
          }),
          catalogModel({
            id: 'model-gone',
            displayName: 'Retired Model',
            isCustom: false,
            disabled: true,
            disabledReason: 'no longer offered',
          }),
        ],
      }),
    ),
  };
  return {
    created,
    sessions,
    skills,
    mcp,
    settings,
    droid: {
      sessions,
      skills,
      mcp,
      settings,
    } as unknown as ConnectedDroid,
  };
}

function catalogModel(overrides: {
  id: string;
  displayName: string;
  isCustom: boolean;
  disabled?: boolean;
  disabledReason?: string;
}) {
  return {
    shortDisplayName: overrides.displayName,
    modelProvider: ModelProvider.ANTHROPIC,
    supportedReasoningEfforts: [
      ReasoningEffort.Off,
      ReasoningEffort.High,
    ],
    defaultReasoningEffort: ReasoningEffort.High,
    ...overrides,
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

function successfulResult(sessionId: string): DroidStreamEvent {
  return {
    type: 'result',
    subtype: 'success',
    sessionId,
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

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) {
    result.push(value);
  }
  return result;
}
