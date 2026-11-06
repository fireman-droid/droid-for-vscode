import { afterEach, expect, it, vi } from 'vitest';
import { projectDurableTurnOutcome, type DaemonTurnOutcome, type RuntimeTurnOutcome } from '../../runtime/turnOutcome';
import type { ConversationRecoveryRecord } from '../recovery/conversationRecoveryState';
import {
  available, catalogEntry, createCatalog, createController, createHostTranscriptState,
  createMemoryPersistence, createMockRuntime, ready, SessionRecoveryStore, turnStates,
  deferred, send, successfulTurn,
  waitForConnected, waitForInteraction, type ChatController, type RuntimeInteractionHandler,
  type RuntimeAskUserResult,
} from './controllerTestHarness';

const controllers: ChatController[] = [];
afterEach(async () => { await Promise.all(controllers.splice(0).map(ctl => ctl.dispose())); });

it('persists the exact submission identity before allowing the runtime generator to send', async () => {
  const persistence = createMemoryPersistence();
  const store = new SessionRecoveryStore(persistence, 'recovery', 0);
  const sent = vi.fn();
  const runtime = createMockRuntime(async function* () {
    yield { type: 'turn-identity', backendTurnId: 'exact-submission' };
    sent();
    yield successfulTurn();
  });
  const { controller, messages } = createController(() => runtime, undefined, undefined, store);
  controllers.push(controller); ready(controller); await waitForConnected(messages);
  const saved = deferred<void>(), resume = deferred<void>();
  const flush = controller.effects.flushRecoveryCheckpointOrReport;
  vi.spyOn(controller.effects, 'flushRecoveryCheckpointOrReport').mockImplementation(async () => {
    const result = await flush();
    if (controller.turnState.turn?.backendTurnId === 'exact-submission') { saved.resolve(); await resume.promise; }
    return result;
  });
  send(controller, 'session-1', 'ui-turn', 'Continue');
  await saved.promise;
  const restored = new SessionRecoveryStore(persistence, 'recovery', 0);
  await restored.load();
  expect(restored.readDisplay(restored.resolveConversationId('session-1')!)?.turn).toMatchObject({
    turnId: 'ui-turn', backendTurnId: 'exact-submission',
  });
  expect(sent).not.toHaveBeenCalled();
  resume.resolve();
  await vi.waitFor(() => expect(turnStates(messages).at(-1)?.status).toBe('completed'));
  expect(sent).toHaveBeenCalledOnce();
});

