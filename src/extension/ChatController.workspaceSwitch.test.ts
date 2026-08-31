import { describe, expect, it, vi } from 'vitest';

import {
  available,
  catalogEntry,
  connectionMessages,
  createCatalog,
  createController,
  createMemoryPersistence,
  createMockRuntime,
  deferred,
  type MockRuntime,
  ready,
  type RuntimeAskUserResult,
  type RuntimeAvailability,
  type RuntimeInteractionHandler,
  type RuntimePermissionResult,
  send,
  type SessionCatalogResult,
  SessionRecoveryStore,
  snapshots,
  successfulTurn,
  turnStates,
  waitForConnected,
  waitForInteraction,
} from './controllerTestHarness';

describe('ChatController', () => {
  it('clears stale catalog rows before loading a changed workspace', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const catalog = {
      listSessions: vi.fn(async (cwd: string) => ({
        status: 'available' as const,
        sessions:
          cwd === 'C:\\workspace-a'
            ? [catalogEntry('a-only')]
            : [catalogEntry('b-only')],
      })),
    };
    const runtime = createMockRuntime();
    const createRuntime = vi.fn(() => runtime);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);
    expect(snapshots(messages).at(-1)?.sessions.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'a-only' }),
      ]),
    );

    workspace.cwd = 'C:\\workspace-b';
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'a-only',
    });

    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'session-1',
      sessions: { status: 'loading', items: [] },
    });
    expect(runtime.dispose).not.toHaveBeenCalled();
    expect(createRuntime).toHaveBeenCalledOnce();
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessions).toMatchObject({
        status: 'ready',
        items: [
          expect.objectContaining({
            id: 'b-only',
            active: false,
          }),
        ],
      });
    });
    expect(runtime.initialize).toHaveBeenCalledTimes(1);
    expect(runtime.initialize).not.toHaveBeenCalledWith({
      kind: 'resume',
      cwd: 'C:\\workspace-b',
      sessionId: 'a-only',
    });
  });

  it('discards a deferred catalog result after the workspace changes', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const staleRefresh = deferred<SessionCatalogResult>();
    const catalog = {
      listSessions: vi
        .fn<(cwd: string) => Promise<SessionCatalogResult>>()
        .mockResolvedValueOnce({
          status: 'available',
          sessions: [catalogEntry('a-existing')],
        })
        .mockImplementationOnce(() => staleRefresh.promise)
        .mockResolvedValue({
          status: 'available',
          sessions: [catalogEntry('b-only')],
        }),
    };
    const runtime = createMockRuntime();
    const createRuntime = vi.fn(() => runtime);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({ type: 'sessions.refresh' });
    expect(snapshots(messages).at(-1)?.sessions).toMatchObject({
      status: 'loading',
      items: [
        expect.objectContaining({
          id: 'session-1',
          active: true,
        }),
      ],
    });
    expect(JSON.stringify(snapshots(messages).at(-1))).not.toContain(
      'a-existing',
    );
    workspace.cwd = 'C:\\workspace-b';
    staleRefresh.resolve({
      status: 'available',
      sessions: [catalogEntry('a-late')],
    });

    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessions).toEqual({
        status: 'idle',
        items: [],
      });
    });
    expect(JSON.stringify(snapshots(messages).at(-1))).not.toContain(
      'a-late',
    );
    await Promise.resolve();

    controller.handleMessage({
      type: 'session.select',
      sessionId: 'a-late',
    });
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(runtime.dispose).not.toHaveBeenCalled();
    expect(runtime.initialize).not.toHaveBeenCalledWith({
      kind: 'resume',
      cwd: 'C:\\workspace-b',
      sessionId: 'a-late',
    });
  });

  it('disposes a candidate when its workspace changes during initialization', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const catalog = {
      listSessions: vi.fn(async (cwd: string) => ({
        status: 'available' as const,
        sessions:
          cwd === 'C:\\workspace-a'
            ? [catalogEntry('a-only')]
            : [catalogEntry('b-only')],
      })),
    };
    const first = createMockRuntime();
    const candidateInitialization = deferred<RuntimeAvailability>();
    const candidate = createMockRuntime();
    candidate.initialize.mockImplementation(
      () => candidateInitialization.promise,
    );
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(candidate);
    const recovery = new SessionRecoveryStore(
      createMemoryPersistence(),
      'recovery',
      0,
    );
    const { controller, messages } = createController(
      createRuntime,
      workspace,
      catalog,
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);

    workspace.cwd = 'C:\\workspace-b';
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'b-only',
    });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessions.items).toEqual([
        expect.objectContaining({ id: 'b-only' }),
      ]);
    });
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'b-only',
    });
    await vi.waitFor(() => {
      expect(candidate.initialize).toHaveBeenCalledWith({
        kind: 'resume',
        cwd: 'C:\\workspace-b',
        sessionId: 'b-only',
      });
    });

    workspace.cwd = 'C:\\workspace-c';
    candidateInitialization.resolve(available('b-only'));
    await vi.waitFor(() => {
      expect(candidate.dispose).toHaveBeenCalledOnce();
      expect(messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'runtime.diagnostic',
            code: 'workspace-changed',
          }),
        ]),
      );
    });

    expect(recovery.getSelectedSessionId()).toBe('session-1');
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'session-1',
      connection: { status: 'unavailable' },
    });
    expect(
      snapshots(messages).some(
        (message) =>
          message.sessionId === 'b-only' &&
          message.connection.status === 'connected',
      ),
    ).toBe(false);
  });

  it('does not publish a replacement before its recovery checkpoint succeeds', async () => {
    const recovery = new SessionRecoveryStore(
      createMemoryPersistence(),
      'recovery',
      0,
    );
    const first = createMockRuntime();
    const candidate = createMockRuntime();
    candidate.initialize.mockResolvedValue(available('session-2'));
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(candidate);
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);
    vi.spyOn(recovery, 'flush').mockRejectedValueOnce(
      new Error('sensitive write failure'),
    );

    controller.handleMessage({
      type: 'session.select',
      sessionId: 'session-2',
    });

    await vi.waitFor(() => {
      expect(connectionMessages(messages).at(-1)).toMatchObject({
        connection: {
          status: 'unavailable',
          message: 'The selected Droid session could not be opened.',
        },
      });
    });
    expect(candidate.initialize).not.toHaveBeenCalled();
    expect(
      snapshots(messages).some(
        (message) =>
          message.sessionId === 'session-2' &&
          message.connection.status === 'connected',
      ),
    ).toBe(false);
    expect(JSON.stringify(messages)).not.toContain(
      'sensitive write failure',
    );
  });

  it('does not commit a candidate when its workspace changes during activation recovery flush', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const catalog = {
      listSessions: vi.fn(async (cwd: string) => ({
        status: 'available' as const,
        sessions:
          cwd === 'C:\\workspace-a'
            ? [catalogEntry('session-1')]
            : [catalogEntry('b-only')],
      })),
    };
    const recovery = new SessionRecoveryStore(
      createMemoryPersistence(),
      'recovery',
      0,
    );
    const first = createMockRuntime();
    const activationFlush = deferred<void>();
    let activationFlushPending = false;
    const candidate = createMockRuntime();
    candidate.initialize.mockImplementation(async () => {
      vi.spyOn(recovery, 'flush').mockImplementationOnce(
        () => {
          activationFlushPending = true;
          return activationFlush.promise;
        },
      );
      return available('b-only');
    });
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(candidate);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
      catalog,
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);

    workspace.cwd = 'C:\\workspace-b';
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'b-only',
    });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessions.items).toEqual([
        expect.objectContaining({ id: 'b-only' }),
      ]);
    });
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'b-only',
    });
    await vi.waitFor(() => {
      expect(candidate.initialize).toHaveBeenCalledWith({
        kind: 'resume',
        cwd: 'C:\\workspace-b',
        sessionId: 'b-only',
      });
      expect(activationFlushPending).toBe(true);
      expect(recovery.getSelectedSessionId()).toBe('session-1');
    });

    const workspaceChangedAt = messages.length;
    workspace.cwd = 'C:\\workspace-c';
    activationFlush.resolve();

    await vi.waitFor(() => {
      expect(candidate.dispose).toHaveBeenCalledOnce();
      expect(snapshots(messages).at(-1)).toMatchObject({
        sessionId: 'session-1',
        connection: {
          status: 'unavailable',
          message:
            'The workspace changed before the Droid session could be opened.',
        },
      });
    });
    expect(recovery.getSelectedSessionId()).toBe('session-1');
    expect(
      snapshots(messages.slice(workspaceChangedAt)).some(
        (message) =>
          message.sessionId === 'b-only' &&
          message.connection.status === 'connected',
      ),
    ).toBe(false);

    send(controller, 'b-only', 'turn-stale', 'Ignore');
    expect(candidate.sendTurn).not.toHaveBeenCalled();
  });

  it('rejects sends when the active runtime belongs to another workspace', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const runtime = createMockRuntime();
    const recovery = new SessionRecoveryStore(
      createMemoryPersistence(),
      'recovery',
      0,
    );
    const writeSession = vi.spyOn(recovery, 'writeSession');
    const { controller, messages } = createController(
      () => runtime,
      workspace,
      createCatalog([]),
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);
    const writesBeforeSend = writeSession.mock.calls.length;

    workspace.cwd = 'C:\\workspace-b';
    send(controller, 'session-1', 'turn-stale', 'Do not persist');

    expect(runtime.sendTurn).not.toHaveBeenCalled();
    expect(writeSession).toHaveBeenCalledTimes(writesBeforeSend);
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'session-1',
      connection: {
        status: 'unavailable',
        message:
          'The workspace changed before the Droid session could be opened.',
      },
      turn: null,
      transcript: [],
      sessions: { status: 'idle', items: [] },
    });

    ready(controller);
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.connection).toMatchObject({
        status: 'unavailable',
        message:
          'The workspace changed before the Droid session could be opened.',
      });
    });
    expect(runtime.sendTurn).not.toHaveBeenCalled();
  });

  it('drops late stream events and disposes the stale runtime once after context loss', async () => {
    const release = deferred<void>();
    const workspace = {
      cwd: 'C:\\workspace-a' as string | null,
      trusted: true,
    };
    const runtime = createMockRuntime(async function* () {
      await release.promise;
      yield { type: 'text-delta', text: 'late secret output' };
      yield successfulTurn();
    });
    const { controller, messages } = createController(
      () => runtime,
      workspace,
    );
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Wait');

    workspace.trusted = false;
    release.resolve();

    await vi.waitFor(() => {
      expect(runtime.dispose).toHaveBeenCalledOnce();
    });
    expect(JSON.stringify(messages)).not.toContain(
      'late secret output',
    );
    expect(turnStates(messages).at(-1)).toMatchObject({
      turnId: 'turn-1',
      status: 'submitting',
    });
    expect(snapshots(messages).at(-1)).toMatchObject({
      connection: {
        status: 'unavailable',
        message:
          'Trust this workspace to start the local Droid runtime.',
      },
      turn: null,
    });

    controller.handleWorkspaceContextChanged();
    await controller.dispose();
    expect(runtime.dispose).toHaveBeenCalledOnce();
  });

  it('cancels permission and AskUser instead of accepting responses after context loss', async () => {
    let handler!: RuntimeInteractionHandler;
    let permission!: Promise<RuntimePermissionResult>;
    let askUser!: Promise<RuntimeAskUserResult>;
    const release = deferred<void>();
    const workspace = {
      cwd: 'C:\\workspace-a' as string | null,
      trusted: true,
    };
    const runtime = createMockRuntime(async function* () {
      permission = handler.requestPermission({
        options: [
          {
            label: 'Proceed',
            value: 'proceed',
            requiresEditedSpec: false,
          },
        ],
        toolUses: [
          {
            toolUseId: 'tool-1',
            toolName: 'Edit',
            confirmationKind: 'edit',
            title: 'Edit file',
          },
        ],
      });
      askUser = handler.askUser({
        toolCallId: 'ask-1',
        questions: [
          {
            index: 0,
            topic: 'Choice',
            question: 'Continue?',
            options: ['Yes'],
            multiSelect: false,
          },
        ],
      });
      await release.promise;
    });
    const { controller, messages } = createController((nextHandler) => {
      handler = nextHandler;
      return runtime;
    }, workspace);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Edit');
    const permissionRequest = await waitForInteraction(
      messages,
      'permission',
    );
    const askUserRequest = await waitForInteraction(
      messages,
      'ask-user',
    );

    workspace.cwd = 'C:\\workspace-b';
    controller.handleMessage({
      type: 'permission.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: permissionRequest.request.requestId,
      selectedOption: 'proceed',
    });
    controller.handleMessage({
      type: 'ask-user.respond',
      sessionId: 'session-1',
      turnId: 'turn-1',
      requestId: askUserRequest.request.requestId,
      cancelled: false,
      answers: [{ index: 0, answer: 'Yes' }],
    });

    await expect(permission).resolves.toEqual({
      selectedOption: 'cancel',
    });
    await expect(askUser).resolves.toEqual({
      cancelled: true,
      answers: [],
    });
    expect(runtime.dispose).toHaveBeenCalledOnce();
    release.resolve();
    await controller.dispose();
  });

  it('closes the old runtime before initializing the latest usable workspace', async () => {
    const calls: string[] = [];
    const cleanup = deferred<void>();
    const workspace = {
      cwd: 'C:\\workspace-a' as string | null,
      trusted: true,
    };
    const first = createMockRuntime();
    first.dispose.mockImplementation(async () => {
      calls.push('dispose-a');
      await cleanup.promise;
    });
    const second = createMockRuntime();
    second.initialize.mockImplementation(async (target) => {
      calls.push(
        `initialize-${typeof target === 'string' ? target : target.cwd}`,
      );
      return available('session-b');
    });
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
    );
    ready(controller);
    await waitForConnected(messages);

    workspace.cwd = 'C:\\workspace-b';
    controller.handleWorkspaceContextChanged();
    workspace.cwd = 'C:\\workspace-c';
    controller.handleWorkspaceContextChanged();

    await vi.waitFor(() => {
      expect(first.dispose).toHaveBeenCalledOnce();
    });
    expect(createRuntime).toHaveBeenCalledOnce();

    cleanup.resolve();
    await vi.waitFor(() => {
      expect(second.initialize).toHaveBeenCalledWith({
        kind: 'new',
        cwd: 'C:\\workspace-c',
      });
      expect(snapshots(messages).at(-1)).toMatchObject({
        sessionId: 'session-b',
        connection: { status: 'connected' },
      });
    });
    expect(calls).toEqual([
      'dispose-a',
      'initialize-C:\\workspace-c',
    ]);
  });

  it('does not replace for untrusted or folderless contexts and ignores unchanged notifications', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a' as string | null,
      trusted: true,
    };
    const first = createMockRuntime();
    const replacement = createMockRuntime();
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(replacement);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleWorkspaceContextChanged();
    expect(first.dispose).not.toHaveBeenCalled();

    workspace.trusted = false;
    controller.handleWorkspaceContextChanged();
    await vi.waitFor(() => {
      expect(first.dispose).toHaveBeenCalledOnce();
    });
    expect(createRuntime).toHaveBeenCalledOnce();

    workspace.cwd = null;
    workspace.trusted = true;
    controller.handleWorkspaceContextChanged();
    await Promise.resolve();
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(snapshots(messages).at(-1)?.connection).toMatchObject({
      status: 'unavailable',
      message: 'Open a workspace folder to use DroidVisX.',
    });

    workspace.cwd = 'C:\\workspace-b';
    controller.handleWorkspaceContextChanged();
    await vi.waitFor(() => {
      expect(replacement.initialize).toHaveBeenCalledWith({
        kind: 'new',
        cwd: 'C:\\workspace-b',
      });
    });
  });

  it('deduplicates runtime cleanup across repeated notifications and disposal', async () => {
    const cleanup = deferred<void>();
    const workspace = {
      cwd: 'C:\\workspace-a' as string | null,
      trusted: true,
    };
    const runtime = createMockRuntime();
    runtime.dispose.mockImplementation(() => cleanup.promise);
    const createRuntime = vi.fn(() => runtime);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
    );
    ready(controller);
    await waitForConnected(messages);

    workspace.trusted = false;
    controller.handleWorkspaceContextChanged();
    controller.handleWorkspaceContextChanged();
    const disposal = controller.dispose();
    expect(controller.dispose()).toBe(disposal);
    await vi.waitFor(() => {
      expect(runtime.dispose).toHaveBeenCalledOnce();
    });

    cleanup.resolve();
    await disposal;
    expect(runtime.dispose).toHaveBeenCalledOnce();
    expect(createRuntime).toHaveBeenCalledOnce();
  });

  it('resumes a shared session id when the active runtime belongs to another workspace', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const catalog = {
      listSessions: vi.fn(async () => ({
        status: 'available' as const,
        sessions: [catalogEntry('shared-session')],
      })),
    };
    const first = createMockRuntime();
    first.initialize.mockResolvedValue(available('shared-session'));
    const second = createMockRuntime();
    second.initialize.mockResolvedValue(available('shared-session'));
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);

    workspace.cwd = 'C:\\workspace-b';
    controller.handleMessage({
      type: 'session.select',
      sessionId: 'shared-session',
    });
    await vi.waitFor(() => {
      expect(catalog.listSessions).toHaveBeenCalledTimes(2);
      expect(snapshots(messages).at(-1)?.sessions).toMatchObject({
        status: 'ready',
        items: [
          expect.objectContaining({ id: 'shared-session' }),
        ],
      });
    });

    controller.handleMessage({
      type: 'session.select',
      sessionId: 'shared-session',
    });
    await vi.waitFor(() => {
      expect(second.initialize).toHaveBeenCalledWith({
        kind: 'resume',
        cwd: 'C:\\workspace-b',
        sessionId: 'shared-session',
      });
      expect(snapshots(messages).at(-1)).toMatchObject({
        sessionId: 'shared-session',
        connection: { status: 'connected' },
      });
    });

    expect(first.dispose).toHaveBeenCalledOnce();
  });

  it('blocks sends synchronously while session replacement is waiting to flush recovery', async () => {
    const first = createMockRuntime();
    const second = createMockRuntime();
    second.initialize.mockResolvedValue(available('session-2'));
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const recovery = new SessionRecoveryStore(
      createMemoryPersistence(),
      'recovery',
      0,
    );
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);
    const replacementFlush = deferred<void>();
    vi.spyOn(recovery, 'flush').mockImplementationOnce(
      () => replacementFlush.promise,
    );

    controller.handleMessage({
      type: 'session.select',
      sessionId: 'session-2',
    });
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'session-1',
      connection: { status: 'connecting' },
    });

    send(controller, 'session-1', 'turn-during-replacement', 'Ignore');

    expect(first.sendTurn).not.toHaveBeenCalled();
    expect(first.dispose).not.toHaveBeenCalled();

    replacementFlush.resolve();
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)).toMatchObject({
        sessionId: 'session-2',
        connection: { status: 'connected' },
      });
    });
    expect(first.sendTurn).not.toHaveBeenCalled();
  });

  it('closes before resume and keeps selection stable when resume fails', async () => {
    const calls: string[] = [];
    const first = createMockRuntime();
    first.dispose.mockImplementation(async () => {
      calls.push('close-old');
    });
    const second = createMockRuntime();
    second.initialize.mockImplementation(async () => {
      calls.push('initialize-new');
      throw new Error('sensitive resume failure');
    });
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const persistence = createMemoryPersistence();
    const recovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.select',
      sessionId: 'session-2',
    });
    await vi.waitFor(() => {
      expect(connectionMessages(messages).at(-1)).toMatchObject({
        connection: {
          status: 'unavailable',
          message: 'The selected Droid session could not be opened.',
        },
      });
    });

    expect(calls).toEqual(['close-old', 'initialize-new']);
    expect(recovery.getSelectedSessionId()).toBe('session-1');
    expect(snapshots(messages).at(-1)?.sessionId).toBe('session-1');
    expect(JSON.stringify(messages)).not.toContain(
      'sensitive resume failure',
    );
  });

  it('coalesces streaming recovery checkpoints and persists terminal state', async () => {
    const runtime = createMockRuntime(async function* () {
      for (let index = 0; index < 100; index += 1) {
        yield { type: 'text-delta', text: 'x' };
      }
      yield successfulTurn();
    });
    const recovery = new SessionRecoveryStore(
      createMemoryPersistence(),
      'recovery',
      0,
    );
    const writeSession = vi.spyOn(recovery, 'writeSession');
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);
    expect(writeSession).toHaveBeenCalledOnce();

    send(controller, 'session-1', 'turn-1', 'Stream');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(writeSession).toHaveBeenCalledTimes(2);
    expect(writeSession).toHaveBeenLastCalledWith(
      'session-1',
      expect.objectContaining({
        transcript: [
          expect.objectContaining({
            kind: 'user',
            text: 'Stream',
          }),
          expect.objectContaining({
            kind: 'assistant',
            text: 'x'.repeat(100),
          }),
        ],
      }),
    );
  });

  it('refresh failure preserves chat and a new session is shown before catalog catch-up', async () => {
    const catalog = {
      listSessions: vi
        .fn<(cwd: string) => Promise<SessionCatalogResult>>()
        .mockResolvedValueOnce({
          status: 'available',
          sessions: [catalogEntry('session-1')],
        })
        .mockResolvedValueOnce({
          status: 'unavailable',
          reason: 'catalog-failed',
          message: 'raw failure',
        }),
    };
    const first = createMockRuntime();
    const second = createMockRuntime();
    second.initialize.mockResolvedValue(available('lagging-session'));
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      catalog,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({ type: 'sessions.refresh' });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessions.status).toBe('error');
    });
    expect(snapshots(messages).at(-1)).toMatchObject({
      connection: { status: 'connected' },
      sessionId: 'session-1',
    });

    controller.handleMessage({ type: 'session.new' });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.sessionId).toBe(
        'lagging-session',
      );
    });
    expect(snapshots(messages).at(-1)?.sessions.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'lagging-session',
          active: true,
        }),
      ]),
    );
  });
});
