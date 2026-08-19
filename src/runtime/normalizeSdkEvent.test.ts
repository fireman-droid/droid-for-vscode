import { join, resolve } from 'node:path';

import {
  DroidErrorType,
  DroidWorkingState,
  type DroidStreamEvent,
} from '@factory/droid-sdk/node';
import { describe, expect, it } from 'vitest';

import {
  MAX_BRIDGE_ID_LENGTH,
  MAX_IMAGE_DATA_LENGTH,
  MAX_IMAGES_PER_TURN,
  MAX_TOOL_ERROR_MESSAGE_LENGTH,
} from '../shared/bridgeMessages';
import {
  normalizeSdkEvent,
  normalizeSdkEventImages,
} from './normalizeSdkEvent';

describe('normalizeSdkEvent', () => {
  it('normalizes streamed text deltas', () => {
    const event: DroidStreamEvent = {
      type: 'assistant_text_delta',
      messageId: 'message-1',
      blockIndex: 0,
      text: 'Hello',
    };

    expect(normalizeSdkEvent(event)).toEqual({
      type: 'text-delta',
      text: 'Hello',
    });
  });

  it('suppresses empty assistant text deltas', () => {
    expect(
      normalizeSdkEvent({
        type: 'assistant_text_delta',
        messageId: 'message-1',
        blockIndex: 0,
        text: '',
      }),
    ).toBeUndefined();
  });

  it('normalizes thinking events without retaining unrelated payloads', () => {
    expect(
      normalizeSdkEvent(
        sdkEvent('thinking_text_delta', {
          messageId: 'message-a',
          blockIndex: 7,
          text: 'Considering',
          thoughtSignature: 'sensitive-signature',
        }),
      ),
    ).toEqual({
      type: 'thinking-delta',
      text: 'Considering',
      messageId: 'message-a',
      blockIndex: 7,
    });
    expect(
      normalizeSdkEvent(
        sdkEvent('thinking_text_complete', {
          messageId: 'message-a',
          blockIndex: 7,
          durationMs: 42,
          internal: 'sensitive',
        }),
      ),
    ).toEqual({
      type: 'thinking-complete',
      durationMs: 42,
      messageId: 'message-a',
      blockIndex: 7,
    });
    expect(
      normalizeSdkEvent(
        sdkEvent('thinking_text_complete', {
          messageId: 'message-1',
          blockIndex: 0,
        }),
      ),
    ).toEqual({
      type: 'thinking-complete',
      durationMs: null,
      messageId: 'message-1',
      blockIndex: 0,
    });
  });

  it('bounds thinking segment identity and drops malformed ones whole', () => {
    const longId = 'm'.repeat(MAX_BRIDGE_ID_LENGTH + 20);
    expect(
      normalizeSdkEvent(
        sdkEvent('thinking_text_delta', {
          messageId: longId,
          blockIndex: 0,
          text: 'Considering',
        }),
      ),
    ).toMatchObject({
      messageId: longId.slice(0, MAX_BRIDGE_ID_LENGTH),
    });
    for (const invalid of [
      { messageId: '', blockIndex: 0 },
      { messageId: 42, blockIndex: 0 },
      { messageId: 'message-1', blockIndex: -1 },
      { messageId: 'message-1', blockIndex: 1.5 },
      { messageId: 'message-1', blockIndex: '0' },
      { messageId: 'message-1' },
    ]) {
      expect(
        normalizeSdkEvent(
          sdkEvent('thinking_text_delta', {
            ...invalid,
            text: 'dropped whole',
          }),
        ),
      ).toBeUndefined();
      expect(
        normalizeSdkEvent(
          sdkEvent('thinking_text_complete', {
            ...invalid,
            durationMs: 10,
          }),
        ),
      ).toBeUndefined();
    }
  });

  it('keeps only safe metadata from every tool event shape', () => {
    const toolCall: DroidStreamEvent = {
      type: 'tool_call',
      name: '\u0000  Read\u0007  ',
      toolUseId: 'tool-1',
      input: { filePath: 'sensitive-path' },
    };
    const toolCallDelta = sdkEvent('tool_call_delta', {
      toolUse: {
        type: 'tool_use',
        id: 'tool-2',
        name: 'Execute',
        input: { command: 'sensitive command' },
        thoughtSignature: 'sensitive-signature',
      },
    });
    const toolProgress: DroidStreamEvent = {
      type: 'tool_progress',
      toolUseId: 'tool-3',
      toolName: 'Search',
      content: 'sensitive progress content',
      update: {
        type: 'message',
        text: 'sensitive progress update',
      },
    };
    const toolResult: DroidStreamEvent = {
      type: 'tool_result',
      toolUseId: 'tool-4',
      toolName: 'Read',
      content: 'sensitive file contents',
      isError: true,
    };

    expect(normalizeSdkEvent(toolCall)).toEqual({
      type: 'tool-start',
      toolName: 'Read',
      toolUseId: 'tool-1',
      action: 'Read workspace files',
      inputComplete: true,
    });
    expect(normalizeSdkEvent(toolCallDelta)).toEqual({
      type: 'tool-start',
      toolName: 'Execute',
      toolUseId: 'tool-2',
      action: 'Ran a local command',
      detailKind: 'command',
      detail: 'sensitive command',
    });
    const projectedProgress = normalizeSdkEvent(toolProgress);
    expect(projectedProgress).toEqual({
      type: 'tool-progress',
      toolName: 'Search',
      toolUseId: 'tool-3',
      action: 'Used Search',
      updateKind: 'message',
    });
    // A failed tool_result deliberately surfaces its text as the
    // error excerpt so the UI can show why the tool failed.
    expect(normalizeSdkEvent(toolResult)).toEqual({
      type: 'tool-result',
      toolName: 'Read',
      toolUseId: 'tool-4',
      action: 'Read workspace files',
      isError: true,
      errorText: 'sensitive file contents',
    });
    const serialized = JSON.stringify([
      normalizeSdkEvent(toolCall),
      normalizeSdkEvent(toolCallDelta),
      projectedProgress,
      normalizeSdkEvent(toolResult),
    ]);
    // The execute command is intentionally surfaced so the UI can show
    // what ran, mirroring Cursor. Other tool content stays excluded.
    for (const prohibited of [
      'sensitive-path',
      'sensitive-signature',
      'sensitive progress content',
      'sensitive progress update',
    ]) {
      expect(serialized).not.toContain(prohibited);
    }
  });

  it('prefers the Execute summary input as the tool-start action', () => {
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: 'Execute',
          toolUseId: 'tool-summary',
          input: {
            command: 'rg -n foo src/',
            summary: 'Search for foo in src',
          },
        }),
      ),
    ).toMatchObject({
      type: 'tool-start',
      action: 'Search for foo in src',
      detailKind: 'command',
      detail: 'rg -n foo src/',
    });
    // Without a summary the generic verb phrase stands.
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: 'Execute',
          toolUseId: 'tool-plain',
          input: { command: 'git status' },
        }),
      ),
    ).toMatchObject({ action: 'Ran a local command' });
  });

  it('projects safe Read, Grep, and Glob targets with live tool starts', () => {
    const root = resolve('workspace-root');
    const targetOf = (
      name: string,
      toolUseId: string,
      input: unknown,
    ) =>
      normalizeSdkEvent(
        sdkEvent('tool_call', { name, toolUseId, input }),
        root,
      );

    expect(
      targetOf('Read', 'read-1', {
        file_path: join(root, 'src', 'app.ts'),
      }),
    ).toMatchObject({ target: 'src/app.ts' });
    expect(
      targetOf('Grep', 'grep-1', {
        pattern: 'needle',
        path: 'src',
        glob: '**/*.ts',
      }),
    ).toMatchObject({ target: 'needle · src · **/*.ts' });
    expect(
      targetOf('Glob', 'glob-1', {
        patterns: '**/*.tsx',
        folder: 'src',
      }),
    ).toMatchObject({ target: '**/*.tsx · src' });
    expect(
      targetOf('Read', 'read-outside', {
        file_path: join(root, '..', 'secret.txt'),
      }),
    ).not.toHaveProperty('target');
  });

  it('bounds and shapes the failed tool_result error excerpt', () => {
    // Successful results never carry an excerpt.
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_result', {
          toolUseId: 'tool-ok',
          toolName: 'Read',
          content: 'file contents',
          isError: false,
        }),
      ),
    ).not.toHaveProperty('errorText');
    // Block arrays surface their text blocks only.
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_result', {
          toolUseId: 'tool-blocks',
          toolName: 'Execute',
          isError: true,
          content: [
            { type: 'text', text: 'Tool execution cancelled by user' },
            { type: 'image', source: { type: 'base64', data: 'aGk=' } },
          ],
        }),
      ),
    ).toMatchObject({
      errorText: 'Tool execution cancelled by user',
    });
    // Long excerpts are truncated at the bridge cap with an ellipsis.
    const long = normalizeSdkEvent(
      sdkEvent('tool_result', {
        toolUseId: 'tool-long',
        toolName: 'Execute',
        isError: true,
        content: 'x'.repeat(MAX_TOOL_ERROR_MESSAGE_LENGTH + 100),
      }),
    );
    expect(long).toMatchObject({ isError: true });
    const errorText = (long as { errorText: string }).errorText;
    expect(errorText.length).toBe(MAX_TOOL_ERROR_MESSAGE_LENGTH);
    expect(errorText.endsWith('…')).toBe(true);
    // Whitespace-only content yields no excerpt.
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_result', {
          toolUseId: 'tool-blank',
          toolName: 'Execute',
          isError: true,
          content: '   \n  ',
        }),
      ),
    ).not.toHaveProperty('errorText');
    // ANSI color runs in the CLI's error content are stripped, so
    // the excerpt never shows literal escape garbage (#29).
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_result', {
          toolUseId: 'tool-ansi',
          toolName: 'Execute',
          isError: true,
          content:
            'Error: Command failed (exit code: 1)\n' +
            '\u001b[31;1mParserError: \u001b[0mMissing closing brace',
        }),
      ),
    ).toMatchObject({
      errorText:
        'Error: Command failed (exit code: 1)\n' +
        'ParserError: Missing closing brace',
    });
  });

  it('surfaces the Task delegation identity from the tool-start input', () => {
    // The child_session_available notification arrives ~40s after
    // tool_call on the process transport (probed 2026-08-13), so the
    // delegation identity must come from the Task input immediately.
    const delegated = normalizeSdkEvent(
      sdkEvent('tool_call', {
        name: 'Task',
        toolUseId: 'task-1',
        input: {
          subagent_type: 'explore',
          description: 'Survey the auth module',
          prompt: 'sensitive delegated prompt body',
        },
      }),
    );
    expect(delegated).toMatchObject({
      type: 'tool-start',
      toolName: 'Task',
      subagent: {
        type: 'explore',
        description: 'Survey the auth module',
      },
    });
    // Identity only — lifecycle status stays notification authority,
    // and the prompt body never crosses the bridge.
    expect(
      (delegated as { subagent: { status?: string } }).subagent,
    ).not.toHaveProperty('status');
    expect(JSON.stringify(delegated)).not.toContain(
      'sensitive delegated prompt body',
    );

    // Non-Task tools ignore delegation-shaped inputs.
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: 'Read',
          toolUseId: 'read-1',
          input: { subagent_type: 'explore', description: 'x' },
        }),
      ),
    ).not.toHaveProperty('subagent');
  });

  it('reads the execute fireAndForget flag fail-soft', () => {
    // Strong signal: the CLI backgrounded the command (probed on
    // CLI 0.193.0; see artifacts/probe-fire-and-forget-conclusions.md).
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: 'Execute',
          toolUseId: 'tool-bg',
          input: {
            command: 'node artifacts/tmp/dvx-long-runner.mjs',
            fireAndForget: true,
          },
        }),
      ),
    ).toMatchObject({
      type: 'tool-start',
      backgroundHint: { fireAndForget: true },
    });

    // Streamed tool_call_delta inputs carry the flag the same way.
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call_delta', {
          toolUse: {
            type: 'tool_use',
            id: 'tool-bg-delta',
            name: 'Execute',
            input: { command: 'pnpm dev', fireAndForget: true },
          },
        }),
      ),
    ).toMatchObject({ backgroundHint: { fireAndForget: true } });

    // Missing field (the foreground norm) adds no key at all.
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: 'Execute',
          toolUseId: 'tool-fg',
          input: { command: 'git status' },
        }),
      ),
    ).not.toHaveProperty('backgroundHint');

    // Malformed values stay fail-soft instead of erroring.
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: 'Execute',
          toolUseId: 'tool-bad',
          input: { command: 'ls', fireAndForget: 'true' },
        }),
      ),
    ).not.toHaveProperty('backgroundHint');

    // Non-execute tools never surface the flag.
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: 'Read',
          toolUseId: 'tool-read-bg',
          input: { file_path: 'x.ts', fireAndForget: true },
        }),
      ),
    ).not.toHaveProperty('backgroundHint');
  });

  it('projects workspace-relative file paths for file-modifying tools', () => {
    const root = resolve('workspace-root');

    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: 'Edit',
          toolUseId: 'tool-edit',
          input: { file_path: join(root, 'src', 'app.ts') },
        }),
        root,
      ),
    ).toEqual({
      type: 'tool-start',
      toolName: 'Edit',
      toolUseId: 'tool-edit',
      action: 'Updated workspace files',
      inputComplete: true,
      filePath: 'src/app.ts',
    });

    // Relative inputs resolve against the workspace root.
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: 'Create',
          toolUseId: 'tool-create',
          input: { file_path: 'docs/readme.md' },
        }),
        root,
      ),
    ).toMatchObject({ filePath: 'docs/readme.md' });

    // Paths escaping the workspace are dropped, not leaked.
    const escaped = normalizeSdkEvent(
      sdkEvent('tool_call', {
        name: 'Edit',
        toolUseId: 'tool-escape',
        input: { file_path: join(root, '..', 'outside.ts') },
      }),
      root,
    );
    expect(escaped).not.toHaveProperty('filePath');
    expect(JSON.stringify(escaped)).not.toContain('outside');

    // Non-file tools never surface their inputs.
    const read = normalizeSdkEvent(
      sdkEvent('tool_call', {
        name: 'Read',
        toolUseId: 'tool-read',
        input: { file_path: join(root, 'src', 'app.ts') },
      }),
      root,
    );
    expect(read).not.toHaveProperty('filePath');

    // Without a workspace root nothing is extracted.
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: 'Edit',
          toolUseId: 'tool-no-root',
          input: { file_path: join(root, 'src', 'app.ts') },
        }),
      ),
    ).not.toHaveProperty('filePath');
  });

  it('reads ApplyPatch paths out of the patch text input', () => {
    const root = resolve('workspace-root');

    // Single-file patches carry only the singular path.
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: 'ApplyPatch',
          toolUseId: 'tool-patch-single',
          input: {
            input: [
              '*** Begin Patch',
              `*** Delete File: ${join(root, 'src', 'page.html')}`,
              `*** Add File: ${join(root, 'src', 'page.html')}`,
              '+rewritten',
              '*** End Patch',
            ].join('\n'),
          },
        }),
        root,
      ),
    ).toEqual({
      type: 'tool-start',
      toolName: 'ApplyPatch',
      toolUseId: 'tool-patch-single',
      action: 'Updated workspace files',
      inputComplete: true,
      filePath: 'src/page.html',
    });

    // Multi-file patches surface every path; `filePath` is the first.
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: 'ApplyPatch',
          toolUseId: 'tool-patch-multi',
          input: {
            input: [
              '*** Begin Patch',
              `*** Update File: ${join(root, 'src', 'a.ts')}`,
              '+x',
              `*** Add File: ${join(root, 'src', 'b.ts')}`,
              '+y',
              `*** Update File: ${join(root, '..', 'outside.ts')}`,
              '+escapes the workspace',
              '*** End Patch',
            ].join('\n'),
          },
        }),
        root,
      ),
    ).toMatchObject({
      filePath: 'src/a.ts',
      filePaths: ['src/a.ts', 'src/b.ts'],
    });

    // Malformed patch text projects no path fields at all.
    const malformed = normalizeSdkEvent(
      sdkEvent('tool_call', {
        name: 'ApplyPatch',
        toolUseId: 'tool-patch-bad',
        input: { input: { not: 'a string' } },
      }),
      root,
    );
    expect(malformed).not.toHaveProperty('filePath');
    expect(malformed).not.toHaveProperty('filePaths');
  });

  it('rejects unknown progress shapes instead of projecting details', () => {
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_progress', {
          toolName: 'Read',
          toolUseId: 'tool-unknown-progress',
          content: 'sensitive',
          update: {
            type: 'future-progress-kind',
            fullOutput: 'sensitive output',
          },
        }),
      ),
    ).toBeUndefined();
  });

  it('bounds tool labels and falls back when no safe label remains', () => {
    const longName = `  ${'x'.repeat(100)}  `;

    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: longName,
          toolUseId: 'tool-1',
          input: {},
        }),
      ),
    ).toEqual({
      type: 'tool-start',
      toolName: 'x'.repeat(80),
      toolUseId: 'tool-1',
      action: `Used ${'x'.repeat(80)}`,
      inputComplete: true,
    });
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_progress', {
          toolName: '\u0000\u0007  ',
          toolUseId: 'tool-2',
          content: 'sensitive',
          update: { type: 'status', status: 'sensitive' },
        }),
      ),
    ).toEqual({
      type: 'tool-progress',
      toolName: 'Tool',
      toolUseId: 'tool-2',
      action: 'Used Tool',
      updateKind: 'status',
    });
  });

  it.each([
    sdkEvent('tool_call', {
      name: 'Read',
      toolUseId: '',
      input: {},
    }),
    sdkEvent('tool_call_delta', {
      toolUse: {
        type: 'tool_use',
        id: 'x'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
        name: 'Read',
        input: {},
      },
    }),
    sdkEvent('tool_progress', {
      toolUseId: 'x'.repeat(MAX_BRIDGE_ID_LENGTH + 1),
      toolName: 'Read',
      content: 'sensitive',
      update: {},
    }),
    sdkEvent('tool_result', {
      toolUseId: '',
      toolName: 'Read',
      content: 'sensitive',
      isError: false,
    }),
  ])('suppresses a tool event with an invalid correlation ID', (event) => {
    expect(normalizeSdkEvent(event)).toBeUndefined();
  });

  it('accepts a tool correlation ID at the bridge limit', () => {
    const toolUseId = 'x'.repeat(MAX_BRIDGE_ID_LENGTH);

    expect(
      normalizeSdkEvent(
        sdkEvent('tool_call', {
          name: 'Read',
          toolUseId,
          input: {},
        }),
      ),
    ).toEqual({
      type: 'tool-start',
      toolName: 'Read',
      toolUseId,
      action: 'Read workspace files',
      inputComplete: true,
    });
  });

  it('projects an execute progress tail from the cumulative fullOutput', () => {
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_progress', {
          toolUseId: 'tool-exec',
          toolName: 'Execute',
          content: 'irrelevant',
          update: {
            type: 'status',
            text: 'line-2\nline-3',
            fullOutput: 'line-1\r\nline-2\nline-3\n',
            terminalId: 'terminal-1',
          },
        }),
      ),
    ).toEqual({
      type: 'tool-progress',
      toolName: 'Execute',
      toolUseId: 'tool-exec',
      action: 'Ran a local command',
      updateKind: 'status',
      outputTail: 'line-1\nline-2\nline-3',
    });
  });

  it('falls back to the recent-lines text window without fullOutput', () => {
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_progress', {
          toolUseId: 'tool-exec',
          toolName: 'Execute',
          content: 'irrelevant',
          update: { type: 'status', text: 'tail line' },
        }),
      ),
    ).toMatchObject({ outputTail: 'tail line' });
  });

  it('omits the output tail for empty or non-execute progress', () => {
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_progress', {
          toolUseId: 'tool-exec',
          toolName: 'Execute',
          content: '',
          update: { type: 'status', text: '' },
        }),
      ),
    ).not.toHaveProperty('outputTail');
    expect(
      normalizeSdkEvent(
        sdkEvent('tool_progress', {
          toolUseId: 'tool-read',
          toolName: 'Read',
          content: 'sensitive',
          update: {
            type: 'status',
            fullOutput: 'sensitive file contents',
          },
        }),
      ),
    ).not.toHaveProperty('outputTail');
  });

  it('normalizes working state and strips structured error details', () => {
    const workingState: DroidStreamEvent = {
      type: 'working_state_changed',
      state: DroidWorkingState.ExecutingTool,
    };
    const error: DroidStreamEvent = {
      type: 'error',
      message: 'The operation failed.',
      errorType: DroidErrorType.ERROR,
      timestamp: '2026-08-09T00:00:00.000Z',
    };

    expect(normalizeSdkEvent(workingState)).toEqual({
      type: 'working-state',
      isWorking: true,
    });
    expect(
      normalizeSdkEvent({
        type: 'working_state_changed',
        state: DroidWorkingState.Idle,
      }),
    ).toEqual({
      type: 'working-state',
      isWorking: false,
    });
    expect(normalizeSdkEvent(error)).toEqual({
      type: 'error',
    });
  });

  it('projects settings changes as a payload-free authoritative refresh signal', () => {
    const projected = normalizeSdkEvent(
      sdkEvent('settings_updated', {
        settings: {
          interactionMode: 'auto',
          sensitiveFutureField: 'must not escape',
        },
      }),
    );

    expect(projected).toEqual({ type: 'settings-updated' });
    expect(JSON.stringify(projected)).not.toContain('sensitiveFutureField');
  });

  it('normalizes a terminal result without retaining its message payloads', () => {
    const event: DroidStreamEvent = {
      type: 'result',
      subtype: 'success',
      sessionId: 'session-1',
      durationMs: 25,
      tokenUsage: {
        inputTokens: 10,
        outputTokens: 4,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        thinkingTokens: 0,
      },
      messages: [],
      text: 'sensitive final response',
      turnCount: 1,
      success: true,
      interrupted: false,
      error: null,
    };

    const projected = normalizeSdkEvent(event);
    expect(projected).toEqual({
      type: 'turn-complete',
      outcome: 'success',
      turnUsage: {
        inputTokens: 10,
        outputTokens: 4,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        thinkingTokens: 0,
      },
    });
    expect(JSON.stringify(projected)).not.toContain('sensitive');
  });

  it('omits turnUsage when the result reports null or invalid usage', () => {
    const base = {
      type: 'result' as const,
      subtype: 'success' as const,
      sessionId: 'session-1',
      durationMs: 25,
      messages: [],
      text: '',
      turnCount: 1,
      success: true as const,
      interrupted: false as const,
      error: null,
    };

    expect(
      normalizeSdkEvent({ ...base, tokenUsage: null }),
    ).toEqual({ type: 'turn-complete', outcome: 'success' });
    expect(
      normalizeSdkEvent(
        sdkEvent('result', {
          ...base,
          tokenUsage: { inputTokens: -1 },
        }),
      ),
    ).toEqual({ type: 'turn-complete', outcome: 'success' });
  });

  it('projects cumulative token usage updates and drops malformed ones', () => {
    // Live shape probed 2026-08-12: cumulative totals, no factoryCredits.
    expect(
      normalizeSdkEvent(
        sdkEvent('token_usage_update', {
          inputTokens: 2565,
          outputTokens: 81,
          cacheReadTokens: 23552,
          cacheCreationTokens: 0,
          thinkingTokens: 62,
        }),
      ),
    ).toEqual({
      type: 'token-usage',
      cumulative: {
        inputTokens: 2565,
        outputTokens: 81,
        cacheReadTokens: 23552,
        cacheCreationTokens: 0,
        thinkingTokens: 62,
      },
    });

    expect(
      normalizeSdkEvent(
        sdkEvent('token_usage_update', {
          inputTokens: Number.NaN,
          outputTokens: 81,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          thinkingTokens: 0,
        }),
      ),
    ).toBeUndefined();
    expect(
      normalizeSdkEvent(sdkEvent('token_usage_update', {})),
    ).toBeUndefined();
  });

  it('projects only the SDK user message id as a rewind anchor', () => {
    const projected = normalizeSdkEvent(
      sdkEvent('user', {
        message: {
          id: 'sdk-message-1',
          role: 'user',
          content: [{ type: 'text', text: 'sensitive prompt text' }],
        },
      }),
    );

    expect(projected).toEqual({
      type: 'user-message',
      messageId: 'sdk-message-1',
    });
    expect(JSON.stringify(projected)).not.toContain('sensitive');
    expect(
      normalizeSdkEvent(sdkEvent('user', { message: { id: '' } })),
    ).toBeUndefined();
    expect(
      normalizeSdkEvent(
        sdkEvent('user', {
          message: { id: 'x'.repeat(MAX_BRIDGE_ID_LENGTH + 1) },
        }),
      ),
    ).toBeUndefined();
    expect(
      normalizeSdkEvent(sdkEvent('user', { message: null })),
    ).toBeUndefined();
    expect(
      normalizeSdkEvent(sdkEvent('user', { content: 'sensitive' })),
    ).toBeUndefined();
  });

  it.each([
    'assistant_text_complete',
    'assistant',
    'token_usage_update',
    'permission_resolved',
    'session_title_updated',
    'session_working_directory_changed',
    'mcp_status_changed',
    'mission_state_changed',
    'mission_features_changed',
    'mission_progress_entry',
    'mission_heartbeat',
    'mission_worker_started',
    'mission_worker_completed',
    'mcp_auth_required',
    'mcp_auth_completed',
    'hook',
    'structured_output',
    'create_message',
    'tool_use',
    'future_sdk_event',
  ])('suppresses unsupported event type %s', (type) => {
    expect(
      normalizeSdkEvent(
        sdkEvent(type, {
          content: 'sensitive',
          input: { secret: true },
          settings: { secret: true },
          stdout: 'sensitive',
          stderr: 'sensitive',
        }),
      ),
    ).toBeUndefined();
  });
});