it('preserves the active backend identity when an earlier turn publishes delayed changes', async () => {
  const persistence = createMemoryPersistence();
  const updates: { conversations: readonly ConversationRecoveryRecord[] }[] = [];
  const update = persistence.update.bind(persistence);
  vi.spyOn(persistence, 'update').mockImplementation(async (key, value) => {
    updates.push(structuredClone(value) as { conversations: readonly ConversationRecoveryRecord[] });
    await update(key, value);
  });
  const store = new SessionRecoveryStore(persistence, 'recovery', 0);
  const finish = deferred<void>();
  const diff = deferred<readonly { path: string; additions: number; deletions: number }[]>();
  const runtime = createMockRuntime(async function* (text) {
    if (text === 'second') {
      yield { type: 'turn-identity', backendTurnId: 'backend-b' };
      yield { type: 'text-delta', text: 'Still running B' };
      await finish.promise;
    }
    yield successfulTurn();
  });
  const { controller, messages } = createController(() => runtime, undefined, undefined, store);
  controllers.push(controller);
  ready(controller);
  await waitForConnected(messages);
  vi.spyOn(controller.effects, 'resolveSettledChangeFiles').mockImplementation(async (_sessionId, turnId) =>
    turnId === 'turn-a' ? diff.promise : []);
  try {
    send(controller, 'session-1', 'turn-a', 'first');
    await vi.waitFor(() => expect(turnStates(messages).at(-1)?.status).toBe('completed'));
    send(controller, 'session-1', 'turn-b', 'second');
    await vi.waitFor(() => expect(controller.turnState.turn).toMatchObject({ turnId: 'turn-b', backendTurnId: 'backend-b', status: 'streaming' }));
    diff.resolve([{ path: 'earlier.ts', additions: 1, deletions: 0 }]);
    await vi.waitFor(() => expect(messages).toContainEqual(expect.objectContaining({ type: 'changes.update', turnId: 'turn-a', state: 'settled' })));
    // Freeze the first publication, before a normal checkpoint/dispose could repair it.
    const saved = updates.find(state => state.conversations.some(conversation =>
      conversation.display.turn?.turnId === 'turn-b' && conversation.turns.some(turn => turn.turnId === 'turn-a' && turn.changesSettled)));
    expect(saved?.conversations[0]?.display.turn).toMatchObject({ turnId: 'turn-b', backendTurnId: 'backend-b' });
    const restored = new SessionRecoveryStore({ get: <T>() => saved as T | undefined, update: async () => {} }, 'recovery', 0);
    const resumed = Object.assign(createMockRuntime(), {
      readSessionWorkingState: vi.fn(async () => 'idle' as const),
      readTurnOutcome: vi.fn(async () => projectDurableTurnOutcome('session-1', 'backend-b', {
        type: 'agent_turn_outcome', turnId: 'backend-b', reason: 'error' as DaemonTurnOutcome['reason'], resultKind: 'text',
      })),
    });
    const replay = createController(() => resumed, undefined, createCatalog([catalogEntry('session-1')]), restored,
      { loadHistory: async () => ({ status: 'available', state: createHostTranscriptState('complete') }) });
    controllers.push(replay.controller);
    ready(replay.controller);
    await waitForConnected(replay.messages);
    await vi.waitFor(() => expect(turnStates(replay.messages).at(-1)?.status).toBe('failed'));
    expect(resumed.readTurnOutcome).toHaveBeenCalledExactlyOnceWith('backend-b');
    expect(resumed.sendTurn).not.toHaveBeenCalled();
  } finally { diff.resolve([]); finish.resolve(); }
});

it('does not submit when its recovery identity checkpoint cannot be saved', async () => {
  const sent = vi.fn();
  const runtime = createMockRuntime(async function* () {
    yield { type: 'turn-identity', backendTurnId: 'exact-submission' };
    sent(); yield successfulTurn();
  });
  const { controller, messages } = createController(() => runtime);
  controllers.push(controller); ready(controller); await waitForConnected(messages);
  vi.spyOn(controller.effects, 'flushRecoveryCheckpointOrReport').mockResolvedValueOnce(false);
  send(controller, 'session-1', 'ui-turn', 'Continue');
  await vi.waitFor(() => expect(turnStates(messages).at(-1)?.status).toBe('failed'));
  expect(sent).not.toHaveBeenCalled();
  expect(messages).toContainEqual(expect.objectContaining({ type: 'turn.error', code: 'recovery-checkpoint-failed' }));
});

async function restoredStore(backendTurnId?: string) {
  const persistence = createMemoryPersistence();
  const seed = new SessionRecoveryStore(persistence, 'recovery', 0);
  const transcript = createHostTranscriptState('complete');
  const conversationId = seed.createConversation('saved-session', transcript)!;
  seed.writeActiveDisplay(conversationId, 'saved-session', transcript, {
    turnId: 'saved-ui-turn', status: 'streaming', ...(backendTurnId ? { backendTurnId } : {}),
  });
  seed.selectConversation(conversationId);
  await seed.flush();
  return { store: new SessionRecoveryStore(persistence, 'recovery', 0), transcript };
}

