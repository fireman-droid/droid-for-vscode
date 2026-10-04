import { describe, expect, it, vi } from 'vitest';

import {
  available,
  ChatController,
  createCatalog,
  createController,
  createMockRuntime,
  deferred,
  SessionRecoveryStore,
  type FileChangeStat,
  type FileDiffOutcome,
  type GitWorkflow,
  lastMessage,
  type OpenPathOutcome,
  type PrototypePreviewOutcome,
  ready,
  send,
  type SessionHistoryLoader,
  snapshots,
  successfulTurn,
  turnStates,
  waitForConnected,
} from './controllerTestHarness';
import { createTurnActivityState } from './turns/turnActivityState';

describe('ChatController', () => {
  it('compacts the session without replacing the canonical Conversation', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      compact: vi.fn(async () => ({
        sessionId: 'session-compacted',
        removedCount: 5,
      })),
    });
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async ({ sessionId }) =>
        sessionId === 'session-compacted'
          ? {
              status: 'available' as const,
              state: {
                transcript: [
                  {
                    id: 'summary-1',
                    kind: 'assistant' as const,
                    turnId: 'summary-turn',
                    text: 'Summary of earlier work',
                  },
                ],
                historyStatus: 'complete' as const,
                truncated: false,
              },
            }
          : {
              status: 'unavailable' as const,
              reason: 'history-failed' as const,
              message: 'Saved Droid session history could not be loaded.' as const,
            },
      ),
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
    send(controller, 'session-1', 'turn-before-compact', 'Original question');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });

    controller.handleMessage({
      type: 'session.compact',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)).toMatchObject({
        conversationId: 'session-1',
        sessionId: 'session-compacted',
      });
    });
    expect(
      snapshots(messages)
        .at(-1)!
        .transcript.some(
          (item) => item.kind === 'user' && item.text === 'Original question',
        ),
    ).toBe(true);
    expect(
      snapshots(messages)
        .at(-1)!
        .transcript.some(
          (item) => item.kind === 'assistant' && item.text === 'Summary of earlier work',
        ),
    ).toBe(false);
    expect(runtime.compact).toHaveBeenCalledOnce();
    expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
      severity: 'info',
      code: 'session-compacted',
      message: expect.stringContaining('5'),
    });
    // Compact/Handoff lineage projects as one selectable Conversation.
    const sessions = snapshots(messages).at(-1)!.sessions;
    expect(sessions.items).toHaveLength(1);
    expect(sessions.items[0]).toMatchObject({
      id: 'session-compacted',
      active: true,
    });

    // Wrong session id is ignored entirely.
    controller.handleMessage({
      type: 'session.compact',
      sessionId: 'session-other',
    });
    expect(runtime.compact).toHaveBeenCalledOnce();
  });

  it('opens a native diff for validated tool paths and reports failures', async () => {
    const openDiff = vi.fn(async (): Promise<FileDiffOutcome> => 'opened-diff');
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      { openDiff },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-1',
      turnId: 'turn-1',
      path: 'src/app.ts',
    });
    await vi.waitFor(() => {
      expect(openDiff).toHaveBeenCalledWith('src/app.ts', {
        sessionId: 'session-1',
        turnId: 'turn-1',
      });
    });
    expect(
      messages.filter(
        (message) =>
          message.type === 'runtime.diagnostic' && message.code === 'file-diff-failed',
      ),
    ).toHaveLength(0);

    // Wrong session requests never reach the opener.
    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-other',
      turnId: 'turn-1',
      path: 'src/app.ts',
    });
    expect(openDiff).toHaveBeenCalledOnce();

    // A failed open surfaces a bounded warning diagnostic naming the
    // offending path (QA v0.3 P2-3).
    openDiff.mockResolvedValueOnce('failed');
    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-1',
      turnId: 'turn-1',
      path: 'src/missing.ts',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        severity: 'warning',
        code: 'file-diff-failed',
        message: expect.stringContaining('src/missing.ts'),
      });
    });
  });

  it('routes Review file selection to the coordinator', async () => {
    const { controller, messages } = createController(() => createMockRuntime());
    const handle = vi.fn();
    Object.defineProperty(controller, 'reviewCoordinator', {
      value: {
        handle,
        replay: vi.fn(async () => {}),
        dispose: vi.fn(),
      },
    });
    ready(controller);
    await waitForConnected(messages);

    const message = {
      type: 'review.selectFile' as const,
      sessionId: 'session-1',
      reviewScopeId: 'scope-1',
      baseline: 'baseline-1',
      path: 'src/app.ts',
    };
    controller.handleMessage(message);

    expect(handle).toHaveBeenCalledWith(message);
  });

  it('uses the retained commit only for the latest Changes turn after Reload', async () => {
    const openDiff = vi.fn(async (): Promise<FileDiffOutcome> => 'opened-diff');
    const changeStats = {
      read: vi.fn(async () => new Map()),
      readCommittedTurn: vi.fn(() => ({
        turnId: 'live-turn-before-reload',
        hash: 'abc1234',
        paths: ['src/app.ts'],
      })),
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      { openDiff },
      changeStats,
    );
    ready(controller);
    await waitForConnected(messages);
    expect(
      controller.recoveryStore.recordSettledTurn(
        controller.sessionState.conversationId!,
        'session-1',
        'history-turn',
        null,
        [{ path: 'src/app.ts', additions: null, deletions: null }],
        'completed',
      ),
    ).toBe(true);
    controller.recoveryState.transcript = {
      transcript: [],
      historyStatus: 'complete',
      truncated: false,
    };

    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-1',
      turnId: 'history-turn',
      path: 'src/app.ts',
    });
    await vi.waitFor(() => {
      expect(openDiff).toHaveBeenCalledWith(
        'src/app.ts',
        { sessionId: 'session-1', turnId: 'history-turn' },
        { committedRef: 'abc1234' },
      );
    });

    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-1',
      turnId: 'older-turn',
      path: 'src/app.ts',
    });
    await vi.waitFor(() => {
      expect(openDiff).toHaveBeenLastCalledWith('src/app.ts', {
        sessionId: 'session-1',
        turnId: 'older-turn',
      });
    });
  });

  it('words a missing file by turn state: still-writing vs moved-or-deleted', async () => {
    const openDiff = vi.fn(async (): Promise<FileDiffOutcome> => 'not-found');
    const release = deferred<void>();
    const runtime = createMockRuntime(async function* () {
      yield { type: 'text-delta', text: 'writing the file' };
      await release.promise;
      yield successfulTurn();
    });
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      { openDiff },
    );
    ready(controller);
    await waitForConnected(messages);

    // Missing during the active turn: Droid has not written it yet.
    send(controller, 'session-1', 'turn-1', 'Create the file');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('streaming');
    });
    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-1',
      turnId: 'turn-1',
      path: 'docs/Canvas-API-学习文档.md',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        severity: 'warning',
        code: 'file-not-ready',
        turnId: 'turn-1',
      });
    });
    const snapshotCount = snapshots(messages).length;
    ready(controller);
    await vi.waitFor(() => {
      expect(snapshots(messages).length).toBeGreaterThan(snapshotCount);
    });
    expect(
      snapshots(messages)
        .at(-1)!
        .transcript.some(
          (item) => item.kind === 'diagnostic' && item.code === 'file-not-ready',
        ),
    ).toBe(false);

    // Missing after the turn settled: moved or deleted.
    release.resolve();
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-1',
      turnId: 'turn-1',
      path: 'docs/Canvas-API-学习文档.md',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        severity: 'warning',
        code: 'file-diff-failed',
        message: expect.stringContaining('docs/Canvas-API-学习文档.md'),
      });
    });
  });

  it('drops a stale file-open result after a newer turn starts', async () => {
    const staleOpen = deferred<FileDiffOutcome>();
    const firstTurn = deferred<void>();
    const secondTurn = deferred<void>();
    let run = 0;
    const runtime = createMockRuntime(async function* () {
      run += 1;
      yield { type: 'text-delta', text: `turn ${run}` };
      await (run === 1 ? firstTurn.promise : secondTurn.promise);
      yield successfulTurn();
    });
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      { openDiff: vi.fn(() => staleOpen.promise) },
    );
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'First turn');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('streaming');
    });
    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-1',
      turnId: 'turn-1',
      path: 'src/late.ts',
    });
    firstTurn.resolve();
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    send(controller, 'session-1', 'turn-2', 'Second turn');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)).toMatchObject({
        turnId: 'turn-2',
        status: 'streaming',
      });
    });

    staleOpen.resolve('not-found');
    await staleOpen.promise;
    await Promise.resolve();
    expect(
      messages.filter(
        (message) =>
          message.type === 'runtime.diagnostic' && message.code === 'file-not-ready',
      ),
    ).toHaveLength(0);
    secondTurn.resolve();
  });

  it('previews validated prototype paths and reports failures', async () => {
    const openPreview = vi.fn(async (): Promise<PrototypePreviewOutcome> => 'opened');
    const openInlineHtml = vi.fn(async (): Promise<PrototypePreviewOutcome> => 'opened');
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
      { openPreview, openInlineHtml },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'file.preview',
      sessionId: 'session-1',
      path: 'prototypes/dashboard.html',
    });
    await vi.waitFor(() => {
      expect(openPreview).toHaveBeenCalledWith('prototypes/dashboard.html');
    });
    expect(
      messages.filter(
        (message) =>
          message.type === 'runtime.diagnostic' && message.code === 'preview-failed',
      ),
    ).toHaveLength(0);

    // Wrong session requests never reach the opener.
    controller.handleMessage({
      type: 'file.preview',
      sessionId: 'session-other',
      path: 'prototypes/dashboard.html',
    });
    expect(openPreview).toHaveBeenCalledOnce();

    // A failed preview surfaces a bounded warning diagnostic.
    openPreview.mockResolvedValueOnce('failed');
    controller.handleMessage({
      type: 'file.preview',
      sessionId: 'session-1',
      path: 'prototypes/missing.html',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        severity: 'warning',
        code: 'preview-failed',
      });
    });
  });

  it('routes inline HTML previews to the opener and reports failures', async () => {
    const openPreview = vi.fn(async (): Promise<PrototypePreviewOutcome> => 'opened');
    const openInlineHtml = vi.fn(async (): Promise<PrototypePreviewOutcome> => 'opened');
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
      { openPreview, openInlineHtml },
    );
    ready(controller);
    await waitForConnected(messages);

    const html = '<!DOCTYPE html><html><body>hi</body></html>';
    controller.handleMessage({
      type: 'preview.inlineHtml',
      sessionId: 'session-1',
      html,
    });
    await vi.waitFor(() => {
      expect(openInlineHtml).toHaveBeenCalledWith(html, undefined);
    });
    expect(
      messages.filter(
        (message) =>
          message.type === 'runtime.diagnostic' && message.code === 'preview-failed',
      ),
    ).toHaveLength(0);

    // Wrong session requests never reach the opener.
    controller.handleMessage({
      type: 'preview.inlineHtml',
      sessionId: 'session-other',
      html,
    });
    expect(openInlineHtml).toHaveBeenCalledOnce();

    // A failed inline preview surfaces a bounded warning diagnostic.
    openInlineHtml.mockResolvedValueOnce('failed');
    controller.handleMessage({
      type: 'preview.inlineHtml',
      sessionId: 'session-1',
      html,
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        severity: 'warning',
        code: 'preview-failed',
      });
    });
  });

  it('answers git.requestStatus and routes git.commit through the workflow', async () => {
    const files = [
      {
        path: 'src/app.ts',
        status: 'modified',
        staged: false,
        inTurn: false,
      },
    ] as const;
    const status = vi.fn(
      async (): Promise<Awaited<ReturnType<GitWorkflow['status']>>> => ({
        available: true,
        branch: 'main',
        files,
        snapshotId: 'commit-preview',
      }),
    );
    const commit = vi.fn(
      async (): Promise<Awaited<ReturnType<GitWorkflow['commit']>>> => ({
        ok: true,
        hash: 'abc1234',
      }),
    );
    let committed:
      | {
          readonly turnId: string;
          readonly hash: string;
          readonly paths: readonly string[];
          readonly stats?: readonly {
            readonly path: string;
            readonly additions: number | null;
            readonly deletions: number | null;
          }[];
        }
      | undefined;
    const changeStats = {
      read: vi.fn(async () => new Map()),
      rememberCommittedTurn: vi.fn(
        async (
          scope: { sessionId: string; turnId: string },
          hash: string,
          paths: readonly string[],
          stats?: readonly {
            path: string;
            additions: number | null;
            deletions: number | null;
          }[],
        ) => {
          committed = { turnId: scope.turnId, hash, paths, stats };
        },
      ),
      readCommittedTurn: vi.fn(() => committed),
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      undefined,
      changeStats,
      undefined,
      undefined,
      undefined,
      undefined,
      { status, commit },
    );
    ready(controller);
    await waitForConnected(messages);
    expect(controller.sessionState.conversationId).not.toBeNull();
    expect(
      controller.recoveryStore.recordSettledTurn(
        controller.sessionState.conversationId!,
        'session-1',
        'turn-a',
        'Change the app',
        [{ path: 'src/app.ts', additions: 1, deletions: 1 }],
        'completed',
      ),
    ).toBe(true);
    controller.recoveryState.transcript = {
      transcript: [
        {
          id: 'user:turn-chat',
          kind: 'user',
          text: 'Explain the result without changing files.',
        },
      ],
      historyStatus: 'complete',
      truncated: false,
    };

    controller.handleMessage({
      type: 'git.requestStatus',
      sessionId: 'session-1',
      turnId: 'turn-a',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.status')).toMatchObject({
        sessionId: 'session-1',
        turnId: 'turn-a',
        branch: 'main',
        files: [expect.objectContaining({ path: 'src/app.ts' })],
      });
    });
    expect(status).toHaveBeenCalledWith('C:\\workspace', new Set(['src/app.ts']));
    expect(lastMessage(messages, 'git.status')).not.toHaveProperty('unavailableReason');

    controller.turnState.turn = {
      turnId: 'turn-a',
      status: 'streaming',
      activity: createTurnActivityState(),
    };
    controller.handleMessage({
      type: 'git.commit',
      sessionId: 'session-1',
      turnId: 'turn-a',
      paths: ['src/app.ts'],
      message: 'feat: commit too early',
    });
    expect(lastMessage(messages, 'git.commitResult')).toMatchObject({
      ok: false,
      error: 'Wait for the Changes turn to finish before committing.',
    });
    expect(commit).not.toHaveBeenCalled();
    controller.turnState.turn = null;

    // Wrong session requests never reach the workflow.
    controller.handleMessage({
      type: 'git.requestStatus',
      sessionId: 'session-other',
      turnId: 'turn-a',
    });
    expect(status).toHaveBeenCalledOnce();

    controller.handleMessage({
      type: 'git.commit',
      sessionId: 'session-1',
      turnId: 'turn-a',
      paths: ['src/app.ts'],
      message: 'feat: add app\n\nBody detail.',
      snapshotId: 'commit-preview',
      mode: 'files',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.commitResult')).toMatchObject({
        sessionId: 'session-1',
        ok: true,
        hash: 'abc1234',
        subject: 'feat: add app',
      });
    });
    expect(commit).toHaveBeenCalledWith(
      'C:\\workspace',
      ['src/app.ts'],
      'feat: add app\n\nBody detail.',
      expect.any(Function),
      { snapshotId: 'commit-preview', mode: 'files' },
    );
    expect(changeStats.rememberCommittedTurn).toHaveBeenCalledWith(
      { sessionId: 'session-1', turnId: 'turn-a' },
      'abc1234',
      ['src/app.ts'],
      [{ path: 'src/app.ts', additions: 1, deletions: 1 }],
    );
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.status')).toMatchObject({
        turnId: 'turn-a',
        committedHash: 'abc1234',
      });
    });

    controller.handleMessage({
      type: 'git.commit',
      sessionId: 'session-1',
      turnId: 'turn-old',
      paths: ['src/app.ts'],
      message: 'feat: stale commit',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.commitResult')).toMatchObject({
        ok: false,
        error: 'The Changes turn is no longer current. Reopen Commit.',
      });
    });
    expect(commit).toHaveBeenCalledOnce();
  });

  it('reports git unavailability and commit failures', async () => {
    const status = vi.fn(
      async (): Promise<Awaited<ReturnType<GitWorkflow['status']>>> => ({
        available: false,
        reason: 'no-repository',
      }),
    );
    const commit = vi.fn(
      async (): Promise<Awaited<ReturnType<GitWorkflow['commit']>>> => ({
        ok: false,
        error: 'pre-commit hook rejected the commit',
      }),
    );
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
      { status, commit },
    );
    ready(controller);
    await waitForConnected(messages);
    expect(
      controller.recoveryStore.recordSettledTurn(
        controller.sessionState.conversationId!,
        'session-1',
        'turn-a',
        'Change the app',
        [{ path: 'src/app.ts', additions: 1, deletions: 1 }],
        'completed',
      ),
    ).toBe(true);

    controller.handleMessage({
      type: 'git.requestStatus',
      sessionId: 'session-1',
      turnId: 'turn-a',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.status')).toMatchObject({
        sessionId: 'session-1',
        turnId: 'turn-a',
        branch: null,
        files: [],
        unavailableReason: 'no-repository',
      });
    });

    controller.handleMessage({
      type: 'git.commit',
      sessionId: 'session-1',
      turnId: 'turn-a',
      paths: ['src/app.ts'],
      message: 'feat: add app',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.commitResult')).toMatchObject({
        ok: false,
        error: 'pre-commit hook rejected the commit',
      });
    });
  });

  it('persists a completed commit even when the controller was disposed', async () => {
    const pending = deferred<Awaited<ReturnType<GitWorkflow['commit']>>>();
    const commit = vi.fn(() => pending.promise);
    const rememberCommittedTurn = vi.fn(async () => undefined);
    const { controller, messages } = createController(
      () => createMockRuntime(),
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      undefined,
      {
        read: vi.fn(async () => new Map()),
        rememberCommittedTurn,
      },
      undefined,
      undefined,
      undefined,
      undefined,
      {
        status: vi.fn(async () => ({
          available: true as const,
          branch: 'main',
          files: [],
        })),
        commit,
      },
    );
    ready(controller);
    await waitForConnected(messages);
    expect(
      controller.recoveryStore.recordSettledTurn(
        controller.sessionState.conversationId!,
        'session-1',
        'turn-a',
        'Fix the app',
        [{ path: 'src/app.ts', additions: 2, deletions: 1 }],
        'completed',
      ),
    ).toBe(true);

    controller.handleMessage({
      type: 'git.commit',
      sessionId: 'session-1',
      turnId: 'turn-a',
      paths: ['src/app.ts'],
      message: 'fix: durable commit',
    });
    await vi.waitFor(() => expect(commit).toHaveBeenCalledOnce());
    controller.dispose();
    pending.resolve({ ok: true, hash: 'abc1234' });

    await vi.waitFor(() => {
      expect(rememberCommittedTurn).toHaveBeenCalledWith(
        { sessionId: 'session-1', turnId: 'turn-a' },
        'abc1234',
        ['src/app.ts'],
        [{ path: 'src/app.ts', additions: 2, deletions: 1 }],
      );
    });
    expect(lastMessage(messages, 'git.commitResult')).toBeUndefined();
  });

  it('degrades git requests to unavailable without an injected workflow', async () => {
    const { controller, messages } = createController(() => createMockRuntime());
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'git.requestStatus',
      sessionId: 'session-1',
      turnId: 'turn-a',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.status')).toMatchObject({
        unavailableReason: 'no-git-extension',
      });
    });
  });

  it('opens clicked transcript paths and reports failures', async () => {
    const openPath = vi.fn(async (): Promise<OpenPathOutcome> => 'opened');
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
      { openPath },
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'D:\\E\\artifacts\\简历.pdf',
    });
    await vi.waitFor(() => {
      expect(openPath).toHaveBeenCalledWith(
        'D:\\E\\artifacts\\简历.pdf',
        undefined,
        undefined,
      );
    });
    expect(
      messages.filter(
        (message) =>
          message.type === 'runtime.diagnostic' && message.code === 'open-path-failed',
      ),
    ).toHaveLength(0);

    // Line and column ride along for text targets.
    controller.handleMessage({
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'src/extension/chat/ChatController.ts',
      line: 12,
      column: 3,
    });
    await vi.waitFor(() => {
      expect(openPath).toHaveBeenCalledWith(
        'src/extension/chat/ChatController.ts',
        12,
        3,
      );
    });

    // Wrong session requests never reach the opener.
    controller.handleMessage({
      type: 'workspace.openPath',
      sessionId: 'session-other',
      path: 'src/app.ts',
    });
    expect(openPath).toHaveBeenCalledTimes(2);

    // A failed open surfaces a bounded warning diagnostic.
    openPath.mockResolvedValueOnce('failed');
    controller.handleMessage({
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'D:\\missing\\file.txt',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        severity: 'warning',
        code: 'open-path-failed',
      });
    });
  });

  it('streams a live changes ledger and settles it with git line stats', async () => {
    const finishTurn = deferred<void>();
    const measurement = deferred<ReadonlyMap<string, FileChangeStat>>();
    const runtime = createMockRuntime(async function* () {
      yield { type: 'user-message', messageId: 'message-1' };
      yield {
        type: 'tool-start',
        toolName: 'Edit',
        toolUseId: 'tool-1',
        action: 'Edited workspace files',
        inputComplete: true,
        filePath: 'src/app.ts',
      };
      yield {
        type: 'tool-result',
        toolName: 'Edit',
        toolUseId: 'tool-1',
        action: 'Edited workspace files',
        isError: false,
      };
      yield {
        type: 'tool-start',
        toolName: 'Create',
        toolUseId: 'tool-2',
        action: 'Created workspace files',
        inputComplete: true,
        filePath: 'docs/new.md',
      };
      yield {
        type: 'tool-result',
        toolName: 'Create',
        toolUseId: 'tool-2',
        action: 'Created workspace files',
        isError: false,
      };
      await finishTurn.promise;
      yield successfulTurn();
    });
    const stats = new Map([['src/app.ts', { additions: 3, deletions: 1 }]]);
    const read = vi.fn(
      async (): Promise<ReadonlyMap<string, FileChangeStat>> =>
        stats,
    ).mockImplementationOnce(() => measurement.promise);
    const captureTurnBaseline = vi.fn(async () => {});
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
    try {
      ready(controller);
      await waitForConnected(messages);
      send(controller, 'session-1', 'turn-1', 'Change files');
      await vi.waitFor(() => expect(read).toHaveBeenCalled(), { timeout: 2_000 });

      // Completed tools name candidates; no row is attributed before measurement.
      expect(messages.filter((message) => message.type === 'changes.update')).toEqual([]);
      measurement.resolve(stats);
      await vi.waitFor(() => expect(lastMessage(messages, 'changes.update')).toMatchObject({
        sessionId: 'session-1', turnId: 'turn-1', state: 'writing',
        files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
      }));
      expect(turnStates(messages).at(-1)?.status).toBe('streaming');
      expect(captureTurnBaseline.mock.calls.slice(0, 2)).toEqual([
        [{ sessionId: 'session-1', turnId: 'turn-1' }, ['src/app.ts']],
        [{ sessionId: 'session-1', turnId: 'turn-1' }, ['docs/new.md']],
      ]);

      finishTurn.resolve();
      await vi.waitFor(() => expect(lastMessage(messages, 'changes.update')).toMatchObject({
        sessionId: 'session-1', turnId: 'turn-1', state: 'settled',
        files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
      }));
      expect(read).toHaveBeenCalledWith(['src/app.ts', 'docs/new.md'], {
        sessionId: 'session-1', turnId: 'turn-1',
      });
      // The unreadable candidate was never measured and must not become a changed file.
      const updates = messages.filter((message) => message.type === 'changes.update');
      expect(updates.every((update) => update.files.every((file) => file.path !== 'docs/new.md'))).toBe(true);
      expect(controller.recoveryState.transcript.transcript.find(
        (item) => item.kind === 'changes' && item.turnId === 'turn-1',
      )).toMatchObject({ files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }] });
      // Only the message identity is persisted; the visible prompt comes from the live transcript.
      expect(controller.recoveryStore.readLatestChanges(controller.sessionState.conversationId!)).toMatchObject({
        turnId: 'turn-1', messageId: 'message-1', prompt: null, changesSettled: true,
        files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
      });
      expect(snapshots(messages).at(-1)?.latestChanges).toMatchObject({
        turnId: 'turn-1', prompt: 'Change files',
      });
    } finally {
      measurement.resolve(stats);
      finishTurn.resolve();
      await controller.dispose();
    }
  });

  it('persists an empty canonical settlement when no net change remains', async () => {
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'tool-start',
        toolName: 'Edit',
        toolUseId: 'tool-1',
        action: 'Edited workspace files',
        inputComplete: true,
        filePath: 'src/app.ts',
      };
      yield {
        type: 'tool-result',
        toolName: 'Edit',
        toolUseId: 'tool-1',
        action: 'Edited workspace files',
        isError: false,
      };
      yield successfulTurn();
    });
    const read = vi.fn(
      async (): Promise<ReadonlyMap<string, FileChangeStat>> =>
        new Map([['src/app.ts', { additions: 0, deletions: 0 }]]),
    );
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      undefined,
      { read },
    );
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Change then restore a file');
    await vi.waitFor(() => {
      expect(
        messages.some(
          (message) =>
            message.type === 'changes.update' &&
            message.state === 'settled' &&
            message.files.length === 0,
        ),
      ).toBe(true);
    });
    expect(
      controller.recoveryState.transcript.transcript.find(
        (item) => item.kind === 'changes' && item.turnId === 'turn-1',
      ),
    ).toMatchObject({ files: [] });
    expect(
      controller.recoveryStore.readTurn(
        controller.sessionState.conversationId!,
        'turn-1',
      ),
    ).toMatchObject({
      turnId: 'turn-1',
      changesSettled: true,
      files: [],
    });
  });

  it('settles an empty canonical marker when no tool named a workspace file', async () => {
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
    const read = vi.fn(
      async (): Promise<ReadonlyMap<string, FileChangeStat>> => new Map(),
    );
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      undefined,
      undefined,
      { read },
    );
    ready(controller);
    await waitForConnected(messages);

    send(controller, 'session-1', 'turn-1', 'Read only');
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    expect(read).not.toHaveBeenCalled();
    expect(lastMessage(messages, 'changes.update')).toMatchObject({
      state: 'settled',
      files: [],
    });
    expect(
      controller.recoveryState.transcript.transcript.find(
        (item) => item.kind === 'changes' && item.turnId === 'turn-1',
      ),
    ).toMatchObject({ files: [] });
  });

  it.each(['pending', 'rejected'] as const)(
    'waits for %s canonical persistence before settled publication',
    async (outcome) => {
      const firstWrite = deferred<void>();
      const retryWrite = deferred<void>();
      let writes = 0;
      let settlementWrites = false;
      const recovery = new SessionRecoveryStore(
        {
          get: () => undefined,
          update: vi.fn(() => {
            if (!settlementWrites) {
              return Promise.resolve();
            }
            writes += 1;
            if (writes === 1) {
              return outcome === 'pending'
                ? firstWrite.promise
                : Promise.reject(new Error('persistence failed'));
            }
            return retryWrite.promise;
          }),
        },
        'recovery',
        0,
      );
      const runtime = createMockRuntime(async function* () {
        yield {
          type: 'tool-start',
          toolName: 'Edit',
          toolUseId: 'tool-1',
          action: 'Edited workspace files',
          inputComplete: true,
          filePath: 'src/app.ts',
        };
        yield {
          type: 'tool-result',
          toolName: 'Edit',
          toolUseId: 'tool-1',
          action: 'Edited workspace files',
          isError: false,
        };
        yield successfulTurn();
      });
      const { controller, messages } = createController(
        () => runtime,
        undefined,
        createCatalog([]),
        recovery,
        undefined,
        undefined,
        undefined,
        {
          read: async () => new Map([['src/app.ts', { additions: 4, deletions: 2 }]]),
        },
      );
      const settleWritingTurn = vi.fn();
      Object.defineProperty(controller, 'reviewCoordinator', {
        value: { settleWritingTurn, replay: vi.fn(async () => {}), dispose: vi.fn() },
      });
      try {
        ready(controller);
        await waitForConnected(messages);
        settlementWrites = true;

        send(controller, 'session-1', 'turn-1', 'Change file');
        await vi.waitFor(() => expect(writes).toBe(outcome === 'pending' ? 1 : 2));
        expect(messages.some(
          (message) => message.type === 'changes.update' && message.state === 'settled',
        )).toBe(false);
        expect(settleWritingTurn).not.toHaveBeenCalled();

        // A successful pending write can include all metadata in one revision.
        // A rejected write needs the retry; neither may publish before it resolves.
        if (outcome === 'pending') firstWrite.resolve();
        else retryWrite.resolve();
        await vi.waitFor(() => expect(messages.filter(
          (message) => message.type === 'changes.update' && message.state === 'settled',
        )).toHaveLength(1));
        expect(settleWritingTurn).toHaveBeenCalledWith('session-1', 'turn-1', [
          { path: 'src/app.ts', additions: 4, deletions: 2 },
        ]);
      } finally {
        settlementWrites = false;
        firstWrite.resolve();
        retryWrite.resolve();
        await controller.dispose();
      }
    },
  );

  it('forks the session, adopts the copy, and keeps the original in the catalog', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      fork: vi.fn(async () => ({ sessionId: 'session-fork' })),
    });
    const history: SessionHistoryLoader = {
      loadHistory: vi.fn(async ({ sessionId }) =>
        sessionId === 'session-fork'
          ? {
              status: 'available' as const,
              state: {
                transcript: [
                  {
                    id: 'copied-1',
                    kind: 'user' as const,
                    text: 'Original question',
                  },
                ],
                historyStatus: 'complete' as const,
                truncated: false,
              },
            }
          : {
              status: 'unavailable' as const,
              reason: 'history-failed' as const,
              message: 'Saved Droid session history could not be loaded.' as const,
            },
      ),
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

    controller.handleMessage({
      type: 'session.fork',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)).toMatchObject({
        sessionId: 'session-fork',
        transcript: [{ kind: 'user', text: 'Original question' }],
      });
    });
    expect(runtime.fork).toHaveBeenCalledOnce();
    expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
      severity: 'info',
      code: 'session-forked',
    });
    // Unlike compaction, the forked-from session stays selectable.
    const sessions = snapshots(messages).at(-1)!.sessions;
    expect(sessions.items.filter(({ id }) => id === 'session-1')).toHaveLength(1);
    expect(sessions.items.at(-1)).toMatchObject({
      id: 'session-fork',
      active: true,
      title: expect.stringContaining('(fork)'),
    });

    // Wrong session id is ignored entirely.
    controller.handleMessage({
      type: 'session.fork',
      sessionId: 'session-other',
    });
    expect(runtime.fork).toHaveBeenCalledOnce();
  });

  it('reports unsupported and failed forking safely', async () => {
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'session.fork',
      sessionId: 'session-1',
    });
    expect(lastMessage(unsupported.messages, 'runtime.diagnostic')).toMatchObject({
      code: 'session-fork-unsupported',
    });

    const failing = Object.assign(createMockRuntime(), {
      fork: vi.fn(async () => {
        throw new Error('private fork failure');
      }),
    });
    const { controller, messages } = createController(() => failing);
    ready(controller);
    await waitForConnected(messages);
    controller.handleMessage({
      type: 'session.fork',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        code: 'session-fork-failed',
      });
    });
    expect(JSON.stringify(messages)).not.toContain('private fork failure');
  });

  it('reports unsupported and failed compaction safely', async () => {
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'session.compact',
      sessionId: 'session-1',
    });
    expect(lastMessage(unsupported.messages, 'runtime.diagnostic')).toMatchObject({
      code: 'session-compact-unsupported',
    });

    const failing = Object.assign(createMockRuntime(), {
      compact: vi.fn(async () => {
        throw new Error('private compaction failure');
      }),
    });
    const { controller, messages } = createController(() => failing);
    ready(controller);
    await waitForConnected(messages);
    controller.handleMessage({
      type: 'session.compact',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        code: 'session-compact-failed',
      });
    });
    expect(JSON.stringify(messages)).not.toContain('private compaction failure');
  });

  it('answers git.requestBranchDiff and fails closed when it cannot', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      readGitDiff: vi.fn(async () => ({
        branch: 'feature/dock',
        baseBranch: 'main',
        files: [{ path: 'src/app.tsx', additions: 4, deletions: 2 }],
        additions: 4,
        deletions: 2,
        commitCount: 3,
      })),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    // A stale session id is ignored entirely.
    controller.handleMessage({
      type: 'git.requestBranchDiff',
      sessionId: 'session-other',
    });
    expect(runtime.readGitDiff).not.toHaveBeenCalled();

    controller.handleMessage({
      type: 'git.requestBranchDiff',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.branchDiff')).toMatchObject({
        branch: 'feature/dock',
        baseBranch: 'main',
        files: [{ path: 'src/app.tsx', additions: 4, deletions: 2 }],
        commitCount: 3,
      });
    });

    const failing = Object.assign(createMockRuntime(), {
      readGitDiff: vi.fn(async () => {
        throw new Error('private git failure');
      }),
    });
    const failed = createController(() => failing);
    ready(failed.controller);
    await waitForConnected(failed.messages);
    failed.controller.handleMessage({
      type: 'git.requestBranchDiff',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(failed.messages, 'git.branchDiff')).toMatchObject({
        branch: null,
        files: [],
        unavailableReason: 'read-failed',
      });
    });
    expect(JSON.stringify(failed.messages)).not.toContain('private git failure');
  });

  it('reports unsupported-runtime when the runtime has no branch diff', async () => {
    const { controller, messages } = createController(() => createMockRuntime());
    ready(controller);
    await waitForConnected(messages);
    controller.handleMessage({
      type: 'git.requestBranchDiff',
      sessionId: 'session-1',
    });

    expect(lastMessage(messages, 'git.branchDiff')).toMatchObject({
      branch: null,
      baseBranch: null,
      files: [],
      additions: 0,
      deletions: 0,
      commitCount: 0,
      unavailableReason: 'unsupported-runtime',
    });
  });
});
