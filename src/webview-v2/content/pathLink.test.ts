import { describe, expect, it } from 'vitest';

import { MAX_OPEN_PATH_LENGTH } from '../../shared/protocol/bounds';
import { detectPathLink, toWorkspaceRelativePath } from '@droidvisx/chat-ui/markdown/pathLink';

describe('detectPathLink', () => {
  it.each([
    {
      text: 'D:\\E\\前端好玩的东西\\react+ts\\个人简历\\artifacts\\林泽楷-简历.pdf',
      expected: {
        path: 'D:\\E\\前端好玩的东西\\react+ts\\个人简历\\artifacts\\林泽楷-简历.pdf',
      },
    },
    {
      text: 'C:/Users/me/report with spaces.txt',
      expected: { path: 'C:/Users/me/report with spaces.txt' },
    },
    {
      text: 'D:\\E\\artifacts',
      expected: { path: 'D:\\E\\artifacts' },
    },
    {
      text: 'src/webview/assistant/thread/Thread.tsx',
      expected: { path: 'src/webview/assistant/thread/Thread.tsx' },
    },
    {
      text: 'docs/产品设计.md',
      expected: { path: 'docs/产品设计.md' },
    },
    {
      text: 'src/extension/chat/ChatController.ts:12',
      expected: { path: 'src/extension/chat/ChatController.ts', line: 12 },
    },
    {
      text: 'foo.ts:12:3',
      expected: { path: 'foo.ts', line: 12, column: 3 },
    },
    {
      text: 'D:\\repo\\src\\app.ts:120:8',
      expected: { path: 'D:\\repo\\src\\app.ts', line: 120, column: 8 },
    },
    {
      text: '  src/shared/bridgeMessages.ts  ',
      expected: { path: 'src/shared/bridgeMessages.ts' },
    },
  ])('detects $text', ({ text, expected }) => {
    expect(detectPathLink(text)).toEqual(expected);
  });

  it.each([
    '',
    '   ',
    'const total = price * quantity;',
    'pnpm run build',
    'a/b',
    'src/utils',
    'foo.ts',
    'package.json',
    'https://example.com/a.ts',
    'file://server/share/a.ts',
    '/etc/passwd',
    '/api/users.json',
    '../secrets.env',
    'src/../../out.ts',
    './src/app.ts',
    'D:',
    'D:\\',
    'C:\\..\\Windows\\win.ini',
    'D:\\a<b>.txt',
    'D:\\a\u0000b.txt',
    'a b/c.ts',
    'src/app.ts:0',
    `D:\\${'x'.repeat(MAX_OPEN_PATH_LENGTH)}\\a.txt`,
  ])('rejects %j', (text) => {
    expect(detectPathLink(text)).toBeNull();
  });

  it('keeps an out-of-range position suffix as part of the name', () => {
    // 8-digit suffixes exceed the position cap, so the text only
    // counts as a path when the whole string still looks like one.
    expect(detectPathLink('src/app.ts:99999999')).toBeNull();
  });
});

describe('toWorkspaceRelativePath', () => {
  const ROOT = 'd:\\E\\前端好玩的东西\\droidvisx';

  it('rebases an inside-root Windows absolute path', () => {
    expect(
      toWorkspaceRelativePath(
        ROOT,
        'D:\\E\\前端好玩的东西\\droidvisx\\artifacts\\烟花.html',
      ),
    ).toBe('artifacts/烟花.html');
  });

  it('compares Windows roots case-insensitively, keeping path casing', () => {
    expect(toWorkspaceRelativePath('D:/e/PROJ', 'd:\\E\\proj\\Demo\\Index.HTML')).toBe(
      'Demo/Index.HTML',
    );
  });

  it('tolerates a trailing separator on the root', () => {
    expect(toWorkspaceRelativePath('D:/proj/', 'D:/proj/a.html')).toBe('a.html');
  });

  it('passes relative paths through with normalized separators', () => {
    expect(toWorkspaceRelativePath(ROOT, 'src\\demo\\a.html')).toBe('src/demo/a.html');
  });

  it('rejects paths outside the root', () => {
    expect(toWorkspaceRelativePath(ROOT, 'C:\\Users\\me\\烟花.html')).toBeNull();
    expect(toWorkspaceRelativePath(ROOT, 'D:\\E\\other\\a.html')).toBeNull();
  });

  it('rejects sibling folders sharing the root as a name prefix', () => {
    expect(toWorkspaceRelativePath('D:/proj', 'D:/project/a.html')).toBeNull();
  });

  it('rejects the root itself and empty inputs', () => {
    expect(toWorkspaceRelativePath(ROOT, ROOT)).toBeNull();
    expect(toWorkspaceRelativePath('', 'a.html')).toBeNull();
    expect(toWorkspaceRelativePath(ROOT, '')).toBeNull();
  });

  it('compares POSIX roots case-sensitively', () => {
    expect(toWorkspaceRelativePath('/home/me/proj', '/home/me/proj/a.html')).toBe(
      'a.html',
    );
    expect(toWorkspaceRelativePath('/home/me/proj', '/home/ME/proj/a.html')).toBeNull();
  });

  it('rejects absolute paths against a relative root', () => {
    expect(toWorkspaceRelativePath('proj', 'D:/proj/a.html')).toBeNull();
  });
});
