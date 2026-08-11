import { describe, expect, it } from 'vitest';

import {
  createUnavailableChangeStatsReader,
  parseGitNumstat,
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

describe('createUnavailableChangeStatsReader', () => {
  it('always resolves to an empty map', async () => {
    const reader = createUnavailableChangeStatsReader();
    await expect(reader.read(['src/app.ts'])).resolves.toEqual(
      new Map(),
    );
  });
});
