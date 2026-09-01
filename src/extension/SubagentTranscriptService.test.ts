import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionTranscriptItem } from '../shared/bridgeMessages';
import { unavailableSessionHistory } from '../runtime/history/SessionHistory';
import { SubagentTranscriptService } from './SubagentTranscriptService';

const parentRow = {
  parentSessionId: 'parent-1',
  turnId: 'parent-turn-1',
  toolUseId: 'parent-task-1',
  type: 'explorer',
  description: 'Trace the child flow',
  cwd: 'd:/work',
};

function userMessage(id: string, text: string): Record<string, unknown> {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    createdAt: 0,
    updatedAt: 0,
  };
}

function assistantMessage(
  id: string,
  toolUseId: string,
): Record<string, unknown> {
  return {
    id,
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: toolUseId,
        name: 'Read',
        input: { file_path: `src/${toolUseId}.ts` },
      },
    ],
    createdAt: 0,
    updatedAt: 0,
  };
}

function taskInvocation(
  description: string,
  task: string,
): string {
  return [
    '# Task Tool Invocation',
    'Subagent type: explorer',
    `Task description: ${description}`,
    '## Task',
    '---BEGIN TASK FROM PARENT AGENT---',
    task,
    '---END TASK FROM PARENT AGENT---',
  ].join('\n');
}

function createService(
  loadHistory = vi.fn().mockResolvedValue(unavailableSessionHistory()),
): {
  readonly service: SubagentTranscriptService;
  readonly loadHistory: typeof loadHistory;
} {
  return {
    service: new SubagentTranscriptService(
      { loadHistory },
      {
        resolveParentRow: (parentSessionId, toolUseId) =>
          parentSessionId === parentRow.parentSessionId &&
          toolUseId === parentRow.toolUseId
            ? parentRow
            : null,
        openViewer: () => undefined,
      },
    ),
    loadHistory,
  };
}

function observe(
  service: SubagentTranscriptService,
  sessionId: string,
  notification: Record<string, unknown>,
): void {
  service.observeProcessNotification(sessionId, {
    params: { sessionId, notification },
  });
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('SubagentTranscriptService', () => {
  it('projects a Task invocation while the child is running', async () => {
    const { service } = createService();
    observe(service, 'parent-1', {
      type: 'child_session_available',
      childSessionId: 'child-1',
      toolUseId: 'parent-task-1',
    });
    await settle();

    const invocation = taskInvocation(
      'Trace the child flow',
      'Inspect the transcript boundary.',
    );
    observe(service, 'child-1', {
      type: 'create_message',
      message: userMessage('child-user-1', invocation),
    });

    expect(service.readViewer('child-1')?.items).toEqual([
      expect.objectContaining({
        kind: 'user',
        messageId: 'child-user-1',
        text: invocation,
      }),
    ]);
    service.dispose();
  });

  it('keeps repeated child invocations and their tool activity separate', async () => {
    const { service } = createService();
    observe(service, 'parent-1', {
      type: 'child_session_available',
      childSessionId: 'child-1',
      toolUseId: 'parent-task-1',
    });
    await settle();

    observe(service, 'child-1', {
      type: 'create_message',
      message: userMessage(
        'child-user-1',
        taskInvocation('First pass', 'Read the first area.'),
      ),
    });
    observe(service, 'child-1', {
      type: 'create_message',
      message: assistantMessage('child-assistant-1', 'child-tool-1'),
    });
    observe(service, 'child-1', {
      type: 'create_message',
      message: userMessage(
        'child-user-2',
        taskInvocation('Second pass', 'Read the second area.'),
      ),
    });
    observe(service, 'child-1', {
      type: 'create_message',
      message: assistantMessage('child-assistant-2', 'child-tool-2'),
    });

    const items = service.readViewer('child-1')?.items ?? [];
    const users = items.filter(
      (item): item is Extract<SessionTranscriptItem, { kind: 'user' }> =>
        item.kind === 'user',
    );
    const tools = items.filter(
      (item): item is Extract<SessionTranscriptItem, { kind: 'tool' }> =>
        item.kind === 'tool',
    );

    expect(users.map((item) => item.messageId)).toEqual([
      'child-user-1',
      'child-user-2',
    ]);
    expect(tools.map((item) => item.toolUseId)).toEqual([
      'child-tool-1',
      'child-tool-2',
    ]);
    expect(tools[0]?.turnId).not.toBe(tools[1]?.turnId);
    service.dispose();
  });

  it('replaces live rows with the terminal history without duplicates', async () => {
    const canonical: SessionTranscriptItem[] = [
      {
        id: 'history-user',
        kind: 'user',
        text: taskInvocation('Final pass', 'Read the saved session.'),
        messageId: 'history-user-id',
      },
      {
        id: 'history-tool',
        kind: 'tool',
        turnId: 'history-turn',
        toolUseId: 'history-tool-id',
        toolName: 'Read',
        action: 'Read workspace files',
        status: 'completed',
        progressCount: 0,
        latestUpdateKind: null,
      },
    ];
    const { service } = createService(
      vi
        .fn()
        .mockResolvedValueOnce(unavailableSessionHistory())
        .mockResolvedValue({
          status: 'available',
          state: {
            transcript: canonical,
            historyStatus: 'complete',
            truncated: false,
          },
        }),
    );
    observe(service, 'parent-1', {
      type: 'child_session_available',
      childSessionId: 'child-1',
      toolUseId: 'parent-task-1',
    });
    await settle();
    observe(service, 'child-1', {
      type: 'create_message',
      message: userMessage(
        'live-user-id',
        taskInvocation('Live pass', 'Read the live session.'),
      ),
    });
    observe(service, 'child-1', {
      type: 'create_message',
      message: assistantMessage('live-assistant-id', 'live-tool-id'),
    });
    observe(service, 'child-1', {
      type: 'agent_turn_completed',
      reason: 'completed',
    });
    await settle();
    await vi.advanceTimersByTimeAsync(500);
    await settle();

    expect(service.readViewer('child-1')?.items).toEqual(canonical);
    service.dispose();
  });
});
