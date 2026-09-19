import { describe, expect, it } from 'vitest';

import { toOpenEditorRelativePaths } from './openEditorTabs';

const ROOT = process.platform === 'win32' ? 'C:\\work\\repo' : '/work/repo';

function abs(relativePath: string): string {
  return process.platform === 'win32'
    ? `${ROOT}\\${relativePath.replaceAll('/', '\\')}`
    : `${ROOT}/${relativePath}`;
}

describe('toOpenEditorRelativePaths', () => {
  it('returns forward-slash workspace-relative paths in tab order', () => {
    expect(
      toOpenEditorRelativePaths(ROOT, [abs('src/app.ts'), abs('docs/notes.md')], 20),
    ).toEqual(['src/app.ts', 'docs/notes.md']);
  });

  it('collapses duplicate tabs (split editors, second group)', () => {
    expect(
      toOpenEditorRelativePaths(
        ROOT,
        [abs('src/app.ts'), abs('src/app.ts'), abs('src/b.ts')],
        20,
      ),
    ).toEqual(['src/app.ts', 'src/b.ts']);
  });

  it('drops files outside the workspace root', () => {
    const outside =
      process.platform === 'win32' ? 'C:\\other\\file.ts' : '/other/file.ts';
    expect(toOpenEditorRelativePaths(ROOT, [outside, abs('src/a.ts')], 20)).toEqual([
      'src/a.ts',
    ]);
  });

  it('drops the workspace root itself', () => {
    expect(toOpenEditorRelativePaths(ROOT, [ROOT], 20)).toEqual([]);
  });

  it('caps the list at maxResults', () => {
    const tabs = Array.from({ length: 30 }, (_, index) => abs(`src/file-${index}.ts`));
    expect(toOpenEditorRelativePaths(ROOT, tabs, 20)).toHaveLength(20);
  });
});
