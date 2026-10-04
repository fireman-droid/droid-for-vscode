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

describe('saved ApplyPatch context recovery', () => {
  const baseline = 'header\nbefore\nfooter\n\nend\n';
  const updated = 'header\nafter\nfooter\n\nend\n';
  const trimmed = {
    ...edit('trimmed', '@@ -2,3 +2,3 @@\n-before\n+after\n footer'),
    toolName: 'ApplyPatch', reversible: false,
    message: 'The tool reported this file as changed, but its diff line counts are inconsistent.',
  };

  it('recovers persisted trimmed context only when the saved complete after image agrees', async () => {
    const input = source(baseline.replace(/\n/g, '\r\n'), updated.replace(/\n/g, '\r\n'));
    expect(await recordedFileVersion(input, scope(), path, [trimmed]))
      .toEqual({ index: 0, before: baseline, after: updated });
    const result = await recordedFileDiffs(input, scope(), path, [trimmed], 512_000, 1);
    expect(result.patches.get(0)).toContain(' header');
    expect(result.patches.get(0)).toContain(' end');
    expect(result.patches.get(0)).toContain('-before\n+after');
  });

  it.each(['writing', 'settled'] as const)('requires an after image when the turn is %s', async lifecycle => {
    expect(await recordedFileVersion(source(baseline), scope(lifecycle), path, [trimmed])).toBeUndefined();
  });

  it('does not verify recovered context against an after image while the turn is still writing', async () => {
    expect(await recordedFileVersion(source(baseline, updated), scope('writing'), path, [trimmed])).toBeUndefined();
  });

  it('rejects a missing edit even if its missing old line was blank', async () => {
    const unrecordedChange = updated.replace('footer\n\n', 'footer\nmissing new content\n');
    expect(await recordedFileVersion(source(baseline, unrecordedChange), scope(), path, [trimmed])).toBeUndefined();
  });

  it('does not invent missing nonblank context or removal lines', async () => {
    const missing = { ...trimmed, patch: '@@ -2,2 +2,2 @@\n-before\n+after' };
    expect(await recordedFileVersion(source(baseline, updated), scope(), path, [missing])).toBeUndefined();
  });

  it('requires every recorded context line to match the saved baseline', async () => {
    const mismatch = { ...trimmed, patch: trimmed.patch.replace(' footer', ' not-footer') };
    expect(await recordedFileVersion(source(baseline, updated), scope(), path, [mismatch])).toBeUndefined();
  });

  it('does not treat another tool as a trimmed ApplyPatch result', async () => {
    expect(await recordedFileVersion(source(baseline, updated), scope(), path, [{ ...trimmed, toolName: 'Edit' }]))
      .toBeUndefined();
  });

  it('rejects a recovered selected version if a later gap breaks after-image verification', async () => {
    const gap = { ...edit('unknown'), outcome: 'failed' as const, patch: '' };
    const write = { ...edit('write'), submittedContent: updated, patch: '' };
    expect(await recordedFileVersion(source(baseline, updated), scope(), path, [trimmed, gap, write], 'trimmed'))
      .toBeUndefined();
  });

  it.each(['write', 'delete'] as const)('starts a new trusted baseline after a full %s without validating overwritten recovery', async operation => {
    const replacement = operation === 'write'
      ? { ...edit('overwrite'), submittedContent: 'fresh\n', patch: '' }
      : { ...edit('overwrite'), kind: 'deleted' as const, patch: '' };
    const next = operation === 'write'
      ? edit('next', '@@ -1 +1 @@\n-fresh\n+final')
      : { ...edit('next', '@@ -0,0 +1,1 @@\n+final'), kind: 'added' as const };
    const entries = [trimmed, replacement, next];
    const input = source(baseline, 'final\n');
    expect(await recordedFileVersion(input, scope(), path, entries, 'trimmed')).toBeUndefined();
    expect(await recordedFileVersion(input, scope(), path, entries, 'overwrite')).toBeUndefined();
    expect(await recordedFileVersion(input, scope(), path, entries, 'next'))
      .toEqual({ index: 2, before: operation === 'write' ? 'fresh\n' : '', after: 'final\n' });
  });

  it('verifies recovery through later exact edits for either selected version', async () => {
    const final = updated.replace('after\n', 'final\n');
    const next = edit('next', '@@ -2 +2 @@\n-after\n+final');
    expect(await recordedFileVersion(source(baseline, final), scope(), path, [trimmed, next], 'trimmed'))
      .toEqual({ index: 0, before: baseline, after: updated });
    expect(await recordedFileVersion(source(baseline, final), scope(), path, [trimmed, next], 'next'))
      .toEqual({ index: 1, before: updated, after: final });
  });

  it('keeps an earlier exact version when later recovered context cannot be verified', async () => {
    const exact = edit('exact', '@@ -1 +1 @@\n-header\n+title');
    const next = baseline.replace('header\n', 'title\n');
    expect(await recordedFileVersion(source(baseline), scope(), path, [exact, trimmed], 'exact'))
      .toEqual({ index: 0, before: baseline, after: next });
  });

  it('recovers only the final hunk and preserves earlier insertions and removals', async () => {
    const original = 'header\nbefore\nkeep\nremove\nfooter\n\nend\n';
    const result = 'header\nafter\nadded\nkeep\nfooter\n\nend\n';
    const entry = { ...trimmed, patch:
      '@@ -2,1 +2,2 @@\n-before\n+after\n+added\n@@ -4,3 +5,2 @@\n-remove\n footer' };
    expect(await recordedFileVersion(source(original, result), scope(), path, [entry]))
      .toEqual({ index: 0, before: original, after: result });
    const earlierTruncation = { ...entry, patch: entry.patch.replace('@@ -2,1 +2,2 @@', '@@ -2,2 +2,3 @@') };
    expect(await recordedFileVersion(source(original, result), scope(), path, [earlierTruncation])).toBeUndefined();
  });

  it.each([
    { kind: 'added' as const, before: '', after: 'new\n', patch: '@@ -0,0 +1,1 @@\n+new' },
    { kind: 'deleted' as const, before: 'old\n', after: '', patch: '@@ -1,1 +0,0 @@\n-old' },
    { kind: 'modified' as const, before: 'old\nkeep\n', after: 'new\nadded\n',
      patch: '@@ -1 +1,2 @@\n-old\n+new\n+added\n@@ -2 +2,0 @@\n-keep' },
  ])('keeps exact $kind patches usable without an after snapshot', async sample => {
    expect(await recordedFileVersion(source(sample.before), scope(), path, [{ ...trimmed, kind: sample.kind, patch: sample.patch }]))
      .toEqual({ index: 0, before: sample.before, after: sample.after });
  });
});