it.each([
  ['completed', 'completed'], ['cancelled', 'interrupted'], ['error', 'failed'],
] as const)('recovers persisted %s after Host restart using its saved backend identity', async (reason, status) => {
  const { store, transcript } = await restoredStore('saved-backend-turn');
  const runtime = Object.assign(createMockRuntime(), {
    readSessionWorkingState: vi.fn(async () => 'idle' as const),
    readTurnOutcome: vi.fn(async () => projectDurableTurnOutcome('saved-session', 'saved-backend-turn', {
      type: 'agent_turn_outcome', turnId: 'saved-backend-turn', reason: reason as DaemonTurnOutcome['reason'], resultKind: 'text',
    })),
  });
  runtime.initialize.mockResolvedValue(available('saved-session'));
  const { controller, messages } = createController(() => runtime, undefined,
    createCatalog([catalogEntry('saved-session')]), store,
    { loadHistory: vi.fn(async () => ({ status: 'available' as const, state: transcript })) });
  controllers.push(controller);
  ready(controller);
  await waitForConnected(messages);
  await vi.waitFor(() => expect(turnStates(messages).at(-1)?.status).toBe(status));
  expect(runtime.readTurnOutcome).toHaveBeenCalledExactlyOnceWith('saved-backend-turn');
  expect(controller.turnState.turn?.turnId).toBe('saved-ui-turn');
  expect(runtime.sendTurn).not.toHaveBeenCalled();
});

it('retains the legacy recovery path for checkpoints without a backend identity', async () => {
  const { store, transcript } = await restoredStore();
  const runtime = Object.assign(createMockRuntime(), {
    readSessionWorkingState: vi.fn(async () => 'idle' as const), readTurnOutcome: vi.fn(async () => null),
  });
  runtime.initialize.mockResolvedValue(available('saved-session'));
  const { controller, messages } = createController(() => runtime, undefined,
    createCatalog([catalogEntry('saved-session')]), store,
    { loadHistory: vi.fn(async () => ({ status: 'available' as const, state: transcript })) });
  controllers.push(controller); ready(controller); await waitForConnected(messages);
  await vi.waitFor(() => expect(turnStates(messages).at(-1)?.status).toBe('completed'));
  expect(runtime.readTurnOutcome).not.toHaveBeenCalled();
  expect(runtime.sendTurn).not.toHaveBeenCalled();
});

it('keeps an Ask restored by the outcome query answerable even when the registry stays idle', async () => {
  const { store, transcript } = await restoredStore('saved-backend-turn');
  let handler!: RuntimeInteractionHandler;
  let question!: Promise<RuntimeAskUserResult>;
  const runtime = Object.assign(createMockRuntime(), {
    readSessionWorkingState: vi.fn(async () => 'idle' as const),
    readTurnOutcome: vi.fn(async (): Promise<RuntimeTurnOutcome | null> => {
      question = handler.askUser({ toolCallId: 'paused-worker-ask', questions: [{
        index: 0, topic: 'Choice', question: 'Continue?', options: ['Yes'], multiSelect: false,
      }] });
      return null;
    }),
  });
  runtime.initialize.mockResolvedValue(available('saved-session'));
  const { controller, messages } = createController(next => { handler = next; return runtime; }, undefined,
    createCatalog([catalogEntry('saved-session')]), store,
    { loadHistory: vi.fn(async () => ({ status: 'available' as const, state: transcript })) });
  controllers.push(controller); ready(controller); await waitForConnected(messages);
  const request = await waitForInteraction(messages, 'ask-user');
  await vi.waitFor(() => expect(controller.interactions.snapshotPending()).toHaveLength(1));
  expect(controller.turnState.turn?.status).toBe('streaming');
  expect(request.turnId).toBe('saved-ui-turn');
  let settled = false;
  void question.then(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 650));
  expect(settled).toBe(false);
  expect(controller.interactions.snapshotPending()).toHaveLength(1);
  expect(runtime.readTurnOutcome).toHaveBeenCalledOnce();
  runtime.readTurnOutcome.mockResolvedValue(projectDurableTurnOutcome('saved-session', 'saved-backend-turn', {
    type: 'agent_turn_outcome', turnId: 'saved-backend-turn', reason: 'completed' as DaemonTurnOutcome['reason'], resultKind: 'text',
  }));
  controller.handleMessage({ type: 'ask-user.respond', sessionId: 'saved-session', turnId: request.turnId,
    requestId: request.request.requestId, cancelled: false, answers: [{ index: 0, answer: 'Yes' }] });
  await expect(question).resolves.toEqual({ answers: [{ index: 0, answer: 'Yes' }] });
  await vi.waitFor(() => expect(turnStates(messages).at(-1)?.status).toBe('completed'));
  expect(runtime.sendTurn).not.toHaveBeenCalled();
});
