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
        availability: 'available',
        used: 10,
        remaining: 90,
        limit: 100,
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

  it('tracks the snapshot-borne background-turns capability', () => {
    expect(
      initialAssistantWebviewState.backgroundTurnsAvailable,
    ).toBe(false);

    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: { ...snapshot(0), backgroundTurnsAvailable: true },
    });
    expect(state.backgroundTurnsAvailable).toBe(true);

    // Absent flag means process mode, not "keep the previous value":
    // a daemon fallback may have removed the capability.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(1),
    });
    expect(state.backgroundTurnsAvailable).toBe(false);
  });

  it('flips one catalog row on session.running without a refresh', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(0),
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.running',
        sequence: 1,
        sessionId: 'session-a',
        running: true,
      },
    });
    expect(state.sessions.items[0]).toMatchObject({
      id: 'session-a',
      running: true,
    });

    // Clearing drops the key entirely so the row matches a fresh
    // catalog load and the spinner disappears at once.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.running',
        sequence: 2,
        sessionId: 'session-a',
        running: false,
      },
    });
    expect('running' in state.sessions.items[0]).toBe(false);

    // Unknown ids never invent rows.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.running',
        sequence: 3,
        sessionId: 'session-missing',
        running: true,
      },
    });
    expect(state.sessions.items).toHaveLength(1);
    expect(state.sequence).toBe(3);
  });

  it('tracks the snapshot-borne workspace root', () => {
    expect(initialAssistantWebviewState.workspaceRoot).toBeNull();

    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: {
        ...snapshot(0),
        workspaceRoot: 'd:\\E\\前端好玩的东西\\droidvisx',
      },
    });
    expect(state.workspaceRoot).toBe('d:\\E\\前端好玩的东西\\droidvisx');

    // Absent root means no usable workspace, not "keep the previous
    // value": a workspace switch may have removed it.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(1),
    });
    expect(state.workspaceRoot).toBeNull();
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

  it('stores a safe tool target and keeps it across lifecycle updates', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'turn.send',
      turnId: 'turn-a',
      text: 'Inspect the file',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-read',
        toolName: 'Read',
        action: 'Read workspace files',
        target: 'src/app.ts',
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
        toolUseId: 'tool-read',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'completed',
        progressCount: 0,
        latestUpdateKind: null,
      },
    });
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'tool',
      status: 'completed',
      target: 'src/app.ts',
    });
  });

  it('streams the execute output tail and keeps it across silent updates', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'turn.send',
      turnId: 'turn-a',
      text: 'Run the build',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-a',
        toolName: 'Execute',
        action: 'Ran a local command',
        status: 'running',
        progressCount: 1,
        latestUpdateKind: 'status',
        outputTail: 'line-1\nline-2',
      },
    });
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'tool',
      status: 'running',
      outputTail: 'line-1\nline-2',
    });

    // A completing update without the field keeps the final tail.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-a',
        toolName: 'Execute',
        action: 'Ran a local command',
        status: 'completed',
        progressCount: 1,
        latestUpdateKind: 'status',
      },
    });
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'tool',
      status: 'completed',
      outputTail: 'line-1\nline-2',
    });
  });

  it('keeps the background hint on upserted execute rows', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'turn.send',
      turnId: 'turn-a',
      text: 'Start the dev server',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-a',
        toolName: 'Execute',
        action: 'Ran a local command',
        status: 'running',
        progressCount: 0,
        latestUpdateKind: null,
        backgroundHint: { fireAndForget: true },
      },
    });
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'tool',
      backgroundHint: { fireAndForget: true },
    });

    // The completing update without the hint keeps the stored one.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-a',
        toolName: 'Execute',
        action: 'Ran a local command',
        status: 'completed',
        progressCount: 0,
        latestUpdateKind: null,
      },
    });
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'tool',
      status: 'completed',
      backgroundHint: { fireAndForget: true },
    });
  });

  it('tracks the snapshot-borne mission identity per session', () => {
    expect(initialAssistantWebviewState.mission).toBeNull();

    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: {
        ...snapshot(0),
        mission: { state: 'running', role: 'orchestrator' },
      },
    });
    expect(state.mission).toEqual({
      state: 'running',
      role: 'orchestrator',
    });

    // Absent means "not a mission session", not "keep the previous".
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(1),
    });
    expect(state.mission).toBeNull();

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        ...snapshot(2),
        mission: { state: 'paused', role: null },
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'host.connection',
        sequence: 3,
        sessionId: 'session-b',
        connection: { status: 'connecting' },
      },
    });
    expect(state.mission).toBeNull();
  });

  it('tracks token usage for the active session and resets on switch', () => {
    // Live values from artifacts/probe-token-usage.out.json.
    const breakdown = {
      inputTokens: 2565,
      outputTokens: 81,
      cacheReadTokens: 23552,
      cacheCreationTokens: 0,
      thinkingTokens: 62,
    };
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    // A snapshot without the field means "no usage", not "keep".
    expect(state.tokenUsage).toEqual({ cumulative: null, lastTurn: null });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.tokenUsage',
        sequence: 1,
        sessionId: 'session-a',
        tokenUsage: { cumulative: breakdown, lastTurn: null },
      },
    });
    expect(state.tokenUsage).toEqual({
      cumulative: breakdown,
      lastTurn: null,
    });

    // Wrong-session updates advance the sequence but never leak in.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.tokenUsage',
        sequence: 2,
        sessionId: 'session-other',
        tokenUsage: {
          cumulative: { ...breakdown, inputTokens: 999999 },
          lastTurn: null,
        },
      },
    });
    expect(state.sequence).toBe(2);
    expect(state.tokenUsage.cumulative).toEqual(breakdown);

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'host.connection',
        sequence: 3,
        sessionId: 'session-b',
        connection: { status: 'connecting' },
      },
    });
    expect(state.tokenUsage).toEqual({ cumulative: null, lastTurn: null });
  });

  it('upgrades a Task row with a subagent summary and settles it', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'turn.send',
      turnId: 'turn-a',
      text: 'Delegate the survey',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'task-a',
        toolName: 'Task',
        action: 'Delegated to a subagent',
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
        toolUseId: 'task-a',
        toolName: 'Task',
        action: 'Delegated to a subagent',
        status: 'running',
        progressCount: 0,
        latestUpdateKind: null,
        subagent: {
          type: 'explore',
          description: 'Survey the auth module',
          status: 'running',
        },
      },
    });
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'tool',
      status: 'running',
      subagent: { type: 'explore', status: 'running' },
    });

    // A later update without the field keeps the recorded summary.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 3,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'task-a',
        toolName: 'Task',
        action: 'Delegated to a subagent',
        status: 'completed',
        progressCount: 0,
        latestUpdateKind: null,
      },
    });
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'tool',
      status: 'completed',
      subagent: { type: 'explore', status: 'running' },
    });

    // Turn-end reconciliation replaces it with the ledger summary.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 4,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'task-a',
        toolName: 'Task',
        action: 'Delegated to a subagent',
        status: 'completed',
        progressCount: 0,
        latestUpdateKind: null,
        subagent: {
          type: 'explore',
          description: 'Survey the auth module',
          status: 'completed',
          toolUseCount: 7,
          durationMs: 4_200,
        },
      },
    });
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'tool',
      status: 'completed',
      subagent: {
        type: 'explore',
        description: 'Survey the auth module',
        status: 'completed',
        toolUseCount: 7,
        durationMs: 4_200,
      },
    });
  });

  it('settles a background delegation after the turn ended', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'turn.send',
      turnId: 'turn-a',
      text: 'Delegate in the background',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'task-bg',
        toolName: 'Task',
        action: 'Delegated focused work',
        status: 'completed',
        progressCount: 0,
        latestUpdateKind: null,
        subagent: {
          type: 'explore',
          description: 'Background research',
          status: 'running',
        },
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'turn.state',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        status: 'completed',
      },
    });

    // The delegation outlived the turn; tool.activity would be
    // dropped now, but the out-of-band settlement lands.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'subagent.update',
        sequence: 3,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'task-bg',
        subagent: {
          type: 'explore',
          description: 'Background research',
          status: 'completed',
          toolUseCount: 7,
          durationMs: 123_000,
        },
      },
    });
    expect(state.sequence).toBe(3);
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'tool',
      status: 'completed',
      subagent: {
        status: 'completed',
        toolUseCount: 7,
        durationMs: 123_000,
      },
    });
  });

  it('drops subagent settlements for other sessions and plain rows', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: {
        ...snapshot(),
        transcript: [
          {
            id: 'tool-plain',
            kind: 'tool',
            turnId: 'turn-a',
            toolUseId: 'read-1',
            toolName: 'Read',
            action: 'Read workspace files',
            status: 'completed',
            progressCount: 0,
            latestUpdateKind: null,
          },
        ],
      },
    });
    const settlement = {
      type: 'subagent.update' as const,
      sequence: 2,
      sessionId: 'session-b',
      turnId: 'turn-a',
      toolUseId: 'read-1',
      subagent: {
        type: 'explore',
        description: '',
        status: 'completed' as const,
      },
    };
    // Wrong session: sequence advances, transcript untouched.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: settlement,
    });
    expect(state.sequence).toBe(2);
    expect(state.transcript[0]).not.toHaveProperty('subagent');

    // Right session but the row never delegated: still a no-op, a
    // settlement can never invent a subagent on a plain tool row.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: { ...settlement, sequence: 3, sessionId: 'session-a' },
    });
    expect(state.transcript[0]).not.toHaveProperty('subagent');
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
        restorablePaths: ['src/app.ts', 'src/store.ts'],
        createdPaths: ['docs/new.md'],
        evictedFiles: [{ path: 'src/big.bin', reason: 'size-limit' }],
      },
    });
    expect(state.rewindInfo).toEqual({
      messageId: 'message-1',
      restorableCount: 2,
      createdCount: 1,
      restorablePaths: ['src/app.ts', 'src/store.ts'],
      createdPaths: ['docs/new.md'],
      evictedFiles: [{ path: 'src/big.bin', reason: 'size-limit' }],
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
        restorablePaths: [],
        createdPaths: [],
        evictedFiles: [],
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
            availability: 'available',
            used: 25,
            remaining: 75,
            limit: 100,
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
        segmentIndex: 0,
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

  it('renders interleaved thinking segments as separate rows in arrival order', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'turn.send',
      turnId: 'turn-a',
      text: 'Think twice',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'thinking.delta',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        delta: 'First thought',
        truncated: false,
        segmentIndex: 0,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'thinking.complete',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        durationMs: 154,
        segmentIndex: 0,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'tool.activity',
        sequence: 3,
        sessionId: 'session-a',
        turnId: 'turn-a',
        toolUseId: 'tool-a',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'completed',
        progressCount: 0,
        latestUpdateKind: null,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'thinking.delta',
        sequence: 4,
        sessionId: 'session-a',
        turnId: 'turn-a',
        delta: 'Second thought',
        truncated: false,
        segmentIndex: 1,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'thinking.complete',
        sequence: 5,
        sessionId: 'session-a',
        turnId: 'turn-a',
        durationMs: 168,
        segmentIndex: 1,
      },
    });

    // Each segment is its own transcript row at its arrival position
    // (before/after the tool row), with its own durationMs: the last
    // segment's completion no longer overwrites earlier labels.
    expect(state.transcript).toMatchObject([
      { kind: 'user', text: 'Think twice' },
      {
        id: 'thinking:turn-a:0',
        kind: 'thinking',
        text: 'First thought',
        status: 'complete',
        durationMs: 154,
      },
      { kind: 'tool', toolUseId: 'tool-a' },
      {
        id: 'thinking:turn-a:1',
        kind: 'thinking',
        text: 'Second thought',
        status: 'complete',
        durationMs: 168,
      },
    ]);
  });

  it('keeps completed thinking segments frozen while a later segment streams', () => {
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
        type: 'thinking.delta',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        delta: 'First thought',
        truncated: false,
        segmentIndex: 0,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'thinking.complete',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        durationMs: 154,
        segmentIndex: 0,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'thinking.delta',
        sequence: 3,
        sessionId: 'session-a',
        turnId: 'turn-a',
        delta: 'Second ',
        truncated: false,
        segmentIndex: 1,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'thinking.delta',
        sequence: 4,
        sessionId: 'session-a',
        turnId: 'turn-a',
        delta: 'thought',
        truncated: false,
        segmentIndex: 1,
      },
    });

    // Regression: later-segment deltas used to append into the
    // already-completed row, growing a static row with no shimmer.
    expect(state.transcript).toMatchObject([
      {
        id: 'thinking:turn-a:0',
        kind: 'thinking',
        text: 'First thought',
        status: 'complete',
        durationMs: 154,
      },
      {
        id: 'thinking:turn-a:1',
        kind: 'thinking',
        text: 'Second thought',
        status: 'active',
      },
    ]);
  });

  it('appends new segments after a legacy single-block checkpoint item without collision', () => {
    // Checkpoints written before segmentation hold one merged item
    // per turn under the legacy `thinking:${turnId}` id; a reconnect
    // that keeps streaming the same turn must not touch it.
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: {
        ...snapshot(),
        turn: { turnId: 'turn-a', status: 'streaming' },
        transcript: [
          {
            id: 'thinking:turn-a',
            kind: 'thinking',
            turnId: 'turn-a',
            text: 'Merged legacy thinking',
            status: 'complete',
            durationMs: 99,
            truncated: false,
          },
        ],
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'thinking.delta',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        delta: 'Fresh segment',
        truncated: false,
        segmentIndex: 1,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'thinking.complete',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        durationMs: 20,
        segmentIndex: 1,
      },
    });

    expect(state.transcript).toMatchObject([
      {
        id: 'thinking:turn-a',
        kind: 'thinking',
        text: 'Merged legacy thinking',
        status: 'complete',
        durationMs: 99,
      },
      {
        id: 'thinking:turn-a:1',
        kind: 'thinking',
        text: 'Fresh segment',
        status: 'complete',
        durationMs: 20,
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

  it('syncs Plan document state and appends one AskUser settlement result', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'interaction.request',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        request: {
          requestId: 'plan-a',
          kind: 'permission',
          tools: [
            {
              toolUseId: 'tool-a',
              toolName: 'ExitSpecMode',
              confirmationKind: 'exit_spec_mode',
              title: 'Review plan',
            },
          ],
          options: [
            {
              label: 'Approve',
              value: 'proceed_once',
              requiresEditedSpec: false,
            },
          ],
          editableSpecContent: '# Original',
        },
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'plan.document.state',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-a',
        requestId: 'plan-a',
        status: 'ready',
        content: '# Revised',
      },
    });
    expect(state.interactions[0]?.planDocument).toEqual({
      status: 'ready',
      content: '# Revised',
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'interaction.closed',
        sequence: 3,
        sessionId: 'session-a',
        turnId: 'turn-a',
        requestId: 'ask-a',
        result: {
          status: 'answered',
          answers: [{ topic: 'Library', answer: 'React' }],
        },
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'interaction.closed',
        sequence: 4,
        sessionId: 'session-a',
        turnId: 'turn-a',
        requestId: 'ask-a',
        result: {
          status: 'answered',
          answers: [{ topic: 'Library', answer: 'React' }],
        },
      },
    });
    expect(
      state.transcript.filter(({ kind }) => kind === 'ask-user-result'),
    ).toEqual([
      expect.objectContaining({
        status: 'answered',
        answers: [{ topic: 'Library', answer: 'React' }],
      }),
    ]);
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

  it('collapses identical back-to-back diagnostics into one card', () => {
    const failedOpen = {
      type: 'runtime.diagnostic' as const,
      sessionId: 'session-a',
      turnId: null,
      severity: 'warning' as const,
      code: 'file-diff-failed',
      message: 'That file could not be opened.',
    };
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    for (let sequence = 1; sequence <= 6; sequence += 1) {
      state = assistantWebviewReducer(state, {
        type: 'host.message',
        message: { ...failedOpen, sequence },
      });
    }
    expect(
      state.transcript.filter((item) => item.kind === 'diagnostic'),
    ).toHaveLength(1);
    // The dropped repeats still advance the sequence cursor.
    expect(state.sequence).toBe(6);

    // A different diagnostic appends; a repeat matching anywhere in
    // the stacked trailing run stays collapsed.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        ...failedOpen,
        code: 'preview-failed',
        message: 'That prototype could not be previewed.',
        sequence: 7,
      },
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: { ...failedOpen, sequence: 8 },
    });
    expect(
      state.transcript.filter((item) => item.kind === 'diagnostic'),
    ).toHaveLength(2);
  });

  it('advances past transient diagnostics without storing history', () => {
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
        severity: 'warning',
        code: 'file-not-ready',
        message: 'Droid is still working on it.',
      },
    });

    expect(state.sequence).toBe(1);
    expect(state.transcript).toHaveLength(0);
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

  it('tracks the plugins panel state and resets it on session change', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    expect(state.plugins).toEqual({ status: 'idle', items: [] });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.plugins',
        sequence: 1,
        sessionId: 'session-a',
        plugins: {
          status: 'ready',
          items: [
            {
              id: 'core@factory-plugins',
              scope: 'user',
              version: 'e3ff29f752fb',
              active: true,
            },
          ],
          marketplaceCount: 1,
        },
      },
    });
    expect(state.plugins).toMatchObject({
      status: 'ready',
      items: [{ id: 'core@factory-plugins' }],
      marketplaceCount: 1,
    });

    // An empty in-flight refresh keeps the current items visible.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.plugins',
        sequence: 2,
        sessionId: 'session-a',
        plugins: { status: 'loading', items: [] },
      },
    });
    expect(state.plugins).toMatchObject({
      status: 'loading',
      items: [{ id: 'core@factory-plugins' }],
    });

    // A failed refresh keeps the last list but surfaces the message.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.plugins',
        sequence: 3,
        sessionId: 'session-a',
        plugins: {
          status: 'error',
          items: [],
          message: 'The local droid daemon is unavailable.',
        },
      },
    });
    expect(state.plugins).toMatchObject({
      status: 'error',
      items: [{ id: 'core@factory-plugins' }],
      message: 'The local droid daemon is unavailable.',
    });

    // Messages for another session only advance the sequence.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'session.plugins',
        sequence: 4,
        sessionId: 'session-b',
        plugins: { status: 'ready', items: [], marketplaceCount: 0 },
      },
    });
    expect(state.plugins.status).toBe('error');

    // A snapshot for a different session resets the panel to idle so
    // the next open triggers a fresh request instead of a stale list.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(5, 'session-b'),
    });
    expect(state.plugins).toEqual({ status: 'idle', items: [] });
  });

  it('enqueues optimistically, consuming the staged attachments', () => {
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
            id: 'attachment-1',
            kind: 'text',
            name: 'notes.md',
            sizeBytes: 64,
            truncated: false,
          },
        ],
      },
    });

    state = assistantWebviewReducer(state, {
      type: 'queue.add',
      queueId: 'queue-1',
      text: 'Follow-up one.',
    });
    expect(state.queue.items).toEqual([
      {
        queueId: 'queue-1',
        text: 'Follow-up one.',
        attachments: [{ kind: 'text', name: 'notes.md', sizeBytes: 64 }],
      },
    ]);
    // The host consumes the staging area at enqueue time.
    expect(state.attachments).toEqual([]);

    // Duplicate ids and repeats past the cap are ignored.
    state = assistantWebviewReducer(state, {
      type: 'queue.add',
      queueId: 'queue-1',
      text: 'Duplicate.',
    });
    expect(state.queue.items).toHaveLength(1);
    for (let index = 2; index <= 12; index += 1) {
      state = assistantWebviewReducer(state, {
        type: 'queue.add',
        queueId: `queue-${index}`,
        text: `Follow-up ${index}.`,
      });
    }
    expect(state.queue.items).toHaveLength(10);
  });

  it('edits, removes, resumes, and clears the queue optimistically', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'queue.add',
      queueId: 'queue-1',
      text: 'One.',
    });
    state = assistantWebviewReducer(state, {
      type: 'queue.add',
      queueId: 'queue-2',
      text: 'Two.',
    });

    state = assistantWebviewReducer(state, {
      type: 'queue.update',
      queueId: 'queue-2',
      text: 'Two, edited.',
    });
    expect(state.queue.items[1]).toMatchObject({ text: 'Two, edited.' });

    // The authoritative echo can mark the queue paused; removing the
    // last item clears the pause locally too.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'queue.state',
        sequence: 1,
        sessionId: 'session-a',
        items: state.queue.items,
        paused: 'stopped',
      },
    });
    expect(state.queue.paused).toBe('stopped');

    state = assistantWebviewReducer(state, {
      type: 'queue.remove',
      queueId: 'queue-1',
    });
    expect(state.queue).toMatchObject({ paused: 'stopped' });
    expect(state.queue.items).toHaveLength(1);
    state = assistantWebviewReducer(state, {
      type: 'queue.remove',
      queueId: 'queue-2',
    });
    expect(state.queue).toEqual({ items: [], paused: null });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'queue.state',
        sequence: 2,
        sessionId: 'session-a',
        items: [{ queueId: 'queue-3', text: 'Three.', attachments: [] }],
        paused: 'turn-failed',
      },
    });
    state = assistantWebviewReducer(state, { type: 'queue.resume' });
    expect(state.queue.paused).toBeNull();

    state = assistantWebviewReducer(state, { type: 'queue.clear' });
    expect(state.queue).toEqual({ items: [], paused: null });
  });

  it('promotes a queued prompt to the head and clears the pause', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    for (const [queueId, text] of [
      ['queue-1', 'One.'],
      ['queue-2', 'Two.'],
      ['queue-3', 'Three.'],
    ] as const) {
      state = assistantWebviewReducer(state, {
        type: 'queue.add',
        queueId,
        text,
      });
    }
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'queue.state',
        sequence: 1,
        sessionId: 'session-a',
        items: state.queue.items,
        paused: 'stopped',
      },
    });

    state = assistantWebviewReducer(state, {
      type: 'queue.promote',
      queueId: 'queue-3',
    });
    expect(state.queue.items.map(({ queueId }) => queueId)).toEqual([
      'queue-3',
      'queue-1',
      'queue-2',
    ]);
    expect(state.queue.paused).toBeNull();

    // Unknown ids are ignored (already dispatched).
    const unchanged = assistantWebviewReducer(state, {
      type: 'queue.promote',
      queueId: 'ghost',
    });
    expect(unchanged).toBe(state);
  });

  it('tracks the queued prompt being edited in the Composer', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'queue.add',
      queueId: 'queue-1',
      text: 'One.',
    });
    state = assistantWebviewReducer(state, {
      type: 'queue.add',
      queueId: 'queue-2',
      text: 'Two.',
    });

    // Begin requires a live prompt; unknown ids do nothing.
    const ghost = assistantWebviewReducer(state, {
      type: 'queue.editBegin',
      queueId: 'ghost',
    });
    expect(ghost.queueEditing).toBeNull();

    state = assistantWebviewReducer(state, {
      type: 'queue.editBegin',
      queueId: 'queue-2',
    });
    expect(state.queueEditing).toEqual({ queueId: 'queue-2', seq: 1 });

    // Re-editing bumps the sequence so the Composer re-prefills.
    state = assistantWebviewReducer(state, { type: 'queue.editEnd' });
    expect(state.queueEditing).toBeNull();
    state = assistantWebviewReducer(state, {
      type: 'queue.editBegin',
      queueId: 'queue-2',
    });
    expect(state.queueEditing).toEqual({ queueId: 'queue-2', seq: 1 });

    // Removing the edited prompt ends the edit; removing another
    // prompt keeps it.
    let branch = assistantWebviewReducer(state, {
      type: 'queue.remove',
      queueId: 'queue-1',
    });
    expect(branch.queueEditing).toEqual({ queueId: 'queue-2', seq: 1 });
    branch = assistantWebviewReducer(branch, {
      type: 'queue.remove',
      queueId: 'queue-2',
    });
    expect(branch.queueEditing).toBeNull();

    // The authoritative echo dropping the prompt (dispatched) ends
    // the edit too.
    branch = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'queue.state',
        sequence: 5,
        sessionId: 'session-a',
        items: [{ queueId: 'queue-1', text: 'One.', attachments: [] }],
        paused: null,
      },
    });
    expect(branch.queueEditing).toBeNull();

    // Clearing the queue ends the edit.
    branch = assistantWebviewReducer(state, { type: 'queue.clear' });
    expect(branch.queueEditing).toBeNull();
  });

  it('reconciles queue state from the host and scopes it per session', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    state = assistantWebviewReducer(state, {
      type: 'queue.add',
      queueId: 'queue-optimistic',
      text: 'Optimistic.',
    });

    // The authoritative echo replaces the optimistic view entirely.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'queue.state',
        sequence: 1,
        sessionId: 'session-a',
        items: [
          { queueId: 'queue-real', text: 'Real.', attachments: [] },
        ],
        paused: null,
      },
    });
    expect(state.queue.items.map(({ queueId }) => queueId)).toEqual([
      'queue-real',
    ]);

    // Echoes for another session only advance the sequence.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'queue.state',
        sequence: 2,
        sessionId: 'session-b',
        items: [],
        paused: null,
      },
    });
    expect(state.queue.items).toHaveLength(1);

    // A snapshot carrying a queue field is authoritative...
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        ...snapshot(3),
        queue: {
          items: [
            { queueId: 'queue-snap', text: 'Snap.', attachments: [] },
          ],
          paused: 'dispatch-blocked',
        },
      },
    });
    expect(state.queue).toMatchObject({
      items: [{ queueId: 'queue-snap' }],
      paused: 'dispatch-blocked',
    });

    // ...and an absent field means empty, not "keep the previous".
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(4),
    });
    expect(state.queue).toEqual({ items: [], paused: null });
  });
});
