import { afterEach, expect, it, vi } from 'vitest';
import { startReplacement } from './sessions/runtimeLifecycle';
import {
  catalogEntry, createCatalog, createController, createMockRuntime, ready, retry,
  send, snapshots, waitForConnected, type ChatController, type MockRuntime,
  type SessionHistoryLoader,
} from './controllerTestHarness';

const controllers: ChatController[] = [];
afterEach(async () => {
  await Promise.all(controllers.splice(0).map((controller) => controller.dispose()));
});

async function failedSession() {
  const original = createMockRuntime(async function* () { throw new Error('Transport closed.'); });
  const replacement = createMockRuntime();
  replacement.readSessionWorkingState = vi.fn(async () => 'idle' as const);
  const factory = vi.fn<() => MockRuntime>().mockReturnValueOnce(original).mockReturnValue(replacement);
  const history: SessionHistoryLoader = { loadHistory: vi.fn(async () => ({
    status: 'available' as const,
    state: {
      transcript: [
        { id: 'answer', kind: 'assistant' as const, text: 'Previous reply', turnId: 'earlier-turn' },
        { id: 'prompt', kind: 'user' as const, text: 'Continue', messageId: 'prompt' },
      ],
      historyStatus: 'complete' as const, truncated: false,
    },
  })) };
  const result = createController(factory, undefined, createCatalog([catalogEntry('session-1')]), undefined, history);
  result.controller.nativeIde = {
    read: () => ({ status: 'connected', message: 'Connected.' }),
    reconnect: vi.fn(async () => false),
  };
  controllers.push(result.controller);
  ready(result.controller);
  await waitForConnected(result.messages);
  send(result.controller, 'session-1', 'failed-turn', 'Continue');
  await vi.waitFor(() => expect(result.controller.turnState.turn?.status).toBe('failed'));
  return { ...result, original, replacement, history };
}

it.each([false, true])('acknowledges a failed turn only after explicit reconnect succeeds, with catalog reload=%s', async (reloadCatalog) => {
  const { controller, messages, original, replacement } = await failedSession();
  if (reloadCatalog) controller.catalogState.sessions = { status: 'idle', items: [] };

  retry(controller, 'session-1');
  await vi.waitFor(() => {
    expect(replacement.initialize).toHaveBeenCalledOnce();
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'session-1', connection: { status: 'connected' }, turn: null,
      transcript: [
        expect.objectContaining({ kind: 'assistant', text: 'Previous reply' }),
        expect.objectContaining({ kind: 'user', text: 'Continue' }),
      ],
    });
    expect(controller.sessionState.sessionOperationInProgress).toBe(false);
  });
  const conversationId = controller.sessionState.conversationId!;
  expect(controller.recoveryStore.readDisplay(conversationId)?.turn).toBeNull();
  expect(original.sendTurn).toHaveBeenCalledOnce();
  expect(replacement.sendTurn).not.toHaveBeenCalled();

  // A later history restore must not bring the acknowledged reconnect banner back.
  startReplacement(controller, { kind: 'resume', sessionId: 'session-1', cwd: 'C:\\workspace' });
  await vi.waitFor(() => {
    expect(replacement.initialize).toHaveBeenCalledTimes(2);
    expect(snapshots(messages).at(-1)).toMatchObject({ connection: { status: 'connected' }, turn: null });
    expect(controller.sessionState.sessionOperationInProgress).toBe(false);
  });
  expect(replacement.sendTurn).not.toHaveBeenCalled();
});

it('retains the failed turn when explicit reconnect cannot initialize the replacement', async () => {
  const { controller, messages, replacement } = await failedSession();
  replacement.initialize.mockRejectedValue(new Error('Native IDE is still unavailable.'));

  retry(controller, 'session-1');
  await vi.waitFor(() => expect(snapshots(messages).at(-1)).toMatchObject({
    connection: { status: 'unavailable' }, turn: { turnId: 'failed-turn', status: 'failed' },
  }));
  expect(controller.recoveryStore.readDisplay(controller.sessionState.conversationId!)?.turn)
    .toMatchObject({ turnId: 'failed-turn', status: 'failed' });
  expect(replacement.sendTurn).not.toHaveBeenCalled();
});

it('retains an unacknowledged failure when the conversation is restored normally', async () => {
  const { controller, messages, replacement } = await failedSession();

  startReplacement(controller, { kind: 'resume', sessionId: 'session-1', cwd: 'C:\\workspace' });
  await vi.waitFor(() => {
    expect(replacement.initialize).toHaveBeenCalledOnce();
    expect(snapshots(messages).at(-1)).toMatchObject({
      connection: { status: 'connected' }, turn: { turnId: 'failed-turn', status: 'failed' },
    });
  });
  expect(replacement.sendTurn).not.toHaveBeenCalled();
});

it.each(['disconnected', 'error', 'reconnect-required'] as const)(
  'retains the failure when session restore leaves IDE %s', async (status) => {
    const { controller, messages, replacement } = await failedSession();
    controller.nativeIde!.read = () => ({ status, message: 'IDE reconnection is blocked.' });

    retry(controller, 'session-1');
    await vi.waitFor(() => {
      expect(replacement.initialize).toHaveBeenCalledOnce();
      expect(snapshots(messages).at(-1)).toMatchObject({
        connection: { status: 'connected' }, turn: { turnId: 'failed-turn', status: 'failed' },
      });
    });
    expect(controller.recoveryStore.readDisplay(controller.sessionState.conversationId!)?.turn)
      .toMatchObject({ turnId: 'failed-turn', status: 'failed' });
    expect(replacement.sendTurn).not.toHaveBeenCalled();
  },
);
