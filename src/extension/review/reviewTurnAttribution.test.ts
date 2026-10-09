import { afterEach, expect, it, vi } from 'vitest';
import type { ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { summarizeOperations } from '../../webview-v2/chat/operationSummary';
import { ReviewCoordinator } from './reviewCoordinator';
import type { RecordedOperation } from './reviewOperationScope';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import { readNativeReviewDiff, readReviewPatch, reviewFileVersion } from './reviewContent';
import { loadTurnReviewScope } from './reviewTurnScope';

vi.mock('vscode', () => ({ workspace: {
  createFileSystemWatcher: () => ({ dispose() {}, onDidChange: () => ({ dispose() {} }),
    onDidCreate: () => ({ dispose() {} }), onDidDelete: () => ({ dispose() {} }) }),
  onDidChangeTextDocument: () => ({ dispose() {} }), textDocuments: [],
} }));
const coordinators: ReviewCoordinator[] = [];
afterEach(() => coordinators.splice(0).forEach(coordinator => coordinator.dispose()));
const edit = (path: string, outcome: 'applied' | 'failed' = 'applied'): RecordedOperation => ({
  sequence: 1, sessionId: 'session', toolUseId: path, toolName: 'Edit',
  operationDiff: { status: 'ready', source: 'tool-result', files: [{
    path, outcome, kind: 'modified', patch: '@@ -2 +2 @@\n-before\n+after',
  }] },
});

it.each(['live', 'settled', 'missing snapshots'] as const)('keeps SDK excerpts readable with unavailable file bodies: %s', async phase => {
  const operations = [edit('.cursor/skills/mcp.json')];
  const source = {
    snapshots: { read: () => phase === 'missing snapshots' ? undefined : {
      before: 'before-tree', ...(phase === 'settled' ? { after: 'after-tree' } : {}), files: [],
    }, readTreeBytes: async () => undefined } as unknown as TurnSnapshotStore,
    getWorkspaceRoot: () => 'Z:/missing-review-workspace',
    readTurnOperations: () => operations, readCanonicalTurnFiles: () => [], isTurnWriting: () => phase === 'live',
  };
  const scope = loadTurnReviewScope(source, new Map(), null, 'session', 'turn');
  expect(scope.files.map(file => file.path)).toEqual(['.cursor/skills/mcp.json']);
  expect(scope.files[0]).toMatchObject({ additions: null, deletions: null, comparable: true, restorable: false });
  const preview = await readReviewPatch(source, scope, '.cursor/skills/mcp.json', 'all');
  expect(preview.patch).toBe('');
  expect(preview.recordedOperations).toEqual([expect.objectContaining({ patch: '@@ -2 +2 @@\n-before\n+after',
    fullPatchUnavailableReason: 'unavailable' })]);
  expect(preview.recordedOperations![0]!.fullPatch).toBeUndefined();
  expect(await reviewFileVersion(source, scope, '.cursor/skills/mcp.json', true)).toBe(preview.version);
  await expect(readNativeReviewDiff(source, scope, '.cursor/skills/mcp.json')).rejects.toThrow('no complete saved file versions');
});

it('does not hide snapshot read failures behind SDK excerpts', async () => {
  const source = {
    snapshots: { read: () => ({ before: 'before-tree', after: 'after-tree', files: [] }),
      readTreeBytes: async () => { throw new Error('Snapshot disk read failed'); } } as unknown as TurnSnapshotStore,
    getWorkspaceRoot: () => 'Z:/missing-review-workspace',
    readTurnOperations: () => [edit('app.ts')], readCanonicalTurnFiles: () => [],
  };
  const scope = loadTurnReviewScope(source, new Map(), null, 'session', 'turn');
  await expect(readReviewPatch(source, scope, 'app.ts', 3)).rejects.toThrow('Snapshot disk read failed');
});

it('keeps SDK-attributed files and full context through live refresh, settlement and reopening', async () => {
  const pending: RecordedOperation = { ...edit('pending.ts'), operationDiff: { status: 'ready', source: 'tool-input',
    files: [{ path: 'pending.ts', kind: 'modified', patch: '@@ -1 +1 @@\n-old\n+new' }] } };
  let operations = [edit('app.ts'), edit('failed.ts', 'failed'), pending];
  let writing = true;
  const bodies = { before: Buffer.from('unchanged header\nbefore\nunchanged footer\n'),
    after: Buffer.from('unchanged header\nafter\nunchanged footer\n') };
  const read = vi.fn(async (_scope: unknown, _path: string, phase: 'before' | 'after') => bodies[phase]);
  const rows = ['.cursor/skills/mcp.json', 'pnpm-lock.yaml', 'app.ts', 'second.ts', 'failed.ts', 'pending.ts']
    .map(path => ({ path, additions: 1, deletions: 1 }));
  const snapshots = { read: () => ({ before: 'before-tree', ...(writing ? {} : { after: 'after-tree' }), files: rows }),
    readTreeBytes: read } as unknown as TurnSnapshotStore;
  const storage = new Map<string, unknown>();
  let state: ReviewScopeState;
  const setup = () => {
    const coordinator = new ReviewCoordinator({ snapshots, getWorkspaceRoot: () => 'Z:/missing-review-workspace',
      fileDiff: { openDiff: async () => 'opened-diff' }, openSelectionInEditor: false, storageDir: '',
      persistence: { get: <T>(key: string) => storage.get(key) as T | undefined, update: async (key, value) => { storage.set(key, value); } },
      publish: message => { if (message.type === 'review.state') state = message.state; },
      isTurnWriting: () => writing, readTurnOperations: () => operations, readCanonicalTurnFiles: () => rows,
      readWorkspaceFiles: async () => undefined, readBranchDiff: async () => undefined,
    });
    coordinators.push(coordinator);
    return coordinator;
  };
  const coordinator = setup();
  coordinator.openWritingTurn('session', 'turn', rows);
  await coordinator.replay('session');
  expect(state!.files.map(file => file.path)).toEqual(['app.ts']);
  expect(state!.files.every(file => !file.restorable)).toBe(true);
  coordinator.refreshWritingTurn('session', 'turn', rows);
  operations = [...operations, edit('second.ts')];
  coordinator.refreshOperationsTurn('session', 'turn');
  await coordinator.replay('session');
  const transcript = operations.map(operation => ({ kind: 'tool', turnId: 'turn', toolUseId: operation.toolUseId,
    operationDiff: operation.operationDiff } as ToolTranscriptItem));
  const expected = [...summarizeOperations(transcript).get('turn')!.files.keys()];
  expect(state!.files.map(file => file.path)).toEqual(expected);
  writing = false;
  await coordinator.settleWritingTurn('session', 'turn', rows);
  await coordinator.replay('session');
  expect(state!.files.map(file => file.path)).toEqual(['app.ts', 'second.ts']);
  const content = await coordinator.readFile({ sessionId: 'session', reviewScopeId: state!.reviewScopeId,
    baseline: state!.baseline, path: 'app.ts', context: 'all' });
  expect(content.patch).toContain(' unchanged header');
  expect(content.patch).toContain('-before\n+after');
  expect(content.patch).toContain(' unchanged footer');
  await expect(coordinator.openNative({ sessionId: 'session', reviewScopeId: state!.reviewScopeId,
    baseline: state!.baseline, path: 'app.ts' })).resolves.toBe('opened-diff');
  await expect(coordinator.openNative({ sessionId: 'session', reviewScopeId: state!.reviewScopeId,
    baseline: state!.baseline, path: '.cursor/skills/mcp.json' })).rejects.toThrow('Review file is no longer available');
  expect(read.mock.calls.every(([, path]) => path === 'app.ts')).toBe(true);
  const reopened = setup();
  reopened.handle({ type: 'review.open', sessionId: 'session', scopeKind: 'turn', turnId: 'turn' });
  await reopened.replay('session');
  expect(state!.files.map(file => file.path)).toEqual(expected);
});
