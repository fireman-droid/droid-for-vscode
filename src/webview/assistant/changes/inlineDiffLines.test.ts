import { describe, expect, it } from 'vitest';
import { inlineDiffLines } from './inlineDiffLines';

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
});
