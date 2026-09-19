import { describe, expect, it } from 'vitest';

import {
  MAX_REWIND_EVICTED_REASON_LENGTH,
  MAX_REWIND_INFO_FILES,
} from '../../shared/protocol/bounds';
import { projectRewindInfo } from './rewindInfo';

const root = process.platform === 'win32' ? 'D:\\repo' : '/repo';
const outside = process.platform === 'win32' ? 'D:\\other\\x.ts' : '/other/x.ts';

describe('projectRewindInfo', () => {
  it('keeps outside files visible by basename while preserving complete restore counts', () => {
    const projected = projectRewindInfo(
      {
        availableFiles: [{ filePath: 'src/app.tsx' }, { filePath: outside }],
        createdFiles: [{ filePath: 'docs/new.md' }],
        evictedFiles: [{ filePath: 'src/big.bin', reason: 'file too large' }],
      },
      root,
    );

    expect(projected).toEqual({
      restorableCount: 2,
      createdCount: 1,
      restorablePaths: ['src/app.tsx'],
      createdPaths: ['docs/new.md'],
      evictedFiles: [{ path: 'src/big.bin', reason: 'file too large' }],
      evictedCount: 1,
      details: [
        { label: 'src/app.tsx', location: 'workspace', action: 'restore' },
        { label: 'x.ts', location: 'outside-workspace', action: 'restore' },
        { label: 'docs/new.md', location: 'workspace', action: 'delete' },
        { label: 'src/big.bin', location: 'workspace', action: 'unavailable', reason: 'file too large' },
      ],
    });
  });

  it('caps the lists and truncates an oversized reason', () => {
    const many = Array.from({ length: MAX_REWIND_INFO_FILES + 3 }, (_unused, index) => ({
      filePath: `src/file-${index}.ts`,
    }));
    const projected = projectRewindInfo(
      {
        availableFiles: many,
        createdFiles: [],
        evictedFiles: many.map(({ filePath }) => ({
          filePath,
          reason: 'x'.repeat(MAX_REWIND_EVICTED_REASON_LENGTH + 20),
        })),
      },
      root,
    );

    expect(projected.restorableCount).toBe(many.length);
    expect(projected.restorablePaths).toHaveLength(MAX_REWIND_INFO_FILES);
    expect(projected.details).toHaveLength(MAX_REWIND_INFO_FILES);
    expect(projected.evictedCount).toBe(many.length);
    expect(projected.evictedFiles).toHaveLength(MAX_REWIND_INFO_FILES);
    expect(projected.evictedFiles[0]?.reason).toHaveLength(
      MAX_REWIND_EVICTED_REASON_LENGTH,
    );
  });

  it('keeps safe names and unknown-location markers without a workspace root', () => {
    const projected = projectRewindInfo(
      {
        availableFiles: [{ filePath: 'src/app.tsx' }],
        createdFiles: [],
        evictedFiles: [{ filePath: 'src/app.tsx', reason: 'evicted' }],
      },
      null,
    );

    expect(projected).toMatchObject({
      restorableCount: 1,
      restorablePaths: [],
      evictedFiles: [],
      evictedCount: 1,
      details: [
        { label: 'app.tsx', location: 'unknown-workspace', action: 'restore' },
        { label: 'app.tsx', location: 'unknown-workspace', action: 'unavailable', reason: 'evicted' },
      ],
    });
  });
});