describe('normalizeSdkEventImages', () => {
  const imageBlock = (data: string, extra: Record<string, unknown> = {}) => ({
    type: 'image',
    source: { type: 'base64', data, mediaType: 'image/png' },
    ...extra,
  });

  it('projects image blocks from completed assistant messages', () => {
    const events = normalizeSdkEventImages(
      sdkEvent('assistant', {
        message: {
          id: 'message-1',
          role: 'assistant',
          content: [
            { type: 'text', text: 'Here you go' },
            imageBlock('aGVsbG8=', { generated: true }),
            imageBlock('d29ybGQ='),
          ],
        },
        text: 'Here you go',
      }),
    );

    expect(events).toEqual([
      {
        type: 'image-block',
        origin: 'assistant',
        mediaType: 'image/png',
        data: 'aGVsbG8=',
        generated: true,
        byteLength: 5,
        sourceId: 'message-1',
        blockIndex: 1,
      },
      {
        type: 'image-block',
        origin: 'assistant',
        mediaType: 'image/png',
        data: 'd29ybGQ=',
        generated: false,
        byteLength: 5,
        sourceId: 'message-1',
        blockIndex: 2,
      },
    ]);
  });

  it('projects tool-result images and skips malformed entries', () => {
    const events = normalizeSdkEventImages(
      sdkEvent('tool_result', {
        toolUseId: 'tool-1',
        toolName: 'Screenshot',
        isError: false,
        content: [
          { type: 'text', text: 'screenshot taken' },
          imageBlock('c2NyZWVu'),
          { type: 'image', source: { type: 'url', url: 'https://x' } },
          {
            type: 'image',
            source: {
              type: 'base64',
              data: 'PHNjcmlwdD4=',
              mediaType: 'image/svg+xml',
            },
          },
          {
            type: 'image',
            source: {
              type: 'base64',
              data: '',
              mediaType: 'image/png',
            },
          },
        ],
      }),
    );

    expect(events).toEqual([
      {
        type: 'image-block',
        origin: 'tool-result',
        mediaType: 'image/png',
        data: 'c2NyZWVu',
        generated: false,
        byteLength: 6,
        sourceId: 'tool-1',
        blockIndex: 1,
      },
    ]);
  });

  it('degrades oversized images to placeholders and caps per event', () => {
    const oversized = 'A'.repeat(MAX_IMAGE_DATA_LENGTH + 4);
    const capped = normalizeSdkEventImages(
      sdkEvent('assistant', {
        message: {
          id: 'message-1',
          role: 'assistant',
          content: [
            imageBlock(oversized),
            ...Array.from({ length: 12 }, () => imageBlock('aGVsbG8=')),
          ],
        },
        text: '',
      }),
    );

    expect(capped).toHaveLength(MAX_IMAGES_PER_TURN);
    expect(capped[0]).toMatchObject({
      data: '',
      byteLength: Math.floor((oversized.length * 3) / 4),
    });
  });

  it('yields nothing for user, string tool content, and other events', () => {
    expect(
      normalizeSdkEventImages(
        sdkEvent('user', {
          message: {
            id: 'message-1',
            role: 'user',
            content: [imageBlock('dXNlcg==')],
          },
        }),
      ),
    ).toEqual([]);
    expect(
      normalizeSdkEventImages(
        sdkEvent('tool_result', {
          toolUseId: 'tool-1',
          toolName: 'Read',
          isError: false,
          content: 'plain text result',
        }),
      ),
    ).toEqual([]);
    expect(
      normalizeSdkEventImages(
        sdkEvent('assistant_text_delta', { text: 'hi' }),
      ),
    ).toEqual([]);
  });
});

function sdkEvent(
  type: string,
  payload: Record<string, unknown>,
): DroidStreamEvent {
  return { type, ...payload } as unknown as DroidStreamEvent;
}
