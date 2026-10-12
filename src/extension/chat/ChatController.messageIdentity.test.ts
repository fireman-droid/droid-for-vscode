import type { DroidStreamEvent } from '@factory/droid-sdk/node';
import { describe, expect, it, vi } from 'vitest';
import { normalizeSdkEvent } from '../../runtime/events/normalizeSdkEvent';
import {
  createController, createMockRuntime, lastMessage, ready, send, successfulTurn, waitForConnected,
} from './controllerTestHarness';

// Identity regression only: no workspace capture or file writes in this test.
vi.mock('./changes/snapshotCapture', () => ({ captureSnapshotBeforeSend: async () => {} }));

function userEvent(id: string, text: string) {
  return normalizeSdkEvent({
    type: 'user', message: { id, role: 'user', content: [{ type: 'text', text }] },
  } as DroidStreamEvent)!;
}

describe('submitted user message identity', () => {
  it.each(['daemon', 'process'] as const)('keeps the %s prompt anchor after internal reminders', async transport => {
    const runtime = createMockRuntime(async function* () {
      if (transport === 'daemon') {
        yield { type: 'turn-identity' as const, backendTurnId: 'submitted-message' };
        yield userEvent('earlier-reminder', '<system-reminder>Earlier task state</system-reminder>');
      }
      yield userEvent('submitted-message', 'Update the list');
      yield { type: 'text-delta' as const, text: 'Updating the list.' };
      yield userEvent('todo-stale-reminder', '<system-reminder>Update the plan</system-reminder>');
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    try {
      ready(controller);
      await waitForConnected(messages);
      send(controller, 'session-1', 'local-turn', 'Update the list');
      await vi.waitFor(() => expect(lastMessage(messages, 'turn.state')?.status).toBe('completed'));
      expect(messages.filter(message => message.type === 'user.message-meta')).toEqual([
        expect.objectContaining({ turnId: 'local-turn', messageId: 'submitted-message' }),
      ]);
      expect(controller.recoveryState.transcript.transcript.filter(item => item.kind === 'user')).toEqual([
        expect.objectContaining({ text: 'Update the list', messageId: 'submitted-message' }),
      ]);
    } finally {
      await controller.dispose();
    }
  });
});
