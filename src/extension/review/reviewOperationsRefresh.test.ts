import { afterEach, expect, it, vi } from 'vitest';
import { MAX_REVIEW_UNDO_FILES, parseReviewHostMessage, type ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import { ReviewCoordinator } from './reviewCoordinator';
import { createActiveScope } from './reviewCoordinatorSupport';
import type { RecordedOperation } from './reviewOperationScope';
import { applyOperationUndo } from './operationUndoFiles';

vi.mock('vscode', () => {
  const disposable = () => ({ dispose() {} });
  return { workspace: {
    createFileSystemWatcher: () => ({ dispose() {}, onDidChange: disposable, onDidCreate: disposable, onDidDelete: disposable }),
    onDidChangeTextDocument: disposable, textDocuments: [],
  } };
});
const coordinators: ReviewCoordinator[] = [];
afterEach(() => coordinators.splice(0).forEach((coordinator) => coordinator.dispose()));
const open = { type: 'review.open', sessionId: 'session', scopeKind: 'operations', turnId: 'turn' } as const;
const operations = (count: number): RecordedOperation[] => Array.from({ length: count }, (_, index) => ({
  sequence: index, sessionId: 'session', toolUseId: `edit-${index}`, toolName: 'ApplyPatch',
  operationDiff: { status: 'ready', source: 'tool-result', files: [{
    path: `file-${index}.txt`, kind: 'modified', outcome: 'applied', reversible: true,
    patch: '@@ -1 +1 @@\n-old\n+new',
  }] },
}));

async function setup(count = 2) {
  let entries = operations(count);
  const states: ReviewScopeState[] = [];
  const publish = vi.fn((message) => { if (message.type === 'review.state') states.push(message.state); });
  const update = vi.fn<() => Promise<void>>(async () => {});
  const read = vi.fn(() => entries);
  const coordinator = new ReviewCoordinator({
    getWorkspaceRoot: () => undefined,
    snapshots: {} as TurnSnapshotStore,
    fileDiff: { openDiff: async () => 'opened-diff' }, openSelectionInEditor: false,
    persistence: { get: <T>() => undefined as T | undefined, update }, storageDir: '', publish,
    readTurnOperations: read, readCanonicalTurnFiles: () => undefined,
    readWorkspaceFiles: async () => undefined, readBranchDiff: async () => undefined,
  });
  coordinators.push(coordinator);
  coordinator.handle(open);
  await coordinator.replay('session');
  read.mockClear(); update.mockClear(); publish.mockClear(); states.length = 0;
  return { coordinator, states, publish, update, read, setEntries: (count: number) => { entries = operations(count); } };
}

it('coalesces a burst of operation invalidations into one latest-evidence refresh', async () => {
  const fixture = await setup();
  fixture.setEntries(3);
  for (let index = 0; index < 100; index += 1) fixture.coordinator.refreshOperationsTurn('session', 'turn');
  await fixture.coordinator.replay('session');
  expect(fixture.read).toHaveBeenCalledTimes(1);
  expect(fixture.update).toHaveBeenCalledTimes(1);
  expect(fixture.states.at(-1)?.files).toHaveLength(3);
});

it('queues evidence arriving during a refresh behind an already requested file selection', async () => {
  const fixture = await setup();
  let release!: () => void, started!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  const refreshing = new Promise<void>((resolve) => { started = resolve; });
  fixture.update.mockImplementationOnce(() => { started(); return blocked; });
  fixture.coordinator.refreshOperationsTurn('session', 'turn');
  await refreshing;
  const state = fixture.states.at(-1)!;
  fixture.coordinator.handle({ type: 'review.selectFile', sessionId: 'session',
    reviewScopeId: state.reviewScopeId, baseline: state.baseline, path: 'file-1.txt' });
  fixture.setEntries(3);
  for (let index = 0; index < 100; index += 1) fixture.coordinator.refreshOperationsTurn('session', 'turn');
  release();
  await fixture.coordinator.replay('session');
  expect(fixture.read).toHaveBeenCalledTimes(2);
  expect(fixture.states.some((entry) => entry.files.length === 2 && entry.currentIndex === 1)).toBe(true);
  expect(fixture.states.at(-1)).toMatchObject({ currentIndex: 1, files: expect.any(Array) });
  expect(fixture.states.at(-1)?.files).toHaveLength(3);
});

it('delivers and selects the 201st file while rejecting an oversized whole-turn undo explicitly', async () => {
  const fixture = await setup(201);
  await fixture.coordinator.replay('session');
  const state = fixture.states.at(-1)!;
  expect(state.files).toHaveLength(201);
  expect(parseReviewHostMessage({ type: 'review.state', sequence: 1, state })).toBeDefined();
  fixture.coordinator.handle({ type: 'review.selectFile', sessionId: 'session', reviewScopeId: state.reviewScopeId,
    baseline: state.baseline, path: 'file-200.txt' });
  await fixture.coordinator.replay('session');
  expect(fixture.states.at(-1)?.currentIndex).toBe(200);
  const file = await fixture.coordinator.readFile({ sessionId: 'session', reviewScopeId: state.reviewScopeId,
    baseline: state.baseline, path: 'file-200.txt', context: 3 });
  expect('recordedOperations' in file).toBe(true);
  if (!('recordedOperations' in file)) throw new Error('Recorded operation details were omitted.');
  expect(file.recordedOperations[0]?.toolUseId).toBe('edit-200');
  fixture.coordinator.handle({ type: 'review.restorePreview', sessionId: 'session', reviewScopeId: state.reviewScopeId,
    baseline: state.baseline, target: 'turn' });
  await fixture.coordinator.replay('session');
  expect(fixture.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'review.operationResult', ok: false,
    message: expect.stringContaining(`up to ${MAX_REVIEW_UNDO_FILES} files`) }));
  expect(fixture.publish.mock.calls.some(([message]) => message.type === 'review.restorePreview')).toBe(false);
  const scope = createActiveScope({ ...open, scopeKind: 'workspace' }, 'HEAD', 'Workspace',
    state.files, new Map());
  expect(scope.files).toHaveLength(201);
});

it('rejects oversized undo before writing any file or recovery journal', async () => {
  const entries = Array.from({ length: MAX_REVIEW_UNDO_FILES + 1 }, (_, index) => ({
    path: `file-${index}.txt`, before: Buffer.from('old'), after: Buffer.from('old'),
    current: Buffer.from('new'), status: 'restorable' as const,
  }));
  expect(await applyOperationUndo('', '', entries, () => true)).toEqual({
    complete: false, written: 0,
    reason: `Automatic undo supports up to ${MAX_REVIEW_UNDO_FILES} files at a time.`,
  });
});
