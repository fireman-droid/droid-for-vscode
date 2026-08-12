import { describe, expect, it, vi } from 'vitest';

import {
  appendAcceptedUserPrompt,
  available,
  catalogEntry,
  connectionMessages,
  createCatalog,
  createCatalogResult,
  createController,
  createHostTranscriptState,
  createMemoryPersistence,
  createMockRuntime,
  deferred,
  type MockRuntime,
  ready,
  type RuntimeAvailability,
  type RuntimeInteractionHandler,
  type RuntimePermissionResult,
  type RuntimeSessionWorkingState,
  seededRecoveryStore,
  send,
  type SessionHistoryLoader,
  SessionRecoveryStore,
  snapshots,
  stop,
  successfulTurn,
  turnStates,
  waitForConnected,
  waitForInteraction,
} from './controllerTestHarness';

describe('ChatController', () => {
  it('resumes only a catalog-validated recovered session and restores its transcript', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.writeSession(
      'saved-session',
      appendAcceptedUserPrompt(
        createHostTranscriptState('complete'),
        'saved-turn',
        'Recovered prompt',
      ),
    );
    seed.selectSession('saved-session');
    await seed.flush();
    const recovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      recovery,
    );

    ready(controller);
    await waitForConnected(messages);

    expect(runtime.initialize).toHaveBeenCalledWith({
      kind: 'resume',
      cwd: 'C:\\workspace',
      sessionId: 'saved-session',
    });
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'saved-session',
      historyStatus: 'partial',
      transcript: [
        expect.objectContaining({
          kind: 'user',
          text: 'Recovered prompt',
        }),
      ],
    });
  });

  it('emits an early connecting snapshot from the recovery checkpoint before runtime activation completes', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.writeSession(
      'saved-session',
      appendAcceptedUserPrompt(
        createHostTranscriptState('complete'),
        'saved-turn',
        'Recovered prompt',
      ),
    );
    seed.selectSession('saved-session');
    await seed.flush();
    const activation = deferred<RuntimeAvailability>();
    const runtime = createMockRuntime();
    runtime.initialize.mockImplementation(() => activation.promise);
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
    );

    ready(controller);

    await vi.waitFor(() => {
      expect(snapshots(messages).length).toBeGreaterThan(0);
    });
    expect(snapshots(messages)[0]).toMatchObject({
      sessionId: 'saved-session',
      connection: { status: 'connecting' },
      transcript: [
        expect.objectContaining({
          kind: 'user',
          text: 'Recovered prompt',
        }),
      ],
    });

    // The early snapshot must not unlock mutating handlers.
    send(controller, 'saved-session', 'turn-early', 'too soon');
    expect(turnStates(messages)).toHaveLength(0);
    expect(runtime.sendTurn).not.toHaveBeenCalled();

    activation.resolve(available('saved-session'));
    await waitForConnected(messages);
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'saved-session',
      connection: { status: 'connected' },
    });
  });

  it('does not emit an early snapshot without a recovered checkpoint transcript', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.selectSession('saved-session');
    await seed.flush();
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
    );

    ready(controller);
    await waitForConnected(messages);

    expect(snapshots(messages)[0]).toMatchObject({
      connection: { status: 'connected' },
    });
  });

  it('reconciles and persists public history with locally recovered content before activation commit', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.writeSession(
      'saved-session',
      appendAcceptedUserPrompt(
        createHostTranscriptState('partial'),
        'cached-turn',
        'Cached fallback',
      ),
    );
    seed.selectSession('saved-session');
    await seed.flush();
    const recovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const historyState = {
      transcript: [
        {
          id: 'user-history',
          kind: 'user' as const,
          text: 'Loaded old prompt',
        },
        {
          id: 'assistant-history',
          kind: 'assistant' as const,
          turnId: 'history-turn',
          text: 'Loaded old answer',
        },
      ],
      historyStatus: 'complete' as const,
      truncated: false,
    };
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async () => ({
        status: 'available' as const,
        state: historyState,
      })),
    };
    const writeSession = vi.spyOn(recovery, 'writeSession');
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      recovery,
      history,
    );

    ready(controller);
    await waitForConnected(messages);

    expect(history.loadHistory).toHaveBeenCalledWith({
      cwd: 'C:\\workspace',
      sessionId: 'saved-session',
    });
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'saved-session',
      historyStatus: 'partial',
      truncated: false,
      transcript: [
        { kind: 'user', text: 'Loaded old prompt' },
        { kind: 'assistant', text: 'Loaded old answer' },
        { kind: 'user', text: 'Cached fallback' },
      ],
    });
    expect(writeSession).toHaveBeenCalledWith(
      'saved-session',
      expect.objectContaining({
        historyStatus: 'partial',
        truncated: false,
        transcript: [
          ...historyState.transcript,
          expect.objectContaining({ text: 'Cached fallback' }),
        ],
      }),
    );
    expect(recovery.readSession('saved-session')).toMatchObject({
      historyStatus: 'partial',
      truncated: false,
      transcript: [
        ...historyState.transcript,
        expect.objectContaining({ text: 'Cached fallback' }),
      ],
    });
  });

  it('projects an in-flight daemon turn as a recovery placeholder and replaces it with the completed result', async () => {
    const recovery = await seededRecoveryStore('saved-session');
    // First load happens during activation (turn still running); the
    // reload after the daemon goes idle sees the completed answer.
    const history: SessionHistoryLoader = {
      loadHistory: vi
        .fn<SessionHistoryLoader['loadHistory']>()
        .mockResolvedValueOnce({
          status: 'available',
          state: {
            transcript: [
              { id: 'user-1', kind: 'user', text: 'Long task' },
            ],
            historyStatus: 'complete',
            truncated: false,
          },
        })
        .mockResolvedValue({
          status: 'available',
          state: {
            transcript: [
              { id: 'user-1', kind: 'user', text: 'Long task' },
              {
                id: 'assistant-1',
                kind: 'assistant',
                turnId: 'daemon-turn',
                text: 'Finished in the background',
              },
            ],
            historyStatus: 'complete',
            truncated: false,
          },
        }),
    };
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    runtime.readSessionWorkingState = vi
      .fn<() => Promise<RuntimeSessionWorkingState>>()
      .mockResolvedValueOnce('running')
      .mockResolvedValue('idle');
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      recovery,
      history,
    );

    ready(controller);
    await waitForConnected(messages);

    // The placeholder turn arrives via a snapshot (the webview adopts
    // turns from snapshots, not bare turn.state messages).
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.turn).toMatchObject({
        turnId: expect.stringMatching(/^recovery-/),
        status: 'streaming',
      });
    });
    expect(runtime.sendTurn).not.toHaveBeenCalled();

    await vi.waitFor(
      () => {
        expect(turnStates(messages).at(-1)?.status).toBe('completed');
      },
      { timeout: 5000 },
    );
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'saved-session',
      turn: expect.objectContaining({ status: 'completed' }),
      transcript: expect.arrayContaining([
        expect.objectContaining({
          kind: 'assistant',
          text: 'Finished in the background',
        }),
      ]),
    });
  });

  it('re-emits a permission replayed during a daemon resume and keeps it answerable', async () => {
    const recovery = await seededRecoveryStore('saved-session');
    let workingState: RuntimeSessionWorkingState = 'waiting-for-user';
    let permission: Promise<RuntimePermissionResult> | null = null;
    const runtime = createMockRuntime();
    runtime.readSessionWorkingState = vi.fn(async () => workingState);
    // The SDK replays a daemon-side pending permission while resume()
    // runs, before the controller has any active turn.
    runtime.initialize.mockImplementation(async () => {
      permission = interactionHandler.requestPermission({
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
            toolName: 'Execute',
            confirmationKind: 'exec',
            title: 'Run command',
          },
        ],
      });
      return available('saved-session');
    });
    let interactionHandler!: RuntimeInteractionHandler;
    const { controller, messages } = createController(
      (handler) => {
        interactionHandler = handler;
        return runtime;
      },
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      recovery,
    );

    ready(controller);
    await waitForConnected(messages);
    const request = await waitForInteraction(messages, 'permission');

    // The replayed permission is held by the synthesized recovery
    // turn instead of being auto-cancelled.
    expect(request.turnId).toMatch(/^recovery-/);
    let settled = false;
    void permission!.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    controller.handleMessage({
      type: 'permission.respond',
      sessionId: 'saved-session',
      turnId: request.turnId,
      requestId: request.request.requestId,
      selectedOption: 'proceed',
    });
    await expect(permission).resolves.toEqual({
      selectedOption: 'proceed',
    });
    workingState = 'idle';
    await vi.waitFor(
      () => {
        expect(turnStates(messages).at(-1)?.status).toBe('completed');
      },
      { timeout: 5000 },
    );
  });

  it('stops a recovered daemon turn through interruptSession', async () => {
    const recovery = await seededRecoveryStore('saved-session');
    let workingState: RuntimeSessionWorkingState = 'running';
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    runtime.readSessionWorkingState = vi.fn(async () => workingState);
    runtime.interruptSession = vi.fn(async () => {
      workingState = 'idle';
    });
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      recovery,
    );

    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.turn?.status).toBe('streaming');
    });
    const turnId = snapshots(messages).at(-1)!.turn!.turnId;

    stop(controller, 'saved-session', turnId);

    await vi.waitFor(
      () => {
        expect(turnStates(messages).at(-1)?.status).toBe('interrupted');
      },
      { timeout: 5000 },
    );
    expect(runtime.interruptSession).toHaveBeenCalledOnce();
    expect(runtime.interrupt).not.toHaveBeenCalled();
  });

  it('keeps process-mode resume unchanged when the working state read throws', async () => {
    const recovery = await seededRecoveryStore('saved-session');
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    runtime.readSessionWorkingState = vi.fn(async () => {
      throw new Error('does not report a working state');
    });
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      recovery,
    );

    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(runtime.readSessionWorkingState).toHaveBeenCalled();
    });

    expect(snapshots(messages).at(-1)?.turn).toBeNull();
    expect(turnStates(messages)).toHaveLength(0);
  });

  it('fails a recovered turn when the daemon stops reporting the session', async () => {
    const recovery = await seededRecoveryStore('saved-session');
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    runtime.readSessionWorkingState = vi
      .fn<() => Promise<RuntimeSessionWorkingState>>()
      .mockResolvedValueOnce('running')
      .mockResolvedValue('unknown');
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      recovery,
    );

    ready(controller);
    await waitForConnected(messages);
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.turn?.status).toBe('streaming');
    });

    await vi.waitFor(
      () => {
        expect(
          messages.find(
            (message) =>
              message.type === 'turn.error' &&
              message.code === 'recovered-turn-lost',
          ),
        ).toBeDefined();
      },
      { timeout: 8000 },
    );
    expect(turnStates(messages).at(-1)?.status).toBe('failed');
  });

  it('falls back to recovery when public old-session history is unavailable', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.writeSession(
      'saved-session',
      appendAcceptedUserPrompt(
        createHostTranscriptState('partial'),
        'cached-turn',
        'Cached fallback',
      ),
    );
    seed.selectSession('saved-session');
    await seed.flush();
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async () => {
        throw new Error('C:\\private\\raw-history-error');
      }),
    };
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
      history,
    );

    ready(controller);
    await waitForConnected(messages);

    expect(snapshots(messages).at(-1)).toMatchObject({
      historyStatus: 'partial',
      transcript: [{ kind: 'user', text: 'Cached fallback' }],
    });
    expect(JSON.stringify(messages)).not.toContain('raw-history-error');
  });

  it('starts the resume runtime while history is still loading', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.selectSession('saved-session');
    await seed.flush();
    const pendingHistory = deferred<{
      readonly status: 'available';
      readonly state: ReturnType<typeof createHostTranscriptState>;
    }>();
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(() => pendingHistory.promise),
    };
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('saved-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('saved-session')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
      history,
    );

    ready(controller);
    // The runtime spawn must not queue behind the history process: the
    // two droid CLI segments of one activation run in parallel.
    await vi.waitFor(() => {
      expect(runtime.initialize).toHaveBeenCalled();
    });
    expect(history.loadHistory).toHaveBeenCalledOnce();
    expect(
      connectionMessages(messages).at(-1)?.connection.status,
    ).not.toBe('connected');

    // The activation still waits for the transcript before committing.
    pendingHistory.resolve({
      status: 'available',
      state: createHostTranscriptState('complete'),
    });
    await waitForConnected(messages);
    await controller.dispose();
  });

  it('rejects stale history after an exact workspace change without persisting, closing the parallel candidate', async () => {
    const workspace = {
      cwd: 'C:\\workspace-a',
      trusted: true,
    };
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.selectSession('saved-session');
    await seed.flush();
    const recovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const writeSession = vi.spyOn(recovery, 'writeSession');
    const staleHistory = deferred<{
      readonly status: 'available';
      readonly state: ReturnType<typeof createHostTranscriptState>;
    }>();
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(() => staleHistory.promise),
    };
    const candidate = createMockRuntime();
    candidate.initialize.mockResolvedValue(available('saved-session'));
    const createRuntime = vi.fn(() => candidate);
    const catalog = createCatalog([catalogEntry('saved-session')]);
    const { controller, messages } = createController(
      createRuntime,
      workspace,
      catalog,
      recovery,
      history,
    );

    ready(controller);
    await vi.waitFor(() => {
      expect(history.loadHistory).toHaveBeenCalledWith({
        cwd: 'C:\\workspace-a',
        sessionId: 'saved-session',
      });
      // The candidate runtime starts in parallel with the history load.
      expect(candidate.initialize).toHaveBeenCalled();
    });
    workspace.cwd = 'C:\\workspace-b';
    workspace.trusted = false;
    staleHistory.resolve({
      status: 'available',
      state: {
        transcript: [
          {
            id: 'stale-user',
            kind: 'user',
            text: 'Must not persist',
          },
        ],
        historyStatus: 'complete',
        truncated: false,
      },
    });

    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)).toMatchObject({
        connection: {
          status: 'unavailable',
          message:
            'Trust this workspace to start the local Droid runtime.',
        },
      });
    });
    expect(history.loadHistory).toHaveBeenCalledOnce();
    // The parallel candidate must be torn down, never activated or
    // persisted, once the workspace change invalidates the switch.
    expect(candidate.dispose).toHaveBeenCalled();
    expect(candidate.sendTurn).not.toHaveBeenCalled();
    expect(writeSession).not.toHaveBeenCalled();
    expect(recovery.readSession('saved-session')).toBeUndefined();
    await controller.dispose();
  });

  it('records an end-to-end session-switch duration on a successful switch', async () => {
    const record = vi.fn();
    const first = createMockRuntime();
    first.initialize.mockResolvedValue(available('session-1'));
    const second = createMockRuntime();
    second.initialize.mockResolvedValue(available('session-2'));
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { controller, messages } = createController(
      createRuntime,
      undefined,
      createCatalog([
        catalogEntry('session-1'),
        catalogEntry('session-2'),
      ]),
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
      { record },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'session.select',
      sessionId: 'session-2',
    });

    await vi.waitFor(() => {
      expect(record).toHaveBeenCalledWith(
        expect.objectContaining({
          level: 'info',
          name: 'host.perf.session-switch',
          attributes: expect.objectContaining({
            kind: 'resume',
            durationMs: expect.any(Number),
          }),
        }),
      );
    });
    await controller.dispose();
  });

  it('falls back to a new session when recovery is missing from the latest catalog', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.selectSession('forged-or-stale');
    await seed.flush();
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('fresh-session'));
    const recovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('other-session')]),
      recovery,
    );

    ready(controller);
    await waitForConnected(messages);

    expect(runtime.initialize).toHaveBeenCalledWith({
      kind: 'new',
      cwd: 'C:\\workspace',
    });
    expect(recovery.getSelectedSessionId()).toBe('fresh-session');
    expect(snapshots(messages).at(-1)).toMatchObject({
      historyStatus: 'complete',
      transcript: [],
    });
  });

  it('recovers cached transcript after controller recreation with the same persistence', async () => {
    const persistence = createMemoryPersistence();
    const firstRuntime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'Persisted answer' };
      yield successfulTurn();
    });
    const firstRecovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const first = createController(
      () => firstRuntime,
      undefined,
      createCatalog([]),
      firstRecovery,
    );
    ready(first.controller);
    await waitForConnected(first.messages);
    send(
      first.controller,
      'session-1',
      'turn-persisted',
      'Persisted prompt',
    );
    await vi.waitFor(() => {
      expect(turnStates(first.messages).at(-1)?.status).toBe(
        'completed',
      );
    });
    await first.controller.dispose();

    const resumedRuntime = createMockRuntime();
    resumedRuntime.initialize.mockResolvedValue(available('session-1'));
    const second = createController(
      () => resumedRuntime,
      undefined,
      createCatalog([catalogEntry('session-1')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
    );
    ready(second.controller);
    await waitForConnected(second.messages);

    expect(resumedRuntime.initialize).toHaveBeenCalledWith({
      kind: 'resume',
      cwd: 'C:\\workspace',
      sessionId: 'session-1',
    });
    expect(snapshots(second.messages).at(-1)?.transcript).toEqual([
      expect.objectContaining({
        kind: 'user',
        text: 'Persisted prompt',
      }),
      expect.objectContaining({
        kind: 'assistant',
        text: 'Persisted answer',
      }),
    ]);
  });

  it('creates a fresh runtime when catalog loading fails and reports history error', async () => {
    const runtime = createMockRuntime();
    const catalog = createCatalogResult({
      status: 'unavailable',
      reason: 'catalog-failed',
      message: 'sensitive backend failure',
    });
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      catalog,
    );

    ready(controller);
    await waitForConnected(messages);

    expect(runtime.initialize).toHaveBeenCalledWith({
      kind: 'new',
      cwd: 'C:\\workspace',
    });
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessions: {
        status: 'error',
        message: 'Saved Droid sessions could not be loaded.',
        items: [
          expect.objectContaining({
            id: 'session-1',
            active: true,
          }),
        ],
      },
    });
    expect(JSON.stringify(messages)).not.toContain(
      'sensitive backend failure',
    );
  });

  it('snapshots the active transcript before replaying pending interactions on reload', async () => {
    let handler!: RuntimeInteractionHandler;
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'Current answer' };
      void handler.askUser({
        toolCallId: 'ask-current',
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
      yield successfulTurn();
    });
    const { controller, messages } = createController((nextHandler) => {
      handler = nextHandler;
      return runtime;
    });
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Prompt');
    await waitForInteraction(messages, 'ask-user');
    const beforeReload = messages.length;

    ready(controller);
    await vi.waitFor(() => {
      expect(messages.length).toBeGreaterThan(beforeReload + 1);
    });

    const reloadMessages = messages.slice(beforeReload);
    expect(reloadMessages[0]).toMatchObject({
      type: 'host.snapshot',
      turn: { turnId: 'turn-1', status: 'streaming' },
      transcript: [
        expect.objectContaining({ kind: 'user', text: 'Prompt' }),
        expect.objectContaining({
          kind: 'assistant',
          text: 'Current answer',
        }),
      ],
    });
    expect(reloadMessages[1]).toMatchObject({
      type: 'interaction.request',
      request: { kind: 'ask-user' },
    });
    release.resolve();
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
  });

  it('marks an uncached external session unavailable then partial after an observed turn', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.selectSession('external-session');
    await seed.flush();
    const recovery = new SessionRecoveryStore(
      persistence,
      'recovery',
      0,
    );
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('external-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('external-session')]),
      recovery,
    );
    ready(controller);
    await waitForConnected(messages);
    expect(snapshots(messages).at(-1)).toMatchObject({
      historyStatus: 'unavailable',
      transcript: [],
    });

    send(controller, 'external-session', 'turn-1', 'Observed');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    ready(controller);
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)?.historyStatus).toBe('partial');
    });
  });

  it('preserves a recovered partial-history cache', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.writeSession(
      'partial-session',
      appendAcceptedUserPrompt(
        createHostTranscriptState('partial'),
        'older-turn',
        'Cached fragment',
      ),
    );
    seed.selectSession('partial-session');
    await seed.flush();
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('partial-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('partial-session')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
    );

    ready(controller);
    await waitForConnected(messages);

    expect(snapshots(messages).at(-1)).toMatchObject({
      historyStatus: 'partial',
      transcript: [
        expect.objectContaining({ text: 'Cached fragment' }),
      ],
    });
  });
});
