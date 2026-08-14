import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  createGitChangeStatsReader,
  createUnavailableChangeStatsReader,
  parseGitNumstat,
  parseNoIndexNumstat,
} from './changeStats';

describe('parseGitNumstat', () => {
  it('parses NUL-terminated numstat records', () => {
    const output = '3\t1\tsrc/app.ts\u00000\t12\tdocs/old.md\u0000';
    const stats = parseGitNumstat(output);
    expect(stats.get('src/app.ts')).toEqual({
      additions: 3,
      deletions: 1,
    });
    expect(stats.get('docs/old.md')).toEqual({
      additions: 0,
      deletions: 12,
    });
  });

  it('maps binary dash counts to null', () => {
    const stats = parseGitNumstat('-\t-\tassets/logo.png\u0000');
    expect(stats.get('assets/logo.png')).toEqual({
      additions: null,
      deletions: null,
    });
  });

  it('normalizes backslashes and ignores malformed records', () => {
    const stats = parseGitNumstat(
      '2\t0\tsrc\\win.ts\u0000garbage line\u0000\u0000not\ta\u0000',
    );
    expect(stats.size).toBe(1);
    expect(stats.get('src/win.ts')).toEqual({
      additions: 2,
      deletions: 0,
    });
  });

  it('returns an empty map for empty output', () => {
    expect(parseGitNumstat('').size).toBe(0);
  });
});

describe('parseNoIndexNumstat', () => {
  it('reads text and binary count prefixes without depending on paths', () => {
    expect(
      parseNoIndexNumstat('87\t12\tbefore => current\u0000'),
    ).toEqual({ additions: 87, deletions: 12 });
    expect(parseNoIndexNumstat('-\t-\tbefore => current\u0000')).toEqual(
      { additions: null, deletions: null },
    );
    expect(parseNoIndexNumstat('')).toBeUndefined();
  });
});

