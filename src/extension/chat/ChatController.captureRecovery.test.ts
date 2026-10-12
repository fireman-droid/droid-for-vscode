import { describe, expect, it, vi } from 'vitest';
import {
  available, catalogEntry, createCatalog, createController, createHostTranscriptState,
  createMemoryPersistence, createMockRuntime, deferred, ready, SessionRecoveryStore,
  snapshots, waitForConnected, type RuntimeSessionWorkingState,
} from './controllerTestHarness';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import { captureSnapshotBeforeSend } from './changes/snapshotCapture';
import { CAPTURE_RECOVERED_MESSAGE } from './recovery/settleRecoveredSnapshot';

const sessionId = 'saved-session';
const pending = { sessionId, turnId: 'original-turn' };
const blockedMessage = `This workspace has an unfinished captured turn. Reopen session ${sessionId} to finish recording it before sending another turn.`;

async function setup(
  state: RuntimeSessionWorkingState,
  captureAfter: () => Promise<string | undefined> = async () => 'saved-after',
) {
  const recovery = new SessionRecoveryStore(createMemoryPersistence(), 'recovery', 0);
  const history = createHostTranscriptState('complete');
  const conversationId = recovery.createConversation(sessionId, history)!;
  recovery.writeActiveDisplay(conversationId, sessionId, history,
    { turnId: 'failed-retry', status: 'failed', error: blockedMessage });
  recovery.selectConversation(conversationId);
  await recovery.flush();
  const runtime = createMockRuntime();
  runtime.initialize.mockResolvedValue(available(sessionId));
  runtime.readSessionWorkingState = vi.fn(async () => state);
  const result = createController(() => runtime, undefined,
    createCatalog([catalogEntry(sessionId)]), recovery,
    { loadHistory: async () => ({ status: 'available', state: history }) });
  const capture = vi.fn<TurnSnapshotStore['capture']>(async (_scope, phase) =>
    phase === 'after' ? captureAfter() : 'new-before');
  const store = {
    readPendingCapture: vi.fn(async () => pending), capture,
    read: () => undefined, dispose: async () => undefined,
  } as unknown as TurnSnapshotStore;
  Object.defineProperty(result.controller, 'turnSnapshots', { value: store });
  ready(result.controller);
  await waitForConnected(result.messages);
  return { ...result, recovery, conversationId, runtime, capture, store };
}

describe('durable workspace capture on session reopen', () => {
  it('settles the original idle turn and persists actionable feedback without sending a message', async () => {
    const fixture = await setup('idle');
    try {
      await vi.waitFor(() => expect(snapshots(fixture.messages).at(-1)?.turn).toMatchObject({
        turnId: 'failed-retry', status: 'failed', error: CAPTURE_RECOVERED_MESSAGE,
      }));
      expect(fixture.capture).toHaveBeenCalledExactlyOnceWith(pending, 'after', undefined);
      expect(fixture.recovery.readDisplay(fixture.conversationId)?.turn?.error).toBe(CAPTURE_RECOVERED_MESSAGE);
      expect(fixture.runtime.sendTurn).not.toHaveBeenCalled();
    } finally { await fixture.controller.dispose(); }
  });

  it.each(['running', 'waiting-for-user', 'unknown'] as const)(
    'does not capture or clear the failed retry while the backend is %s', async (state) => {
      const fixture = await setup(state);
      try {
        await vi.waitFor(() => expect(fixture.runtime.readSessionWorkingState).toHaveBeenCalledTimes(state === 'unknown' ? 3 : 1),
          { timeout: 2000 });
        expect(fixture.capture).not.toHaveBeenCalled();
        expect(snapshots(fixture.messages).at(-1)?.turn?.error).toBe(blockedMessage);
      } finally { await fixture.controller.dispose(); }
    },
  );

  it('retains the rejection and reports failure when the final snapshot cannot be saved', async () => {
    const fixture = await setup('idle', async () => undefined);
    try {
      await vi.waitFor(() => expect(fixture.messages).toContainEqual(expect.objectContaining({
        type: 'runtime.diagnostic', code: 'recovered-capture-failed',
      })));
      expect(snapshots(fixture.messages).at(-1)?.turn?.error).toBe(blockedMessage);
      expect(fixture.runtime.sendTurn).not.toHaveBeenCalled();
    } finally { await fixture.controller.dispose(); }
  });

  it('shares the final snapshot with a concurrent retry before taking its new baseline', async () => {
    const after = deferred<string>();
    const fixture = await setup('idle', () => after.promise);
    try {
      await vi.waitFor(() => expect(fixture.capture).toHaveBeenCalledTimes(1));
      const send = captureSnapshotBeforeSend({ turnSnapshots: fixture.store }, sessionId,
        'new-retry', undefined, fixture.runtime);
      await vi.waitFor(() => expect(fixture.runtime.readSessionWorkingState).toHaveBeenCalledTimes(2));
      expect(fixture.capture).toHaveBeenCalledTimes(1);
      after.resolve('saved-after');
      await send;
      expect(fixture.capture.mock.calls).toEqual([
        [pending, 'after', undefined],
        [{ sessionId, turnId: 'new-retry' }, 'before', undefined],
      ]);
    } finally { after.resolve('saved-after'); await fixture.controller.dispose(); }
  });
});
