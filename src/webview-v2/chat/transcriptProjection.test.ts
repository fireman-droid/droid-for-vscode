import { expect, it } from 'vitest';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { createTranscriptSelector } from '../../webview/assistant/transcript/transcriptGroups';
import { createTranscriptMessagesSelector, createTranscriptStructureSelector } from './transcriptProjection';

const user = (id: string, text = id) => ({ kind: 'user' as const, id, text });
const assistant = (turnId: string, text: string) => ({ kind: 'assistant' as const, id: `${turnId}-reply`, turnId, text });
const tool: ToolTranscriptItem = { kind: 'tool', id: 'trailing-tool', turnId: 'tool-only', toolUseId: 'call', toolName: 'Read',
  action: 'Read', status: 'completed', progressCount: 0, latestUpdateKind: null };

it('keeps reply copying and question navigation current through streaming, rewinds and restored tool-only tails', () => {
  const select = createTranscriptSelector();
  const structure = createTranscriptStructureSelector();
  const messages = createTranscriptMessagesSelector();
  const start = [user('question-1'), assistant('turn-1', 'First answer'), tool, user('question-2'), assistant('turn-2', 'Partial')];
  let projection = select(start);
  expect([...projection.replyTails]).toEqual([['assistant-turn:tool-only', 'First answer'], ['assistant-turn:turn-2', 'Partial']]);
  expect(structure(projection.descriptors).turns.map((turn) => turn.messageIds)).toEqual([
    ['question-1', 'assistant-turn:turn-1', 'assistant-turn:tool-only'], ['question-2', 'assistant-turn:turn-2'],
  ]);
  const pending = new Set(['assistant-turn:turn-2']);
  expect(messages(projection.descriptors, projection.replyTails, pending).at(-1)?.replyEnd).toBe(false);
  projection = select([...start.slice(0, -1), assistant('turn-2', 'Complete answer')]);
  expect(projection.replyTails.get('assistant-turn:turn-2')).toBe('Complete answer');
  expect(messages(projection.descriptors, projection.replyTails, new Set()).at(-1)?.replyEnd).toBe(true);
  projection = select(start.slice(0, 3));
  expect([...projection.replyTails]).toEqual([['assistant-turn:tool-only', 'First answer']]);
  expect(structure(projection.descriptors).ids).toEqual(['question-1', 'assistant-turn:turn-1', 'assistant-turn:tool-only']);
  projection = select([user('question-1', 'Revised prompt'), assistant('replacement', 'Revised answer')]);
  expect([...projection.replyTails]).toEqual([['assistant-turn:replacement', 'Revised answer']]);
  expect(messages(projection.descriptors, projection.replyTails, new Set())[0]?.text).toBe('Revised prompt');
});

it('refreshes image ownership and excludes workspace snapshots without mutating an earlier projection', () => {
  const select = createTranscriptSelector();
  const prompt = user('question');
  const first = select([prompt]);
  const image: SessionTranscriptItem = { kind: 'image', id: 'image', turnId: 'turn', origin: 'user', mediaType: 'image/png', data: 'a', generated: false, byteLength: 1 };
  const second = select([image, prompt, assistant('turn', 'With image'), { kind: 'changes', id: 'manual', turnId: 'turn', files: [{ path: 'manual.ts', additions: 1, deletions: 0 }] }]);
  expect(first.descriptors[0]).toMatchObject({ kind: 'user', images: [] });
  expect(second.descriptors[0]).toMatchObject({ kind: 'user', images: [image] });
  expect(second.descriptors).toHaveLength(2);
  const removed = select([prompt, assistant('turn', 'Without image')]);
  expect(removed.descriptors[0]).toMatchObject({ kind: 'user', images: [] });
  expect(removed.replyTails.get('assistant-turn:turn')).toBe('Without image');
  expect(second.replyTails.get('assistant-turn:turn')).toBe('With image');
});

it('invalidates a cached earlier segment when restored replies contain several assistant groups', () => {
  const select = createTranscriptSelector();
  const first = assistant('first', 'Before');
  const second = assistant('second', 'Tail');
  expect(select([user('question'), first, second]).replyTails.get('assistant-turn:second')).toBe('Before\n\nTail');
  expect(select([user('question'), { ...first, text: 'Corrected' }, second]).replyTails.get('assistant-turn:second')).toBe('Corrected\n\nTail');
  expect(select([user('question'), second]).replyTails.get('assistant-turn:second')).toBe('Tail');
  expect(select([]).descriptors).toEqual([]);
});

it('keeps the latest copy and regenerate target in restored reply order', () => {
  const select = createTranscriptSelector();
  const first = [user('first-question'), assistant('first', 'First answer')];
  const second = [user('second-question'), assistant('second', 'Second answer')];
  expect([...select([...first, ...second]).replyTails.keys()].at(-1)).toBe('assistant-turn:second');
  expect([...select([...second, ...first]).replyTails.keys()].at(-1)).toBe('assistant-turn:first');
});
