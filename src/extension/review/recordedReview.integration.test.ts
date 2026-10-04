import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('vscode', () => {
  const disposable = () => ({ dispose: vi.fn() });
  return { workspace: {
    createFileSystemWatcher: () => ({ dispose: vi.fn(), onDidChange: disposable, onDidCreate: disposable, onDidDelete: disposable }),
    onDidChangeTextDocument: disposable, textDocuments: [],
  } };
});
import { ReviewCoordinator } from './reviewCoordinator';
import type { RecordedOperation } from './reviewOperationScope';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import type { FileDiffOpener } from '../changes/fileDiffOpener';
import type { ReviewHostMessage } from '../../shared/protocol/reviewProtocol';
import { isReviewPanelFile } from '../../shared/protocol/reviewPanelProtocol';
import { createOperationDiffCollector } from '../../runtime/tools/operationDiff';
import { parseOperationResult } from '../../runtime/tools/operationResult';
import { enrichOperationDiff, isOperationDiff, MAX_OPERATION_CONTENT_UNITS } from '../../shared/protocol/operationDiff';
import { loadOperationReviewScope } from './reviewOperationScope';

function operation(index: number): RecordedOperation {
  return { sequence: index, sessionId: 'session', toolUseId: `edit-${index}`, toolName: 'Edit',
    operationDiff: { status: 'ready', source: 'tool-result', files: [{
      path: 'file.txt', kind: 'modified', outcome: 'applied',
      patch: `@@ -1 +1 @@\n-value ${index}\n+value ${index + 1}`,
    }] } };
}
const controllers: ReviewCoordinator[] = [];
afterEach(() => controllers.splice(0).forEach(controller => controller.dispose()));
async function open(before: string | undefined, operations: RecordedOperation[], prior: RecordedOperation[] = []) {
  const states: Extract<ReviewHostMessage, { type: 'review.state' }>[] = [];
  const openDiff = vi.fn<FileDiffOpener['openDiff']>(async () => 'opened-diff');
  const coordinator = new ReviewCoordinator({
    getWorkspaceRoot: () => 'Z:/not-read-for-recorded-review',
    snapshots: { readTreeBytes: async (_scope: unknown, _path: string, phase: string) => phase === 'before' && before !== undefined ? Buffer.from(before) : undefined } as unknown as TurnSnapshotStore,
    fileDiff: { openDiff }, persistence: { get: () => undefined, update: async () => {} },
    storageDir: 'Z:/not-written-for-recorded-review',
    publish: message => { if (message.type === 'review.state') states.push(message as Extract<ReviewHostMessage, { type: 'review.state' }>); },
    readTurnOperations: () => operations, readCanonicalTurnFiles: () => undefined,
    readPriorFileOperations: () => loadOperationReviewScope({ type: 'review.open', sessionId: 'session', scopeKind: 'operations', turnId: 'prior' }, prior, new Map()).recordedOperations ?? [],
    readWorkspaceFiles: async () => undefined, readBranchDiff: async () => undefined,
  });
  controllers.push(coordinator);
  coordinator.handle({ type: 'review.open', sessionId: 'session', scopeKind: 'operations', turnId: 'turn' });
  await coordinator.replay('session');
  const state = states.at(-1)!.state;
  return { coordinator, openDiff, request: { sessionId: 'session', reviewScopeId: state.reviewScopeId,
    baseline: state.baseline, path: 'file.txt', context: 'all' as const } };
}

