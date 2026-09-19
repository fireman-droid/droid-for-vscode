import { describe, expect, it } from 'vitest';

import type { HostSnapshotMessage } from '../../../shared/bridgeMessages';
import { assistantWebviewReducer } from './store';
import { initialAssistantWebviewState } from './initialState';

/**
 * Live changes-ledger slices of the webview reducer, kept in their
 * own file next to store.test.ts (the ledger ships as its own
 * vertical slice; see decard-design-proposal.md §4).
 */

function snapshot(sequence = 0, sessionId = 'session-a'): HostSnapshotMessage {
  return {
    type: 'host.snapshot',
    sequence,
    conversationId: sessionId,
    sessionId,
    connection: { status: 'connected' },
    turn: null,
    sessions: { status: 'ready', items: [] },
    settings: { status: 'loading', value: null },
    context: { status: 'loading', value: null },
    modelCatalog: { status: 'loading', items: [] },
    transcript: [],
    historyStatus: 'complete',
    truncated: false,
  };
}

describe('assistantWebviewReducer changes ledger', () => {
  it('streams the live changes ledger and settles it in place', () => {
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
        additionalFileCount: 2,
      },
    });
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'tool',
      filePath: 'src/app.ts',
      additionalFileCount: 2,
    });

    // First writing frame while the turn is live: the ledger appears
    // at its first-appearance position, marked writing.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'changes.update',
        sequence: 3,
        sessionId: 'session-a',
        turnId: 'turn-a',
        state: 'writing',
        files: [{ path: 'src/app.ts', additions: null, deletions: null }],
      },
    });
    expect(state.transcript.at(-1)).toMatchObject({
      kind: 'changes',
      turnId: 'turn-a',
      writing: true,
      files: [{ path: 'src/app.ts', additions: null, deletions: null }],
    });
    const ledgerId = state.transcript.at(-1)!.id;

    // A later writing frame refreshes files in place: same item, same
    // id, no duplicate.
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'changes.update',
        sequence: 4,
        sessionId: 'session-a',
        turnId: 'turn-a',
        state: 'writing',
        files: [
          { path: 'src/app.ts', additions: 2, deletions: 0 },
          { path: 'docs/new.md', additions: null, deletions: null },
        ],
      },
    });
    expect(state.transcript.filter((item) => item.kind === 'changes')).toHaveLength(1);
    expect(state.transcript.at(-1)).toMatchObject({
      id: ledgerId,
      writing: true,
      files: [
        { path: 'src/app.ts', additions: 2, deletions: 0 },
        { path: 'docs/new.md', additions: null, deletions: null },
      ],
    });

    // The terminal turn state settles the header even before (or
    // without) a settled frame — failed turns never get one.
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
    expect(state.transcript.at(-1)).not.toHaveProperty('writing');

    // The settled reconciliation lands after the terminal state and
    // replaces the ledger in place with final counts.
    const settled = {
      type: 'changes.update' as const,
      sequence: 6,
      sessionId: 'session-a',
      turnId: 'turn-a',
      state: 'settled' as const,
      files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
    };
    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: settled,
    });
    expect(state.transcript.filter((item) => item.kind === 'changes')).toHaveLength(1);
    expect(state.transcript.at(-1)).toMatchObject({
      id: ledgerId,
      kind: 'changes',
      files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
    });
    expect(state.transcript.at(-1)).not.toHaveProperty('writing');

    // A stale writing frame after the terminal state is discarded.
    const stale = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'changes.update',
        sequence: 7,
        sessionId: 'session-a',
        turnId: 'turn-a',
        state: 'writing',
        files: [{ path: 'late.ts', additions: 1, deletions: 0 }],
      },
    });
    expect(stale.transcript.at(-1)).toMatchObject({
      files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
    });

    // Other sessions only advance the sequence.
    const other = assistantWebviewReducer(stale, {
      type: 'host.message',
      message: {
        ...settled,
        sequence: 8,
        sessionId: 'session-b',
        turnId: 'turn-b',
      },
    });
    expect(other.transcript.filter((item) => item.kind === 'changes')).toHaveLength(1);
    expect(other.sequence).toBe(8);
  });

  it('restores live state from a host snapshot and clears reverted changes', () => {
    let state = assistantWebviewReducer(initialAssistantWebviewState, {
      type: 'host.message',
      message: {
        ...snapshot(),
        turn: { turnId: 'turn-a', status: 'streaming' },
        transcript: [
          {
            id: 'changes:turn-a',
            kind: 'changes',
            turnId: 'turn-a',
            files: [{ path: 'src/app.ts', additions: 1, deletions: 0 }],
          },
        ],
      },
    });
    expect(state.transcript[0]).toMatchObject({
      kind: 'changes',
      writing: true,
    });

    state = assistantWebviewReducer(state, {
      type: 'host.message',
      message: {
        type: 'changes.update',
        sequence: 1,
        sessionId: 'session-a',
        turnId: 'turn-a',
        state: 'settled',
        files: [],
      },
    });
    expect(state.transcript).toEqual([]);
  });
});
