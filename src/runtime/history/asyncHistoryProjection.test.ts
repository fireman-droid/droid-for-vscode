import { setImmediate } from 'node:timers/promises';
import { describe, expect, it } from 'vitest';
import { projectSessionHistoryAsync, projectSessionMessagesAsync } from './asyncHistoryProjection';
import { projectSessionMessages } from './projectSessionHistory';

describe('responsive saved-history projection', () => {
  it('allows pending host work to run before a long projection completes, without changing its result', async () => {
    const messages = Array.from({ length: 6_420 }, (_, index) => ({
      id: `message-${index}`, parentId: index === 0 ? null : `message-${index - 1}`,
      createdAt: index, role: index % 2 ? 'assistant' : 'user',
      content: [{ type: 'text', text: `entry-${index}\n${'saved message content\n'.repeat(400)}` }],
    }));
    const options = { sourceSessionId: 'saved', workspaceRoot: 'C:/synthetic' };
    const expected = projectSessionMessages(messages, options);
    let completed = false;
    const pendingHostWork = setImmediate();
    const projection = projectSessionMessagesAsync(messages, options).then(result => {
      completed = true;
      return result;
    });
    await pendingHostWork;
    expect(completed).toBe(false);
    const actual = await projection;
    expect(actual).toEqual(expected);
    expect(actual).toMatchObject({ status: 'available', state: { truncated: true } });
  });

  it('retains tool completion, thinking and ancestry across yield boundaries', async () => {
    const messages = Array.from({ length: 600 }, (_, index) => [
      { id: `user-${index}`, role: 'user', content: [{ type: 'text', text: 'Read the file' }] },
      { id: `call-${index}`, parentId: `user-${index}`, role: 'assistant', content: [
        { type: 'thinking', thinking: 'Inspect the source', durationMs: 20 },
        { type: 'tool_use', id: `tool-${index}`, name: 'Read', input: { file_path: 'C:/synthetic/file.ts' } },
      ] },
      { id: `result-${index}`, parentId: `call-${index}`, role: 'tool', content: [
        { type: 'tool_result', toolUseId: `tool-${index}`, content: 'const answer = 42;' },
      ] },
    ]).flat();
    const options = { sourceSessionId: 'saved', workspaceRoot: 'C:/synthetic' };
    expect(await projectSessionMessagesAsync(messages, options))
      .toEqual(projectSessionMessages(messages, options));
  });

  it('retains the unavailable result for unsupported envelopes', async () => {
    expect(await projectSessionHistoryAsync({ result: null })).toMatchObject({ status: 'unavailable' });
  });
});
