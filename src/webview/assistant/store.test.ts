import { describe, expect, it } from 'vitest';

import type { HostSnapshotMessage } from '../../shared/bridgeMessages';
import {
  assistantWebviewReducer,
  initialAssistantWebviewState,
} from './store';

function snapshot(
  sequence = 0,
  sessionId = 'session-a',
): HostSnapshotMessage {
  return {
    type: 'host.snapshot',
    sequence,
    sessionId,
    connection: { status: 'connected' },
    turn: null,
    sessions: {
      status: 'ready',
      items: [
        {
          id: sessionId,
          title: 'Active',
          messageCount: 0,
          modifiedTime: '2026-02-20T10:00:00.000Z',
          active: true,
          isFavorite: false,
        },
      ],
    },
    settings: {
      status: 'ready',
      value: {
        interactionMode: 'auto',
        modelId: 'model-a',
        reasoningEffort: 'medium',
        autonomyLevel: 'low',
        specModeModelId: null,
        specModeReasoningEffort: null,
      },
    },
    context: {
      status: 'ready',
      value: {
        used: 10,
        remaining: 90,
        limit: 100,
        accuracy: 'exact',
      },
    },
    modelCatalog: {
      status: 'unsupported',
      items: [],
      message: 'Unavailable',
    },
    transcript: [],
    historyStatus: 'complete',
    truncated: false,
  };
}

