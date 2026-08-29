import { describe, expect, it, vi } from 'vitest';

import {
  available,
  catalogEntry,
  connectionMessages,
  createCatalog,
  createController,
  createMemoryPersistence,
  createMirrorSpy,
  createMockRuntime,
  deferred,
  type HostToWebviewMessage,
  lastMessage,
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_THINKING_TEXT_LENGTH,
  type MockRuntime,
  ready,
  retry,
  type RuntimeAvailability,
  send,
  type SessionHistoryLoader,
  SessionRecoveryStore,
  snapshots,
  stop,
  successfulTurn,
  tokenUsageMessages,
  toolActivities,
  turnStates,
  unavailableSessionHistory,
  usageFixture,
  waitForConnected,
} from './controllerTestHarness';
import { MAX_THINKING_DELTA_LENGTH } from '../shared/bridgeMessages';

describe('ChatController', () => {
  it('initializes one runtime on repeated ready messages and keeps sequences monotonic', async () => {
    const runtime = createMockRuntime();
    const createRuntime = vi.fn(() => runtime);
    const { controller, messages } = createController(createRuntime);

    ready(controller);
    ready(controller);

    await vi.waitFor(() => {
      expect(connectionMessages(messages).at(-1)).toMatchObject({
        sessionId: 'session-1',
        connection: { status: 'connected' },
      });
    });
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(runtime.initialize).toHaveBeenCalledOnce();
    expect(runtime.initialize).toHaveBeenCalledWith({
      kind: 'new',
      cwd: 'C:\\workspace',
    });
    expect(messages.map(({ sequence }) => sequence)).toEqual(
      messages.map((_, index) => index),
    );
  });

  it('reports missing and untrusted workspaces without creating a runtime', () => {
    const createRuntime = vi.fn(() => createMockRuntime());
    const noWorkspace = createController(createRuntime, {
      cwd: null,
      trusted: true,
    });
    const untrusted = createController(createRuntime, {
      cwd: 'C:\\workspace',
      trusted: false,
    });

    ready(noWorkspace.controller);
    ready(untrusted.controller);

    expect(createRuntime).not.toHaveBeenCalled();
    expect(noWorkspace.messages.at(-1)).toMatchObject({
      type: 'host.snapshot',
      sessionId: null,
      connection: {
        status: 'unavailable',
        message: 'Open a workspace folder to use DroidVisX.',
      },
    });
    expect(untrusted.messages.at(-1)).toMatchObject({
      type: 'host.snapshot',
      sessionId: null,
      connection: {
        status: 'unavailable',
        message: 'Trust this workspace to start the local Droid runtime.',
      },
    });
  });

  it('can retry startup after a workspace becomes available', async () => {
    const workspace: { cwd: string | null; trusted: boolean } = {
      cwd: null,
      trusted: true,
    };
    const runtime = createMockRuntime();
    const { controller, messages } = createController(
      () => runtime,
      workspace,
    );
    ready(controller);
    expect(connectionMessages(messages).at(-1)?.connection.status).toBe(
      'unavailable',
    );

    workspace.cwd = 'C:\\workspace';
    retry(controller, null);
    await waitForConnected(messages);

    expect(runtime.initialize).toHaveBeenCalledWith({
      kind: 'new',
      cwd: 'C:\\workspace',
    });
  });

  it('maps semantic runtime events to safe bridge messages', async () => {
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'Hello' };
      yield {
        type: 'thinking-delta',
        text: 'Safe plan',
        messageId: 'message-1',
        blockIndex: 0,
      };
      yield {
        type: 'thinking-complete',
        durationMs: null,
        messageId: 'message-1',
        blockIndex: 0,
      };
      yield { type: 'error' };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Say hello');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'assistant.delta',
          sessionId: 'session-1',
          turnId: 'turn-1',
          delta: 'Hello',
        }),
        expect.objectContaining({
          type: 'thinking.delta',
          delta: 'Safe plan',
          truncated: false,
          segmentIndex: 0,
        }),
        expect.objectContaining({
          type: 'thinking.complete',
          durationMs: null,
          segmentIndex: 0,
        }),
        expect.objectContaining({
          type: 'runtime.diagnostic',
          code: 'runtime-event-error',
          message:
            'Droid reported a runtime error while processing this turn.',
        }),
      ]),
    );
  });

  it('enters streaming before tool activity and projects safe progress', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'tool-start',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
      };
      yield {
        type: 'tool-progress',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
        updateKind: 'status',
      };
      yield {
        type: 'tool-result',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
        isError: false,
      };
      yield {
        type: 'tool-progress',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
        updateKind: 'message',
      };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Read a file');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    const activities = toolActivities(messages);
    expect(activities).toEqual([
      expect.objectContaining({
        toolUseId: 'tool-1',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'running',
        progressCount: 0,
        latestUpdateKind: null,
      }),
      expect.objectContaining({
        toolUseId: 'tool-1',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'running',
        progressCount: 1,
        latestUpdateKind: 'status',
      }),
      expect.objectContaining({
        toolUseId: 'tool-1',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'completed',
        progressCount: 1,
        latestUpdateKind: 'status',
      }),
    ]);
    expect(
      messages.findIndex(
        (message) =>
          message.type === 'turn.state' &&
          message.status === 'streaming',
      ),
    ).toBeLessThan(
      messages.findIndex((message) => message.type === 'tool.activity'),
    );
  });

  it('captures a complete partial path set before the stream advances', async () => {
    const releaseCapture = deferred<void>();
    const afterIncompleteCall = vi.fn();
    const afterCompleteCall = vi.fn();
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'tool-start',
        toolName: 'Edit',
        toolUseId: 'edit-1',
        action: 'Updated workspace files',
        filePath: 'index.html',
      };
      afterIncompleteCall();
      yield {
        type: 'tool-start',
        toolName: 'Edit',
        toolUseId: 'edit-1',
        action: 'Updated workspace files',
        filePath: 'index.html',
        filePathsComplete: true,
      };
      yield {
        type: 'tool-start',
        toolName: 'Edit',
        toolUseId: 'edit-1',
        action: 'Updated workspace files',
        inputComplete: true,
        filePath: 'index.html',
      };
      afterCompleteCall();
      yield {
        type: 'tool-result',
        toolName: 'Edit',
        toolUseId: 'edit-1',
        action: 'Updated workspace files',
        isError: false,
      };
      yield successfulTurn();
    });
    const captureTurnBaseline = vi.fn(async () => releaseCapture.promise);
    const read = vi.fn(async () =>
      new Map([
        ['index.html', { additions: 4, deletions: 1 }],
      ]),
    );
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      undefined,
      { read, captureTurnBaseline },
    );
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Update the prototype');
    await vi.waitFor(() => {
      expect(captureTurnBaseline).toHaveBeenCalledWith(
        { sessionId: 'session-1', turnId: 'turn-1' },
        ['index.html'],
      );
    });
    expect(afterIncompleteCall).toHaveBeenCalledOnce();
    expect(captureTurnBaseline).toHaveBeenCalledOnce();
    expect(afterCompleteCall).not.toHaveBeenCalled();

    releaseCapture.resolve();
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
      expect(read).toHaveBeenCalledWith(
        ['index.html'],
        { sessionId: 'session-1', turnId: 'turn-1' },
      );
    });
    expect(captureTurnBaseline).toHaveBeenCalledTimes(2);
    expect(afterCompleteCall).toHaveBeenCalledOnce();
  });

  it('mirrors execute lifecycle and output into the terminal mirror', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'tool-start',
        toolName: 'Execute',
        toolUseId: 'exec-1',
        action: 'Ran a command',
        detailKind: 'command',
        detail: 'pnpm ls',
      };
      yield {
        type: 'tool-progress',
        toolName: 'Execute',
        toolUseId: 'exec-1',
        action: 'Ran a command',
        updateKind: 'status',
        outputTail: 'pkg-a\npkg-b',
      };
      yield {
        type: 'tool-result',
        toolName: 'Execute',
        toolUseId: 'exec-1',
        action: 'Ran a command',
        isError: false,
      };
      yield {
        type: 'tool-start',
        toolName: 'Read',
        toolUseId: 'read-1',
        action: 'Read workspace files',
      };
      yield successfulTurn();
    });
    const mirror = createMirrorSpy();
    const { controller, messages } = createController(
      () => runtime,
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
      mirror,
    );
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Run pnpm ls');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(mirror.commandStarted).toHaveBeenCalledExactlyOnceWith({
      toolUseId: 'exec-1',
      command: 'pnpm ls',
      sessionTag: 'session-1'.slice(0, 8),
    });
    expect(mirror.commandOutput).toHaveBeenCalledExactlyOnceWith(
      'exec-1',
      'pkg-a\npkg-b',
    );
    expect(mirror.commandSettled).toHaveBeenCalledExactlyOnceWith(
      'exec-1',
    );
    // Turn completion releases all mirror state; the non-execute
    // Read tool never reached the mirror at all.
    expect(mirror.settleAll).toHaveBeenCalled();
  });

  it('opens the terminal mirror only for the live session id', async () => {
    const mirror = createMirrorSpy();
    const { controller, messages } = createController(
      () => createMockRuntime(),
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
      mirror,
    );
    // Before the handshake nothing is connected: fail closed.
    controller.handleMessage({
      type: 'terminal.openMirror',
      sessionId: 'session-1',
    });
    expect(mirror.open).not.toHaveBeenCalled();

    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'terminal.openMirror',
      sessionId: 'forged-session',
    });
    expect(mirror.open).not.toHaveBeenCalled();

    controller.handleMessage({
      type: 'terminal.openMirror',
      sessionId: 'session-1',
    });
    expect(mirror.open).toHaveBeenCalledTimes(1);
  });

  it('upgrades a Task row on delegation and settles it from the ledger', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'tool-start',
        toolName: 'Task',
        toolUseId: 'task-1',
        action: 'Delegated focused work',
      };
      yield {
        type: 'subagent-started',
        toolUseId: 'task-1',
        subagentType: 'explore',
        description: 'Survey the auth module',
      };
      yield {
        type: 'tool-result',
        toolName: 'Task',
        toolUseId: 'task-1',
        action: 'Delegated focused work',
        isError: false,
      };
      yield successfulTurn();
    });
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async () => unavailableSessionHistory()),
      loadSubagentSummaries: vi.fn(async () => [
        {
          type: 'explore',
          description: 'Survey the auth module',
          status: 'completed' as const,
          toolUseCount: 7,
          durationMs: 4200,
        },
      ]),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      history,
    );
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Delegate the survey');

    // The turn-end settlement arrives on the out-of-band channel: a
    // live webview drops tool.activity once the turn is terminal, so
    // only subagent.update can land the ledger's verdict.
    await vi.waitFor(() => {
      expect(
        messages.find(
          (message) => message.type === 'subagent.update',
        ),
      ).toMatchObject({
        sessionId: 'session-1',
        turnId: 'turn-1',
        toolUseId: 'task-1',
        subagent: {
          type: 'explore',
          description: 'Survey the auth module',
          status: 'completed',
          toolUseCount: 7,
          durationMs: 4200,
        },
      });
    });
    expect(history.loadSubagentSummaries).toHaveBeenCalledWith({
      cwd: 'C:\\workspace',
      sessionId: 'session-1',
    });
    const activities = toolActivities(messages);
    expect(activities).toEqual([
      expect.objectContaining({
        toolUseId: 'task-1',
        status: 'running',
      }),
      expect.objectContaining({
        toolUseId: 'task-1',
        status: 'running',
        subagent: {
          type: 'explore',
          description: 'Survey the auth module',
          status: 'running',
        },
      }),
      expect.objectContaining({
        toolUseId: 'task-1',
        status: 'completed',
        subagent: {
          type: 'explore',
          description: 'Survey the auth module',
          status: 'running',
        },
      }),
    ]);
    // The settlement lands after the terminal turn state.
    expect(
      messages.findIndex(
        (message) =>
          message.type === 'turn.state' &&
          message.status === 'completed',
      ),
    ).toBeLessThan(
      messages.findIndex(
        (message) => message.type === 'subagent.update',
      ),
    );
  });

  it('keeps reconciling a background delegation after the turn ended', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'tool-start',
        toolName: 'Task',
        toolUseId: 'task-bg',
        action: 'Delegated focused work',
      };
      yield {
        type: 'subagent-started',
        toolUseId: 'task-bg',
        subagentType: 'explore',
        description: 'Background research',
      };
      yield {
        type: 'tool-result',
        toolName: 'Task',
        toolUseId: 'task-bg',
        action: 'Delegated focused work',
        isError: false,
      };
      yield successfulTurn();
    });
    // The ledger keeps reporting `running` at turn end (probed
    // 2026-08-12: background children settle minutes later with no
    // notification) and flips to `completed` on a later poll.
    const running = {
      type: 'explore',
      description: 'Background research',
      status: 'running' as const,
    };
    const completed = {
      type: 'explore',
      description: 'Background research',
      status: 'completed' as const,
      toolUseCount: 9,
      durationMs: 123_000,
    };
    let settledInLedger = false;
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async () => unavailableSessionHistory()),
      loadSubagentSummaries: vi.fn(async () => [
        settledInLedger ? completed : running,
      ]),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      history,
    );
    ready(controller);
    await waitForConnected(messages);

    const settlements = () =>
      messages.filter(
        (message) => message.type === 'subagent.update',
      ) as Array<
        Extract<HostToWebviewMessage, { type: 'subagent.update' }>
      >;
    // Fake timers must own the watch's interval from birth, so the
    // whole turn runs under them (the mock stream is microtask-only).
    vi.useFakeTimers();
    try {
      send(controller, 'session-1', 'turn-1', 'Delegate in the background');
      await vi.advanceTimersByTimeAsync(0);
      expect(history.loadSubagentSummaries).toHaveBeenCalledTimes(1);

      // While the ledger still says running, polls settle nothing.
      await vi.advanceTimersByTimeAsync(5_100);
      expect(settlements()).toHaveLength(0);

      settledInLedger = true;
      await vi.advanceTimersByTimeAsync(5_100);
      expect(settlements()).toEqual([
        expect.objectContaining({
          type: 'subagent.update',
          sessionId: 'session-1',
          turnId: 'turn-1',
          toolUseId: 'task-bg',
          subagent: completed,
        }),
      ]);

      // The watch cleared itself: no further polling.
      const loads = (
        history.loadSubagentSummaries as ReturnType<typeof vi.fn>
      ).mock.calls.length;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(
        (history.loadSubagentSummaries as ReturnType<typeof vi.fn>)
          .mock.calls.length,
      ).toBe(loads);
    } finally {
      vi.useRealTimers();
    }

    // The settlement also landed in the host transcript, so a
    // reloading webview snapshots the settled row.
    ready(controller);
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'host.snapshot')?.transcript.find(
          (item) => item.kind === 'tool' && item.toolUseId === 'task-bg',
        ),
      ).toMatchObject({ subagent: completed });
    });
  });

  it('projects the automatic parent answer after a background child settles', async () => {
    const runtime = Object.assign(
      createMockRuntime(async function* () {
        yield {
          type: 'tool-start',
          toolName: 'Task',
          toolUseId: 'task-bg',
          action: 'Delegated focused work',
        };
        yield {
          type: 'subagent-started',
          toolUseId: 'task-bg',
          subagentType: 'explore',
          description: 'Background research',
        };
        yield {
          type: 'tool-result',
          toolName: 'Task',
          toolUseId: 'task-bg',
          action: 'Delegated focused work',
          isError: false,
        };
        yield successfulTurn();
      }),
      {
        readSessionWorkingState: vi
          .fn()
          .mockResolvedValueOnce('idle')
          .mockResolvedValueOnce('running')
          .mockResolvedValue('idle'),
      },
    );
    const running = {
      type: 'explore',
      description: 'Background research',
      status: 'running' as const,
    };
    const completed = {
      ...running,
      status: 'completed' as const,
      toolUseCount: 4,
    };
    let settledInLedger = false;
    const loadHistory = vi.fn(async () => ({
      status: 'available' as const,
      state: {
        transcript: [
          {
            id: 'u1',
            kind: 'user' as const,
            text: 'Delegate in the background',
            messageId: 'message-1',
          },
          {
            id: 'a-final',
            kind: 'assistant' as const,
            turnId: 'history-final',
            text: 'Here is the completed research summary.',
          },
        ],
        historyStatus: 'complete' as const,
        truncated: false,
      },
    }));
    const history: SessionHistoryLoader = {
      loadHistory,
      loadSubagentSummaries: vi.fn(async () => [
        settledInLedger ? completed : running,
      ]),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      history,
    );
    ready(controller);
    await waitForConnected(messages);

    vi.useFakeTimers();
    try {
      send(controller, 'session-1', 'turn-1', 'Delegate in the background');
      await vi.advanceTimersByTimeAsync(0);
      settledInLedger = true;
      await vi.advanceTimersByTimeAsync(5_100);

      // Child settlement is followed by a real idle gap. Reading now
      // would reproduce the production loss, so the grace holds.
      await vi.advanceTimersByTimeAsync(5_100);
      expect(loadHistory).not.toHaveBeenCalled();

      // The hidden completion notification starts the automatic
      // parent turn, then its first idle sample is still held long
      // enough for chained completion notifications to start.
      await vi.advanceTimersByTimeAsync(5_100);
      expect(loadHistory).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(10_100);

      expect(loadHistory).toHaveBeenCalledOnce();
      expect(
        snapshots(messages).at(-1)?.transcript.at(-1),
      ).toMatchObject({
        kind: 'assistant',
        text: 'Here is the completed research summary.',
      });

      // The watch closes once a running→idle automatic turn exposes
      // the changed answer; no further history polling remains.
      const loads = loadHistory.mock.calls.length;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(loadHistory).toHaveBeenCalledTimes(loads);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the parent-history fallback bounded when no answer appears', async () => {
    const runtime = Object.assign(
      createMockRuntime(async function* () {
        yield {
          type: 'tool-start',
          toolName: 'Task',
          toolUseId: 'task-bg',
          action: 'Delegated focused work',
        };
        yield {
          type: 'subagent-started',
          toolUseId: 'task-bg',
          subagentType: 'explore',
          description: 'Quiet background research',
        };
        yield {
          type: 'tool-result',
          toolName: 'Task',
          toolUseId: 'task-bg',
          action: 'Delegated focused work',
          isError: false,
        };
        yield successfulTurn();
      }),
      {
        readSessionWorkingState: vi
          .fn()
          .mockResolvedValue('unknown'),
      },
    );
    const running = {
      type: 'explore',
      description: 'Quiet background research',
      status: 'running' as const,
    };
    const completed = { ...running, status: 'completed' as const };
    let settledInLedger = false;
    const loadHistory = vi.fn(async () => ({
      status: 'available' as const,
      state: {
        transcript: [],
        historyStatus: 'complete' as const,
        truncated: false,
      },
    }));
    const history: SessionHistoryLoader = {
      loadHistory,
      loadSubagentSummaries: vi.fn(async () => [
        settledInLedger ? completed : running,
      ]),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      history,
    );
    ready(controller);
    await waitForConnected(messages);

    vi.useFakeTimers();
    try {
      send(controller, 'session-1', 'turn-1', 'Delegate quietly');
      await vi.advanceTimersByTimeAsync(0);
      settledInLedger = true;
      await vi.advanceTimersByTimeAsync(35_100);
      expect(loadHistory.mock.calls.length).toBeGreaterThan(0);
      const loads = loadHistory.mock.calls.length;
      const snapshotsBefore = snapshots(messages).length;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(loadHistory).toHaveBeenCalledTimes(loads);
      expect(snapshots(messages)).toHaveLength(snapshotsBefore);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for the final child before syncing the aggregate parent answer', async () => {
    const runtime = Object.assign(
      createMockRuntime(async function* () {
        for (const [toolUseId, description] of [
          ['task-a', 'Background research A'],
          ['task-b', 'Background research B'],
        ] as const) {
          yield {
            type: 'tool-start',
            toolName: 'Task',
            toolUseId,
            action: 'Delegated focused work',
          };
          yield {
            type: 'subagent-started',
            toolUseId,
            subagentType: 'explore',
            description,
          };
          yield {
            type: 'tool-result',
            toolName: 'Task',
            toolUseId,
            action: 'Delegated focused work',
            isError: false,
          };
        }
        yield successfulTurn();
      }),
      {
        readSessionWorkingState: vi.fn().mockResolvedValue('idle'),
      },
    );
    const summaries: Array<{
      type: string;
      description: string;
      status: 'running' | 'completed';
    }> = [
      {
        type: 'explore',
        description: 'Background research A',
        status: 'running',
      },
      {
        type: 'explore',
        description: 'Background research B',
        status: 'running',
      },
    ];
    const loadHistory = vi.fn(async () => ({
      status: 'available' as const,
      state: {
        transcript: [],
        historyStatus: 'complete' as const,
        truncated: false,
      },
    }));
    const history: SessionHistoryLoader = {
      loadHistory,
      loadSubagentSummaries: vi.fn(async () => summaries),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      history,
    );
    ready(controller);
    await waitForConnected(messages);

    vi.useFakeTimers();
    try {
      send(controller, 'session-1', 'turn-1', 'Delegate twice');
      await vi.advanceTimersByTimeAsync(0);
      summaries[0] = { ...summaries[0], status: 'completed' };
      await vi.advanceTimersByTimeAsync(15_100);
      expect(loadHistory).not.toHaveBeenCalled();

      summaries[1] = { ...summaries[1], status: 'completed' };
      await vi.advanceTimersByTimeAsync(15_100);
      expect(loadHistory).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-arms the ledger poll for a replayed running delegation', async () => {
    // Reload Window while a background delegation is still running:
    // the replayed transcript row says "running", the watch that was
    // polling the ledger died with the old window, and the ledger has
    // no push channel. Resume must arm a fresh poll or the row stays
    // running on screen forever.
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.selectSession('replay-session');
    await seed.flush();
    const completed = {
      type: 'explore',
      description: 'Outlived the reload',
      status: 'completed' as const,
      toolUseCount: 5,
      durationMs: 60_000,
    };
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async () => ({
        status: 'available' as const,
        state: {
          transcript: [
            {
              id: 'replayed-tool',
              kind: 'tool' as const,
              turnId: 'turn-old',
              toolUseId: 'task-live',
              toolName: 'Task',
              action: 'Delegated focused work',
              status: 'completed' as const,
              progressCount: 0,
              latestUpdateKind: null,
              subagent: {
                type: 'explore',
                description: 'Outlived the reload',
                status: 'running' as const,
              },
            },
          ],
          historyStatus: 'complete' as const,
          truncated: false,
        },
      })),
      loadSubagentSummaries: vi.fn(async () => [completed]),
    };
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('replay-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('replay-session')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
      history,
    );

    vi.useFakeTimers();
    try {
      ready(controller);
      // Flush the resume activation, then cross one poll interval.
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(5_100);
      expect(
        messages.filter(
          (message) => message.type === 'subagent.update',
        ),
      ).toEqual([
        expect.objectContaining({
          sessionId: 'replay-session',
          turnId: 'turn-old',
          toolUseId: 'task-live',
          subagent: completed,
        }),
      ]);
      // Settled: the watch cleared itself and stops polling.
      const loads = (
        history.loadSubagentSummaries as ReturnType<typeof vi.fn>
      ).mock.calls.length;
      await vi.advanceTimersByTimeAsync(20_000);
      expect(
        (history.loadSubagentSummaries as ReturnType<typeof vi.fn>)
          .mock.calls.length,
      ).toBe(loads);
    } finally {
      vi.useRealTimers();
    }
  });

  it('never loads the invocation ledger for turns without delegation', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'tool-start',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
      };
      yield {
        type: 'tool-result',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
        isError: false,
      };
      yield successfulTurn();
    });
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async () => unavailableSessionHistory()),
      loadSubagentSummaries: vi.fn(async () => []),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      history,
    );
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Read a file');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(history.loadSubagentSummaries).not.toHaveBeenCalled();
  });

  it('surfaces the read-only mission identity of a resumed session', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.selectSession('mission-session');
    await seed.flush();
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async () => ({
        status: 'available' as const,
        state: {
          transcript: [],
          historyStatus: 'complete' as const,
          truncated: false,
        },
        mission: {
          state: 'running' as const,
          role: 'orchestrator' as const,
        },
      })),
    };
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('mission-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('mission-session')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
      history,
    );

    ready(controller);
    await waitForConnected(messages);

    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'mission-session',
      mission: { state: 'running', role: 'orchestrator' },
    });
  });

  it('omits mission identity for plain sessions and forwards catalog roles', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([
        { ...catalogEntry('worker-session'), missionRole: 'worker' },
        catalogEntry('plain-session'),
      ]),
    );

    ready(controller);
    await waitForConnected(messages);

    const snapshot = snapshots(messages).at(-1);
    expect(snapshot).not.toHaveProperty('mission');
    const items = snapshot?.sessions.items ?? [];
    expect(
      items.find((item) => item.id === 'worker-session'),
    ).toMatchObject({ missionRole: 'worker' });
    expect(
      items.find((item) => item.id === 'plain-session'),
    ).not.toHaveProperty('missionRole');
  });

  it('publishes cumulative and per-turn token usage from runtime events', async () => {
    const first = usageFixture();
    const second = usageFixture({ inputTokens: 2565, outputTokens: 81 });
    const turnUsage = usageFixture({
      inputTokens: 1719,
      outputTokens: 76,
      factoryCredits: 0,
    });
    const runtime = createMockRuntime(async function* () {
      yield { type: 'token-usage', cumulative: first };
      yield { type: 'token-usage', cumulative: second };
      yield { ...successfulTurn(), turnUsage };
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    // No usage reported yet: the snapshot omits the field entirely.
    expect(snapshots(messages).at(-1)).not.toHaveProperty('tokenUsage');

    send(controller, 'session-1', 'turn-1', 'Count tokens');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });

    expect(
      tokenUsageMessages(messages).map(({ tokenUsage }) => tokenUsage),
    ).toEqual([
      { cumulative: first, lastTurn: null },
      { cumulative: second, lastTurn: null },
      { cumulative: second, lastTurn: turnUsage },
    ]);
  });

  it('seeds cumulative token usage from history when resuming a session', async () => {
    const persistence = createMemoryPersistence();
    const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
    seed.selectSession('usage-session');
    await seed.flush();
    const cumulative = usageFixture({ factoryCredits: 2 });
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async () => ({
        status: 'available' as const,
        state: {
          transcript: [],
          historyStatus: 'complete' as const,
          truncated: false,
        },
        tokenUsage: cumulative,
      })),
    };
    const runtime = createMockRuntime();
    runtime.initialize.mockResolvedValue(available('usage-session'));
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([catalogEntry('usage-session')]),
      new SessionRecoveryStore(persistence, 'recovery', 0),
      history,
    );

    ready(controller);
    await waitForConnected(messages);

    // History carries no per-turn usage, so only cumulative is seeded.
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'usage-session',
      tokenUsage: { cumulative, lastTurn: null },
    });
  });

  it('caps assistant output and emits one safe truncation diagnostic', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'text-delta',
        text: 'a'.repeat(MAX_ASSISTANT_TEXT_LENGTH),
      };
      yield { type: 'text-delta', text: '' };
      yield { type: 'text-delta', text: 'secret overflow' };
      yield { type: 'text-delta', text: 'more secret overflow' };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Write');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    const assistant = messages.filter(
      (message) => message.type === 'assistant.delta',
    );
    const diagnostics = messages.filter(
      (message) =>
        message.type === 'runtime.diagnostic' &&
        message.code === 'assistant-output-truncated',
    );
    expect(assistant).toHaveLength(1);
    expect(assistant[0]).toMatchObject({
      delta: 'a'.repeat(MAX_ASSISTANT_TEXT_LENGTH),
    });
    expect(diagnostics).toEqual([
      expect.objectContaining({
        severity: 'warning',
        message:
          'Assistant output exceeded the display limit and was truncated.',
      }),
    ]);
    expect(JSON.stringify(messages)).not.toContain('secret overflow');
  });

  it('coalesces token-level Thinking and flushes before later events', async () => {
    const runtime = createMockRuntime(async function* () {
      for (let index = 0; index < 128; index += 1) {
        yield {
          type: 'thinking-delta',
          text: 'x',
          messageId: 'message-1',
          blockIndex: 0,
        };
      }
      yield {
        type: 'tool-start',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
      };
      yield { type: 'text-delta', text: 'Done' };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Think');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    const thinking = messages.filter(
      (message) => message.type === 'thinking.delta',
    );
    expect(thinking).toHaveLength(1);
    expect(thinking[0]).toMatchObject({
      delta: 'x'.repeat(128),
      truncated: false,
      segmentIndex: 0,
    });
    const thinkingIndex = messages.findIndex(
      (message) => message.type === 'thinking.delta',
    );
    const toolIndex = messages.findIndex(
      (message) => message.type === 'tool.activity',
    );
    const textIndex = messages.findIndex(
      (message) => message.type === 'assistant.delta',
    );
    const completedIndex = messages.findIndex(
      (message) =>
        message.type === 'turn.state' && message.status === 'completed',
    );
    expect(thinkingIndex).toBeGreaterThanOrEqual(0);
    expect(toolIndex).toBeGreaterThan(thinkingIndex);
    expect(textIndex).toBeGreaterThan(toolIndex);
    expect(completedIndex).toBeGreaterThan(textIndex);
  });

  it('retains Thinking beyond the former 32K display cutoff', async () => {
    const longThinking = 'a'.repeat(40_000);
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'thinking-delta',
        text: longThinking,
        messageId: 'message-1',
        blockIndex: 0,
      };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Think');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    const thinking = messages.filter(
      (message) => message.type === 'thinking.delta',
    );
    expect(
      thinking.map((message) => message.delta).join(''),
    ).toBe(longThinking);
    expect(
      thinking.every(
        (message) =>
          message.delta.length <= MAX_THINKING_DELTA_LENGTH &&
          !message.truncated,
      ),
    ).toBe(true);
  });

  it('caps thinking output and emits truncation only once', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'thinking-delta',
        text: 'a'.repeat(MAX_THINKING_TEXT_LENGTH),
        messageId: 'message-1',
        blockIndex: 0,
      };
      yield {
        type: 'thinking-delta',
        text: 'secret overflow',
        messageId: 'message-2',
        blockIndex: 0,
      };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Think');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    const thinking = messages.filter(
      (message) => message.type === 'thinking.delta',
    );
    expect(thinking).toHaveLength(
      Math.ceil(
        MAX_THINKING_TEXT_LENGTH / MAX_THINKING_DELTA_LENGTH,
      ),
    );
    expect(thinking.map((message) => message.delta).join('')).toBe(
      'a'.repeat(MAX_THINKING_TEXT_LENGTH),
    );
    expect(
      thinking.every(
        (message) => message.delta.length <= MAX_THINKING_DELTA_LENGTH,
      ),
    ).toBe(true);
    expect(thinking.filter((message) => message.truncated)).toEqual([
      expect.objectContaining({
        truncated: true,
        segmentIndex: 0,
      }),
    ]);
    expect(JSON.stringify(messages)).not.toContain('secret overflow');
  });

  it('flushes pending Thinking on Stop without a late timer duplicate', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'thinking-delta',
        text: 'pending thought',
        messageId: 'message-1',
        blockIndex: 0,
      };
      await release.promise;
      yield {
        ...successfulTurn(),
        outcome: 'interrupted',
      };
    });
    runtime.interrupt.mockImplementation(async () => release.resolve());
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Think');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('streaming');
    });
    stop(controller, 'session-1', 'turn-1');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('interrupted');
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    const thinking = messages.filter(
      (message) => message.type === 'thinking.delta',
    );
    expect(thinking).toEqual([
      expect.objectContaining({
        delta: 'pending thought',
        truncated: false,
        segmentIndex: 0,
      }),
    ]);
  });

  it('numbers interleaved thinking segments and completes each in place', async () => {
    // Probed shape (artifacts/probe-interleaved-thinking.out.json):
    // think→tool→think arrives as two delta→complete sequences with
    // distinct messageIds strictly interleaved with the tool events.
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'thinking-delta',
        text: 'First thought',
        messageId: 'message-1',
        blockIndex: 0,
      };
      yield {
        type: 'thinking-complete',
        durationMs: 154,
        messageId: 'message-1',
        blockIndex: 0,
      };
      yield {
        type: 'tool-start',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
      };
      yield {
        type: 'tool-result',
        toolName: 'Read',
        toolUseId: 'tool-1',
        action: 'Read workspace files',
        isError: false,
      };
      yield {
        type: 'thinking-delta',
        text: 'Second thought',
        messageId: 'message-2',
        blockIndex: 0,
      };
      yield {
        type: 'thinking-complete',
        durationMs: 168,
        messageId: 'message-2',
        blockIndex: 0,
      };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Think twice');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    const thinking = messages.filter(
      (message) =>
        message.type === 'thinking.delta' ||
        message.type === 'thinking.complete',
    );
    expect(thinking).toEqual([
      expect.objectContaining({
        type: 'thinking.delta',
        delta: 'First thought',
        segmentIndex: 0,
      }),
      expect.objectContaining({
        type: 'thinking.complete',
        durationMs: 154,
        segmentIndex: 0,
      }),
      expect.objectContaining({
        type: 'thinking.delta',
        delta: 'Second thought',
        segmentIndex: 1,
      }),
      expect.objectContaining({
        type: 'thinking.complete',
        durationMs: 168,
        segmentIndex: 1,
      }),
    ]);
  });

  it('suppresses completions for thinking segments without deltas', async () => {
    // Probed: the auto-routed model can emit complete-only segments
    // (zero deltas); those must not surface an empty Thinking row.
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'thinking-complete',
        durationMs: 12,
        messageId: 'message-empty',
        blockIndex: 0,
      };
      yield {
        type: 'thinking-delta',
        text: 'Visible thought',
        messageId: 'message-1',
        blockIndex: 0,
      };
      yield {
        type: 'thinking-complete',
        durationMs: 34,
        messageId: 'message-1',
        blockIndex: 0,
      };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Think');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    const completes = messages.filter(
      (message) => message.type === 'thinking.complete',
    );
    expect(completes).toEqual([
      expect.objectContaining({ durationMs: 34, segmentIndex: 0 }),
    ]);
  });

  it('uses non-idle working state to enter streaming and keeps idle silent', async () => {
    const runtime = createMockRuntime(async function* () {
      yield { type: 'working-state', isWorking: false };
      yield { type: 'working-state', isWorking: true };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Work');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(turnStates(messages).map(({ status }) => status)).toEqual([
      'submitting',
      'streaming',
      'completed',
    ]);
    expect(
      messages.some(
        (message) =>
          message.type === 'assistant.delta' ||
          message.type === 'thinking.delta' ||
          message.type === 'thinking.complete' ||
          message.type === 'tool.activity' ||
          message.type === 'runtime.diagnostic',
      ),
    ).toBe(false);
  });

  it('does not enter streaming for idle working state alone', async () => {
    const runtime = createMockRuntime(async function* () {
      yield { type: 'working-state', isWorking: false };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Wait');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(turnStates(messages).map(({ status }) => status)).toEqual([
      'submitting',
      'completed',
    ]);
  });

  it('fails execution outcomes with a safe retryable turn error', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        ...successfulTurn(),
        outcome: 'error_during_execution',
      };
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Run');

    await vi.waitFor(() => {
      expect(
        messages.find((message) => message.type === 'turn.error'),
      ).toMatchObject({
        code: 'runtime-execution-failed',
        retryable: true,
      });
    });
    expect(turnStates(messages).at(-1)?.status).toBe('failed');
  });

  it('makes stop idempotent and drops every late nonterminal event', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'before stop' };
      await release.promise;
      yield { type: 'text-delta', text: 'late sensitive text' };
      yield {
        type: 'thinking-delta',
        text: 'late sensitive thinking',
        messageId: 'message-late',
        blockIndex: 0,
      };
      yield {
        type: 'tool-start',
        toolName: 'LateSensitiveTool',
        toolUseId: 'late-sensitive-id',
        action: 'Used Late Sensitive Tool',
      };
      yield { type: 'working-state', isWorking: true };
      yield { type: 'error' };
      yield {
        ...successfulTurn(),
        outcome: 'interrupted',
      };
    });
    runtime.interrupt.mockImplementation(async () => release.resolve());
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'wrong-session', 'ignored', 'No');
    send(controller, 'session-1', 'turn-1', 'Start');
    send(controller, 'session-1', 'turn-2', 'Duplicate');
    await vi.waitFor(() => {
      expect(
        messages.some((message) => message.type === 'assistant.delta'),
      ).toBe(true);
    });

    stop(controller, 'wrong-session', 'turn-1');
    stop(controller, 'session-1', 'wrong-turn');
    stop(controller, 'session-1', 'turn-1');
    stop(controller, 'session-1', 'turn-1');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('interrupted');
    });
    expect(runtime.sendTurn).toHaveBeenCalledOnce();
    expect(runtime.interrupt).toHaveBeenCalledOnce();
    expect(
      messages.filter((message) => message.type === 'assistant.delta'),
    ).toHaveLength(1);
    expect(
      messages.some(
        (message) =>
          message.type === 'thinking.delta' ||
          message.type === 'tool.activity' ||
          message.type === 'runtime.diagnostic',
      ),
    ).toBe(false);
    expect(JSON.stringify(messages)).not.toContain('late sensitive');
    expect(JSON.stringify(messages)).not.toContain('LateSensitiveTool');
  });

  it('disposes a failed runtime before retrying and ignores its late cleanup', async () => {
    const disposed = deferred<void>();
    const first = createMockRuntime(async function* () {
      throw new Error('sensitive stream failure');
    });
    first.dispose.mockImplementation(() => disposed.promise);
    const second = createMockRuntime();
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Fail');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('failed');
    });

    retry(controller, 'wrong-session');
    retry(controller, 'session-1');
    retry(controller, 'session-1');
    await vi.waitFor(() => {
      expect(first.dispose).toHaveBeenCalledOnce();
    });
    expect(createRuntime).toHaveBeenCalledOnce();

    disposed.resolve();
    await vi.waitFor(() => {
      expect(createRuntime).toHaveBeenCalledTimes(2);
      expect(connectionMessages(messages).at(-1)).toMatchObject({
        sessionId: 'session-1',
        connection: { status: 'connected' },
      });
    });
    expect(second.initialize).toHaveBeenCalledWith({
      kind: 'resume',
      cwd: 'C:\\workspace',
      sessionId: 'session-1',
    });
  });

  it('fails a stopped turn safely when interrupt rejects and drops late events', async () => {
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'before stop' };
      await release.promise;
      yield { type: 'text-delta', text: 'late sensitive content' };
    });
    runtime.interrupt.mockRejectedValue(new Error('sensitive interrupt failure'));
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Start');
    await vi.waitFor(() => {
      expect(
        messages.some((message) => message.type === 'assistant.delta'),
      ).toBe(true);
    });

    stop(controller, 'session-1', 'turn-1');

    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('failed');
    });
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'turn.error',
          code: 'runtime-interrupt-failed',
          retryable: true,
        }),
      ]),
    );
    release.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(JSON.stringify(messages)).not.toContain('late sensitive content');
    expect(JSON.stringify(messages)).not.toContain(
      'sensitive interrupt failure',
    );
  });

  it('reports cleanup failure and allows a later retry with a fresh runtime', async () => {
    const first = createMockRuntime(async function* () {
      throw new Error('stream failure');
    });
    first.dispose
      .mockRejectedValueOnce(new Error('sensitive cleanup failure'))
      .mockResolvedValueOnce();
    const second = createMockRuntime();
    const createRuntime = vi
      .fn<() => MockRuntime>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Fail');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('failed');
    });

    retry(controller, 'session-1');
    await vi.waitFor(() => {
      expect(connectionMessages(messages).at(-1)).toMatchObject({
        sessionId: 'session-1',
        connection: {
          status: 'unavailable',
          message: 'The current Droid session could not be closed.',
        },
      });
    });
    expect(createRuntime).toHaveBeenCalledOnce();
    expect(JSON.stringify(messages)).not.toContain('sensitive cleanup failure');

    retry(controller, 'session-1');
    await vi.waitFor(() => {
      expect(createRuntime).toHaveBeenCalledTimes(2);
      expect(connectionMessages(messages).at(-1)).toMatchObject({
        sessionId: 'session-1',
        connection: { status: 'connected' },
      });
    });
  });

  it('does not create a replacement runtime when disposed during retry cleanup', async () => {
    const cleanup = deferred<void>();
    const first = createMockRuntime(async function* () {
      throw new Error('stream failure');
    });
    first.dispose.mockImplementation(() => cleanup.promise);
    const createRuntime = vi.fn(() => first);
    const { controller, messages } = createController(createRuntime);
    ready(controller);
    await waitForConnected(messages);
    send(controller, 'session-1', 'turn-1', 'Fail');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('failed');
    });

    retry(controller, 'session-1');
    const disposal = controller.dispose();
    cleanup.resolve();
    await disposal;
    await Promise.resolve();

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(createRuntime).toHaveBeenCalledOnce();
    const count = messages.length;
    ready(controller);
    retry(controller, null);
    expect(messages).toHaveLength(count);
  });

  it('keeps the session alive without listeners and disposes once', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    const detachedMessages: HostToWebviewMessage[] = [];
    const detached = controller.subscribe((message) => {
      detachedMessages.push(message);
    });
    detached.dispose();
    ready(controller);

    expect(runtime.initialize).toHaveBeenCalledOnce();
    expect(detachedMessages).toEqual([]);
    const firstDisposal = controller.dispose();
    const secondDisposal = controller.dispose();
    expect(secondDisposal).toBe(firstDisposal);
    await firstDisposal;
    expect(runtime.dispose).toHaveBeenCalledOnce();

    const count = messages.length;
    ready(controller);
    expect(messages).toHaveLength(count);
  });

  it('drops an initialization result that arrives after disposal', async () => {
    const initialization = deferred<RuntimeAvailability>();
    const runtime = createMockRuntime();
    runtime.initialize.mockImplementation(() => initialization.promise);
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    const disposal = controller.dispose();
    initialization.resolve(available());
    await disposal;
    await Promise.resolve();

    expect(runtime.dispose).not.toHaveBeenCalled();
    expect(messages).toHaveLength(0);
  });
});
