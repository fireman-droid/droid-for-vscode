import { afterEach, expect, it, vi } from 'vitest';
import { projectDurableTurnOutcome, type DaemonTurnOutcome, type RuntimeTurnOutcome } from '../../runtime/turnOutcome';
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
  vi.spyOn(controller.effects, 'flushRecoveryCheckpointOrReport').mockImplementationOnce(async () => {
    const result = await flush(); saved.resolve(); await resume.promise; return result;
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
