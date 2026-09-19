import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readInlineDiff, MAX_INLINE_DIFF_FILE_BYTES } from './inlineDiff';
import type { TurnSnapshotStore } from './turnSnapshots';
import { MAX_INLINE_DIFF_LINES, MAX_INLINE_DIFF_PATCH_LENGTH } from '../../shared/protocol/inlineDiffProtocol';

const scope = { sessionId: 'session-1', turnId: 'turn-1' };
let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'dvx-inline-test-')); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
function snapshots(before: Buffer | null | undefined, after: Buffer | null | undefined) {
  const readTreeBytes = vi.fn(async (_scope: unknown, _path: string, phase: string) => phase === 'before' ? before : after);
  return { store: { readTreeBytes } as unknown as TurnSnapshotStore, readTreeBytes };
}

describe('turn inline diff contents', () => {
  it('uses frozen before/after snapshots for settled turns despite later workspace edits', async () => {
    await writeFile(join(directory, 'app.ts'), 'unrelated later edit\n');
    const { store, readTreeBytes } = snapshots(Buffer.from('old\ncontext\n'), Buffer.from('new\ncontext\n'));
    const result = await readInlineDiff(store, scope, directory, 'app.ts', 'settled');
    expect(result).toEqual({
      status: 'ready', phase: 'settled', truncated: false,
      patch: '@@ -1,2 +1,2 @@\n-old\n+new\n context',
    });
    expect(readTreeBytes.mock.calls).toEqual([[scope, 'app.ts', 'before'], [scope, 'app.ts', 'after']]);
  });

  it('compares a live turn against the current file, including changes with unchanged counts', async () => {
    const { store } = snapshots(Buffer.from('before\n'), Buffer.from('stale\n'));
    await writeFile(join(directory, 'app.ts'), 'first\n');
    expect(await readInlineDiff(store, scope, directory, 'app.ts', 'live')).toMatchObject({ phase: 'live', patch: '@@ -1 +1 @@\n-before\n+first' });
    await writeFile(join(directory, 'app.ts'), 'second\n');
    expect(await readInlineDiff(store, scope, directory, 'app.ts', 'live')).toMatchObject({ patch: '@@ -1 +1 @@\n-before\n+second' });
  });

  it.each([
    [null, 'added\n', '@@ -0,0 +1 @@\n+added'],
    ['removed\n', null, '@@ -1 +0,0 @@\n-removed'],
    ['same\n', 'same\n', ''],
  ])('handles created, deleted and unchanged files (%s → %s)', async (before, after, patch) => {
    const { store } = snapshots(before === null ? null : Buffer.from(before!), after === null ? null : Buffer.from(after!));
    expect(await readInlineDiff(store, scope, directory, 'app.ts', 'settled')).toMatchObject({ status: 'ready', patch, truncated: false });
  });

  it('retains CRLF and missing-final-newline information', async () => {
    const { store } = snapshots(Buffer.from('old\r\n'), Buffer.from('new'));
    const result = await readInlineDiff(store, scope, directory, 'app.ts', 'settled');
    expect(result).toMatchObject({ status: 'ready' });
    if (result.status !== 'ready') return;
    expect(result.patch).toContain('-old\r');
    expect(result.patch).toContain('+new\n\\ No newline at end of file');
  });

  it('reports missing snapshots instead of substituting HEAD or an empty baseline', async () => {
    for (const [before, after] of [[undefined, Buffer.from('a')], [Buffer.from('a'), undefined], [null, null]]) {
      const { store } = snapshots(before, after);
      expect(await readInlineDiff(store, scope, directory, 'app.ts', 'settled')).toEqual({ status: 'unavailable' });
    }
  });

  it('bounds binary, non-UTF-8 and oversized file reads', async () => {
    for (const bytes of [Buffer.from([0, 1]), Buffer.from([0xff])]) {
      expect(await readInlineDiff(snapshots(null, bytes).store, scope, directory, 'app.ts', 'settled')).toEqual({ status: 'binary' });
    }
    const huge = Buffer.alloc(MAX_INLINE_DIFF_FILE_BYTES + 1, 'x');
    expect(await readInlineDiff(snapshots(null, huge).store, scope, directory, 'app.ts', 'settled')).toEqual({ status: 'too-large' });
    await writeFile(join(directory, 'app.ts'), huge);
    expect(await readInlineDiff(snapshots(null, null).store, scope, directory, 'app.ts', 'live')).toEqual({ status: 'too-large' });
  });

  it('truncates preview output on complete lines without claiming there are no changes', async () => {
    for (const text of ['line\n'.repeat(1000), 'x'.repeat(MAX_INLINE_DIFF_PATCH_LENGTH + 1)]) {
      const result = await readInlineDiff(snapshots(null, Buffer.from(text)).store, scope, directory, 'app.ts', 'settled');
      expect(result).toMatchObject({ status: 'ready', truncated: true });
      if (result.status !== 'ready') continue;
      expect(result.patch.length).toBeLessThanOrEqual(MAX_INLINE_DIFF_PATCH_LENGTH);
      expect(result.patch.split('\n').length).toBeLessThanOrEqual(MAX_INLINE_DIFF_LINES);
      expect(result.patch).toContain('@@ ');
    }
  });

  it('does not follow workspace links to files outside the workspace', async () => {
    await mkdir(join(directory, 'workspace'));
    await mkdir(join(directory, 'outside'));
    await writeFile(join(directory, 'outside', 'secret'), 'private');
    await symlink(join(directory, 'outside'), join(directory, 'workspace', 'linked'), 'junction');
    expect(await readInlineDiff(snapshots(null, null).store, scope, join(directory, 'workspace'), 'linked/secret', 'live')).toEqual({ status: 'unavailable' });
  });
});
