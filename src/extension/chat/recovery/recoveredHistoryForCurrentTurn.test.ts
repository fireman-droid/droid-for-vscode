import { describe, expect, it } from 'vitest';
import { projectSessionMessages } from '../../../runtime/history/projectSessionHistory';
import { sessionMessageTurnId } from '../../../shared/transcript/sessionMessageIdentity';
import { TurnState } from '../turns/TurnState';
import { createTurnActivityState } from '../turns/turnActivityState';
import { recoveredHistoryForCurrentTurn } from './recoveredHistoryForCurrentTurn';

const text = (value: string) => ({ type: 'text', text: value });
const message = (id: string, role: string, parentId: string | null, content: unknown[], hidden = false) => ({
  id, role, parentId, content, createdAt: 1, updatedAt: 1, ...(hidden ? { visibility: 'llm_only' } : {}),
});

describe('automatic parent turn history identity', () => {
  it('maps unseen gap messages and tools through hidden persisted user ancestry without capturing the next turn', () => {
    const loaded = projectSessionMessages([
      message('request', 'user', null, [text('Delegate research')]),
      message('launch', 'assistant', 'request', [text('Research launched')]),
      message('context-task-completion:1', 'user', 'launch', [], true),
      // The real daemon persists this live-system notification as a hidden user.
      message('task-completion:1', 'user', 'context-task-completion:1', [text('Hidden child result')], true),
      message('observed-answer', 'assistant', 'task-completion:1', [text('Before disconnect')]),
      message('unseen-tools', 'assistant', 'observed-answer', [
        { type: 'tool_use', id: 'read-gap', name: 'Read', input: { file_path: 'src/events.ts' } },
        { type: 'tool_use', id: 'edit-gap', name: 'Edit', input: { file_path: 'src/events.ts', old_str: 'open = 1', new_str: 'open = 2' } },
      ]),
      message('read-result', 'tool', 'unseen-tools', [{ type: 'tool_result', tool_use_id: 'read-gap', content: 'export const open = 1' }]),
      message('unseen-answer', 'assistant', 'read-result', [text('Recovered final answer')]),
      message('next-request', 'user', 'unseen-answer', [text('Different request')]),
      message('next-answer', 'assistant', 'next-request', [text('Next user answer')]),
      message('task-completion:2', 'user', 'next-answer', [text('Another hidden result')], true),
      message('another-auto-answer', 'assistant', 'task-completion:2', [text('Another automatic answer')]),
    ], { sourceSessionId: 'parent', workspaceRoot: 'C:/workspace' });
    expect(loaded.status).toBe('available');
    if (loaded.status !== 'available') return;
    const turnState = new TurnState();
    turnState.turn = { turnId: 'original-ui-turn', status: 'streaming', activity: createTurnActivityState(), recovery: true,
      transportRecovery: { messageId: 'task-completion:1', dispose() {} } };
    const recovered = recoveredHistoryForCurrentTurn({ turnState }, loaded.state, loaded.messageAncestry);
    const owned = recovered.transcript.filter(item => item.kind !== 'user' && item.turnId === 'original-ui-turn');
    expect(owned).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'assistant', text: 'Before disconnect' }),
      expect.objectContaining({ kind: 'tool', toolName: 'Read' }),
      expect.objectContaining({ kind: 'tool', toolName: 'Edit', filePath: 'src/events.ts' }),
      expect.objectContaining({ kind: 'changes', files: [expect.objectContaining({ path: 'src/events.ts' })] }),
      expect.objectContaining({ kind: 'assistant', text: 'Recovered final answer' }),
    ]));
    expect(owned).toHaveLength(5);
    expect(recovered.transcript.find(item => item.kind === 'assistant' && item.text === 'Next user answer')).toMatchObject({ turnId: sessionMessageTurnId('parent', 'next-answer') });
    expect(recovered.transcript.find(item => item.kind === 'assistant' && item.text === 'Another automatic answer')).toMatchObject({ turnId: sessionMessageTurnId('parent', 'another-auto-answer') });
    expect(JSON.stringify(recovered)).not.toContain('Hidden child result');
    expect(JSON.stringify(loaded.messageAncestry)).not.toContain('Hidden child result');
  });

  it('does not assign orphaned or cyclic history to an automatic turn', () => {
    const turnState = new TurnState();
    turnState.turn = { turnId: 'live', status: 'streaming', activity: createTurnActivityState(),
      transportRecovery: { messageId: 'automatic', dispose() {} } };
    const loaded = projectSessionMessages([
      message('automatic', 'user', null, [text('Hidden')], true),
      message('orphan', 'assistant', 'missing-parent', [text('Unrelated')]),
      message('cycle-a', 'assistant', 'cycle-b', [text('Cycle A')]),
      message('cycle-b', 'assistant', 'cycle-a', [text('Cycle B')]),
    ], { sourceSessionId: 'parent' });
    if (loaded.status !== 'available') throw new Error('Expected available fixture');
    const recovered = recoveredHistoryForCurrentTurn({ turnState }, loaded.state, loaded.messageAncestry);
    expect(recovered.transcript.some(item => item.kind !== 'user' && item.turnId === 'live')).toBe(false);
  });
});
