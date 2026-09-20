import { expect, it } from 'vitest';
import type { OperationDiff, OperationDiffFile } from '../../shared/protocol/operationDiff';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';
import { summarizeOperations } from './operationSummary';

const file: OperationDiffFile = { path: 'src/shared.ts', kind: 'modified', outcome: 'applied', patch: '@@ -1 +1 @@\n-original\n+first' };
function operation(callId: string, files: readonly OperationDiffFile[], overrides: Partial<ToolTranscriptItem> = {}): ToolTranscriptItem {
  return { kind: 'tool', id: `row-${callId}`, turnId: 'turn-1', toolUseId: callId, toolName: 'Edit', action: 'Edit file',
    status: 'completed', progressCount: 0, latestUpdateKind: null,
    operationDiff: { status: 'ready', source: 'tool-result', sourceSessionId: 'session-1', callId, files }, ...overrides };
}

it('deduplicates replayed calls while accumulating separate edits to one file', () => {
  const first = operation('call-1', [file]);
  const secondFile = { ...file, patch: '@@ -1 +1,2 @@\n-first\n+second\n+extra' };
  const summary = summarizeOperations([first, { ...first, id: 'replayed-row' }, operation('call-2', [secondFile])]).get('turn-1')!;
  expect(summary.files.size).toBe(1);
  expect(summary.calls.size).toBe(2);
  expect(summary.files.get(file.path)).toEqual({ path: file.path, kind: 'modified', additions: 3, deletions: 2, records: [file, secondFile] });
});

it('keeps call identities separate across sessions and turns', () => {
  const first = operation('call-1', [file]);
  const otherSession: OperationDiff = { status: 'ready', source: 'tool-result', sourceSessionId: 'session-2', callId: 'call-1', files: [file] };
  const summaries = summarizeOperations([first, { ...first, id: 'other-session', operationDiff: otherSession }, { ...first, id: 'next-turn', turnId: 'turn-2' }]);
  expect(summaries.size).toBe(2);
  expect(summaries.get('turn-1')?.files.get(file.path)?.records).toHaveLength(2);
  expect(summaries.get('turn-2')?.files.get(file.path)?.records).toHaveLength(1);
});

it('excludes unchanged and unconfirmed files and keeps unknown line totals unknown', () => {
  const unchanged = { ...file, path: 'unchanged.ts', patch: '@@ -1 +1 @@\n-same\n+same' };
  const missing = { ...file, patch: '' };
  const proposed: OperationDiff = { status: 'ready', source: 'tool-input', files: [file] };
  const summary = summarizeOperations([
    operation('confirmed', [file, unchanged, { ...file, path: 'failed.ts', outcome: 'failed' }, { ...file, path: 'uncertain.ts', outcome: 'uncertain' }]),
    operation('missing-patch', [missing]), operation('proposed', [file], { operationDiff: proposed }),
    operation('unchanged-call', [unchanged]),
  ]).get('turn-1')!;
  expect([...summary.files.keys()]).toEqual([file.path]);
  expect(summary.unconfirmed).toBe(2);
  expect(summary.calls.size).toBe(2);
  expect(summary.files.get(file.path)).toMatchObject({ additions: null, deletions: null, records: [file, missing] });
});
