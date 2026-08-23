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

describe('assistantWebviewReducer Git flow', () => {
  it('tracks the git commit flow through status, commit, and result', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    expect(state.git.availability).toBe('unknown');

    state = assistantWebviewReducer(state, {
      type: 'git.statusRequested',
      turnId: 'turn-a',
    });
    expect(state.git.statusPending).toBe(true);

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'git.status',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        branch: 'main',
        files: [
          {
            path: 'src/app.ts',
            status: 'modified',
            staged: false,
            inTurn: true,
          },
        ],
      },
    });
    expect(state.git).toMatchObject({
      availability: 'available',
      unavailableReason: null,
      statusPending: false,
      branch: 'main',
      files: [{ path: 'src/app.ts', inTurn: true }],
    });

    state = assistantWebviewReducer(state, {
      type: 'git.commitRequested',
      turnId: 'turn-a',
    });
    expect(state.git).toMatchObject({
      commitPending: true,
      commitTurnId: 'turn-a',
      lastResult: null,
    });

    // A result for another session only advances the sequence.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'git.commitResult',
        sequence: 2,
        sessionId: 'session-b',
        turnId: 'turn-a',
        ok: true,
        hash: 'deadbee',
        subject: 'other',
      },
    });
    expect(state.git.commitPending).toBe(true);

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'git.commitResult',
        sequence: 3,
        sessionId: 'session-a',
        turnId: 'turn-a',
        ok: true,
        hash: 'abc1234',
        subject: 'feat: add app',
      },
    });
    expect(state.git).toMatchObject({
      commitPending: false,
      lastResult: { ok: true, hash: 'abc1234', subject: 'feat: add app' },
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'git.status',
        sequence: 4,
        sessionId: 'session-a',
        turnId: 'turn-a',
        branch: 'main',
        files: [],
        committedHash: 'abc1234',
      },
    });
    expect(state.git.committedHash).toBe('abc1234');

    // Failure results carry git's own error text.
    state = assistantWebviewReducer(state, {
      type: 'git.commitRequested',
      turnId: 'turn-a',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'git.commitResult',
        sequence: 5,
        sessionId: 'session-a',
        turnId: 'turn-a',
        ok: false,
        error: 'hook declined',
      },
    });
    expect(state.git.lastResult).toEqual({
      ok: false,
      error: 'hook declined',
    });

    // An unavailable status closes the flow with its reason.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'git.status',
        sequence: 6,
        sessionId: 'session-a',
        turnId: 'turn-a',
        branch: null,
        files: [],
        unavailableReason: 'no-repository',
      },
    });
    expect(state.git).toMatchObject({
      availability: 'unavailable',
      unavailableReason: 'no-repository',
      branch: null,
      files: [],
    });

    // A snapshot for a different session resets the flow.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(7, 'session-b'),
    });
    expect(state.git.availability).toBe('unknown');
  });

  it('drops a git status response for an older Changes turn', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(1, 'session-a'),
    });
    state = assistantWebviewReducer(state, {
      type: 'git.statusRequested',
      turnId: 'turn-current',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'git.status',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-stale',
        branch: 'stale',
        files: [],
      },
    });

    expect(state.sequence).toBe(2);
    expect(state.git).toMatchObject({
      statusTurnId: 'turn-current',
      statusPending: true,
      branch: null,
      files: [],
    });
  });

  it('drops a commit result for an older Changes turn', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(1, 'session-a'),
    });
    state = assistantWebviewReducer(state, {
      type: 'git.commitRequested',
      turnId: 'turn-current',
    });
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'git.commitResult',
        sequence: 2,
        sessionId: 'session-a',
        turnId: 'turn-stale',
        ok: true,
        hash: 'deadbee',
        subject: 'stale',
      },
    });

    expect(state.sequence).toBe(2);
    expect(state.git).toMatchObject({
      commitTurnId: 'turn-current',
      commitPending: true,
      lastResult: null,
    });
  });

  it('keeps a branch diff for the active session and drops it on switch', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: snapshot(),
    });
    expect(state.branchDiff).toBeNull();

    // Another session's report only advances the sequence.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'git.branchDiff',
        sequence: 1,
        sessionId: 'session-b',
        branch: 'other',
        baseBranch: 'main',
        files: [],
        additions: 0,
        deletions: 0,
        commitCount: 0,
      },
    });
    expect(state.branchDiff).toBeNull();
    expect(state.sequence).toBe(1);

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'git.branchDiff',
        sequence: 2,
        sessionId: 'session-a',
        branch: 'feature/dock',
        baseBranch: 'main',
        files: [{ path: 'src/app.tsx', additions: 4, deletions: 2 }],
        additions: 4,
        deletions: 2,
        commitCount: 3,
      },
    });
    expect(state.branchDiff).toEqual({
      branch: 'feature/dock',
      baseBranch: 'main',
      files: [{ path: 'src/app.tsx', additions: 4, deletions: 2 }],
      additions: 4,
      deletions: 2,
      commitCount: 3,
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: snapshot(3, 'session-b'),
    });
    expect(state.branchDiff).toBeNull();
  });
});
