import { describe, expect, it, vi } from 'vitest';
import type { TurnSnapshotStore } from '../changes/turnSnapshots';
import type { ActiveScope } from './reviewCoordinatorSupport';
import type { ReviewContentSource } from './reviewContent';
import { recordedFileDiffs, recordedFileVersion } from './recordedFileDiffs';
import { priorFileOperations } from './recordedFileHistory';
import type { ToolTranscriptItem } from '../../shared/protocol/toolProtocol';

const path = 'racing.html';
const before = 'header\nbefore\nfooter\n';
const after = 'header\nafter\nfooter\n';
type Entry = NonNullable<ActiveScope['recordedOperations']>[number];
const edit = (toolUseId = 'edit', patch = '@@ -2 +2 @@\n-before\n+after'): Entry => ({
  sequence: 1, sessionId: 'session', toolUseId, toolName: 'Edit', source: 'tool-result',
  kind: 'modified', outcome: 'applied', path, patch,
});
const scope = (lifecycle: ActiveScope['lifecycle'] = 'settled'): ActiveScope => ({
  sessionId: 'session', turnId: 'turn', reviewScopeId: 'scope', scopeKind: 'operations',
  baseline: 'baseline', baselineLabel: 'Recorded edits', lifecycle, files: [], currentIndex: 0, reviewed: new Map(),
});
function source(baseline: string | null = before, end?: string): ReviewContentSource {
  return { getWorkspaceRoot: () => '/workspace', snapshots: {
    readTreeBytes: vi.fn(async (_scope: unknown, _path: string, phase: 'before' | 'after') => {
      const text = phase === 'before' ? baseline : end;
      return text == null ? undefined : Buffer.from(text);
    }),
  } as unknown as TurnSnapshotStore };
}
function tool(entry: Entry, turnId: string): ToolTranscriptItem {
  return { id: entry.toolUseId, kind: 'tool', turnId, toolUseId: entry.toolUseId,
    toolName: entry.toolName, action: '', status: 'completed', progressCount: 0, latestUpdateKind: null,
    operationDiff: { status: 'ready', source: entry.source, sourceSessionId: entry.sessionId, files: [{
      path, kind: entry.kind, patch: entry.patch, outcome: entry.outcome,
      ...(entry.submittedContent === undefined ? {} : { submittedContent: entry.submittedContent }),
    }] } };
}

describe('complete recorded edit versions', () => {
  it('uses a saved before image without requiring an after capture', async () => {
    expect(await recordedFileVersion(source(), scope(), path, [edit()])).toEqual({ index: 0, before, after });
  });
  it('retains completed edits while a later proposal is running', async () => {
    const pending = { ...edit('pending'), source: 'tool-input' as const, outcome: undefined };
    expect(await recordedFileVersion(source(), scope('writing'), path, [edit(), pending]))
      .toEqual({ index: 0, before, after });
    expect(await recordedFileVersion(source(), scope('writing'), path, [edit(), pending], 'pending')).toBeUndefined();
  });
  it('rejects a mismatched edit without discarding the earlier reconstructed edit', async () => {
    const entries = [edit(), edit('mismatch', '@@ -2 +2 @@\n-not-the-file\n+next')];
    expect(await recordedFileVersion(source(), scope(), path, entries, 'mismatch')).toBeUndefined();
    expect(await recordedFileVersion(source(), scope(), path, entries, 'edit')).toEqual({ index: 0, before, after });
  });
  it('rejects a complete recorded chain disproved by the settled snapshot', async () => {
    expect(await recordedFileVersion(source(before, 'header\nafter\nunrecorded\n'), scope(), path, [edit()])).toBeUndefined();
  });
  it('does not assume a failed write left the file unchanged', async () => {
    const failure: Entry = { ...edit('failed'), outcome: 'failed', patch: '' };
    const last = edit('last', '@@ -2 +2 @@\n-after\n+final');
    const entries = [edit(), failure, last];
    expect(await recordedFileVersion(source(), scope(), path, entries, 'edit')).toEqual({ index: 0, before, after });
    expect(await recordedFileVersion(source(), scope(), path, entries, 'last')).toBeUndefined();
    expect(await recordedFileVersion(source(), scope(), path, [edit(), { ...failure, executionPhase: 'settled_without_execution' }, last], 'last'))
      .toEqual({ index: 2, before: after, after: 'header\nfinal\nfooter\n' });
  });
  it('never substitutes an after snapshot for a missing before version', async () => {
    expect(await recordedFileVersion(source(null, after), scope(), path, [edit()])).toBeUndefined();
  });
  it('reconstructs an edit from a successful full write in an earlier turn', async () => {
    const create: Entry = { ...edit('create'), kind: 'added', patch: '', submittedContent: before };
    const previous = edit('previous', '@@ -1 +1 @@\n-header\n+title');
    const entries = [tool(create, 'earlier'), tool(previous, 'earlier'), tool(edit(), 'turn')];
    const history = priorFileOperations(entries, 'session', 'turn', path);
    const input = source(null);
    expect(await recordedFileVersion({ ...input, readPriorFileOperations: () => history }, scope(), path, [edit()]))
      .toEqual({ index: 0, before: 'title\nbefore\nfooter\n', after: 'title\nafter\nfooter\n' });
  });
  it('does not bridge a missing write result or use another session as baseline', async () => {
    const create: Entry = { ...edit('create'), kind: 'added', patch: '', submittedContent: before };
    const unknown: ToolTranscriptItem = { ...tool(edit('unknown'), 'earlier'), operationDiff: { status: 'unavailable', reason: 'not-recorded' } };
    const history = priorFileOperations([tool(create, 'earlier'), unknown, tool(edit(), 'turn')], 'session', 'turn', path);
    expect(await recordedFileVersion({ ...source(null), readPriorFileOperations: () => history }, scope(), path, [edit()])).toBeUndefined();
    expect(await recordedFileVersion({ ...source(null), readPriorFileOperations: () => [{ ...create, sessionId: 'other' }] }, scope(), path, [edit()])).toBeUndefined();
    expect(await recordedFileVersion({ ...source(null), readPriorFileOperations: () => [{ ...create, sessionId: 'other' }, create] }, scope(), path, [edit()]))
      .toEqual({ index: 0, before, after });
  });
  it('returns only the selected edit with all context beyond the old 10000-line limit', async () => {
    const tail = Array.from({ length: 12_000 }, (_, index) => `line ${index}`).join('\n') + '\n';
    const entries = [edit(), edit('second', '@@ -2 +2 @@\n-after\n+final')];
    const { patches } = await recordedFileDiffs(source(before + tail), scope(), path, entries, 2 * 1024 * 1024, 2, 'edit');
    expect([...patches.keys()]).toEqual([0]);
    expect(patches.get(0)).toContain(' line 11999');
    expect(patches.get(0)).toContain('-before\n+after');
  });
});
