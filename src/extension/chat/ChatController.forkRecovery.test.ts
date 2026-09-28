import { expect, it, vi } from 'vitest';
import {
  available, catalogEntry, createCatalog, createController, createMemoryPersistence,
  createMockRuntime, ready, SessionRecoveryStore, snapshots, waitForConnected,
} from './controllerTestHarness';
import { createDurableForkConversation } from './recovery/conversationLineage';
import type { HostTranscriptState } from '../recovery/hostTranscriptState';

it('resumes the selected edited conversation and loads its newer history after Reload', async () => {
  const persistence = createMemoryPersistence();
  const writer = new SessionRecoveryStore(persistence);
  const empty: HostTranscriptState = { transcript: [], historyStatus: 'complete', truncated: false };
  writer.createConversation('original', empty);
  writer.writeActiveDisplay('original', 'original', empty, { turnId: 'old', status: 'completed' });
  writer.recordSettledTurn('original', 'original', 'old', null,
    [{ path: 'app.ts', additions: 1, deletions: 0 }], 'completed', 'old-message');
  await createDurableForkConversation({ recoveryStore: writer }, 'original', 'original', 'edited', 'rewind', {
    ...empty, transcript: [{ id: 'old-changes', kind: 'changes', turnId: 'old', files: [] }],
  });
  writer.recordSettledTurn('edited', 'edited', 'new', null, [], 'completed', 'new-message');
  await writer.dispose();
  const runtime = createMockRuntime();
  runtime.initialize.mockResolvedValue(available('edited'));
  const loadHistory = vi.fn(async () => ({
    status: 'available' as const,
    state: { ...empty, transcript: [
      { id: 'old-user', kind: 'user' as const, messageId: 'old-message', text: 'Earlier prompt' },
      { id: 'new-user', kind: 'user' as const, messageId: 'new-message', text: 'The newer conversation' },
    ] },
  }));
  const { controller, messages } = createController(
    () => runtime, undefined,
    createCatalog([catalogEntry('original'), catalogEntry('edited')]),
    new SessionRecoveryStore(persistence), { loadHistory },
  );
  try {
    ready(controller);
    await waitForConnected(messages);
    expect(runtime.initialize).toHaveBeenCalledWith({
      kind: 'resume', cwd: 'C:\\workspace', sessionId: 'edited',
    });
    expect(loadHistory).toHaveBeenCalledWith({ cwd: 'C:\\workspace', sessionId: 'edited' });
    expect(snapshots(messages).at(-1)).toMatchObject({
      sessionId: 'edited',
      transcript: expect.arrayContaining([
        expect.objectContaining({ kind: 'user', messageId: 'new-message', text: 'The newer conversation' }),
      ]),
    });
    expect(controller.recoveryStore.readTurn('edited', 'old')?.sessionId).toBe('original');
  } finally {
    await controller.dispose();
  }
});