describe('recorded Review host requests', () => {
  it('keeps a full Create larger than the snippet budget for later edits and history reloads', async () => {
    const content = 'value 0\n' + Array.from({ length: 1_000 }, (_, index) => `unchanged full file context ${index}`).join('\n') + '\n';
    expect(content.length).toBeGreaterThan(24_000);
    const input = { file_path: '/workspace/file.txt', content };
    const result = JSON.stringify({ success: true, file_path: input.file_path });
    const collect = createOperationDiffCollector('/workspace', 'session');
    collect({ type: 'tool_call', name: 'Create', toolUseId: 'create', input });
    const live = collect({ type: 'tool_result', toolName: 'Create', toolUseId: 'create', content: result, isError: false });
    const reloaded = enrichOperationDiff({ status: 'unavailable', reason: 'too-large' },
      parseOperationResult('create', input, result, '/workspace', 'create', 'session'));
    expect(reloaded).toEqual(live);
    expect(isOperationDiff(reloaded)).toBe(true);
    if (reloaded?.status !== 'ready') throw new Error('Complete Create evidence was dropped');
    expect(reloaded.files[0]?.submittedContent).toBe(content);
    const { coordinator, openDiff, request } = await open(undefined, [operation(0)], [{
      sequence: 0, sessionId: 'session', toolUseId: 'create', toolName: 'Create', operationDiff: reloaded,
    }]);
    const file = await coordinator.readFile(request);
    if (!('recordedOperations' in file)) throw new Error('Recorded operation missing');
    expect(file.recordedOperations?.[0]?.fullPatch).toContain(' unchanged full file context 999');
    expect(file.recordedOperations?.[0]?.fullPatch).toContain('-value 0\n+value 1');
    expect(file.recordedOperations?.[0]?.fullPatchUnavailableReason).toBeUndefined();
    expect(isReviewPanelFile({ ...file, type: 'reviewPanel.file', requestId: 'request', reviewScopeId: request.reviewScopeId,
      path: request.path, error: null })).toBe(true);
    await coordinator.openNative(request);
    expect(openDiff.mock.calls[0]?.[2]?.turnSnapshot).toMatchObject({ before: content, after: content.replace('value 0', 'value 1') });
    const createFile = { ...file, recordedOperations: [{ toolUseId: 'create', patch: '', source: 'tool-result', outcome: 'applied', submittedContent: content }] };
    expect(isReviewPanelFile({ ...createFile, type: 'reviewPanel.file', requestId: 'request', reviewScopeId: request.reviewScopeId,
      path: request.path, error: null })).toBe(true);
  });
  it('still bounds full writes and preserves the separate snippet limit', () => {
    const input = { file_path: '/workspace/file.txt', content: 'x'.repeat(MAX_OPERATION_CONTENT_UNITS + 1) };
    expect(parseOperationResult('create', input, JSON.stringify({ success: true, file_path: input.file_path }), '/workspace'))
      .toEqual({ status: 'unavailable', reason: 'too-large' });
    expect(isOperationDiff({ status: 'ready', source: 'tool-result', files: [{
      path: 'file.txt', kind: 'modified', outcome: 'applied', patch: 'x'.repeat(24_001),
    }] })).toBe(false);
  });
  it('opens the requested edit in native diff and rejects another path or missing tool ID', async () => {
    const { coordinator, openDiff, request } = await open('value 0\nunchanged\n', [operation(0), operation(1)]);
    await coordinator.openNative({ ...request, toolUseId: 'edit-0' });
    expect(openDiff).toHaveBeenLastCalledWith('file.txt', expect.anything(), expect.objectContaining({
      turnSnapshot: { before: 'value 0\nunchanged\n', after: 'value 1\nunchanged\n', phase: 'settled' },
    }));
    await coordinator.openNative({ ...request, toolUseId: 'edit-1' });
    expect(openDiff).toHaveBeenLastCalledWith('file.txt', expect.anything(), expect.objectContaining({
      turnSnapshot: { before: 'value 1\nunchanged\n', after: 'value 2\nunchanged\n', phase: 'settled' },
    }));
    await expect(coordinator.openNative({ ...request, toolUseId: 'missing' })).rejects.toThrow('no complete saved file versions');
    await expect(coordinator.openNative({ ...request, path: 'other.txt', toolUseId: 'edit-0' })).rejects.toThrow('no complete saved file versions');
    expect(openDiff).toHaveBeenCalledTimes(2);
  });
  it('serves one selected complete patch independently of all excerpt metadata', async () => {
    const unchanged = Array.from({ length: 30_000 }, (_, index) => `unchanged context ${index}`).join('\n') + '\n';
    const { coordinator, request } = await open(`value 0\n${unchanged}`, Array.from({ length: 20 }, (_, index) => operation(index)));
    const result = await coordinator.readFile({ ...request, toolUseId: 'edit-0' });
    if (!('recordedOperations' in result)) throw new Error('Recorded review payload was not returned.');
    expect(result.recordedOperations?.filter(entry => entry.fullPatch !== undefined)).toHaveLength(1);
    expect(result.recordedOperations?.[0]?.fullPatch?.includes(' unchanged context 29999')).toBe(true);
    expect(result.recordedOperations?.[0]?.fullPatch?.includes('-value 0\n+value 1')).toBe(true);
    expect(isReviewPanelFile({ ...result, type: 'reviewPanel.file', requestId: 'request', reviewScopeId: request.reviewScopeId,
      path: request.path, error: null })).toBe(true);
    await expect(coordinator.readFile({ ...request, toolUseId: 'missing' })).rejects.toThrow('selected edit is no longer available');
  });
  it('reports large previews accurately and retains the complete native version', async () => {
    const before = 'value 0\n' + '\n'.repeat(100_005);
    const { coordinator, openDiff, request } = await open(before, [operation(0)]);
    const result = await coordinator.readFile(request);
    if (!('recordedOperations' in result)) throw new Error('Recorded review payload was not returned.');
    expect(result.recordedOperations?.[0]?.fullPatch).toBeUndefined();
    expect(result.recordedOperations?.[0]?.fullPatchUnavailableReason).toBe('too-large');
    await coordinator.openNative(request);
    expect(openDiff.mock.calls[0]?.[2]?.turnSnapshot?.before.length).toBe(before.length);
    expect(openDiff.mock.calls[0]?.[2]?.turnSnapshot?.after.length).toBe(before.length);
  });
});