describe('assistantWebviewReducer', () => {
  it('tracks the snapshot-borne worktree-create capability', () => {
    expect(initialAssistantWebviewState.worktreeCreateAvailable).toBe(
      false,
    );

    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: { ...snapshot(0), worktreeCreateAvailable: true },
    });
    expect(state.worktreeCreateAvailable).toBe(true);

    // Absent flag means unavailable, not "keep the previous value":
    // a workspace switch may have removed the capability.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(1),
    });
    expect(state.worktreeCreateAvailable).toBe(false);
  });

  it('keeps archived and content-search state across snapshots', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(0),
    });
    expect(state.archived).toEqual({ status: 'idle', items: [] });
    expect(state.sessionSearch).toBeNull();

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.archived',
        sequence: 1,
        archived: {
          status: 'ready',
          items: [
            {
              id: 'session-z',
              title: 'Old spike',
              modifiedTime: '2026-02-10T10:00:00.000Z',
              archivedTime: '2026-02-11T10:00:00.000Z',
            },
          ],
        },
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.searchResults',
        sequence: 2,
        search: {
          status: 'ready',
          query: 'spike',
          items: [
            {
              id: 'session-z',
              title: 'Old spike',
              modifiedTime: null,
              snippet: 'spike notes',
            },
          ],
        },
      },
    });
    expect(state.archived.items).toHaveLength(1);
    expect(state.sessionSearch?.status).toBe('ready');

    // A later snapshot for another session leaves both intact: they
    // are workspace-level, not session-level.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(3, 'session-b'),
    });
    expect(state.archived.items).toHaveLength(1);
    expect(state.sessionSearch?.query).toBe('spike');

    // An archived refresh in flight keeps the last list visible.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.archived',
        sequence: 4,
        archived: { status: 'loading', items: [] },
      },
    });
    expect(state.archived.status).toBe('loading');
    expect(state.archived.items).toHaveLength(1);

    // An error state replaces the list.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.archived',
        sequence: 5,
        archived: {
          status: 'error',
          items: [],
          message: 'The local droid daemon is unavailable.',
        },
      },
    });
    expect(state.archived.status).toBe('error');
    expect(state.archived.items).toHaveLength(0);
  });

  it('stores the failure excerpt on the failed tool row', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'turn.send',
      turnId: 'turn-a',
      text: 'Patch the file',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-a',
        toolName: 'ApplyPatch',
        action: 'Updated workspace files',
        status: 'running',
        progressCount: 0,
        latestUpdateKind: null,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-a',
        toolName: 'ApplyPatch',
        action: 'Updated workspace files',
        status: 'failed',
        progressCount: 0,
        latestUpdateKind: null,
        errorMessage: 'Tool execution cancelled by user',
      },
    });
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'tool',
      status: 'failed',
      errorMessage: 'Tool execution cancelled by user',
    });
  });

  it('carries tool file paths and appends one changes summary per turn', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'turn.send',
      turnId: 'turn-a',
      text: 'Change files',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-a',
        toolName: 'Edit',
        action: 'Updated workspace files',
        status: 'running',
        progressCount: 0,
        latestUpdateKind: null,
      },
    });
    // The full call fills the path in on a live update.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-a',
        toolName: 'Edit',
        action: 'Updated workspace files',
        status: 'completed',
        progressCount: 0,
        latestUpdateKind: null,
        filePath: 'src/app.ts',
      },
    });
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'tool',
      filePath: 'src/app.ts',
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'turn.state',
        sequence: 3,
        sessionId: 'session-a',
        turnId: 'turn-a',
        status: 'completed',
      },
    });
    const changes = {
      type: 'turn.changes' as const,
      sequence: 4,
      sessionId: 'session-a',
      turnId: 'turn-a',
      files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
    };
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: changes,
    });
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'changes',
      turnId: 'turn-a',
      files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
    });

    // Redelivery does not duplicate the summary.
    const again = assistantWebviewReducer(state, {
      type: 'host.message',
      message: { ...changes, sequence: 5 },
    });
    expect(
      again.transcript.filter((item) => item.kind === 'changes'),
    ).toHaveLength(1);

    // Other sessions only advance the sequence.
    const other = assistantWebviewReducer(again, {
      type: 'host.message',
      message: {
        ...changes,
        sequence: 6,
        sessionId: 'session-b',
        turnId: 'turn-b',
      },
    });
    expect(
      other.transcript.filter((item) => item.kind === 'changes'),
    ).toHaveLength(1);
    expect(other.sequence).toBe(6);
  });

  it('tracks staged attachments for the active session only', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.attachments',
        sequence: 1,
        sessionId: 'session-a',
        attachments: [
          {
            id: 'att-1',
            kind: 'image',
            name: 'shot.png',
            sizeBytes: 12,
            truncated: false,
          },
        ],
      },
    });
    expect(state.attachments).toHaveLength(1);

    // Other-session attachment updates advance the sequence only.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.attachments',
        sequence: 2,
        sessionId: 'session-other',
        attachments: [],
      },
    });
    expect(state.sequence).toBe(2);
    expect(state.attachments).toHaveLength(1);

    // Same-session snapshots keep staged attachments; new sessions drop them.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(3),
    });
    expect(state.attachments).toHaveLength(1);
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(4, 'session-b'),
    });
    expect(state.attachments).toHaveLength(0);
  });

  it('tracks workspace file search results for the active session only', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'workspace.files',
        sequence: 1,
        sessionId: 'session-a',
        requestId: 'file-search-1',
        status: 'ok',
        files: ['src/app.ts', 'docs/readme.md'],
      },
    });
    expect(state.fileSearch).toEqual({
      requestId: 'file-search-1',
      status: 'ok',
      files: ['src/app.ts', 'docs/readme.md'],
    });

    // Other-session results advance the sequence only.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'workspace.files',
        sequence: 2,
        sessionId: 'session-other',
        requestId: 'file-search-9',
        status: 'ok',
        files: [],
      },
    });
    expect(state.sequence).toBe(2);
    expect(state.fileSearch?.requestId).toBe('file-search-1');

    // Switching sessions drops stale results.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(3, 'session-b'),
    });
    expect(state.fileSearch).toBeNull();
  });

  it('stores markdown image bytes keyed by path for the active session only', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'workspace.imageData',
        sequence: 1,
        sessionId: 'session-a',
        path: 'out/plot.png',
        status: 'ok',
        mediaType: 'image/png',
        data: 'aGk=',
      },
    });
    expect(state.localImages['out/plot.png']).toEqual({
      status: 'ok',
      mediaType: 'image/png',
      data: 'aGk=',
    });

    // Other-session bytes advance the sequence only.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'workspace.imageData',
        sequence: 2,
        sessionId: 'session-other',
        path: 'other.png',
        status: 'ok',
        mediaType: 'image/png',
        data: 'aGk=',
      },
    });
    expect(state.localImages['other.png']).toBeUndefined();

    // Non-ok statuses persist so the renderer can explain the miss.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'workspace.imageData',
        sequence: 3,
        sessionId: 'session-a',
        path: 'missing.png',
        status: 'not-found',
        mediaType: null,
        data: '',
      },
    });
    expect(state.localImages['missing.png']?.status).toBe('not-found');

    // Switching sessions drops the cache.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(4, 'session-b'),
    });
    expect(Object.keys(state.localImages)).toHaveLength(0);
  });

  it('tracks rewind file info for the active session only', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'rewind.info',
        sequence: 1,
        sessionId: 'session-a',
        messageId: 'message-1',
        restorableCount: 2,
        createdCount: 1,
      },
    });
    expect(state.rewindInfo).toEqual({
      messageId: 'message-1',
      restorableCount: 2,
      createdCount: 1,
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'rewind.info',
        sequence: 2,
        sessionId: 'session-other',
        messageId: 'message-9',
        restorableCount: 0,
        createdCount: 0,
      },
    });
    expect(state.rewindInfo?.messageId).toBe('message-1');

    // Any snapshot (e.g. after the rewind forks) clears stale info.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(3),
    });
    expect(state.rewindInfo).toBeNull();
  });

  it('tracks MCP auth progress for the active session only', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'mcp.auth',
        sequence: 1,
        sessionId: 'session-a',
        serverName: 'sentry',
        phase: 'browser',
        message: 'Complete the sign-in in your browser.',
      },
    });
    expect(state.mcpAuth).toEqual({
      serverName: 'sentry',
      phase: 'browser',
      message: 'Complete the sign-in in your browser.',
    });

    // Other-session progress advances the sequence only.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'mcp.auth',
        sequence: 2,
        sessionId: 'session-other',
        serverName: 'linear',
        phase: 'failed',
        message: null,
      },
    });
    expect(state.sequence).toBe(2);
    expect(state.mcpAuth?.serverName).toBe('sentry');

    // Switching sessions drops stale progress.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(3, 'session-b'),
    });
    expect(state.mcpAuth).toBeNull();
  });

  it('isolates sequenced settings, context, and catalogs by session', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    const confirmed = state;
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.settings',
        sequence: 1,
        sessionId: 'session-other',
        settings: {
          status: 'ready',
          value: {
            interactionMode: 'mission',
            modelId: 'must-not-leak',
            reasoningEffort: 'max',
            autonomyLevel: 'high',
            specModeModelId: null,
            specModeReasoningEffort: null,
          },
        },
      },
    });
    expect(state.sequence).toBe(1);
    expect(state.settings).toBe(confirmed.settings);

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.context',
        sequence: 2,
        sessionId: 'session-a',
        context: {
          status: 'ready',
          value: {
            used: 25,
            remaining: 75,
            limit: 100,
            accuracy: 'estimated',
          },
        },
      },
    });
    expect(state.context.value).toMatchObject({ used: 25 });

    const accepted = state;
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.model-catalog',
        sequence: 2,
        sessionId: 'session-a',
        modelCatalog: {
          status: 'ready',
          items: [],
        },
      },
    });
    expect(state).toBe(accepted);
  });

  it('rejects stale sequences and advances past wrong-session deltas', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: {
        ...snapshot(),
        turn: { turnId: 'turn-a', status: 'streaming' },
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'assistant.delta',
        sequence: 2,
        sessionId: 'session-other',
        turnId: 'turn-a',
        delta: 'must be ignored',
      },
    });
    const afterWrongSession = state;
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'assistant.delta',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        delta: 'stale',
      },
    });

    expect(state).toBe(afterWrongSession);
    expect(state.sequence).toBe(2);
    expect(state.transcript).toEqual([]);
  });

  it('optimistically accepts a user send and streams safe activities', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'turn.send',
      turnId: 'turn-a',
      text: 'Inspect this',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'thinking.delta',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        delta: 'Checking',
        truncated: false,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-a',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'running',
        progressCount: 0,
        latestUpdateKind: null,
      },
    });
    state = assistantWebviewReducer(state, { type: 'turn.stop' });

    expect(state.turn?.status).toBe('stopping');
    expect(state.transcript).toMatchObject([
      { id: 'user:turn-a', kind: 'user', text: 'Inspect this' },
      { kind: 'thinking', status: 'stopping' },
      {
        kind: 'tool',
        toolUseId: 'tool-a',
        toolName: 'Read',
        status: 'stopping',
      },
    ]);
  });

  it('appends live image items once per id and caps them per turn', () => {
    const imageMessage = (id: string, sequence: number) =>
      ({
        type: 'host.message',
        message: {
          type: 'transcript.image',
          sequence,
          sessionId: 'session-a',
          turnId: 'turn-a',
          item: {
            id,
            kind: 'image',
            turnId: 'turn-a',
            origin: 'tool-result',
            mediaType: 'image/png',
            data: 'aGVsbG8=',
            generated: false,
            byteLength: 5,
          },
        },
      }) as const;

    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'turn.send',
      turnId: 'turn-a',
      text: 'Screenshot please',
    });
    state = assistantWebviewReducer(state, imageMessage('image-1', 1));
    state = assistantWebviewReducer(state, imageMessage('image-1', 2));
    for (let index = 2; index <= 12; index += 1) {
      state = assistantWebviewReducer(
        state,
        imageMessage(`image-${index}`, index + 1),
      );
    }

    const images = state.transcript.filter(
      (item) => item.kind === 'image',
    );
    expect(images).toHaveLength(8);
    expect(images[0]).toMatchObject({
      id: 'image-1',
      data: 'aGVsbG8=',
    });
    expect(state.sequence).toBe(13);
  });

  it('attaches the SDK message id to the matching user prompt', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'turn.send',
      turnId: 'turn-a',
      text: 'Inspect this',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'user.message-meta',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        messageId: 'sdk-msg-1',
      },
    });

    expect(state.transcript).toMatchObject([
      {
        id: 'user:turn-a',
        kind: 'user',
        text: 'Inspect this',
        messageId: 'sdk-msg-1',
      },
    ]);

    const wrongSession = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'user.message-meta',
        sequence: 2,
        sessionId: 'session-other',
        turnId: 'turn-a',
        messageId: 'sdk-msg-other',
      },
    });
    expect(wrongSession.transcript).toEqual(state.transcript);

    const unknownTurn = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'user.message-meta',
        sequence: 3,
        sessionId: 'session-a',
        turnId: 'turn-unknown',
        messageId: 'sdk-msg-2',
      },
    });
    expect(unknownTurn.transcript).toEqual(state.transcript);
  });

  it('keeps interactions generation-safe, unique, and closes once', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    const request = {
      requestId: 'permission-a',
      kind: 'permission' as const,
      tools: [
        {
          toolUseId: 'tool-a',
          toolName: 'Execute',
          confirmationKind: 'exec' as const,
          title: 'Run checks',
        },
      ],
      options: [
        {
          label: 'Allow',
          value: 'allow',
          requiresEditedSpec: false,
        },
      ],
    };
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'interaction.request',
        sequence: 1,
        sessionId: 'session-other',
        turnId: 'turn-a',
        request,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'interaction.request',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        request,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'interaction.request',
        sequence: 3,
        sessionId: 'session-a',
        turnId: 'turn-a',
        request,
      },
    });
    expect(state.interactions).toHaveLength(1);

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'interaction.closed',
        sequence: 4,
        sessionId: 'session-a',
        turnId: 'turn-a',
        requestId: 'permission-a',
      },
    });
    expect(state.interactions).toEqual([]);

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'turn.state',
        sequence: 5,
        sessionId: 'session-a',
        turnId: 'turn-a',
        status: 'completed',
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'interaction.request',
        sequence: 6,
        sessionId: 'session-a',
        turnId: 'turn-a',
        request: { ...request, requestId: 'late-permission' },
      },
    });
    expect(state.terminalTurnId).toBe('turn-a');
    expect(state.interactions).toEqual([]);
  });

  it('stops a running tool when the overall turn fails', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: {
        ...snapshot(),
        turn: { turnId: 'turn-a', status: 'streaming' },
        transcript: [
          {
            id: 'tool-a',
            kind: 'tool',
            turnId: 'turn-a',
            toolUseId: 'tool-a',
            toolName: 'Read',
            action: 'Read workspace files',
            status: 'running',
            progressCount: 0,
            latestUpdateKind: null,
          },
        ],
      },
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'turn.state',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        status: 'failed',
      },
    });

    expect(state.transcript).toMatchObject([
      { kind: 'tool', status: 'stopped' },
    ]);
  });

  it('preserves an explicit tool failure when the turn fails', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: {
        ...snapshot(),
        turn: { turnId: 'turn-a', status: 'streaming' },
        transcript: [
          {
            id: 'tool-a',
            kind: 'tool',
            turnId: 'turn-a',
            toolUseId: 'tool-a',
            toolName: 'Read',
            action: 'Read workspace files',
            status: 'running',
            progressCount: 0,
            latestUpdateKind: null,
          },
        ],
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-a',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'failed',
        progressCount: 1,
        latestUpdateKind: 'error',
      },
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'turn.state',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        status: 'failed',
      },
    });

    expect(state.transcript).toMatchObject([
      { kind: 'tool', status: 'failed' },
    ]);
  });

  it('replaces earlier same-turn errors with the terminal runtime failure', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: {
        ...snapshot(),
        turn: { turnId: 'turn-a', status: 'streaming' },
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'runtime.diagnostic',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        severity: 'error',
        code: 'sdk-stream-error',
        message: 'The Droid SDK stream failed.',
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'runtime.diagnostic',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        severity: 'error',
        code: 'runtime-execution-failed',
        message: 'Droid could not complete this turn.',
      },
    });

    expect(state.transcript).toMatchObject([
      {
        kind: 'diagnostic',
        code: 'runtime-execution-failed',
        turnId: 'turn-a',
      },
    ]);
  });

  it('tracks the command catalog and resets it on session change', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    expect(state.commands.status).toBe('idle');

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.commands',
        sequence: 1,
        sessionId: 'session-a',
        commands: {
          status: 'ready',
          items: [
            {
              name: 'deploy',
              description: null,
              argumentHint: null,
              isExecutable: false,
            },
          ],
          recent: [],
        },
      },
    });
    expect(state.commands).toMatchObject({
      status: 'ready',
      items: [{ name: 'deploy' }],
    });

    // An empty in-flight refresh keeps the current items visible but
    // adopts the fresh recent list.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.commands',
        sequence: 2,
        sessionId: 'session-a',
        commands: { status: 'loading', items: [], recent: ['deploy'] },
      },
    });
    expect(state.commands).toMatchObject({
      status: 'loading',
      items: [{ name: 'deploy' }],
      recent: ['deploy'],
    });

    // Messages for another session only advance the sequence.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.commands',
        sequence: 3,
        sessionId: 'session-b',
        commands: { status: 'ready', items: [], recent: [] },
      },
    });
    expect(state.commands.status).toBe('loading');

    // A snapshot for a different session resets the catalog to idle.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(4, 'session-b'),
    });
    expect(state.commands).toMatchObject({ status: 'idle', items: [] });
  });
});
