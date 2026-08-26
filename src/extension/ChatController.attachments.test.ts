import { describe, expect, it, vi } from 'vitest';

import {
  attachmentsMessages,
  type AttachmentSources,
  ChatController,
  createCatalog,
  createController,
  createMockRuntime,
  lastMessage,
  mcpAuthMessages,
  ready,
  send,
  successfulTurn,
  waitForConnected,
} from './controllerTestHarness';

describe('ChatController', () => {
  it('stages picked attachments, sends them with the next turn, then clears', async () => {
    const runtime = createMockRuntime();
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({
        status: 'picked' as const,
        items: [
          {
            kind: 'image' as const,
            name: 'shot.png',
            data: 'aW1n',
            mediaType: 'image/png' as const,
            sizeBytes: 3,
            truncated: false,
          },
          {
            kind: 'text' as const,
            name: 'notes.md',
            data: 'hello',
            sizeBytes: 5,
            truncated: false,
          },
        ],
      })),
      readActiveEditor: vi.fn(async () => ({ status: 'empty' as const })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async () => ({
        status: 'failed' as const,
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.pick',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(
        attachmentsMessages(messages).at(-1)?.attachments,
      ).toHaveLength(2);
    });
    const staged = attachmentsMessages(messages).at(-1)!.attachments;
    expect(staged[0]).toMatchObject({
      kind: 'image',
      name: 'shot.png',
      truncated: false,
    });

    // Removing one staged attachment keeps the other.
    controller.handleMessage({
      type: 'attachment.remove',
      sessionId: 'session-1',
      attachmentId: staged[1]!.id,
    });
    expect(
      attachmentsMessages(messages).at(-1)?.attachments,
    ).toEqual([staged[0]]);

    send(controller, 'session-1', 'turn-1', 'describe this');
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledWith('describe this', [
        { kind: 'image', data: 'aW1n', mediaType: 'image/png' },
      ]);
    });
    // Attachments are consumed by the send.
    expect(
      attachmentsMessages(messages).at(-1)?.attachments,
    ).toHaveLength(0);
    // The image bytes cross the Bridge exactly once: as the bounded
    // user-origin transcript echo, never inside attachment metadata.
    const imageEchoes = messages.filter(
      (message) => message.type === 'transcript.image',
    );
    expect(imageEchoes).toHaveLength(1);
    expect(imageEchoes[0]).toMatchObject({
      sessionId: 'session-1',
      turnId: 'turn-1',
      item: {
        kind: 'image',
        origin: 'user',
        mediaType: 'image/png',
        data: 'aW1n',
        generated: false,
        byteLength: 3,
      },
    });
    expect(
      JSON.stringify(
        messages.filter((message) => message.type !== 'transcript.image'),
      ),
    ).not.toContain('aW1n');
  });

  it('stages dropped/pasted images via attachment.addImage and rejects oversized ones', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'pasted-image.png',
      mediaType: 'image/png',
      dataBase64: 'aW1n',
    });
    const staged = attachmentsMessages(messages).at(-1)!.attachments;
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({
      kind: 'image',
      name: 'pasted-image.png',
      sizeBytes: 3,
      truncated: false,
    });

    // An image decoding above the 4 MB cap is rejected with a
    // structured diagnostic and stages nothing.
    controller.handleMessage({
      type: 'attachment.addImage',
      sessionId: 'session-1',
      name: 'huge.png',
      mediaType: 'image/png',
      dataBase64: 'A'.repeat(5_592_408),
    });
    expect(attachmentsMessages(messages).at(-1)?.attachments).toEqual(
      staged,
    );
    const diagnostics = messages.filter(
      (message) => message.type === 'runtime.diagnostic',
    );
    expect(JSON.stringify(diagnostics.at(-1))).toContain('too large');

    send(controller, 'session-1', 'turn-1', 'what is this?');
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledWith('what is this?', [
        { kind: 'image', data: 'aW1n', mediaType: 'image/png' },
      ]);
    });
    expect(
      attachmentsMessages(messages).at(-1)?.attachments,
    ).toHaveLength(0);
  });

  it('stages dropped file URIs inside the workspace and reports outside ones', async () => {
    const runtime = createMockRuntime();
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({ status: 'cancelled' as const })),
      readActiveEditor: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async (path: string) => ({
        status: 'picked' as const,
        items: [
          {
            kind: 'text' as const,
            name: path.split('/').at(-1) ?? path,
            data: 'file body',
            sizeBytes: 9,
            truncated: false,
          },
        ],
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.addUris',
      sessionId: 'session-1',
      uris: [
        'file:///C:/workspace/src/a.ts',
        'file:///C:/elsewhere/outside.ts',
      ],
    });

    await vi.waitFor(() => {
      expect(
        attachmentsMessages(messages).at(-1)?.attachments,
      ).toMatchObject([{ kind: 'text', name: 'a.ts' }]);
    });
    expect(sources.readWorkspaceFile).toHaveBeenCalledOnce();
    expect(sources.readWorkspaceFile).toHaveBeenCalledWith('src/a.ts');
    const diagnostics = messages.filter(
      (message) => message.type === 'runtime.diagnostic',
    );
    expect(JSON.stringify(diagnostics)).toContain(
      'inside the current workspace',
    );
  });

  it('stages dropped text files with webview-read content', async () => {
    const runtime = createMockRuntime();
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.addTextFile',
      sessionId: 'session-1',
      name: 'notes.txt',
      text: 'dropped body',
      truncated: true,
    });

    const staged = attachmentsMessages(messages).at(-1)!.attachments;
    expect(staged).toMatchObject([
      {
        kind: 'text',
        name: 'notes.txt',
        sizeBytes: 12,
        truncated: true,
      },
    ]);

    send(controller, 'session-1', 'turn-1', 'summarize the file');
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledWith(
        'summarize the file',
        [
          expect.objectContaining({
            kind: 'text',
            name: 'notes.txt',
            data: 'dropped body',
          }),
        ],
      );
    });
  });

  it('echoes sent chips, stages edits per message, and resends from the edit stage', async () => {
    const runtime = Object.assign(
      createMockRuntime(async function* () {
        yield { type: 'user-message', messageId: 'sdk-message-1' };
        yield successfulTurn();
      }),
      { rewind: vi.fn(async () => ({ sessionId: 'fork-1' })) },
    );
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({
        status: 'picked' as const,
        items: [
          {
            kind: 'image' as const,
            name: 'shot.png',
            data: 'aW1n',
            mediaType: 'image/png' as const,
            sizeBytes: 3,
            truncated: false,
          },
          {
            kind: 'text' as const,
            name: 'notes.md',
            data: 'hello',
            sizeBytes: 5,
            truncated: false,
          },
        ],
      })),
      readActiveEditor: vi.fn(async () => ({ status: 'empty' as const })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async () => ({
        status: 'failed' as const,
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.pick',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(attachmentsMessages(messages).at(-1)?.attachments).toHaveLength(
        2,
      );
    });
    send(controller, 'session-1', 'turn-1', 'first prompt');
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'user.message-meta')).toMatchObject({
        messageId: 'sdk-message-1',
      });
      expect(lastMessage(messages, 'turn.state')?.status).toBe('completed');
    });

    // The snapshot user item echoes only non-image chips; the image is
    // its own user-echo transcript item. A repeated ready re-emits the
    // current snapshot.
    ready(controller);
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'host.snapshot')?.transcript.find(
          (item) => item.kind === 'user',
        ),
      ).toMatchObject({
        text: 'first prompt',
        attachments: [{ kind: 'text', name: 'notes.md', sizeBytes: 5 }],
      });
    });

    // Entering edit mode prefills the edit stage from the retention
    // area with restorable payloads.
    controller.handleMessage({
      type: 'editStage.begin',
      sessionId: 'session-1',
      messageId: 'sdk-message-1',
    });
    const editState = lastMessage(messages, 'session.editAttachments')!;
    expect(editState.messageId).toBe('sdk-message-1');
    expect(editState.attachments).toMatchObject([
      { kind: 'image', name: 'shot.png', restorable: true },
      { kind: 'text', name: 'notes.md', restorable: true },
    ]);

    // Edit-stage removal targets the edit stage, not the composer.
    controller.handleMessage({
      type: 'attachment.remove',
      sessionId: 'session-1',
      attachmentId: editState.attachments[1]!.id,
      stage: 'edit',
    });
    expect(
      lastMessage(messages, 'session.editAttachments')?.attachments,
    ).toMatchObject([{ kind: 'image', restorable: true }]);

    // Resending consumes the edit stage: kept originals travel with the
    // forked send while the composer stage stays untouched.
    controller.handleMessage({
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'sdk-message-1',
      text: 'edited prompt',
    });
    await vi.waitFor(() => {
      expect(runtime.rewind).toHaveBeenCalledWith(
        expect.objectContaining({ messageId: 'sdk-message-1' }),
      );
      expect(runtime.sendTurn).toHaveBeenLastCalledWith('edited prompt', [
        { kind: 'image', data: 'aW1n', mediaType: 'image/png' },
      ]);
    });
    const forkSnapshot = lastMessage(messages, 'host.snapshot')!;
    expect(forkSnapshot.sessionId).toBe('fork-1');
    expect(
      forkSnapshot.transcript.find((item) => item.kind === 'user'),
    ).toMatchObject({ text: 'edited prompt' });
  });

  it('rejects edit-resend with structured reasons', async () => {
    // A runtime without rewind: structured 'unsupported'.
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'sdk-message-1',
      text: 'edited',
    });
    expect(
      lastMessage(unsupported.messages, 'turn.editResendRejected'),
    ).toMatchObject({
      messageId: 'sdk-message-1',
      reason: 'unsupported',
    });

    // An active turn: structured 'busy'.
    const hanging = Object.assign(
      createMockRuntime(async function* () {
        yield { type: 'user-message', messageId: 'sdk-message-1' };
        await new Promise(() => {});
      }),
      { rewind: vi.fn(async () => ({ sessionId: 'fork-1' })) },
    );
    const busy = createController(() => hanging);
    ready(busy.controller);
    await waitForConnected(busy.messages);
    send(busy.controller, 'session-1', 'turn-1', 'first prompt');
    await vi.waitFor(() => {
      expect(
        lastMessage(busy.messages, 'user.message-meta'),
      ).toMatchObject({ messageId: 'sdk-message-1' });
    });
    busy.controller.handleMessage({
      type: 'turn.editResend',
      sessionId: 'session-1',
      turnId: 'turn-2',
      messageId: 'sdk-message-1',
      text: 'edited',
    });
    expect(
      lastMessage(busy.messages, 'turn.editResendRejected'),
    ).toMatchObject({ messageId: 'sdk-message-1', reason: 'busy' });
    expect(hanging.rewind).not.toHaveBeenCalled();
  });

  it('evicts retained payloads by byte budget and marks stale chips unrestorable', async () => {
    let sendIndex = 0;
    const runtime = Object.assign(
      createMockRuntime(async function* () {
        sendIndex += 1;
        yield {
          type: 'user-message',
          messageId: `sdk-message-${sendIndex}`,
        };
        yield successfulTurn();
      }),
      { rewind: vi.fn(async () => ({ sessionId: 'fork-1' })) },
    );
    // Each send carries one ~20 MB text payload, so the second send
    // pushes the 32 MB retention budget over and evicts the first.
    const bigData = 'a'.repeat(20 * 1024 * 1024);
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({
        status: 'picked' as const,
        items: [
          {
            kind: 'text' as const,
            name: 'big.md',
            data: bigData,
            sizeBytes: bigData.length,
            truncated: false,
          },
        ],
      })),
      readActiveEditor: vi.fn(async () => ({ status: 'empty' as const })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async () => ({
        status: 'failed' as const,
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      createCatalog([]),
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    for (const turn of [1, 2]) {
      controller.handleMessage({
        type: 'attachment.pick',
        sessionId: 'session-1',
      });
      await vi.waitFor(() => {
        expect(
          attachmentsMessages(messages).at(-1)?.attachments,
        ).toHaveLength(1);
      });
      send(controller, 'session-1', `turn-${turn}`, `prompt ${turn}`);
      await vi.waitFor(() => {
        expect(
          lastMessage(messages, 'user.message-meta'),
        ).toMatchObject({ messageId: `sdk-message-${turn}` });
        expect(lastMessage(messages, 'turn.state')?.status).toBe(
          'completed',
        );
      });
    }

    // The first message's payload was evicted: its chip is only
    // metadata and cannot be resent.
    controller.handleMessage({
      type: 'editStage.begin',
      sessionId: 'session-1',
      messageId: 'sdk-message-1',
    });
    expect(
      lastMessage(messages, 'session.editAttachments')?.attachments,
    ).toMatchObject([
      { kind: 'text', name: 'big.md', restorable: false },
    ]);

    // The second message's payload is still retained.
    controller.handleMessage({
      type: 'editStage.begin',
      sessionId: 'session-1',
      messageId: 'sdk-message-2',
    });
    expect(
      lastMessage(messages, 'session.editAttachments')?.attachments,
    ).toMatchObject([
      { kind: 'text', name: 'big.md', restorable: true },
    ]);
  });

  it('runs the MCP browser auth flow and refreshes the list on success', async () => {
    let completed:
      | ((outcome: 'success' | 'cancelled' | 'failed') => void)
      | null = null;
    const runtime = Object.assign(createMockRuntime(), {
      listMcpServers: vi.fn(async () => []),
      setMcpServerEnabled: vi.fn(async () => {}),
      authenticateMcpServer: vi.fn(
        async (
          _name: string,
          onCompleted: (
            outcome: 'success' | 'cancelled' | 'failed',
          ) => void,
        ) => {
          completed = onCompleted;
          return { authUrl: 'https://auth.example/flow' };
        },
      ),
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
        'browser',
      ]);
    });
    expect(opened).toEqual(['https://auth.example/flow']);
    expect(runtime.authenticateMcpServer).toHaveBeenCalledTimes(1);

    // A second request while one flow is pending is ignored.
    controller.handleMessage({
      type: 'mcp.server.authenticate',
      sessionId: 'session-1',
      name: 'linear',
    });
    expect(runtime.authenticateMcpServer).toHaveBeenCalledTimes(1);

    completed!('success');
    await vi.waitFor(() => {
      expect(mcpAuthMessages(messages).at(-1)).toMatchObject({
        serverName: 'sentry',
        phase: 'success',
      });
    });
    // Success refreshes the MCP catalog.
    await vi.waitFor(() => {
      expect(runtime.listMcpServers).toHaveBeenCalled();
    });

    // A runtime without the capability answers with an error phase.
    const unsupported = createController(() => createMockRuntime());
    ready(unsupported.controller);
    await waitForConnected(unsupported.messages);
    unsupported.controller.handleMessage({
      type: 'mcp.server.authenticate',
      sessionId: 'session-1',
      name: 'sentry',
    });
    expect(mcpAuthMessages(unsupported.messages).at(-1)).toMatchObject({
      serverName: 'sentry',
      phase: 'error',
    });
  });

  it('answers rewind info requests with file-impact counts', async () => {
    const runtime = Object.assign(createMockRuntime(), {
      getRewindInfo: vi.fn(async () => ({
        restorableCount: 2,
        createdCount: 1,
        restorablePaths: ['src/app.ts', 'src/store.ts'],
        createdPaths: ['docs/new.md'],
        evictedFiles: [{ path: 'src/big.bin', reason: 'size-limit' }],
      })),
    });
    const { controller, messages } = createController(() => runtime);
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'rewind.info',
      sessionId: 'session-1',
      messageId: 'sdk-msg-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'rewind.info')).toMatchObject({
        sessionId: 'session-1',
        messageId: 'sdk-msg-1',
        restorableCount: 2,
        createdCount: 1,
        restorablePaths: ['src/app.ts', 'src/store.ts'],
        createdPaths: ['docs/new.md'],
        evictedFiles: [{ path: 'src/big.bin', reason: 'size-limit' }],
      });
    });

    // Requests for another session are ignored.
    controller.handleMessage({
      type: 'rewind.info',
      sessionId: 'session-other',
      messageId: 'sdk-msg-1',
    });
    expect(runtime.getRewindInfo).toHaveBeenCalledTimes(1);
  });

  it('answers workspace file searches and stages @-mentioned files', async () => {
    const runtime = createMockRuntime();
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({ status: 'cancelled' as const })),
      readActiveEditor: vi.fn(async () => ({ status: 'empty' as const })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => [
        'src/webview/assistant/Thread.tsx',
        'src/webview/assistant/thread/buildTurns.ts',
      ]),
      listOpenEditorFiles: vi.fn(() => [
        'src/extension/ChatController.ts',
        '../outside/escape.ts',
        'docs/PLAN.md',
      ]),
      readWorkspaceFile: vi.fn(async (path: string) => ({
        status: 'picked' as const,
        items: [
          {
            kind: 'text' as const,
            name: path.split('/').at(-1) ?? path,
            data: 'contents',
            sizeBytes: 8,
            truncated: false,
          },
        ],
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'workspace.searchFiles',
      sessionId: 'session-1',
      requestId: 'file-search-1',
      query: 'Thread',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'workspace.files')).toMatchObject({
        requestId: 'file-search-1',
        files: [
          'src/webview/assistant/Thread.tsx',
          'src/webview/assistant/thread/buildTurns.ts',
        ],
      });
    });
    expect(sources.searchWorkspaceFiles).toHaveBeenCalledWith(
      'Thread',
      20,
    );

    // Blank queries answer immediately with the open editor tabs
    // (unsafe paths filtered) instead of running a search.
    controller.handleMessage({
      type: 'workspace.searchFiles',
      sessionId: 'session-1',
      requestId: 'file-search-2',
      query: '   ',
    });
    expect(lastMessage(messages, 'workspace.files')).toMatchObject({
      requestId: 'file-search-2',
      status: 'ok',
      files: [
        'src/extension/ChatController.ts',
        'docs/PLAN.md',
      ],
    });
    expect(sources.listOpenEditorFiles).toHaveBeenCalledWith(20);
    expect(sources.searchWorkspaceFiles).toHaveBeenCalledTimes(1);

    // Guarded requests still settle with an explicit empty reply so
    // the mention popup never hangs on "Searching...".
    controller.handleMessage({
      type: 'workspace.searchFiles',
      sessionId: 'session-other',
      requestId: 'file-search-3',
      query: 'Thread',
    });
    expect(lastMessage(messages, 'workspace.files')).toMatchObject({
      sessionId: 'session-other',
      requestId: 'file-search-3',
      status: 'ok',
      files: [],
    });

    controller.handleMessage({
      type: 'attachment.addPath',
      sessionId: 'session-1',
      path: 'src/webview/assistant/Thread.tsx',
    });
    await vi.waitFor(() => {
      expect(
        attachmentsMessages(messages).at(-1)?.attachments,
      ).toMatchObject([{ kind: 'text', name: 'Thread.tsx' }]);
    });
    expect(sources.readWorkspaceFile).toHaveBeenCalledWith(
      'src/webview/assistant/Thread.tsx',
    );
  });

  it('serves markdown-referenced workspace images and refuses escapes', async () => {
    const runtime = createMockRuntime();
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({ status: 'cancelled' as const })),
      readActiveEditor: vi.fn(async () => ({ status: 'empty' as const })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async () => ({
        status: 'picked' as const,
        items: [
          {
            kind: 'image' as const,
            name: 'plot.png',
            data: 'aGk=',
            mediaType: 'image/png' as const,
            sizeBytes: 2,
            truncated: false,
          },
        ],
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'workspace.readImage',
      sessionId: 'session-1',
      path: 'out/plot.png',
    });
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'workspace.imageData'),
      ).toMatchObject({
        path: 'out/plot.png',
        status: 'ok',
        mediaType: 'image/png',
        data: 'aGk=',
      });
    });
    expect(sources.readWorkspaceFile).toHaveBeenCalledWith(
      'out/plot.png',
    );

    // Absolute references inside the workspace rebase to relative
    // reads; the reply still carries the path as written.
    controller.handleMessage({
      type: 'workspace.readImage',
      sessionId: 'session-1',
      path: 'C:\\workspace\\out\\chart.png',
    });
    await vi.waitFor(() => {
      expect(
        lastMessage(messages, 'workspace.imageData'),
      ).toMatchObject({
        path: 'C:\\workspace\\out\\chart.png',
        status: 'ok',
      });
    });
    expect(sources.readWorkspaceFile).toHaveBeenLastCalledWith(
      'out/chart.png',
    );

    // Escaping the workspace answers not-found without touching disk.
    controller.handleMessage({
      type: 'workspace.readImage',
      sessionId: 'session-1',
      path: 'C:\\elsewhere\\secret.png',
    });
    expect(lastMessage(messages, 'workspace.imageData')).toMatchObject({
      path: 'C:\\elsewhere\\secret.png',
      status: 'not-found',
    });
    expect(sources.readWorkspaceFile).toHaveBeenCalledTimes(2);
  });

  it('labels editor captures and reports empty selections', async () => {
    const runtime = createMockRuntime();
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({ status: 'cancelled' as const })),
      readActiveEditor: vi.fn(async () => ({
        status: 'captured' as const,
        item: {
          kind: 'text' as const,
          name: 'main.ts',
          data: 'const x = 1;',
          sizeBytes: 12,
          truncated: false,
        },
      })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async () => ({
        status: 'failed' as const,
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.addEditor',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(
        attachmentsMessages(messages).at(-1)?.attachments,
      ).toMatchObject([{ kind: 'editor', name: 'main.ts' }]);
    });

    controller.handleMessage({
      type: 'attachment.addSelection',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        code: 'attachment-empty',
      });
    });
    expect(
      attachmentsMessages(messages).at(-1)?.attachments,
    ).toHaveLength(1);

    // Wrong-session attachment requests are ignored.
    const before = attachmentsMessages(messages).length;
    controller.handleMessage({
      type: 'attachment.addEditor',
      sessionId: 'session-other',
    });
    expect(attachmentsMessages(messages)).toHaveLength(before);
  });

  it('stages problems as text and reports empty git changes', async () => {
    const runtime = createMockRuntime();
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({ status: 'cancelled' as const })),
      readActiveEditor: vi.fn(async () => ({ status: 'empty' as const })),
      readActiveSelection: vi.fn(async () => ({
        status: 'empty' as const,
      })),
      readProblems: vi.fn(async () => ({
        status: 'captured' as const,
        item: {
          kind: 'text' as const,
          name: 'Problems',
          data: 'src/a.ts:3 [error] Unexpected token',
          sizeBytes: 35,
          truncated: false,
        },
      })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async () => ({
        status: 'failed' as const,
      })),
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      sources,
    );
    ready(controller);
    await waitForConnected(messages);

    controller.handleMessage({
      type: 'attachment.addProblems',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(
        attachmentsMessages(messages).at(-1)?.attachments,
      ).toMatchObject([{ kind: 'text', name: 'Problems' }]);
    });

    controller.handleMessage({
      type: 'attachment.addGitChanges',
      sessionId: 'session-1',
    });
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        code: 'attachment-empty',
        message: 'There are no uncommitted git changes to attach.',
      });
    });
    expect(
      attachmentsMessages(messages).at(-1)?.attachments,
    ).toHaveLength(1);
  });

  it('keeps an invoke-time selection capture across a cold connect and sends it', async () => {
    const runtime = createMockRuntime();
    const selectionData =
      '```12:34:src/webview/assistant/store.ts\nconst a = 1;\n```';
    // The command reads the editor itself at invoke time; the
    // controller must never re-read (a cold start takes ~16s and the
    // editor state may have changed by then, QA v0.3 P1-1).
    const readActiveSelection = vi.fn(async () => ({
      status: 'failed' as const,
    }));
    const sources: AttachmentSources = {
      pickFiles: vi.fn(async () => ({ status: 'cancelled' as const })),
      readActiveEditor: vi.fn(async () => ({ status: 'empty' as const })),
      readActiveSelection,
      readProblems: vi.fn(async () => ({ status: 'empty' as const })),
      readGitChanges: vi.fn(async () => ({ status: 'empty' as const })),
      searchWorkspaceFiles: vi.fn(async () => []),
      readWorkspaceFile: vi.fn(async () => ({
        status: 'failed' as const,
      })),
    };
    const capture = {
      status: 'captured' as const,
      item: {
        kind: 'text' as const,
        name: 'store.ts:12-34',
        data: selectionData,
        sizeBytes: selectionData.length,
        truncated: false,
      },
    };
    const { controller, messages } = createController(
      () => runtime,
      undefined,
      undefined,
      undefined,
      undefined,
      sources,
    );

    // Before the webview connects there is no session to stage into;
    // the command entry reports that so its caller keeps the capture
    // and retries.
    expect(controller.stageCapturedEditorSelection(capture)).toBe(false);

    ready(controller);
    await waitForConnected(messages);

    // The late retry stages the original capture untouched.
    expect(controller.stageCapturedEditorSelection(capture)).toBe(true);
    await vi.waitFor(() => {
      expect(
        attachmentsMessages(messages).at(-1)?.attachments,
      ).toMatchObject([
        { kind: 'selection', name: 'store.ts:12-34', truncated: false },
      ]);
    });
    expect(readActiveSelection).not.toHaveBeenCalled();

    send(controller, 'session-1', 'turn-1', 'explain this selection');
    await vi.waitFor(() => {
      expect(runtime.sendTurn).toHaveBeenCalledWith(
        'explain this selection',
        [{ kind: 'text', data: selectionData, name: 'store.ts:12-34' }],
      );
    });
    expect(
      attachmentsMessages(messages).at(-1)?.attachments,
    ).toHaveLength(0);
  });

  it('reports an empty invoke-time capture as the usual in-session diagnostic', async () => {
    const { controller, messages } = createController(
      () => createMockRuntime(),
    );
    const empty = { status: 'empty' as const };
    expect(controller.stageCapturedEditorSelection(empty)).toBe(false);

    ready(controller);
    await waitForConnected(messages);

    expect(controller.stageCapturedEditorSelection(empty)).toBe(true);
    await vi.waitFor(() => {
      expect(lastMessage(messages, 'runtime.diagnostic')).toMatchObject({
        code: 'attachment-empty',
        message: 'Select text in an editor first to attach the selection.',
      });
    });
    expect(attachmentsMessages(messages)).toHaveLength(0);
  });

  it('silently ignores a repeated identical selection capture (QA v0.3 P2-5)', async () => {
    const sameCapture = {
      status: 'captured' as const,
      item: {
        kind: 'text' as const,
        name: 'store.ts:12-34',
        data: 'const a = 1;',
        sizeBytes: 12,
        truncated: false,
      },
    };
    const otherCapture = {
      status: 'captured' as const,
      item: {
        kind: 'text' as const,
        name: 'store.ts:40-50',
        data: 'const b = 2;',
        sizeBytes: 12,
        truncated: false,
      },
    };
    const { controller, messages } = createController(
      () => createMockRuntime(),
    );
    ready(controller);
    await waitForConnected(messages);

    expect(controller.stageCapturedEditorSelection(sameCapture)).toBe(
      true,
    );
    await vi.waitFor(() => {
      expect(
        attachmentsMessages(messages).at(-1)?.attachments,
      ).toHaveLength(1);
    });

    // The identical file, range, and content stages no second chip.
    expect(controller.stageCapturedEditorSelection(sameCapture)).toBe(
      true,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      attachmentsMessages(messages).at(-1)?.attachments,
    ).toHaveLength(1);

    // A different selection still stages alongside the first chip.
    expect(controller.stageCapturedEditorSelection(otherCapture)).toBe(
      true,
    );
    await vi.waitFor(() => {
      expect(
        attachmentsMessages(messages).at(-1)?.attachments,
      ).toMatchObject([
        { kind: 'selection', name: 'store.ts:12-34' },
        { kind: 'selection', name: 'store.ts:40-50' },
      ]);
    });
  });
});
