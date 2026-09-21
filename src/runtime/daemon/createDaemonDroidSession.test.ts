import type { DaemonApi } from './api';
import {
  AutonomyLevel,
  DroidInteractionMode,
  ModelProvider,
  ReasoningEffort,
  ToolConfirmationOutcome,
  ToolConfirmationType,
  type DroidStreamEvent,
  type SessionSettings,
} from '@factory/droid-sdk';
import type {
  ClientAskUserHandler,
  ClientPermissionHandler,
} from '@factory/droid-sdk/node';
import { describe, expect, it, vi } from 'vitest';

import { FactoryDroidRuntime } from '../FactoryDroidRuntime';
import { cancellingRuntimeInteractionHandler } from '../events/runtimeInteractions';
import {
  createDaemonDroidSession,
  createDaemonSessionFactory,
} from './createDaemonDroidSession';

describe('createDaemonDroidSession', () => {
  it.each(['new', 'resume'] as const)('starts the %s worker and model catalog concurrently', async (kind) => {
    const mock = createDroidMock();
    let finishCatalog!: (value: Awaited<ReturnType<typeof mock.settings.getDefaults>>) => void;
    let finishWorker!: (value: typeof mock.created) => void;
    mock.settings.getDefaults.mockImplementation(() => new Promise(resolve => { finishCatalog = resolve; }));
    const worker = new Promise<typeof mock.created>(resolve => { finishWorker = resolve; });
    if (kind === 'new') mock.sessions.create.mockImplementation(() => worker);
    else mock.sessions.resume.mockImplementation(() => worker);
    let settled = false;
    const pending = createDaemonDroidSession({
      target: kind === 'new' ? { kind, cwd: 'C:/workspace' } : { kind, cwd: 'C:/workspace', sessionId: 'session-1' },
      interactionHandler: cancellingRuntimeInteractionHandler, getDroid: async () => mock.droid,
    }).then(value => { settled = true; return value; });
    await vi.waitFor(() => expect(mock.sessions[kind === 'new' ? 'create' : 'resume']).toHaveBeenCalledOnce());
    expect(mock.settings.getDefaults).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    finishCatalog({});
    await Promise.resolve();
    expect(settled).toBe(false);
    finishWorker(mock.created);
    expect((await pending).id).toBe('session-1');
  });

  it('preserves a worker startup failure when the concurrent catalog also fails', async () => {
    const mock = createDroidMock();
    mock.settings.getDefaults.mockRejectedValue(new Error('catalog unavailable'));
    mock.sessions.resume.mockRejectedValue(new Error('worker failed'));
    await expect(createDaemonDroidSession({
      target: { kind: 'resume', cwd: 'C:/workspace', sessionId: 'session-1' },
      interactionHandler: cancellingRuntimeInteractionHandler, getDroid: async () => mock.droid,
    })).rejects.toThrow('worker failed');
    expect(mock.settings.getDefaults).toHaveBeenCalledOnce();
  });
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
    expect(session.onNotification).toBeTypeOf('function');
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
    failing.settings.getDefaults.mockRejectedValue(new Error('defaults unavailable'));
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
      createSdkSession: createDaemonSessionFactory(async () => mock.droid),
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
    expect(replaced?.session.availableModels?.map(({ id }) => id)).toEqual([
      'model-1',
      'custom:Probe-0',
    ]);
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
    (mock.created as { cwd: string }).cwd = 'C:\\workspace-wt-main-wt';

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

    expect(mock.sessions.resume).toHaveBeenCalledExactlyOnceWith('saved-session', {
      permissionHandler: expect.any(Function),
      askUserHandler: expect.any(Function),
    });
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
      answers: [{ index: 4, question: 'Which language?', answer: 'TypeScript' }],
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
      createSdkSession: createDaemonSessionFactory(async () => mock.droid),
    });

    const availability = await runtime.initialize('C:\\workspace');
    const events = await collect(runtime.sendTurn('Say hello'));

    expect(availability).toMatchObject({
      status: 'available',
      sessionId: 'session-1',
    });
    expect(mock.created.stream).toHaveBeenCalledWith('Say hello', {
      includePartialMessages: true,
      abortSignal: expect.any(AbortSignal),
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

  it('uses the daemon last-call compaction meter rather than category estimates', async () => {
    const mock = createDroidMock();
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: createDaemonSessionFactory(async () => mock.droid),
    });
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readContextWindow()).resolves.toEqual({
      availability: 'available',
      used: 14000,
      remaining: 75000,
      limit: 89000,
      estimatedTokens: 40000,
    });
    expect(mock.sessions.getContextBreakdown).toHaveBeenCalledWith('session-1');
  });

  it('rounds fractional daemon Context Breakdown values', async () => {
    const mock = createDroidMock();
    mock.sessions.getContextBreakdown.mockResolvedValueOnce({
      modelId: 'model-1',
      modelDisplayName: 'Model 1',
      contextBudget: 100000,
      lastCallCompactionTokens: 24999.6,
      usedTokens: 40000.4,
      freeTokens: 59999.6,
      categories: [],
      skills: [],
      mcpServers: [],
      droids: [],
    });
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: createDaemonSessionFactory(async () => mock.droid),
    });
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readContextWindow()).resolves.toEqual({
      availability: 'available',
      used: 14000,
      remaining: 75000,
      limit: 89000,
      estimatedTokens: 40000,
    });
  });

  it('waits for daemon last-call usage instead of falling back to the estimate', async () => {
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
      createSdkSession: createDaemonSessionFactory(async () => mock.droid),
    });
    await runtime.initialize('C:\\workspace');

    await expect(runtime.readContextWindow()).resolves.toEqual({
      availability: 'unavailable',
      reason: 'awaiting-usage',
      estimatedTokens: 40000,
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

    expect(mock.sessions.updateSettings).toHaveBeenCalledWith('session-1', {
      modelId: 'model-2',
    });
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

  it('forwards spec drafting overrides and their resets to the daemon', async () => {
    const mock = createDroidMock();
    const session = await createDaemonDroidSession({
      target: { kind: 'new', cwd: 'C:\\workspace' },
      interactionHandler: cancellingRuntimeInteractionHandler,
      getDroid: async () => mock.droid,
    });

    await session.updateSettings({ specModeModelId: 'model-2' });
    expect(mock.sessions.updateSettings).toHaveBeenCalledWith('session-1', {
      specModeModelId: 'model-2',
    });
    expect(session.settings.specModeModelId).toBe('model-2');

    // null is a reset, not "no change": it must reach the daemon, and
    // the overlay retires against a snapshot that reports it absent.
    await session.updateSettings({
      specModeModelId: null,
      specModeReasoningEffort: null,
    });
    expect(mock.sessions.updateSettings).toHaveBeenLastCalledWith('session-1', {
      specModeModelId: null,
      specModeReasoningEffort: null,
    });
    mock.created.settings = { ...mock.created.settings };
    expect(session.settings.specModeModelId ?? null).toBeNull();
    mock.created.settings = {
      ...mock.created.settings,
      specModeModelId: 'model-3',
    };
    expect(session.settings.specModeModelId).toBe('model-3');
  });

  it('compacts into a resumed replacement session and detaches the source', async () => {
    const mock = createDroidMock();
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: createDaemonSessionFactory(async () => mock.droid),
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
      createSdkSession: createDaemonSessionFactory(async () => mock.droid),
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
    mock.sessions.resume.mockRejectedValue(new Error('arbitrary resume failure'));
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

  it.each([
    ['new lease conflict', 'new', 'conflict', false, 'attachment', false],
    ['new lease throw', 'new', 'throw', false, null, false],
    ['resume lease retry exhaustion', 'resume', 'conflict', false, null, true],
    ['resume lease throw', 'resume', 'throw', false, null, false],
    ['resume attachment failure', 'resume', 'acquired', true, 'lease', false],
  ] as const)(
    'cleans only acquired resources after %s',
    async (
      _failure,
      targetKind,
      acquireResult,
      resumeFails,
      cleanupFailureResource,
      retries,
    ) => {
      const mock = createDroidMock();
      const primary = new Error('primary establishment failure');
      const cleanupFailure = new Error('cleanup failure');
      const diagnostics = { record: vi.fn() };
      const lease = {
        acquire: vi.fn<
          (
            sessionId: string,
          ) => { acquired: true } | { acquired: false; heldByPid: number }
        >(() => {
          if (acquireResult === 'throw') {
            throw primary;
          }
          return acquireResult === 'conflict'
            ? ({ acquired: false, heldByPid: 4242 } as const)
            : ({ acquired: true } as const);
        }),
        release: vi.fn<(sessionId: string) => void>(() => {
          if (cleanupFailureResource === 'lease') {
            throw cleanupFailure;
          }
        }),
      };
      if (cleanupFailureResource === 'attachment') {
        mock.created.detach.mockRejectedValue(cleanupFailure);
      }
      if (resumeFails) {
        mock.sessions.resume.mockRejectedValue(primary);
      }
      const target =
        targetKind === 'new'
          ? ({ kind: 'new', cwd: 'C:\\workspace' } as const)
          : ({
              kind: 'resume',
              cwd: 'C:\\workspace',
              sessionId: 'saved-session',
            } as const);
      const establish = () =>
        createDaemonDroidSession({
          target,
          interactionHandler: cancellingRuntimeInteractionHandler,
          getDroid: async () => mock.droid,
          lease,
          diagnostics,
        });
      const expectPrimary = (pending: ReturnType<typeof establish>) =>
        acquireResult === 'conflict'
          ? expect(pending).rejects.toThrow('open in another window (pid 4242)')
          : expect(pending).rejects.toBe(primary);

      if (retries) {
        vi.useFakeTimers();
        try {
          const assertion = expectPrimary(establish());
          await vi.advanceTimersByTimeAsync(15_600);
          await assertion;
        } finally {
          vi.useRealTimers();
        }
      } else {
        await expectPrimary(establish());
      }

      const sessionId = targetKind === 'new' ? 'session-1' : 'saved-session';
      expect(lease.acquire.mock.calls.every(([id]) => id === sessionId)).toBe(true);
      if (retries) {
        expect(lease.acquire.mock.calls.length).toBeGreaterThan(1);
      } else {
        expect(lease.acquire).toHaveBeenCalledOnce();
      }
      if (targetKind === 'new') {
        expect(mock.sessions.create).toHaveBeenCalledOnce();
        expect(mock.sessions.resume).not.toHaveBeenCalled();
        expect(mock.created.detach).toHaveBeenCalledOnce();
        expect(lease.release).not.toHaveBeenCalled();
      } else {
        expect(mock.sessions.create).not.toHaveBeenCalled();
        expect(mock.created.detach).not.toHaveBeenCalled();
        if (resumeFails) {
          expect(lease.release).toHaveBeenCalledExactlyOnceWith('saved-session');
          expect(mock.sessions.resume).toHaveBeenCalledOnce();
          expect(mock.sessions.resume).toHaveBeenCalledWith(
            'saved-session',
            expect.anything(),
          );
        } else {
          expect(lease.release).not.toHaveBeenCalled();
          expect(mock.sessions.resume).not.toHaveBeenCalled();
        }
      }
      if (cleanupFailureResource === null) {
        expect(diagnostics.record).not.toHaveBeenCalled();
      } else {
        expect(diagnostics.record).toHaveBeenCalledExactlyOnceWith({
          level: 'warn',
          name: 'daemon.session.provisional-cleanup-failed',
          attributes: {
            operation: targetKind === 'new' ? 'create' : 'resume',
            resource: cleanupFailureResource,
          },
        });
      }
    },
  );

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

  it.each([
    ['rewind', 'a successor lease conflict', 'lease-conflict'],
    ['compact', 'a successor lease throw', 'lease-throw'],
    ['fork', 'a successor resume failure', 'resume-failure'],
    ['rewind', 'a source detach failure', 'source-detach-failure'],
    [
      'compact',
      'source detach and successor cleanup failures',
      'source-detach-cleanup-failure',
    ],
    ['fork', 'an old-source lease release failure', 'source-lease-release-failure'],
  ] as const)(
    'keeps shared replacement ownership coherent after %s hits %s',
    async (operation, _description, failure) => {
      const mock = createDroidMock();
      const successor = createDaemonSessionMock('session-2');
      const primary = new Error('primary replacement failure');
      const cleanupFailure = new Error('cleanup failure');
      const diagnostics = { record: vi.fn() };
      const lease = {
        acquire: vi.fn<
          (
            sessionId: string,
          ) => { acquired: true } | { acquired: false; heldByPid: number }
        >((sessionId) => {
          if (sessionId === 'session-2') {
            if (failure === 'lease-conflict') {
              return { acquired: false, heldByPid: 4242 };
            }
            if (failure === 'lease-throw') {
              throw primary;
            }
          }
          return { acquired: true };
        }),
        release: vi.fn<(sessionId: string) => void>((sessionId) => {
          if (
            (failure === 'resume-failure' && sessionId === 'session-2') ||
            (failure === 'source-detach-cleanup-failure' && sessionId === 'session-2') ||
            (failure === 'source-lease-release-failure' && sessionId === 'session-1')
          ) {
            throw cleanupFailure;
          }
        }),
      };
      if (failure === 'resume-failure') {
        mock.sessions.resume.mockRejectedValue(primary);
      } else if (
        failure === 'source-detach-failure' ||
        failure === 'source-detach-cleanup-failure'
      ) {
        mock.sessions.resume.mockResolvedValue(successor);
        mock.created.detach.mockRejectedValue(primary);
        if (failure === 'source-detach-cleanup-failure') {
          successor.detach.mockRejectedValue(cleanupFailure);
        }
      } else if (failure === 'source-lease-release-failure') {
        mock.sessions.resume.mockResolvedValue(successor);
      }
      const runtime = new FactoryDroidRuntime({
        interactionHandler: cancellingRuntimeInteractionHandler,
        createSdkSession: createDaemonSessionFactory(
          async () => mock.droid,
          lease,
          diagnostics,
        ),
      });
      await runtime.initialize('C:\\workspace');
      const replace = () => {
        switch (operation) {
          case 'rewind':
            return runtime.rewind({
              messageId: 'message-9',
              forkTitle: 'Rewound',
            });
          case 'compact':
            return runtime.compact();
          case 'fork':
            return runtime.fork('Branch');
        }
      };

      if (failure === 'source-lease-release-failure') {
        await expect(replace()).resolves.toMatchObject({
          sessionId: 'session-2',
        });
        await runtime.interruptSession();
        expect(successor.interrupt).toHaveBeenCalledOnce();
        expect(mock.created.interrupt).not.toHaveBeenCalled();
        expect(mock.created.detach).toHaveBeenCalledOnce();
        expect(successor.detach).not.toHaveBeenCalled();
        expect(lease.release).toHaveBeenCalledExactlyOnceWith('session-1');
        expect(diagnostics.record).toHaveBeenCalledExactlyOnceWith({
          level: 'warn',
          name: 'daemon.session.replacement-cleanup-failed',
          attributes: { resource: 'source-lease' },
        });
        return;
      }

      if (failure === 'lease-conflict') {
        await expect(replace()).rejects.toThrow('open in another window (pid 4242)');
      } else {
        await expect(replace()).rejects.toBe(primary);
      }
      await runtime.interruptSession();
      expect(mock.created.interrupt).toHaveBeenCalledOnce();
      expect(successor.interrupt).not.toHaveBeenCalled();

      if (failure === 'lease-conflict' || failure === 'lease-throw') {
        expect(mock.sessions.resume).not.toHaveBeenCalled();
        expect(mock.created.detach).not.toHaveBeenCalled();
        expect(lease.release).not.toHaveBeenCalled();
        expect(diagnostics.record).not.toHaveBeenCalled();
        return;
      }

      if (failure === 'resume-failure') {
        expect(mock.created.detach).not.toHaveBeenCalled();
        expect(lease.release).toHaveBeenCalledExactlyOnceWith('session-2');
        expect(diagnostics.record).toHaveBeenCalledExactlyOnceWith({
          level: 'warn',
          name: 'daemon.session.replacement-cleanup-failed',
          attributes: { resource: 'successor-lease' },
        });
        return;
      }

      expect(mock.created.detach).toHaveBeenCalledOnce();
      expect(successor.detach).toHaveBeenCalledOnce();
      expect(lease.release).toHaveBeenCalledExactlyOnceWith('session-2');
      if (failure === 'source-detach-failure') {
        expect(diagnostics.record).not.toHaveBeenCalled();
      } else {
        expect(diagnostics.record).toHaveBeenNthCalledWith(1, {
          level: 'warn',
          name: 'daemon.session.replacement-cleanup-failed',
          attributes: { resource: 'successor-attachment' },
        });
        expect(diagnostics.record).toHaveBeenNthCalledWith(2, {
          level: 'warn',
          name: 'daemon.session.replacement-cleanup-failed',
          attributes: { resource: 'successor-lease' },
        });
      }
    },
  );

  it.each([
    ['successful cleanup', null],
    ['a detach failure', 'detach'],
    ['a lease release failure', 'lease'],
    ['detach and lease release failures', 'detach-and-lease'],
  ] as const)(
    'tracks daemon close ownership independently after %s',
    async (_description, failure) => {
      const mock = createDroidMock();
      const detachFailure = new Error('detach cleanup failure');
      const leaseFailure = new Error('lease cleanup failure');
      const failureStage = failure;
      let leaseFails = failureStage === 'lease' || failureStage === 'detach-and-lease';
      const lease = {
        acquire: vi.fn(() => ({ acquired: true }) as const),
        release: vi.fn(() => {
          if (leaseFails) {
            leaseFails = false;
            throw leaseFailure;
          }
        }),
      };
      if (failureStage === 'detach' || failureStage === 'detach-and-lease') {
        mock.created.detach.mockRejectedValueOnce(detachFailure);
      }
      const session = await createDaemonDroidSession({
        target: { kind: 'new', cwd: 'C:\\workspace' },
        interactionHandler: cancellingRuntimeInteractionHandler,
        getDroid: async () => mock.droid,
        lease,
      });

      if (failureStage === null) {
        await session.close();
      } else {
        await expect(session.close()).rejects.toBe(
          failureStage === 'lease' ? leaseFailure : detachFailure,
        );
      }
      expect(mock.created.detach).toHaveBeenCalledOnce();
      expect(lease.release).toHaveBeenCalledExactlyOnceWith('session-1');
      expect(mock.created.close).not.toHaveBeenCalled();

      await session.close();

      expect(mock.created.detach).toHaveBeenCalledTimes(
        failureStage === 'detach' || failureStage === 'detach-and-lease' ? 2 : 1,
      );
      expect(lease.release).toHaveBeenCalledTimes(
        failureStage === 'lease' || failureStage === 'detach-and-lease' ? 2 : 1,
      );
      expect(mock.created.close).not.toHaveBeenCalled();
    },
  );

  it('shares concurrent daemon close cleanup without duplicate actions', async () => {
    const mock = createDroidMock();
    let releaseDetach: (() => void) | undefined;
    mock.created.detach.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseDetach = resolve;
        }),
    );
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

    const first = session.close();
    const second = session.close();
    await Promise.resolve();

    expect(second).toBe(first);
    expect(mock.created.detach).toHaveBeenCalledOnce();
    expect(lease.release).not.toHaveBeenCalled();
    if (releaseDetach === undefined) {
      throw new Error('detach was not started');
    }
    releaseDetach();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(mock.created.detach).toHaveBeenCalledOnce();
    expect(lease.release).toHaveBeenCalledExactlyOnceWith('session-1');

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
      createSdkSession: createDaemonSessionFactory(async () => mock.droid),
    });
    await runtime.initialize('C:\\workspace');

    const expectProjection = async (workingState: string, projected: string) => {
      mock.sessions.listOpened.mockResolvedValue([{ id: 'session-1', workingState }]);
      await expect(runtime.readSessionWorkingState()).resolves.toBe(projected);
    };
    await expectProjection('idle', 'idle');
    await expectProjection('waiting_for_tool_confirmation', 'waiting-for-user');
    await expectProjection('thinking', 'running');
    await expectProjection('streaming_assistant_message', 'running');
    await expectProjection('executing_tool', 'running');
    await expectProjection('compacting_conversation', 'running');
    // Unrecognized states and unlisted sessions both fail closed to
    // `unknown` instead of reading as idle.
    await expectProjection('some_future_state', 'unknown');
    mock.sessions.listOpened.mockResolvedValue([]);
    await expect(runtime.readSessionWorkingState()).resolves.toBe('unknown');
  });

  it('interruptSession interrupts the daemon turn without a local turn', async () => {
    const mock = createDroidMock();
    const runtime = new FactoryDroidRuntime({
      interactionHandler: cancellingRuntimeInteractionHandler,
      createSdkSession: createDaemonSessionFactory(async () => mock.droid),
    });
    await runtime.initialize('C:\\workspace');

    // `interrupt()` requires a locally streaming turn; a reloaded
    // window observing a daemon-side turn has none.
    await runtime.interrupt();
    expect(mock.created.interrupt).not.toHaveBeenCalled();

    await runtime.interruptSession();
    expect(mock.created.interrupt).toHaveBeenCalledOnce();
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
    onNotification: vi.fn(() => () => undefined),
    detach: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  };
}

function createDroidMock(streamImplementation?: () => AsyncGenerator<DroidStreamEvent>) {
  const created = createDaemonSessionMock('session-1', streamImplementation);
  const sessions = {
    create: vi.fn(
      async (_options: {
        cwd: string;
        permissionHandler?: ClientPermissionHandler;
        askUserHandler?: ClientAskUserHandler;
      }) => created,
    ),
    resume: vi.fn(async (sessionId: string) => createDaemonSessionMock(sessionId)),
    listOpened: vi.fn(async (): Promise<{ id: string; workingState: string }[]> => []),
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
    } as unknown as DaemonApi,
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
    supportedReasoningEfforts: [ReasoningEffort.Off, ReasoningEffort.High],
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
