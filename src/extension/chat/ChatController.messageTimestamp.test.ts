import { describe, expect, it, vi } from 'vitest';
import {
  createController, createMockRuntime, lastMessage, ready, send, successfulTurn, waitForConnected,
} from './controllerTestHarness';

describe('live chat message times', () => {
  it('sends Host acceptance time in user metadata and preserves the first streamed reply time', async () => {
    const acceptedAt = 1_790_417_400_000;
    let clock = acceptedAt;
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock);
    const runtime = createMockRuntime(async function* () {
      clock = acceptedAt + 2_000;
      yield { type: 'user-message', messageId: 'sdk-message' };
      clock = acceptedAt + 3_000;
      yield { type: 'text-delta', text: 'Hello' };
      clock = acceptedAt + 10_000;
      yield { type: 'text-delta', text: ' again' };
      yield successfulTurn();
    });
    const { controller, messages } = createController(() => runtime);
    try {
      ready(controller);
      await waitForConnected(messages);
      send(controller, 'session-1', 'turn', 'Question');
      await vi.waitFor(() => expect(lastMessage(messages, 'turn.state')?.status).toBe('completed'));
      expect(lastMessage(messages, 'user.message-meta'))
        .toMatchObject({ messageId: 'sdk-message', timestamp: acceptedAt });
      expect(messages.filter(message => message.type === 'assistant.delta'))
        .toEqual([
          expect.objectContaining({ delta: 'Hello', timestamp: acceptedAt + 3_000 }),
          expect.objectContaining({ delta: ' again', timestamp: acceptedAt + 10_000 }),
        ]);
      expect(controller.recoveryState.transcript.transcript
        .filter(item => item.kind === 'user' || item.kind === 'assistant')).toEqual([
        expect.objectContaining({ kind: 'user', timestamp: acceptedAt }),
        expect.objectContaining({ kind: 'assistant', timestamp: acceptedAt + 3_000, text: 'Hello again' }),
      ]);
    } finally {
      await controller.dispose();
      now.mockRestore();
    }
  });
});
