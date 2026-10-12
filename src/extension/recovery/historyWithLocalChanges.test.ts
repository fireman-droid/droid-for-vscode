import { describe, expect, it } from 'vitest';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { summarizeOperations } from '../../webview-v2/chat/operationSummary';
import {
  createRootConversation, writeConversationDisplay, type ConversationTurnRecord,
} from './conversationRecoveryState';
import { historyWithLocalChanges } from './historyWithLocalChanges';
import type { HostTranscriptState } from './hostTranscriptState';

const history = (transcript: readonly SessionTranscriptItem[]): HostTranscriptState => ({
  transcript, historyStatus: 'complete', truncated: false,
});
const user = (messageId: string): SessionTranscriptItem => ({
  kind: 'user', id: `user-${messageId}`, messageId, text: 'Update the files',
});
function edit(callId: string, path = 'TaskList.vue', sessionId = 'session-1'): ToolTranscriptItem {
  return {
    kind: 'tool', id: `row-${callId}`, turnId: `sdk-${callId}`, toolUseId: callId,
    toolName: 'Edit', action: 'Edit file', status: 'completed', progressCount: 0, latestUpdateKind: null,
    operationDiff: {
      status: 'ready', source: 'tool-result', sourceSessionId: sessionId, callId,
      files: [{ path, kind: 'modified', outcome: 'applied', patch: '@@ -1 +1 @@\n-old\n+new' }],
    },
  };
}
function record(items: readonly ToolTranscriptItem[], messageId = 'todo-stale-reminder'): ConversationTurnRecord {
  return {
    turnId: 'local-turn', sessionId: 'session-1', prompt: null, messageId,
    status: 'completed', changesSettled: true, firstRevision: 1, lastRevision: 2,
    files: [...new Set(items.flatMap(item => item.operationDiff?.status === 'ready'
      ? item.operationDiff.files.map(file => file.path) : []))]
      .map(path => ({ path, additions: 1, deletions: 1 })),
    toolOperations: items.map(item => ({
      toolUseId: item.toolUseId, toolName: item.toolName, operationDiff: item.operationDiff!,
    })),
  };
}
const conversation = (turns: readonly ConversationTurnRecord[]) => ({
  ...createRootConversation('session-1', history([]), 1), turns,
});

describe('history turn ownership', () => {
  it.each(['todo-stale-reminder', 'submitted-message'])('restores one task card from %s and retains every edit', anchor => {
    const paths = ['typing.ts', 'task-list-api.ts', 'TaskList.vue', 'TaskFormDrawer.vue'];
    const edits = Array.from({ length: 15 }, (_, index) => edit(`call-${index}`, paths[index % paths.length]));
    const saved = conversation([record(edits, anchor)]);
    const source = history([user('submitted-message'), ...edits, user('next-message'), edit('next-call')]);
    const restored = historyWithLocalChanges(source, saved);
    const summary = summarizeOperations(restored.transcript);
    expect([...summary.keys()]).toEqual(['local-turn', 'sdk-next-call']);
    expect(summary.get('local-turn')?.files.size).toBe(4);
    expect(summary.get('local-turn')?.calls.size).toBe(15);
    expect([...summary.get('local-turn')!.files.values()].flatMap(file => file.records)).toHaveLength(15);
    expect(restored.transcript.filter(item => item.kind === 'changes')).toEqual([
      expect.objectContaining({ turnId: 'local-turn', files: saved.turns[0]!.files }),
    ]);
    const checkpoint = writeConversationDisplay(saved, 'session-1', restored, 2)!;
    expect(checkpoint.turns.find(turn => turn.turnId === 'local-turn')).toMatchObject({
      messageId: 'submitted-message', changesSettled: true,
    });
    expect(historyWithLocalChanges(source, checkpoint)).toEqual(restored);
  });

  it('does not match identical call ids from another session', () => {
    const source = history([user('submitted-message'), edit('shared-call', 'TaskList.vue', 'session-2')]);
    expect(historyWithLocalChanges(source, conversation([record([edit('shared-call')])]))).toEqual(source);
  });

  it('does not merge two user messages into one saved task', () => {
    const first = edit('first');
    const second = edit('second');
    const source = history([user('first-message'), first, user('second-message'), second]);
    expect(historyWithLocalChanges(source, conversation([record([first, second])]))).toEqual(source);
  });

  it('leaves ambiguous saved call ownership unchanged', () => {
    const item = edit('shared-call');
    const turn = record([item]);
    const source = history([user('submitted-message'), item]);
    expect(historyWithLocalChanges(source, conversation([
      turn, { ...turn, turnId: 'other-turn', messageId: 'other-reminder' },
    ]))).toEqual(source);
  });
});
