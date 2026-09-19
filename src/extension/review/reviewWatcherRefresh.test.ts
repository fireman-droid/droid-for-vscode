import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActiveScope } from './reviewCoordinatorSupport';
import { refreshScopeVersions, ReviewWatcherRefresh } from './reviewWatcherRefresh';

afterEach(() => {
  vi.useRealTimers();
});

describe('ReviewWatcherRefresh', () => {
  it('retains events through supplemental refreshes without overlapping runs', async () => {
    vi.useFakeTimers();
    let active = scope('workspace', ['a.txt', 'b.txt']);
    const calls: string[][] = [];
    const releases: (() => void)[] = [];
    let running = 0;
    let maxRunning = 0;
    let completion = Promise.resolve();
    const refresh = new ReviewWatcherRefresh({
      getActive: () => active,
      setActive: (next) => {
        active = next;
      },
      loadScope: async (source) => cloneScope(source),
      refreshVersions: async (_source, affected) => {
        calls.push([...(affected ?? [])].sort());
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await new Promise<void>((resolve) => releases.push(resolve));
        running -= 1;
      },
      publish: vi.fn(),
      enqueue: (task) => {
        completion = task();
        return completion;
      },
    });

    refresh.note('a.txt');
    refresh.note('b.txt');
    await vi.advanceTimersByTimeAsync(120);
    expect(calls).toEqual([['a.txt', 'b.txt']]);

    refresh.note('c.txt');
    releases.shift()?.();
    await flushMicrotasks();
    expect(calls).toEqual([['a.txt', 'b.txt'], ['c.txt']]);

    refresh.note('d.txt');
    releases.shift()?.();
    await flushMicrotasks();
    expect(calls).toEqual([['a.txt', 'b.txt'], ['c.txt'], ['d.txt']]);
    releases.shift()?.();
    await completion;
    expect(maxRunning).toBe(1);
    refresh.dispose();
  });

  it('refreshes scope-aware membership and suppresses stale writing replacements', async () => {
    vi.useFakeTimers();
    const reads: string[] = [];
    let active = scope('turn', ['a.txt', 'b.txt']);
    const publish = vi.fn();
    const loadScope = vi.fn(async (source: ActiveScope) => {
      const next = scope(
        source.scopeKind,
        ['b.txt', 'c.txt'],
        source.scopeKind === 'branch' ? 'new-base' : 'base',
      );
      next.files[1]!.version = '';
      return next;
    });
    const refresh = new ReviewWatcherRefresh({
      getActive: () => active,
      setActive: (next) => {
        active = next;
      },
      loadScope,
      refreshVersions: (source, affected) =>
        refreshScopeVersions(
          source,
          affected,
          async (path) => {
            reads.push(path);
            return `new:${path}`;
          },
          () => false,
        ),
      publish,
      enqueue: async (task) => task(),
    });

    refresh.note('a.txt');
    await vi.advanceTimersByTimeAsync(120);
    await flushMicrotasks();
    expect(loadScope).not.toHaveBeenCalled();
    expect(reads).toEqual(['a.txt']);
    expect(active.files.map(({ path }) => path)).toEqual(['a.txt', 'b.txt']);

    reads.length = 0;
    active = scope('workspace', ['a.txt', 'b.txt']);
    refresh.note('a.txt');
    await vi.advanceTimersByTimeAsync(120);
    await flushMicrotasks();
    expect(reads).toEqual(['c.txt']);
    expect(active.files.map(({ path }) => path)).toEqual(['b.txt', 'c.txt']);
    expect(active.files[0]?.version).toBe('old:b.txt');

    reads.length = 0;
    active = scope('branch', ['a.txt', 'b.txt']);
    refresh.note('b.txt');
    await vi.advanceTimersByTimeAsync(120);
    await flushMicrotasks();
    expect(loadScope).toHaveBeenCalledTimes(2);
    expect(reads).toEqual(['b.txt', 'c.txt']);
    expect(active.lifecycle).toBe('stale');
    expect(active.baseline).toBe('new-base');

    let resolveLoad: ((value: ActiveScope) => void) | undefined;
    active = scope('workspace', ['a.txt']);
    loadScope.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLoad = resolve;
        }),
    );
    publish.mockClear();
    refresh.note('a.txt');
    await vi.advanceTimersByTimeAsync(120);
    active = {
      ...scope('turn', ['writing.txt']),
      lifecycle: 'writing',
    };
    resolveLoad?.(scope('workspace', ['stale.txt']));
    await flushMicrotasks();
    expect(active.files.map(({ path }) => path)).toEqual(['writing.txt']);
    expect(publish).not.toHaveBeenCalledWith(
      expect.objectContaining({
        files: [expect.objectContaining({ path: 'stale.txt' })],
      }),
    );
    refresh.dispose();
  });

  it('bounds full refreshes at six reads and preserves membership order', async () => {
    const paths = Array.from({ length: 13 }, (_, index) => `file-${index}.txt`);
    const target = scope('workspace', paths);
    let running = 0;
    let maxRunning = 0;
    const reads: string[] = [];

    await refreshScopeVersions(
      target,
      undefined,
      async (path) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        reads.push(path);
        await new Promise((resolve) => setTimeout(resolve, path.length % 4));
        running -= 1;
        return `new:${path}`;
      },
      () => false,
    );

    expect(maxRunning).toBe(6);
    expect([...reads].sort()).toEqual([...paths].sort());
    expect(new Set(reads).size).toBe(paths.length);
    expect(target.files.map(({ path }) => path)).toEqual(paths);
    expect(target.files.map(({ version }) => version)).toEqual(
      paths.map((path) => `new:${path}`),
    );
  });
});

function scope(
  scopeKind: ActiveScope['scopeKind'],
  paths: readonly string[],
  baseline = 'base',
): ActiveScope {
  return {
    reviewScopeId: `${scopeKind}-${baseline}`,
    sessionId: 'session-1',
    scopeKind,
    ...(scopeKind === 'turn' ? { turnId: 'turn-1' } : {}),
    baseline,
    baselineLabel: scopeKind === 'turn' ? 'Before turn' : 'HEAD',
    lifecycle: paths.length === 0 ? 'complete' : 'reviewing',
    files: paths.map((path) => ({
      path,
      additions: 1,
      deletions: 0,
      version: `old:${path}`,
      comparable: true,
      restorable: scopeKind === 'turn',
      restoreConflict: false,
    })),
    currentIndex: paths.length === 0 ? null : 0,
    reviewed: new Map(),
  };
}

function cloneScope(source: ActiveScope): ActiveScope {
  return {
    ...source,
    files: source.files.map((file) => ({ ...file })),
    reviewed: new Map(source.reviewed),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
