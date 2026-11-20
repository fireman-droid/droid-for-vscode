import { describe, expect, it } from 'vitest';
import { formatDiffHunkHeader, inlineDiffLines } from '../../src/review/inlineDiffLines';
import { translate } from '../../src/i18n/translate';

describe('unified diff line numbers', () => {
  it('tracks each side independently and resets at separated hunks', () => {
    expect(inlineDiffLines('@@ -2,2 +2,3 @@\n keep\n--old\n++new\n+\n\\ No newline at end of file\n@@ -10 +11 @@\n-a\n+b')).toEqual([
      { kind: 'hunk', text: '@@ -2,2 +2,3 @@', before: null, after: null },
      { kind: 'context', text: 'keep', before: 2, after: 2 },
      { kind: 'remove', text: '-old', before: 3, after: null },
      { kind: 'add', text: '+new', before: null, after: 3 },
      { kind: 'add', text: '', before: null, after: 4 },
      { kind: 'note', text: '\\ No newline at end of file', before: null, after: null },
      { kind: 'hunk', text: '@@ -10 +11 @@', before: null, after: null },
      { kind: 'remove', text: 'a', before: 10, after: null },
      { kind: 'add', text: 'b', before: null, after: 11 },
    ]);
  });

  it('formats hunk headers using the active locale translator', () => {
    expect(formatDiffHunkHeader('@@ -1,3 +1,4 @@ fn')).toBe('Before lines 1–3 → After lines 1–4 · fn');
    expect(formatDiffHunkHeader('@@ -0,0 +1,1 @@', (m, p) => translate('en', m, p))).toBe('Before no lines → After line 1');
    expect(formatDiffHunkHeader('@@ -1,3 +1,4 @@', (m, p) => translate('zh-CN', m, p))).toBe('修改前 1–3 行 → 修改后 1–4 行');
    expect(formatDiffHunkHeader('@@ -0,0 +1,1 @@', (m, p) => translate('zh-TW', m, p))).toBe('修改前 無對應行 → 修改後 1 行');
  });
});