describe('createGitChangeStatsReader turn baselines', () => {
  const scope = { sessionId: 'session-a', turnId: 'turn-a' };

  it('keeps the first pre-tool text and uses it before git HEAD', async () => {
    let source = Buffer.from('before\n');
    const readWorkspaceFile = vi.fn(async (_path: string) => source);
    const readBaselineStat = vi.fn(
      async (_path: string, _baseline: Buffer) => ({
        additions: 4,
        deletions: 2,
      }),
    );
    const readHeadStats = vi.fn(
      async (_root: string, _paths: readonly string[]) => new Map(),
    );
    const reader = createGitChangeStatsReader(
      () => 'C:\\workspace',
      { readWorkspaceFile, readBaselineStat, readHeadStats },
    );

    await reader.captureTurnBaseline?.(scope, ['index.html']);
    source = Buffer.from('after\n');
    await reader.captureTurnBaseline?.(scope, ['index.html']);
    await expect(reader.read(['index.html'], scope)).resolves.toEqual(
      new Map([
        ['index.html', { additions: 4, deletions: 2 }],
      ]),
    );
    expect(readWorkspaceFile).toHaveBeenCalledOnce();
    expect(readBaselineStat.mock.calls[0]?.[1].toString('utf8')).toBe(
      'before\n',
    );
    expect(readHeadStats).not.toHaveBeenCalled();
    await expect(
      reader.readTurnBaseline?.(scope, 'index.html'),
    ).resolves.toBe('before\n');
  });

  it('treats a file created during the turn as additions from empty', async () => {
    const notFound = Object.assign(new Error('missing'), {
      code: 'ENOENT',
    });
    const readBaselineStat = vi.fn(
      async (_path: string, _baseline: Buffer) => ({
        additions: 653,
        deletions: 0,
      }),
    );
    const reader = createGitChangeStatsReader(
      () => 'C:\\workspace',
      {
        readWorkspaceFile: vi.fn(async (_path: string) => {
          throw notFound;
        }),
        readBaselineStat,
        readHeadStats: vi.fn(
          async (_root: string, _paths: readonly string[]) => new Map(),
        ),
      },
    );

    await reader.captureTurnBaseline?.(scope, ['index.html']);
    const stats = await reader.read(['index.html'], scope);
    expect(stats.get('index.html')).toEqual({
      additions: 653,
      deletions: 0,
    });
    expect(readBaselineStat.mock.calls[0]?.[1]).toEqual(Buffer.alloc(0));
    await expect(
      reader.readTurnBaseline?.(scope, 'index.html'),
    ).resolves.toBe('');
  });

  it('falls back to git HEAD when no live baseline exists', async () => {
    const head = new Map([
      ['src/app.ts', { additions: 3, deletions: 1 }],
    ]);
    const readHeadStats = vi.fn(
      async (_root: string, _paths: readonly string[]) => head,
    );
    const reader = createGitChangeStatsReader(
      () => 'C:\\workspace',
      {
        readWorkspaceFile: vi.fn(async (_path: string) => Buffer.alloc(0)),
        readBaselineStat: vi.fn(
          async (_path: string, _baseline: Buffer) => undefined,
        ),
        readHeadStats,
      },
    );

    await expect(reader.read(['src/app.ts'], scope)).resolves.toStrictEqual(
      head,
    );
    expect(readHeadStats).toHaveBeenCalledWith(
      'C:\\workspace',
      ['src/app.ts'],
    );
  });

  it('evicts older turns when the byte budget fills', async () => {
    const baseline = Buffer.alloc(4 * 1024 * 1024, 1);
    const readBaselineStat = vi.fn(
      async (_path: string, _baseline: Buffer) => ({
        additions: 1,
        deletions: 0,
      }),
    );
    const reader = createGitChangeStatsReader(
      () => 'C:\\workspace',
      {
        readWorkspaceFile: vi.fn(async (_path: string) => baseline),
        readBaselineStat,
        readHeadStats: vi.fn(
          async (_root: string, _paths: readonly string[]) => new Map(),
        ),
      },
    );

    await reader.captureTurnBaseline?.(scope, [
      'one.html',
      'two.html',
      'three.html',
      'four.html',
    ]);
    const nextScope = { sessionId: 'session-a', turnId: 'turn-b' };
    await reader.captureTurnBaseline?.(nextScope, ['current.html']);
    await reader.read(['current.html'], nextScope);

    expect(readBaselineStat).toHaveBeenCalledOnce();
    expect(readBaselineStat.mock.calls[0]?.[0]).toBe(
      'C:\\workspace\\current.html',
    );
    expect(readBaselineStat.mock.calls[0]?.[1]).toBe(baseline);
  });

  it('rejects an oversized file before reading its baseline', async () => {
    const root = await mkdtemp(join(tmpdir(), 'droidvisx-stats-'));
    const path = join(root, 'large.html');
    try {
      await writeFile(path, '');
      await truncate(path, 4 * 1024 * 1024 + 1);
      const readHeadStats = vi.fn(
        async (_root: string, _paths: readonly string[]) => new Map(),
      );
      const reader = createGitChangeStatsReader(
        () => root,
        {
          readBaselineStat: vi.fn(
            async (_path: string, _baseline: Buffer) => ({
              additions: 1,
              deletions: 0,
            }),
          ),
          readHeadStats,
        },
      );

      await reader.captureTurnBaseline?.(scope, ['large.html']);
      await reader.read(['large.html'], scope);

      expect(readHeadStats).toHaveBeenCalledWith(root, ['large.html']);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('counts a captured edit in a non-git workspace', async () => {
    const root = await mkdtemp(join(tmpdir(), 'droidvisx-stats-'));
    const path = join(root, 'index.html');
    const reader = createGitChangeStatsReader(() => root);
    try {
      await writeFile(path, '<main>before</main>\n');
      await reader.captureTurnBaseline?.(scope, ['index.html']);
      await writeFile(
        path,
        '<main>before</main>\n<footer>after</footer>\n',
      );

      const stats = await reader.read(['index.html'], scope);

      expect(stats.get('index.html')).toEqual({
        additions: 1,
        deletions: 0,
      });
      await expect(
        reader.readTurnBaseline?.(scope, 'index.html'),
      ).resolves.toBe('<main>before</main>\n');
    } finally {
      reader.dispose?.();
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe('createUnavailableChangeStatsReader', () => {
  it('always resolves to an empty map', async () => {
    const reader = createUnavailableChangeStatsReader();
    await expect(reader.read(['src/app.ts'])).resolves.toEqual(
      new Map(),
    );
  });
});
