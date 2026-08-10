import { describe, expect, it, vi } from 'vitest';

import {
  MAX_ASSISTANT_TEXT_LENGTH,
  MAX_BRIDGE_ID_LENGTH,
  MAX_SESSION_TRANSCRIPT_ITEMS,
  MAX_THINKING_TEXT_LENGTH,
  MAX_TOOL_NAME_LENGTH,
  MAX_TURN_TEXT_LENGTH,
} from '../../shared/bridgeMessages';
import { FactorySessionHistoryLoader } from './FactorySessionHistoryLoader';
import { SESSION_HISTORY_UNAVAILABLE_MESSAGE } from './SessionHistory';
import { projectSessionHistory } from './projectSessionHistory';

describe('projectSessionHistory', () => {
  it('projects visible text, thinking, and safe tool lifecycle in order', () => {
    const loaded = response([
      message('raw-user-id', 'user', [
        { type: 'text', text: 'Question' },
      ]),
      message('raw-assistant-id', 'assistant', [
        {
          type: 'thinking',
          thinking: 'Visible thought',
          signature: 'private-signature',
          durationMs: 42,
        },
        {
          type: 'tool_use',
          id: 'raw-tool-id',
          name: 'Read',
          input: { path: 'C:\\private\\file' },
          thoughtSignature: 'private-tool-signature',
        },
        { type: 'text', text: 'Answer' },
      ]),
      message('raw-result-id', 'tool', [
        {
          type: 'tool_result',
          toolUseId: 'raw-tool-id',
          content: 'private result',
          isError: false,
        },
      ]),
    ]);

    const first = projectSessionHistory(loaded);
    const second = projectSessionHistory(loaded);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: 'available',
      state: {
        historyStatus: 'complete',
        truncated: false,
        transcript: [
          { kind: 'user', text: 'Question' },
          {
            kind: 'thinking',
            text: 'Visible thought',
            status: 'complete',
            durationMs: 42,
          },
          {
            kind: 'tool',
            toolName: 'Read',
            status: 'completed',
          },
          { kind: 'assistant', text: 'Answer' },
        ],
      },
    });
    const serialized = JSON.stringify(first);
    expect(serialized).not.toContain('raw-user-id');
    expect(serialized).not.toContain('raw-assistant-id');
    expect(serialized).not.toContain('raw-tool-id');
    expect(serialized).not.toContain('private');
  });

  it('omits hidden content and marks visible attachment omissions partial', () => {
    const loaded = response([
      {
        ...message('system', 'system', [
          { type: 'text', text: 'system secret' },
        ]),
      },
      {
        ...message('llm-only', 'assistant', [
          { type: 'text', text: 'llm secret' },
        ]),
        visibility: 'llm_only',
      },
      {
        ...message('invisible', 'assistant', [
          { type: 'text', text: 'invisible secret' },
        ]),
        isUserVisible: false,
      },
      {
        ...message('hidden', 'assistant', [
          { type: 'text', text: 'hidden secret' },
        ]),
        hiddenFromUserViews: true,
      },
      {
        ...message('hook', 'assistant', [
          { type: 'text', text: 'hook secret' },
        ]),
        hookEventName: 'SessionStart',
      },
      message('visible', 'assistant', [
        { type: 'redacted_thinking', data: 'encrypted secret' },
        {
          type: 'image',
          source: { type: 'base64', data: 'image secret' },
        },
        {
          type: 'document',
          source: { type: 'text', data: 'document secret' },
        },
        { type: 'text', text: 'Visible answer' },
      ]),
    ]);

    const result = projectSessionHistory(loaded);

    expect(result).toMatchObject({
      status: 'available',
      state: {
        historyStatus: 'partial',
        truncated: true,
        transcript: [{ kind: 'assistant', text: 'Visible answer' }],
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret');
  });

  it('removes every balanced system marker span from user text', () => {
    const result = projectSessionHistory(
      response([
        message('filtered-user', 'user', [
          {
            type: 'text',
            text:
              '  Prefix <system-reminder>reminder secret</system-reminder> middle ' +
              '<system-notification>notification secret</system-notification> suffix  ',
          },
        ]),
      ]),
    );

    expect(result).toMatchObject({
      status: 'available',
      state: {
        historyStatus: 'complete',
        truncated: false,
        transcript: [
          {
            kind: 'user',
            text: 'Prefix  middle  suffix',
          },
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('system-reminder');
    expect(serialized).not.toContain('system-notification');
    expect(serialized).not.toContain('secret');
  });

  it('drops marker-only blocks while preserving visible block order', () => {
    const result = projectSessionHistory(
      response([
        message('ordered-user', 'user', [
          {
            type: 'text',
            text: ' \n<system-reminder>first secret</system-reminder>\t ',
          },
          { type: 'text', text: 'First visible block' },
          {
            type: 'text',
            text:
              '<system-notification>second secret</system-notification>',
          },
          {
            type: 'text',
            text:
              '<system-reminder>third secret</system-reminder>Second visible block',
          },
        ]),
      ]),
    );

    expect(result).toMatchObject({
      status: 'available',
      state: {
        historyStatus: 'complete',
        truncated: false,
        transcript: [
          { kind: 'user', text: 'First visible block' },
          { kind: 'user', text: 'Second visible block' },
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('system-reminder');
    expect(serialized).not.toContain('system-notification');
    expect(serialized).not.toContain('secret');
  });

  it('fails closed for malformed or ambiguous system markers', () => {
    const result = projectSessionHistory(
      response([
        message('malformed-user', 'user', [
          {
            type: 'text',
            text: 'unmatched opener <system-reminder>opener secret',
          },
          {
            type: 'text',
            text: 'closer secret</system-notification> unmatched closer',
          },
          {
            type: 'text',
            text:
              '<system-reminder>cross secret<system-notification>cross inner' +
              '</system-reminder>cross tail</system-notification>',
          },
          {
            type: 'text',
            text:
              '<system-reminder>nested secret<system-reminder>nested inner' +
              '</system-reminder></system-reminder>',
          },
          {
            type: 'text',
            text:
              'malformed syntax <system-notification private>syntax secret' +
              '</system-notification>',
          },
          { type: 'text', text: 'Safe visible block' },
        ]),
      ]),
    );

    expect(result).toMatchObject({
      status: 'available',
      state: {
        historyStatus: 'partial',
        truncated: true,
        transcript: [{ kind: 'user', text: 'Safe visible block' }],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('system-reminder');
    expect(serialized).not.toContain('system-notification');
    expect(serialized).not.toContain('secret');
  });

  it('filters hidden spans before applying the user text bound', () => {
    const result = projectSessionHistory(
      response([
        message('large-hidden-user', 'user', [
          {
            type: 'text',
            text:
              `<system-reminder>${'hidden secret '.repeat(
                MAX_TURN_TEXT_LENGTH,
              )}</system-reminder>` + 'Visible after hidden span',
          },
        ]),
      ]),
    );

    expect(result).toMatchObject({
      status: 'available',
      state: {
        historyStatus: 'complete',
        truncated: false,
        transcript: [
          { kind: 'user', text: 'Visible after hidden span' },
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('system-reminder');
    expect(serialized).not.toContain('hidden secret');
  });

  it('keeps literal system tags in assistant text unchanged', () => {
    const assistantText =
      'Before <system-reminder>assistant reminder</system-reminder> ' +
      '<system-notification>assistant notification</system-notification> after';
    const result = projectSessionHistory(
      response([
        message('assistant-literal', 'assistant', [
          { type: 'text', text: assistantText },
        ]),
      ]),
    );

    expect(result).toMatchObject({
      status: 'available',
      state: {
        historyStatus: 'complete',
        truncated: false,
        transcript: [{ kind: 'assistant', text: assistantText }],
      },
    });
  });

  it('bounds hostile text, names, identities, and transcript count', () => {
    const messages = Array.from(
      { length: MAX_SESSION_TRANSCRIPT_ITEMS + 1 },
      (_, index) =>
        message(`message-${index}`, 'user', [
          {
            type: 'text',
            text:
              index === MAX_SESSION_TRANSCRIPT_ITEMS
                ? 'u'.repeat(MAX_TURN_TEXT_LENGTH + 10)
                : `Prompt ${index}`,
          },
        ]),
    );
    messages.push(
      message('x'.repeat(100_000), 'assistant', [
        {
          type: 'thinking',
          thinking: 't'.repeat(MAX_THINKING_TEXT_LENGTH + 10),
          signature: 'signature',
        },
        {
          type: 'tool_use',
          id: 'y'.repeat(100_000),
          name: `\u0000 ${'n'.repeat(MAX_TOOL_NAME_LENGTH + 10)}`,
          input: { secret: 'raw input' },
        },
        {
          type: 'text',
          text: 'a'.repeat(MAX_ASSISTANT_TEXT_LENGTH + 10),
        },
      ]),
    );

    const result = projectSessionHistory(response(messages));

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      throw new Error('Expected projected history.');
    }
    expect(result.state.transcript).toHaveLength(
      MAX_SESSION_TRANSCRIPT_ITEMS,
    );
    expect(result.state).toMatchObject({
      historyStatus: 'partial',
      truncated: true,
    });
    for (const item of result.state.transcript) {
      expect(item.id.length).toBeLessThanOrEqual(MAX_BRIDGE_ID_LENGTH);
      if ('turnId' in item && typeof item.turnId === 'string') {
        expect(item.turnId.length).toBeLessThanOrEqual(
          MAX_BRIDGE_ID_LENGTH,
        );
      }
      if (item.kind === 'tool') {
        expect(item.toolUseId.length).toBeLessThanOrEqual(
          MAX_BRIDGE_ID_LENGTH,
        );
        expect(item.toolName.length).toBeLessThanOrEqual(
          MAX_TOOL_NAME_LENGTH,
        );
      }
    }
    expect(
      result.state.transcript.find(
        (item) => item.kind === 'assistant',
      ),
    ).toMatchObject({
      text: 'a'.repeat(MAX_ASSISTANT_TEXT_LENGTH),
    });
    expect(
      result.state.transcript.find((item) => item.kind === 'thinking'),
    ).toMatchObject({
      text: 't'.repeat(MAX_THINKING_TEXT_LENGTH),
      truncated: true,
    });
    expect(JSON.stringify(result)).not.toContain('raw input');
  });

  it('fails closed when the public load response is malformed', () => {
    const result = projectSessionHistory({
      result: { session: { messages: 'not-an-array' } },
    });

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'history-failed',
      message: SESSION_HISTORY_UNAVAILABLE_MESSAGE,
    });
  });

  it('fails closed when record-shaped values are arrays', () => {
    const loaded = [] as unknown as unknown[] & {
      result: { session: { messages: readonly unknown[] } };
    };
    loaded.result = { session: { messages: [] } };

    expect(projectSessionHistory(loaded)).toEqual({
      status: 'unavailable',
      reason: 'history-failed',
      message: SESSION_HISTORY_UNAVAILABLE_MESSAGE,
    });
    expect(
      projectSessionHistory(
        response([
          {
            id: 'message',
            role: 'user',
            content: [
              Object.assign([], { type: 'text', text: 'hidden' }),
            ],
          },
        ]),
      ),
    ).toMatchObject({
      status: 'available',
      state: {
        historyStatus: 'partial',
        truncated: true,
        transcript: [],
      },
    });
  });

  it('updates retained tools and forgets lifecycle metadata after eviction', () => {
    const messages: unknown[] = [
      message('old-tool-message', 'assistant', [
        { type: 'tool_use', id: 'shared-tool-id', name: 'OldTool' },
      ]),
      ...Array.from(
        { length: MAX_SESSION_TRANSCRIPT_ITEMS },
        (_, index) =>
          message(`filler-${index}`, 'user', [
            { type: 'text', text: `Filler ${index}` },
          ]),
      ),
      message('new-tool-message', 'assistant', [
        { type: 'tool_use', id: 'shared-tool-id', name: 'NewTool' },
        { type: 'tool_use', id: 'retained-error-id', name: 'Check' },
      ]),
      message('tool-results', 'tool', [
        {
          type: 'tool_result',
          toolUseId: 'shared-tool-id',
          isError: false,
        },
        {
          type: 'tool_result',
          toolUseId: 'retained-error-id',
          isError: true,
        },
      ]),
    ];

    const result = projectSessionHistory(response(messages));

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      throw new Error('Expected projected history.');
    }
    expect(result.state.transcript).toHaveLength(
      MAX_SESSION_TRANSCRIPT_ITEMS,
    );
    expect(
      result.state.transcript.filter((item) => item.kind === 'tool'),
    ).toMatchObject([
      { toolName: 'NewTool', status: 'completed' },
      { toolName: 'Check', status: 'failed' },
    ]);
    expect(JSON.stringify(result)).not.toContain('OldTool');
    expect(result.state).toMatchObject({
      historyStatus: 'partial',
      truncated: true,
    });
  });
});

describe('FactorySessionHistoryLoader', () => {
  it('closes its temporary client after loading without sending a prompt', async () => {
    const calls: string[] = [];
    const client = {
      loadSession: vi.fn(async ({ sessionId }: { sessionId: string }) => {
        calls.push(`load:${sessionId}`);
        return response([]);
      }),
      close: vi.fn(async () => {
        calls.push('close');
      }),
    };
    const createClient = vi.fn(async (cwd: string) => {
      calls.push(`create:${cwd}`);
      return client;
    });
    const loader = new FactorySessionHistoryLoader({ createClient });

    await expect(
      loader.loadHistory({
        cwd: 'C:\\workspace',
        sessionId: 'saved-session',
      }),
    ).resolves.toMatchObject({
      status: 'available',
      state: { historyStatus: 'complete', transcript: [] },
    });
    expect(calls).toEqual([
      'create:C:\\workspace',
      'load:saved-session',
      'close',
    ]);
    expect(client.loadSession).toHaveBeenCalledWith({
      sessionId: 'saved-session',
    });
    expect(client.close).toHaveBeenCalledOnce();
  });

  it('cleans up and returns only a fixed safe error', async () => {
    const client = {
      loadSession: vi.fn(async () => {
        throw new Error('C:\\Users\\person\\private-session');
      }),
      close: vi.fn(async () => {}),
    };
    const loader = new FactorySessionHistoryLoader({
      createClient: async () => client,
    });

    const result = await loader.loadHistory({
      cwd: 'C:\\workspace',
      sessionId: 'saved-session',
    });

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'history-failed',
      message: SESSION_HISTORY_UNAVAILABLE_MESSAGE,
    });
    expect(client.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('private-session');
  });

  it('treats temporary client cleanup failure as safely unavailable', async () => {
    const client = {
      loadSession: vi.fn(async () => response([])),
      close: vi.fn(async () => {
        throw new Error('private cleanup failure');
      }),
    };
    const loader = new FactorySessionHistoryLoader({
      createClient: async () => client,
    });

    const result = await loader.loadHistory({
      cwd: 'C:\\workspace',
      sessionId: 'saved-session',
    });

    expect(result).toEqual({
      status: 'unavailable',
      reason: 'history-failed',
      message: SESSION_HISTORY_UNAVAILABLE_MESSAGE,
    });
    expect(client.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('private cleanup');
  });
});

function response(messages: readonly unknown[]): unknown {
  return { result: { session: { messages } } };
}

function message(
  id: string,
  role: string,
  content: readonly unknown[],
): Record<string, unknown> {
  return { id, role, content };
}
