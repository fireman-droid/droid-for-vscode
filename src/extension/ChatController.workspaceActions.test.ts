import { describe, expect, it, vi } from 'vitest';

import {
  available,
  ChatController,
  createCatalog,
  createController,
  createMockRuntime,
  deferred,
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

describe('ChatController', () => {
  it('compacts the session, adopts the continuation, and reloads its transcript', async () => {
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
              message:
                'Saved Droid session history could not be loaded.' as const,
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
      type: 'session.compact',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(snapshots(messages).at(-1)).toMatchObject({
        sessionId: 'session-compacted',
        transcript: [{ kind: 'assistant', text: 'Summary of earlier work' }],
      });
    });
    expect(runtime.compact).toHaveBeenCalledOnce();
    expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
      severity: 'info',
      code: 'session-compacted',
      message: expect.stringContaining('5'),
      // The pre-compaction session backs "View full history".
      relatedSessionId: 'session-1',
    });
    // The compacted session stays selectable next to the continuation:
    // its file keeps the full pre-compaction history on disk.
    const sessions = snapshots(messages).at(-1)!.sessions;
    expect(
      sessions.items.filter(({ id }) => id === 'session-1'),
    ).toHaveLength(1);
    expect(sessions.items.at(-1)).toMatchObject({
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
    const openDiff = vi.fn(
      async (): Promise<FileDiffOutcome> => 'opened-diff',
    );
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
      path: 'src/app.ts',
    });
    await vi.waitFor(() => {
      expect(openDiff).toHaveBeenCalledWith('src/app.ts');
    });
    expect(
      messages.filter(
        (message) =>
          message.type === 'runtime.diagnostic' &&
          message.code === 'file-diff-failed',
      ),
    ).toHaveLength(0);

    // Wrong session requests never reach the opener.
    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-other',
      path: 'src/app.ts',
    });
    expect(openDiff).toHaveBeenCalledOnce();

    // A failed open surfaces a bounded warning diagnostic naming the
    // offending path (QA v0.3 P2-3).
    openDiff.mockResolvedValueOnce('failed');
    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-1',
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

  it('words a missing file by turn state: still-writing vs moved-or-deleted', async () => {
    const openDiff = vi.fn(
      async (): Promise<FileDiffOutcome> => 'not-found',
    );
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
      path: 'docs/Canvas-API-学习文档.md',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        severity: 'warning',
        code: 'file-not-ready',
      });
    });

    // Missing after the turn settled: moved or deleted.
    release.resolve();
    await vi.waitFor(() => {
      expect(turnStates(messages).at(-1)?.status).toBe('completed');
    });
    controller.handleMessage({
      type: 'file.openDiff',
      sessionId: 'session-1',
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

  it('previews validated prototype paths and reports failures', async () => {
    const openPreview = vi.fn(
      async (): Promise<PrototypePreviewOutcome> => 'opened',
    );
    const openInlineHtml = vi.fn(
      async (): Promise<PrototypePreviewOutcome> => 'opened',
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
          message.type === 'runtime.diagnostic' &&
          message.code === 'preview-failed',
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
    const openPreview = vi.fn(
      async (): Promise<PrototypePreviewOutcome> => 'opened',
    );
    const openInlineHtml = vi.fn(
      async (): Promise<PrototypePreviewOutcome> => 'opened',
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
      expect(openInlineHtml).toHaveBeenCalledWith(html);
    });
    expect(
      messages.filter(
        (message) =>
          message.type === 'runtime.diagnostic' &&
          message.code === 'preview-failed',
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
      async (): Promise<
        Awaited<ReturnType<GitWorkflow['status']>>
      > => ({ available: true, branch: 'main', files }),
    );
    const commit = vi.fn(
      async (): Promise<
        Awaited<ReturnType<GitWorkflow['commit']>>
      > => ({ ok: true, hash: 'abc1234' }),
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

    controller.handleMessage({
      type: 'git.requestStatus',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.status')).toMatchObject({
        sessionId: 'session-1',
        branch: 'main',
        files: [expect.objectContaining({ path: 'src/app.ts' })],
      });
    });
    expect(status).toHaveBeenCalledWith('C:\\workspace', new Set());
    expect(
      lastMessage(messages, 'git.status'),
    ).not.toHaveProperty('unavailableReason');

    // Wrong session requests never reach the workflow.
    controller.handleMessage({
      type: 'git.requestStatus',
      sessionId: 'session-other',
    });
    expect(status).toHaveBeenCalledOnce();

    controller.handleMessage({
      type: 'git.commit',
      sessionId: 'session-1',
      paths: ['src/app.ts'],
      message: 'feat: add app\n\nBody detail.',
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
    );
  });

  it('reports git unavailability and commit failures', async () => {
    const status = vi.fn(
      async (): Promise<
        Awaited<ReturnType<GitWorkflow['status']>>
      > => ({ available: false, reason: 'no-repository' }),
    );
    const commit = vi.fn(
      async (): Promise<
        Awaited<ReturnType<GitWorkflow['commit']>>
      > => ({ ok: false, error: 'pre-commit hook rejected the commit' }),
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

    controller.handleMessage({
      type: 'git.requestStatus',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.status')).toMatchObject({
        sessionId: 'session-1',
        branch: null,
        files: [],
        unavailableReason: 'no-repository',
      });
    });

    controller.handleMessage({
      type: 'git.commit',
      sessionId: 'session-1',
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

  it('degrades git requests to unavailable without an injected workflow', async () => {
    const { controller, messages } = createController(() =>
      createMockRuntime(),
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'git.requestStatus',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'git.status')).toMatchObject({
        unavailableReason: 'no-git-extension',
      });
    });
  });

  it('opens clicked transcript paths and reports failures', async () => {
    const openPath = vi.fn(
      async (): Promise<OpenPathOutcome> => 'opened',
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
          message.type === 'runtime.diagnostic' &&
          message.code === 'open-path-failed',
      ),
    ).toHaveLength(0);

    // Line and column ride along for text targets.
    controller.handleMessage({
      type: 'workspace.openPath',
      sessionId: 'session-1',
      path: 'src/extension/ChatController.ts',
      line: 12,
      column: 3,
    });
    await vi.waitFor(() => {
      expect(openPath).toHaveBeenCalledWith(
        'src/extension/ChatController.ts',
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
    const runtime = createMockRuntime(async function* () {
      yield {
        type: 'tool-start',
        toolName: 'Edit',
        toolUseId: 'tool-1',
        action: 'Edited workspace files',
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
        filePath: 'docs/new.md',
      };
      yield {
        type: 'tool-result',
        toolName: 'Create',
        toolUseId: 'tool-2',
        action: 'Created workspace files',
        isError: false,
      };
      yield successfulTurn();
    });
    const read = vi.fn(
      async (): Promise<ReadonlyMap<string, FileChangeStat>> =>
        new Map([['src/app.ts', { additions: 3, deletions: 1 }]]),
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

    send(controller, 'session-1', 'turn-1', 'Change files');
    await vi.waitFor(() => {
      expect(
        messages.some(
          (message) =>
            message.type === 'changes.update' &&
            message.state === 'settled',
        ),
      ).toBe(true);
    });

    const updates = messages.filter(
      (message) => message.type === 'changes.update',
    );
    // Each completed file tool published its row immediately: first
    // frame with one file, second with both, all pre-git (null
    // counts) because the per-file stat read is debounced.
    expect(updates[0]).toMatchObject({
      sessionId: 'session-1',
      turnId: 'turn-1',
      state: 'writing',
      files: [{ path: 'src/app.ts', additions: null, deletions: null }],
    });
    expect(updates[1]).toMatchObject({
      state: 'writing',
      files: [
        { path: 'src/app.ts', additions: null, deletions: null },
        { path: 'docs/new.md', additions: null, deletions: null },
      ],
    });
    // Untracked files keep null stats; order follows tool order.
    expect(read).toHaveBeenCalledWith(['src/app.ts', 'docs/new.md']);
    expect(updates.at(-1)).toMatchObject({
      sessionId: 'session-1',
      turnId: 'turn-1',
      state: 'settled',
      files: [
        { path: 'src/app.ts', additions: 3, deletions: 1 },
        { path: 'docs/new.md', additions: null, deletions: null },
      ],
    });
  });

  it('skips the changes summary when no tool named a workspace file', async () => {
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
    expect(
      messages.find((message) => message.type === 'changes.update'),
    ).toBeUndefined();
  });

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
              message:
                'Saved Droid session history could not be loaded.' as const,
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
    expect(
      sessions.items.filter(({ id }) => id === 'session-1'),
    ).toHaveLength(1);
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
    expect(
      lastMessage(unsupported.messages, 'runtime.diagnostic'),
    ).toMatchObject({ code: 'session-fork-unsupported' });

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
    expect(JSON.stringify(messages)).not.toContain(
      'private fork failure',
    );
  });

  it('reports unsupported and failed compaction safely', async () => {
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'session.compact',
      sessionId: 'session-1',
    });
    expect(
      lastMessage(unsupported.messages, 'runtime.diagnostic'),
    ).toMatchObject({ code: 'session-compact-unsupported' });

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
    expect(JSON.stringify(messages)).not.toContain(
      'private compaction failure',
    );
  });
});
