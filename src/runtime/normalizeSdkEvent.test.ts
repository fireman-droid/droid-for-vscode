import { join, resolve } from 'node:path';

import {
  DroidErrorType,
  DroidWorkingState,
  type DroidStreamEvent,
} from '@factory/droid-sdk/node';
import { describe, expect, it } from 'vitest';

import { MAX_BRIDGE_ID_LENGTH } from '../shared/bridgeMessages';
import { normalizeSdkEvent } from './normalizeSdkEvent';

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
          messageId: 'sensitive-message-id',
          blockIndex: 7,
          text: 'Considering',
          thoughtSignature: 'sensitive-signature',
        }),
      ),
    ).toEqual({
      type: 'thinking-delta',
      text: 'Considering',
    });
    expect(
      normalizeSdkEvent(
        sdkEvent('thinking_text_complete', {
          messageId: 'sensitive-message-id',
          blockIndex: 7,
          durationMs: 42,
          internal: 'sensitive',
        }),
      ),
    ).toEqual({
      type: 'thinking-complete',
      durationMs: 42,
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
    });
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
    });
    expect(normalizeSdkEvent(toolCallDelta)).toEqual({
      type: 'tool-start',
      toolName: 'Execute',
      toolUseId: 'tool-2',
      action: 'Ran a local command',
    });
    const projectedProgress = normalizeSdkEvent(toolProgress);
    expect(projectedProgress).toEqual({
      type: 'tool-progress',
      toolName: 'Search',
      toolUseId: 'tool-3',
      action: 'Used Search',
      updateKind: 'message',
    });
    expect(normalizeSdkEvent(toolResult)).toEqual({
      type: 'tool-result',
      toolName: 'Read',
      toolUseId: 'tool-4',
      action: 'Read workspace files',
      isError: true,
    });
    const serialized = JSON.stringify([
      normalizeSdkEvent(toolCall),
      normalizeSdkEvent(toolCallDelta),
      projectedProgress,
      normalizeSdkEvent(toolResult),
    ]);
    for (const prohibited of [
      'sensitive-path',
      'sensitive command',
      'sensitive-signature',
      'sensitive progress content',
      'sensitive progress update',
      'sensitive file contents',
    ]) {
      expect(serialized).not.toContain(prohibited);
    }
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
    });
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

    expect(normalizeSdkEvent(event)).toEqual({
      type: 'turn-complete',
      outcome: 'success',
    });
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

function sdkEvent(
  type: string,
  payload: Record<string, unknown>,
): DroidStreamEvent {
  return { type, ...payload } as unknown as DroidStreamEvent;
}
