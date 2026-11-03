import { describe, expect, it, vi } from 'vitest';
import { SessionHistoryWindow } from './SessionHistoryWindow';
import { projectSessionMessages } from './projectSessionHistory';
import { collectSessionHistory } from './collectSessionHistory';
import type { SessionHistoryLoader, SessionHistoryRequest } from './SessionHistory';

const message = (id: number, content: unknown[] = [{ type: 'text', text: `message ${id}` }], role = 'user') =>
  ({ id: `m${id}`, createdAt: id + 1, role, content });
function loader(messages: ReturnType<typeof message>[]) {
  const loadHistory = vi.fn(async ({ cursor, limit = 100, sessionId }: SessionHistoryRequest) => {
    const end = cursor === undefined ? messages.length : messages.findIndex(item => item.id === cursor);
    const page = messages.slice(Math.max(0, end - limit), end);
    const projected = projectSessionMessages(page, { sourceSessionId: sessionId });
    if (projected.status !== 'available') throw new Error('Invalid test fixture');
    return { ...projected, page: { messages: page, nextCursor: end > limit ? page[0]!.id : null } };
  });
  return { loadHistory } satisfies SessionHistoryLoader;
}
describe('paged history windows', () => {
  it('opens only one page and keeps ids stable while prepending and revisiting evicted pages', async () => {
    const history = loader(Array.from({ length: 1000 }, (_, i) => message(i)));
    const window = new SessionHistoryWindow(history, '/workspace', ['session']);
    const latest = await window.open();
    expect(history.loadHistory).toHaveBeenCalledTimes(1);
    expect(latest.state.transcript).toHaveLength(100);
    const anchor = latest.state.transcript[0]!;
    await window.navigate('older');
    expect(window.snapshot()!.items.find(item => item.id === anchor.id)).toEqual(anchor);
    for (let i = 0; i < 8; i++) await window.navigate('older');
    expect(window.snapshot()).toMatchObject({ hasOlder: false, hasNewer: true });
    expect(window.snapshot()!.items.length).toBeLessThanOrEqual(300);
    const calls = history.loadHistory.mock.calls.length;
    for (let i = 0; i < 7; i++) await window.navigate('newer');
    expect(history.loadHistory.mock.calls.length).toBeGreaterThan(calls);
    expect(window.snapshot()).toMatchObject({ hasNewer: false });
    expect(window.snapshot()!.items.at(-1)).toMatchObject({ text: 'message 999' });
  });

  it('joins tool results even after their newer page was evicted', async () => {
    const messages = Array.from({ length: 900 }, (_, i) => message(i));
    messages[2] = message(2, [{ type: 'tool_use', id: 'call', name: 'Read', input: { file_path: '/workspace/test.ts' } }], 'assistant');
    messages[899] = message(899, [{ type: 'tool_result', toolUseId: 'call', content: 'file body' }], 'tool');
    const window = new SessionHistoryWindow(loader(messages), '/workspace', ['session']);
    await window.open();
    while (window.snapshot()!.hasOlder) await window.navigate('older');
    expect(window.snapshot()!.items.find(item => item.kind === 'tool')).toMatchObject({
      toolUseId: 'call', status: 'completed',
    });
  });

  it('allows an explicit export beyond 2000 items without duplicates', async () => {
    const history = loader(Array.from({ length: 2301 }, (_, i) => message(i)));
    const result = await collectSessionHistory(history, { cwd: '/workspace', sessionId: 'session' });
    expect(result.status).toBe('available');
    if (result.status !== 'available') return;
    expect(result.state.transcript.map(item => item.kind === 'user' ? item.text : '')).toEqual(
      Array.from({ length: 2301 }, (_, i) => `message ${i}`));
    expect(result.state.truncated).toBe(false);
  });

  it('moves to a compacted predecessor only after the current session is exhausted', async () => {
    const current = loader([message(2)]), previous = loader([message(1)]);
    const window = new SessionHistoryWindow({
      loadHistory: request => (request.sessionId === 'current' ? current : previous).loadHistory(request),
    }, '/workspace', ['current', 'previous']);
    await window.open();
    expect(previous.loadHistory).not.toHaveBeenCalled();
    expect(window.snapshot()!.hasOlder).toBe(true);
    await window.navigate('older');
    expect(window.snapshot()!.items.map(item => item.kind === 'user' ? item.text : '')).toEqual(['message 1', 'message 2']);
    expect(window.snapshot()!.hasOlder).toBe(false);
  });

  it('retains the readable window on failure and retries the same page', async () => {
    const history = loader(Array.from({ length: 250 }, (_, i) => message(i)));
    const window = new SessionHistoryWindow(history, '/workspace', ['session']);
    await window.open();
    const before = window.snapshot();
    history.loadHistory.mockRejectedValueOnce(new Error('offline'));
    await expect(window.navigate('older')).rejects.toThrow('offline');
    expect(window.snapshot()).toBe(before);
    await window.navigate('older');
    expect(window.snapshot()!.items.length).toBe(200);
  });
});
