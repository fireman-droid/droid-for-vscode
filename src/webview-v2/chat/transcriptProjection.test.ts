import { expect, it } from 'vitest';
import type { SessionTranscriptItem } from '../../shared/protocol/transcript';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { createTranscriptSelector, describeTranscript } from './transcript/transcriptGroups';
import { createTranscriptMessagesSelector, createTranscriptStructureSelector } from './transcriptProjection';

const user = (id: string, text = id) => ({ kind: 'user' as const, id, text });
const assistant = (turnId: string, text: string) => ({ kind: 'assistant' as const, id: `${turnId}-reply`, turnId, text });
const tool: ToolTranscriptItem = { kind: 'tool', id: 'trailing-tool', turnId: 'tool-only', toolUseId: 'call', toolName: 'Read',
  action: 'Read', status: 'completed', progressCount: 0, latestUpdateKind: null };

it('keeps repeated steering replies after their own prompts while retaining the runtime turn identity', () => {
  const select = createTranscriptSelector();
  const before = { ...assistant('active-turn', 'Before guidance'), timestamp: 1_790_000_000_000 };
  const oldTool = { ...tool, turnId: 'active-turn' };
  const start = [user('original'), before, oldTool];
  const original = select(start);
  const after = { ...assistant('active-turn', 'After guidance'), id: 'guided-reply', timestamp: before.timestamp + 1_000 };
  const thinking: SessionTranscriptItem = { kind: 'thinking', id: 'guided-thinking', turnId: 'active-turn',
    text: 'Considering guidance', status: 'complete', truncated: false };
  const guided = [...start, user('guidance'), thinking, after];
  const first = select(guided);
  const second = select([...guided, user('more-guidance'),
    { ...after, id: 'second-guided-reply', text: 'After more guidance', timestamp: before.timestamp + 2_000 }]);
  expect(second.descriptors.map(item => item.kind === 'user' ? item.item.text
    : item.items.filter(row => row.kind === 'assistant').map(row => row.text).join(''))).toEqual([
    'original', 'Before guidance', 'guidance', 'After guidance', 'more-guidance', 'After more guidance',
  ]);
  const replies = second.descriptors.filter(item => item.kind === 'assistant');
  expect(replies.map(item => item.turnId)).toEqual(['active-turn', 'active-turn', 'active-turn']);
  expect(new Set(replies.map(item => item.id)).size).toBe(3);
  expect([...original.replyTails.values()]).toEqual(['Before guidance']);
  expect([...first.replyTails.values()]).toEqual(['Before guidance', 'After guidance']);
  expect([...second.replyTails.values()]).toEqual(['Before guidance', 'After guidance', 'After more guidance']);
  expect([...second.replyTimestamps.values()]).toEqual([before.timestamp, before.timestamp + 1_000, before.timestamp + 2_000]);
  const structure = createTranscriptStructureSelector()(second.descriptors);
  expect(structure.turns.map(row => row.messageIds)).toEqual([
    ['original', replies[0]!.id], ['guidance', replies[1]!.id], ['more-guidance', replies[2]!.id],
  ]);
  const restored = describeTranscript(JSON.parse(JSON.stringify(guided)));
  expect(restored.descriptors).toEqual(first.descriptors);
  // A late result for an earlier tool updates its own reply, not the guided reply.
  const late = select([{ ...start[0]! }, before, { ...oldTool, durationMs: 500 }, ...guided.slice(start.length)]);
  expect(late.descriptors[1]).toMatchObject({ items: [before, { ...oldTool, durationMs: 500 }] });
  expect([...late.replyTails.values()]).toEqual(['Before guidance', 'After guidance']);
});

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

it('keeps recorded reply times after history is restored into a fresh transcript selector', () => {
  const timestamp = Date.parse('2026-09-26T10:01:02.000Z');
  const items: SessionTranscriptItem[] = [user('question'), { ...assistant('turn', 'Recorded reply'), timestamp }];
  const select = createTranscriptSelector();
  expect(select(items).replyTimestamps.get('assistant-turn:turn')).toBe(timestamp);
  const restored: SessionTranscriptItem[] = JSON.parse(JSON.stringify(items));
  expect(createTranscriptSelector()(restored).replyTimestamps.get('assistant-turn:turn')).toBe(timestamp);
  expect(describeTranscript(restored).replyTimestamps.get('assistant-turn:turn')).toBe(timestamp);
  // A later authoritative snapshot can correct metadata without changing the reply text.
  expect(select([items[0]!, { ...assistant('turn', 'Recorded reply'), timestamp: timestamp + 5_000 }])
    .replyTimestamps.get('assistant-turn:turn')).toBe(timestamp + 5_000);
});

it('places the latest assistant message time on a trailing tool-only reply group', () => {
  const timestamp = Date.parse('2026-09-26T10:01:02.000Z');
  const projection = describeTranscript([
    user('question'), { ...assistant('first', 'Before tools'), timestamp },
    { ...assistant('last', 'First text'), timestamp: timestamp + 10_000 },
    { ...assistant('last', 'Latest text'), id: 'latest-text', timestamp: timestamp + 20_000 }, tool,
  ]);
  expect([...projection.replyTimestamps]).toEqual([['assistant-turn:tool-only', timestamp + 20_000]]);
  expect(projection.replyTails.get('assistant-turn:tool-only')).toBe('Before tools\n\nFirst text\n\nLatest text');
});

it('does not substitute an earlier message time when the final assistant message has no recorded time', () => {
  const projection = describeTranscript([
    user('question'), { ...assistant('first', 'Has time'), timestamp: 1_790_000_000_000 },
    assistant('last', 'Old reply with unknown time'), tool,
    user('tool-only-question'), { ...tool, id: 'only-tool', turnId: 'without-answer' },
  ]);
  expect([...projection.replyTimestamps]).toEqual([
    ['assistant-turn:tool-only', undefined], ['assistant-turn:without-answer', undefined],
  ]);
});
