import { expect, it, vi } from 'vitest';
import { projectSessionMessages } from './projectSessionHistory';
import { scopedSessionHistory } from './scopedSessionHistory';

it('never includes another invocation before the first prompt or after the next prompt', async () => {
  const messages = ['foreign', 'start', 'answer'].map(id =>
    ({ id, role: 'user', createdAt: 1, content: [{ type: 'text', text: id }] }));
  const projected = projectSessionMessages(messages, { sourceSessionId: 'child' });
  if (projected.status !== 'available') throw new Error('fixture');
  const loader = { loadHistory: vi.fn(async () => ({ ...projected, page: { messages, nextCursor: 'foreign' } })) };
  const scoped = scopedSessionHistory(loader, 'start', 'next-invocation');
  const result = await scoped.loadHistory({ cwd: '/workspace', sessionId: 'child' });
  expect(loader.loadHistory).toHaveBeenCalledWith({ cwd: '/workspace', sessionId: 'child', cursor: 'next-invocation' });
  expect(result).toMatchObject({ status: 'available', page: { nextCursor: null },
    state: { transcript: [{ text: 'start' }, { text: 'answer' }] } });
  const changed = scopedSessionHistory(loader, 'missing-start', 'next-invocation', new Set(['answer']));
  await expect(changed.loadHistory({ cwd: '/workspace', sessionId: 'child' })).resolves.toMatchObject({
    state: { transcript: [{ text: 'answer' }] },
  });
});
