import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_CHANGED_FILES_PER_TURN } from '../../shared/protocol/bounds';
import { type ChangedFileSummary } from '../../shared/protocol/transcript';
import type { FileChangeStat } from './changeStats';
import { createTurnChangesLedger } from './turnChangesLedger';

type ReadFn = (paths: readonly string[]) => Promise<ReadonlyMap<string, FileChangeStat>>;

function deferredReader(): {
  read: ReadFn & ReturnType<typeof vi.fn<ReadFn>>;
  resolveNext: (stats: ReadonlyMap<string, FileChangeStat>) => void;
} {
  const resolvers: Array<(stats: ReadonlyMap<string, FileChangeStat>) => void> = [];
  const read = vi.fn<ReadFn>(
    () =>
      new Promise<ReadonlyMap<string, FileChangeStat>>((resolve) => {
        resolvers.push(resolve);
      }),
  );
  return {
    read,
    resolveNext: (stats) => {
      const resolve = resolvers.shift();
      if (resolve === undefined) {
        throw new Error('no pending read');
      }
      resolve(stats);
    },
  };
}

describe('createTurnChangesLedger', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('publishes a new row immediately and its counts after the debounce', async () => {
    const read = vi.fn(
      async (): Promise<ReadonlyMap<string, FileChangeStat>> =>
        new Map([['src/app.ts', { additions: 3, deletions: 1 }]]),
    );
    const publish = vi.fn();
    const ledger = createTurnChangesLedger({
      reader: { read },
      scope: { sessionId: 'session-a', turnId: 'turn-a' },
      publish,
    });

    ledger.recordPaths(['src/app.ts']);
    // The row appears at once, before any git read.
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith([
      { path: 'src/app.ts', additions: null, deletions: null },
    ]);
    expect(read).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(['src/app.ts'], {
      sessionId: 'session-a',
      turnId: 'turn-a',
    });
    expect(publish).toHaveBeenLastCalledWith([
      { path: 'src/app.ts', additions: 3, deletions: 1 },
    ]);
  });

  it('debounces repeated edits per file into one trailing read', async () => {
    const read = vi.fn(
      async (): Promise<ReadonlyMap<string, FileChangeStat>> =>
        new Map([['src/app.ts', { additions: 9, deletions: 2 }]]),
    );
    const publish = vi.fn();
    const ledger = createTurnChangesLedger({
      reader: { read },
      scope: { sessionId: 'session-a', turnId: 'turn-a' },
      publish,
    });

    ledger.recordPaths(['src/app.ts']);
    await vi.advanceTimersByTimeAsync(300);
    ledger.recordPaths(['src/app.ts']); // resets the trailing window
    await vi.advanceTimersByTimeAsync(300);
    expect(read).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(read).toHaveBeenCalledTimes(1);
    // First publish appended the row; second carries the counts.
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('keeps existing rows in place and appends new files in order', async () => {
    const read = vi.fn(
      async (paths: readonly string[]): Promise<ReadonlyMap<string, FileChangeStat>> =>
        new Map(paths.map((path) => [path, { additions: 1, deletions: 0 }])),
    );
    const publish = vi.fn();
    const ledger = createTurnChangesLedger({
      reader: { read },
      scope: { sessionId: 'session-a', turnId: 'turn-a' },
      publish,
    });

    ledger.recordPaths(['src/a.ts']);
    await vi.advanceTimersByTimeAsync(500);
    ledger.recordPaths(['src/b.ts', 'src/a.ts']);
    expect(publish).toHaveBeenLastCalledWith([
      { path: 'src/a.ts', additions: 1, deletions: 0 },
      { path: 'src/b.ts', additions: null, deletions: null },
    ]);
    await vi.advanceTimersByTimeAsync(500);
    const last = publish.mock.lastCall?.[0] as ChangedFileSummary[];
    expect(last.map((file) => file.path)).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('serializes git reads and coalesces due files into one batch', async () => {
    const { read, resolveNext } = deferredReader();
    const publish = vi.fn();
    const ledger = createTurnChangesLedger({
      reader: { read },
      scope: { sessionId: 'session-a', turnId: 'turn-a' },
      publish,
    });

    ledger.recordPaths(['src/a.ts']);
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(1);

    // Two more files fall due while the first read is in flight; no
    // second git process starts until it resolves, and both files
    // then share one batched invocation.
    ledger.recordPaths(['src/b.ts', 'src/c.ts']);
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(1);

    resolveNext(new Map([['src/a.ts', { additions: 2, deletions: 0 }]]));
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(['src/b.ts', 'src/c.ts'], {
      sessionId: 'session-a',
      turnId: 'turn-a',
    });
    resolveNext(new Map());
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('skips publishing when a read reports no visible count change', async () => {
    const read = vi.fn(
      async (): Promise<ReadonlyMap<string, FileChangeStat>> =>
        new Map([['src/app.ts', { additions: 3, deletions: 1 }]]),
    );
    const publish = vi.fn();
    const ledger = createTurnChangesLedger({
      reader: { read },
      scope: { sessionId: 'session-a', turnId: 'turn-a' },
      publish,
    });

    ledger.recordPaths(['src/app.ts']);
    await vi.advanceTimersByTimeAsync(500);
    expect(publish).toHaveBeenCalledTimes(2);

    // Same counts again: nothing visible changed, nothing published.
    ledger.recordPaths(['src/app.ts']);
    await vi.advanceTimersByTimeAsync(500);
    expect(read).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it('caps the ledger at the changed-files bound', () => {
    const read = vi.fn(
      async (): Promise<ReadonlyMap<string, FileChangeStat>> => new Map(),
    );
    const publish = vi.fn();
    const ledger = createTurnChangesLedger({
      reader: { read },
      scope: { sessionId: 'session-a', turnId: 'turn-a' },
      publish,
    });

    ledger.recordPaths(
      Array.from(
        { length: MAX_CHANGED_FILES_PER_TURN + 5 },
        (_, index) => `src/file-${index}.ts`,
      ),
    );
    expect(ledger.files()).toHaveLength(MAX_CHANGED_FILES_PER_TURN);
  });

  it('cancel stops timers and suppresses in-flight results', async () => {
    const { read, resolveNext } = deferredReader();
    const publish = vi.fn();
    const ledger = createTurnChangesLedger({
      reader: { read },
      scope: { sessionId: 'session-a', turnId: 'turn-a' },
      publish,
    });

    ledger.recordPaths(['src/a.ts']);
    await vi.advanceTimersByTimeAsync(500);
    ledger.recordPaths(['src/b.ts']);
    expect(publish).toHaveBeenCalledTimes(2);

    ledger.cancel();
    // The pending b.ts debounce dies with the timers…
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(1);
    // …and the in-flight a.ts result is dropped instead of published.
    resolveNext(new Map([['src/a.ts', { additions: 7, deletions: 7 }]]));
    await vi.advanceTimersByTimeAsync(0);
    expect(publish).toHaveBeenCalledTimes(2);
    ledger.recordPaths(['src/c.ts']);
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
