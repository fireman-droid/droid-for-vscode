import { join, resolve } from 'node:path';

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
          // User messages intentionally expose the SDK message id as
          // `messageId`; it anchors edit-and-resend rewinds.
          { kind: 'user', text: 'Question', messageId: 'raw-user-id' },
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
    expect(serialized).not.toContain('raw-assistant-id');
    expect(serialized).not.toContain('raw-tool-id');
    expect(serialized).not.toContain('private');
  });

  it('projects workspace-relative file paths for file-modifying history tools', () => {
    const root = resolve('workspace-root');
    const loaded = response([
      message('assistant-1', 'assistant', [
        {
          type: 'tool_use',
          id: 'tool-edit',
          name: 'Edit',
          input: { file_path: join(root, 'src', 'app.ts') },
        },
        {
          type: 'tool_use',
          id: 'tool-outside',
          name: 'Edit',
          input: { file_path: join(root, '..', 'outside.ts') },
        },
        {
          type: 'tool_use',
          id: 'tool-read',
          name: 'Read',
          input: { file_path: join(root, 'src', 'app.ts') },
        },
      ]),
    ]);

    const result = projectSessionHistory(loaded, {
      workspaceRoot: root,
    });

    expect(result).toMatchObject({
      status: 'available',
      state: {
        transcript: [
          { kind: 'tool', toolName: 'Edit', filePath: 'src/app.ts' },
          { kind: 'tool', toolName: 'Edit' },
          { kind: 'tool', toolName: 'Read' },
          {
            kind: 'changes',
            files: [
              { path: 'src/app.ts', additions: null, deletions: null },
            ],
          },
        ],
      },
    });
    const transcript =
      result.status === 'available' ? result.state.transcript : [];
    expect(transcript[1]).not.toHaveProperty('filePath');
    expect(transcript[2]).not.toHaveProperty('filePath');
    expect(JSON.stringify(result)).not.toContain('outside');

    // Without a workspace root no paths are projected at all.
    const rootless = projectSessionHistory(loaded);
    expect(JSON.stringify(rootless)).not.toContain('app.ts');
  });

  it('carries the execute background hint fail-soft on history rows', () => {
    const loaded = response([
      message('assistant-1', 'assistant', [
        {
          type: 'tool_use',
          id: 'tool-bg',
          name: 'Execute',
          input: { command: 'pnpm dev', fireAndForget: true },
        },
        {
          type: 'tool_use',
          id: 'tool-fg',
          name: 'Execute',
          input: { command: 'git status' },
        },
        {
          type: 'tool_use',
          id: 'tool-bad',
          name: 'Execute',
          input: { command: 'ls', fireAndForget: 'true' },
        },
      ]),
    ]);

    const result = projectSessionHistory(loaded);

    expect(result).toMatchObject({
      status: 'available',
      state: {
        transcript: [
          {
            kind: 'tool',
            toolName: 'Execute',
            backgroundHint: { fireAndForget: true },
          },
          { kind: 'tool', toolName: 'Execute' },
          { kind: 'tool', toolName: 'Execute' },
        ],
      },
    });
    const transcript =
      result.status === 'available' ? result.state.transcript : [];
    expect(transcript[1]).not.toHaveProperty('backgroundHint');
    expect(transcript[2]).not.toHaveProperty('backgroundHint');
  });

  it('synthesizes one changes summary per history turn after its last item', () => {
    const root = resolve('workspace-root');
    const loaded = response([
      message('assistant-1', 'assistant', [
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'Edit',
          input: { file_path: 'src/a.ts' },
        },
        { type: 'text', text: 'First turn summary.' },
      ]),
      message('user-1', 'user', [
        { type: 'text', text: 'Next question' },
      ]),
      message('assistant-2', 'assistant', [
        {
          type: 'tool_use',
          id: 'tool-2',
          name: 'Create',
          input: { file_path: 'docs/new.md' },
        },
        {
          type: 'tool_use',
          id: 'tool-3',
          name: 'Edit',
          input: { file_path: 'docs/new.md' },
        },
      ]),
    ]);

    const result = projectSessionHistory(loaded, {
      workspaceRoot: root,
    });
    expect(result.status).toBe('available');
    const transcript =
      result.status === 'available' ? result.state.transcript : [];
    const kinds = transcript.map((item) => item.kind);
    expect(kinds).toEqual([
      'tool',
      'assistant',
      'changes',
      'user',
      'tool',
      'tool',
      'changes',
    ]);
    const summaries = transcript.filter(
      (item) => item.kind === 'changes',
    );
    expect(summaries[0]).toMatchObject({
      files: [{ path: 'src/a.ts', additions: null, deletions: null }],
    });
    // Duplicate paths within a turn collapse to one entry.
    expect(summaries[1]).toMatchObject({
      files: [{ path: 'docs/new.md', additions: null, deletions: null }],
    });
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

  it('projects user, assistant, and tool-result images as bounded items', () => {
    const image = (data: string, extra: Record<string, unknown> = {}) => ({
      type: 'image',
      source: { type: 'base64', data, mediaType: 'image/png' },
      ...extra,
    });
    const loaded = response([
      message('user-1', 'user', [
        { type: 'text', text: 'What is on this screenshot?' },
        image('dXNlcg=='),
      ]),
      message('assistant-1', 'assistant', [
        { type: 'text', text: 'A chart.' },
        image('Z2VuZXJhdGVk', { generated: true }),
      ]),
      message('tool-1', 'tool', [
        {
          type: 'tool_result',
          toolUseId: 'raw-tool-id',
          isError: false,
          content: [
            { type: 'text', text: 'took screenshot' },
            image('c2NyZWVu'),
          ],
        },
      ]),
    ]);

    const result = projectSessionHistory(loaded);

    expect(result).toMatchObject({
      status: 'available',
      state: {
        // Valid images no longer degrade the history to partial.
        historyStatus: 'complete',
        truncated: false,
        transcript: [
          { kind: 'user', text: 'What is on this screenshot?' },
          {
            kind: 'image',
            origin: 'user',
            mediaType: 'image/png',
            data: 'dXNlcg==',
            generated: false,
            byteLength: 4,
          },
          { kind: 'assistant', text: 'A chart.' },
          {
            kind: 'image',
            origin: 'assistant',
            data: 'Z2VuZXJhdGVk',
            generated: true,
          },
          {
            kind: 'image',
            origin: 'tool-result',
            data: 'c2NyZWVu',
            generated: false,
          },
        ],
      },
    });
  });

  it('degrades oversized history images to placeholders without partial', () => {
    const oversized = 'A'.repeat(2_800_001);
    const result = projectSessionHistory(
      response([
        message('user-1', 'user', [
          { type: 'text', text: 'Huge image' },
          {
            type: 'image',
            source: {
              type: 'base64',
              data: oversized,
              mediaType: 'image/jpeg',
            },
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
          { kind: 'user', text: 'Huge image' },
          {
            kind: 'image',
            origin: 'user',
            mediaType: 'image/jpeg',
            data: '',
            byteLength: Math.floor((oversized.length * 3) / 4),
          },
        ],
      },
    });
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

  it('retains ordinary histories beyond the former 200-item window', () => {
    const result = projectSessionHistory(
      response(
        Array.from({ length: 250 }, (_, index) =>
          message(`message-${index}`, 'user', [
            { type: 'text', text: `Prompt ${index}` },
          ]),
        ),
      ),
    );

    expect(result).toMatchObject({
      status: 'available',
      state: {
        historyStatus: 'complete',
        truncated: false,
      },
    });
    if (result.status !== 'available') {
      throw new Error('Expected projected history.');
    }
    expect(result.state.transcript).toHaveLength(250);
    expect(result.state.transcript[0]).toMatchObject({
      text: 'Prompt 0',
    });
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

  it('settles Task rows with ledger summaries by delegation identity in order', () => {
    const task = (id: string, type: string, description: string) => ({
      type: 'tool_use',
      id,
      name: 'Task',
      input: {
        subagent_type: type,
        description,
        prompt: 'private prompt that stays out of the transcript',
      },
    });
    const loaded = responseWith(
      [
        message('assistant-1', 'assistant', [
          task('task-1', 'worker', 'same job'),
          task('task-2', 'worker', 'same job'),
          task('task-3', 'explore', 'find the consumers'),
          task('task-4', 'worker', 'never reached the ledger'),
          { type: 'tool_use', id: 'read-1', name: 'Read', input: {} },
        ]),
      ],
      {
        subagentInvocations: [
          {
            childSessionId: 'child-1',
            subagentType: 'worker',
            description: 'same job',
            status: 'completed',
            toolUseCount: 12,
            durationMs: 377050,
          },
          {
            childSessionId: 'child-2',
            subagentType: 'worker',
            description: 'same job',
            status: 'failed',
          },
          {
            childSessionId: 'child-3',
            subagentType: 'explore',
            description: 'find the consumers',
            status: 'running',
          },
        ],
      },
    );

    const result = projectSessionHistory(loaded);

    expect(result.status).toBe('available');
    if (result.status !== 'available') {
      throw new Error('Expected projected history.');
    }
    expect(
      result.state.transcript.filter((item) => item.kind === 'tool'),
    ).toMatchObject([
      {
        toolName: 'Task',
        subagent: {
          type: 'worker',
          description: 'same job',
          status: 'completed',
          toolUseCount: 12,
          durationMs: 377050,
        },
      },
      {
        toolName: 'Task',
        subagent: {
          type: 'worker',
          description: 'same job',
          status: 'failed',
        },
      },
      {
        toolName: 'Task',
        subagent: {
          type: 'explore',
          description: 'find the consumers',
          status: 'running',
        },
      },
      // A Task without a ledger match keeps its identity and reports
      // no status instead of inventing one.
      {
        toolName: 'Task',
        subagent: {
          type: 'worker',
          description: 'never reached the ledger',
        },
      },
      { toolName: 'Read' },
    ]);
    const tools = result.state.transcript.filter(
      (item) => item.kind === 'tool',
    );
    expect(
      tools[3] !== undefined &&
        'subagent' in tools[3] &&
        tools[3].subagent !== undefined &&
        'status' in tools[3].subagent,
    ).toBe(false);
    expect(tools[4] !== undefined && 'subagent' in tools[4]).toBe(false);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('child-1');
    expect(serialized).not.toContain('child-2');
    expect(serialized).not.toContain('child-3');
    expect(serialized).not.toContain('private prompt');
  });

  it('projects the read-only mission identity from the load envelope', () => {
    const withMission = projectSessionHistory(
      responseWith([], {
        mission: { state: 'running' },
        decompSessionType: 'orchestrator',
      }),
    );
    expect(withMission).toMatchObject({
      status: 'available',
      mission: { state: 'running', role: 'orchestrator' },
    });

    const workerOnly = projectSessionHistory(
      responseWith([], { decompSessionType: 'worker' }),
    );
    expect(workerOnly).toMatchObject({
      status: 'available',
      mission: { state: null, role: 'worker' },
    });

    const plain = projectSessionHistory(response([]));
    expect(plain.status).toBe('available');
    expect(
      plain.status === 'available' && 'mission' in plain,
    ).toBe(false);
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

function responseWith(
  messages: readonly unknown[],
  extra: Record<string, unknown>,
): unknown {
  return { result: { session: { messages }, ...extra } };
}

function message(
  id: string,
  role: string,
  content: readonly unknown[],
): Record<string, unknown> {
  return { id, role, content };
}
