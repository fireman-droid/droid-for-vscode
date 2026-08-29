import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MAX_CHANGED_FILES_PER_TURN } from '../shared/bridgeMessages';
import {
  extractToolFilePaths,
  toWorkspaceRelativePath,
} from './toolFilePath';

describe('extractToolFilePaths', () => {
  it('reads the single path key of Create/Edit/Write inputs', () => {
    expect(
      extractToolFilePaths('Edit', { file_path: ' src/app.ts ' }),
    ).toEqual(['src/app.ts']);
    expect(
      extractToolFilePaths('Create', { filePath: 'docs/readme.md' }),
    ).toEqual(['docs/readme.md']);
    expect(extractToolFilePaths('Write', { path: 'a.ts' })).toEqual([
      'a.ts',
    ]);
    expect(
      extractToolFilePaths('functions.Edit', {
        file_path: 'src/namespaced.ts',
      }),
    ).toEqual(['src/namespaced.ts']);
    expect(extractToolFilePaths('Read', { file_path: 'a.ts' })).toEqual(
      [],
    );
    expect(extractToolFilePaths('Edit', null)).toEqual([]);
    expect(extractToolFilePaths('Edit', { file_path: 42 })).toEqual([]);
  });

  it('reads Add/Update headers out of ApplyPatch patch text', () => {
    // Real CLI shape: one `input` key with the whole patch text.
    const single = [
      '*** Begin Patch',
      '*** Add File: d:\\E\\前端好玩的东西\\react+ts\\个人简历\\烟花.html',
      '+<!doctype html>',
      '+<html></html>',
      '*** End Patch',
    ].join('\n');
    expect(extractToolFilePaths('ApplyPatch', { input: single })).toEqual(
      ['d:\\E\\前端好玩的东西\\react+ts\\个人简历\\烟花.html'],
    );

    const multi = [
      '*** Begin Patch',
      '*** Update File: src/a.ts',
      '@@',
      '-old',
      '+new',
      '*** Add File: src/b.ts',
      '+created',
      '*** End Patch',
    ].join('\n');
    expect(extractToolFilePaths('ApplyPatch', { input: multi })).toEqual([
      'src/a.ts',
      'src/b.ts',
    ]);
  });

  it('deduplicates rewrites and includes pure deletes', () => {
    // The CLI rewrites a file as a Delete+Add pair for the same path.
    const rewrite = [
      '*** Begin Patch',
      '*** Delete File: d:\\proj\\烟花.html',
      '*** Add File: d:\\proj\\烟花.html',
      '+rewritten',
      '*** End Patch',
    ].join('\n');
    expect(
      extractToolFilePaths('ApplyPatch', { input: rewrite }),
    ).toEqual(['d:\\proj\\烟花.html']);

    const deleteOnly = [
      '*** Begin Patch',
      '*** Delete File: src/gone.ts',
      '*** End Patch',
    ].join('\n');
    expect(
      extractToolFilePaths('ApplyPatch', { input: deleteOnly }),
    ).toEqual(['src/gone.ts']);
  });

  it('handles CRLF patches and repeated headers', () => {
    const crlf =
      '*** Begin Patch\r\n' +
      '*** Update File: src/a.ts\r\n' +
      '+x\r\n' +
      '*** Update File: src/a.ts\r\n' +
      '+y\r\n' +
      '*** End Patch\r\n';
    expect(extractToolFilePaths('ApplyPatch', { input: crlf })).toEqual([
      'src/a.ts',
    ]);
  });

  it('quietly returns nothing for malformed or hostile patch input', () => {
    // No file headers at all.
    expect(
      extractToolFilePaths('ApplyPatch', { input: '+just a diff body' }),
    ).toEqual([]);
    // Malformed headers: wrong verb, missing colon, indented marker.
    const malformed = [
      '*** Begin Patch',
      '*** Rename File: src/a.ts',
      '*** Add File src/b.ts',
      '  *** Add File: src/c.ts',
      '*** End Patch',
    ].join('\n');
    expect(
      extractToolFilePaths('ApplyPatch', { input: malformed }),
    ).toEqual([]);
    // Non-string input value.
    expect(
      extractToolFilePaths('ApplyPatch', { input: { nested: true } }),
    ).toEqual([]);
    expect(extractToolFilePaths('ApplyPatch', {})).toEqual([]);
    expect(extractToolFilePaths('ApplyPatch', 'raw patch')).toEqual([]);
    // Oversized or control-character header paths are dropped without
    // dropping the rest of the patch.
    const hostile = [
      `*** Add File: ${'x'.repeat(5000)}`,
      '*** Add File: bad\u0007name.ts',
      '*** Add File: src/ok.ts',
    ].join('\n');
    expect(
      extractToolFilePaths('ApplyPatch', { input: hostile }),
    ).toEqual(['src/ok.ts']);
  });

  it('prefers a standard path key over patch parsing and caps output', () => {
    expect(
      extractToolFilePaths('ApplyPatch', {
        file_path: 'src/direct.ts',
        input: '*** Add File: src/other.ts',
      }),
    ).toEqual(['src/direct.ts']);

    const oversized = Array.from(
      { length: MAX_CHANGED_FILES_PER_TURN + 5 },
      (_, index) => `*** Add File: src/file-${index}.ts`,
    ).join('\n');
    expect(
      extractToolFilePaths('ApplyPatch', { input: oversized }),
    ).toHaveLength(MAX_CHANGED_FILES_PER_TURN);
  });
});

describe('toWorkspaceRelativePath', () => {
  it('resolves absolute and relative paths inside the workspace', () => {
    const root = resolve('workspace-root');
    expect(
      toWorkspaceRelativePath(root, join(root, 'src', 'app.ts')),
    ).toBe('src/app.ts');
    expect(toWorkspaceRelativePath(root, 'docs/readme.md')).toBe(
      'docs/readme.md',
    );
    expect(
      toWorkspaceRelativePath(root, join(root, '..', 'outside.ts')),
    ).toBeUndefined();
  });

  it.runIf(process.platform === 'win32')(
    'accepts the CLI\'s lowercase drive-letter absolute paths',
    () => {
      const root = resolve('workspace-root');
      const lowercased =
        root.charAt(0).toLowerCase() + root.slice(1);
      expect(
        toWorkspaceRelativePath(
          root,
          join(lowercased, 'src', '烟花.html'),
        ),
      ).toBe('src/烟花.html');
    },
  );
});
