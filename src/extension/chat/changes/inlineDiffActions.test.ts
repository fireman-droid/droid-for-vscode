import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFileOpenTurnDiff, handleFileReadDiff } from './inlineDiffActions';
import { readInlineDiff, readTurnDiffContents } from '../../changes/inlineDiff';
import type { TurnSnapshotStore } from '../../changes/turnSnapshots';
import type { CurrentTurn } from '../internals';
import { createTurnActivityState } from '../turns/turnActivityState';
import type { ConversationTurnRecord } from '../../recovery/conversationRecoveryState';
import type { FileReadDiffMessage, InlineDiffResult } from '../../../shared/protocol/inlineDiffProtocol';

vi.mock('../../changes/inlineDiff', () => ({ readInlineDiff: vi.fn(), readTurnDiffContents: vi.fn() }));
const request: FileReadDiffMessage = {
  type: 'file.readDiff', sessionId: 'session-now', turnId: 'turn-1', path: 'app.ts', requestId: 'request-1',
};
const ready: InlineDiffResult = { status: 'ready', phase: 'settled', patch: '@@ -1 +1 @@\n-a\n+b', truncated: false };
function controller() {
  const settled: ConversationTurnRecord = {
    turnId: 'turn-1', sessionId: 'session-before-compaction', prompt: null,
    status: 'completed', changesSettled: true, firstRevision: 1, lastRevision: 2,
    files: [{ path: 'app.ts', additions: 1, deletions: 1 }],
  };
  return {
    effects: { readConversationTurnChanges: vi.fn(() => settled), readLatestConversationChanges: vi.fn() },
    turnState: { turn: null as CurrentTurn | null },
    turnSnapshots: {} as TurnSnapshotStore,
    ensureWorkspaceCurrent: vi.fn(() => true),
    sessionState: { sessionId: 'session-now', runtimeGeneration: 1, activeRuntimeCwd: 'C:/workspace', connection: { status: 'connected' as const }, disposed: false },
    emit: vi.fn(), recordHost: vi.fn(), emitSessionDiagnostic: vi.fn(),
    fileDiff: { openDiff: vi.fn(async () => 'opened-diff' as const) },
  };
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(readInlineDiff).mockResolvedValue(ready); });
describe('inline diff host routing', () => {
  it('uses the original snapshot session after compaction but replies to the visible session', async () => {
    const ctl = controller();
    handleFileReadDiff(ctl, request);
    await vi.waitFor(() => expect(ctl.emit).toHaveBeenCalled());
    expect(readInlineDiff).toHaveBeenCalledWith(ctl.turnSnapshots,
      { sessionId: 'session-before-compaction', turnId: 'turn-1' }, 'C:/workspace', 'app.ts', 'settled');
    expect(ctl.emit).toHaveBeenCalledWith({ ...request, type: 'file.diff', result: ready });
  });

  it('uses the current live ledger for unfinished turns', async () => {
    const ctl = controller();
    ctl.turnState.turn = {
      turnId: 'turn-1', status: 'streaming', activity: createTurnActivityState(),
      changesLedger: { files: () => [{ path: 'app.ts', additions: 1, deletions: 1 }], recordPaths: vi.fn(), cancel: vi.fn() },
    };
    handleFileReadDiff(ctl, request);
    await vi.waitFor(() => expect(ctl.emit).toHaveBeenCalled());
    expect(readInlineDiff).toHaveBeenCalledWith(ctl.turnSnapshots,
      { sessionId: 'session-now', turnId: 'turn-1' }, 'C:/workspace', 'app.ts', 'live');
  });

  it('rejects paths not attributed to the turn and invalid workspace context before reading', () => {
    const ctl = controller();
    handleFileReadDiff(ctl, { ...request, path: 'secret.ts' });
    expect(readInlineDiff).not.toHaveBeenCalled();
    expect(ctl.emit).toHaveBeenLastCalledWith(expect.objectContaining({ result: { status: 'unavailable' } }));
    ctl.ensureWorkspaceCurrent.mockReturnValue(false);
    handleFileReadDiff(ctl, request);
    expect(readInlineDiff).not.toHaveBeenCalled();
  });

  it.each(['session', 'generation', 'workspace', 'disposed'])('drops asynchronous replies after a %s change', async (change) => {
    const ctl = controller();
    let resolve!: (result: InlineDiffResult) => void;
    vi.mocked(readInlineDiff).mockReturnValueOnce(new Promise((done) => { resolve = done; }));
    handleFileReadDiff(ctl, request);
    if (change === 'session') ctl.sessionState.sessionId = 'other-session';
    if (change === 'generation') ctl.sessionState.runtimeGeneration++;
    if (change === 'workspace') ctl.sessionState.activeRuntimeCwd = 'C:/other';
    if (change === 'disposed') ctl.sessionState.disposed = true;
    resolve(ready);
    await Promise.resolve();
    expect(ctl.emit).not.toHaveBeenCalled();
  });

  it('reports read failures instead of rendering an empty successful diff', async () => {
    const ctl = controller();
    vi.mocked(readInlineDiff).mockRejectedValueOnce(new Error('git failed'));
    handleFileReadDiff(ctl, request);
    await vi.waitFor(() => expect(ctl.emit).toHaveBeenCalled());
    expect(ctl.emit).toHaveBeenLastCalledWith(expect.objectContaining({ result: { status: 'read-failed' } }));
    expect(ctl.recordHost).toHaveBeenCalled();
  });

  it('opens exact snapshots with the visible session identity for editor selections', async () => {
    const ctl = controller();
    vi.mocked(readTurnDiffContents).mockResolvedValueOnce({ status: 'ready', before: Buffer.from('before'), after: Buffer.from('after') });
    handleFileOpenTurnDiff(ctl, { type: 'file.openTurnDiff', sessionId: request.sessionId, turnId: request.turnId, path: request.path });
    await vi.waitFor(() => expect(ctl.fileDiff.openDiff).toHaveBeenCalled());
    expect(ctl.fileDiff.openDiff).toHaveBeenCalledWith('app.ts', { sessionId: 'session-now', turnId: 'turn-1' },
      { turnSnapshot: { before: 'before', after: 'after', phase: 'settled' } });
  });
});
