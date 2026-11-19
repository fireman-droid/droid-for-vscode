import { describe, expect, it } from 'vitest';
import {
  buildGroupDisambiguation,
  compactDirPath,
  compactExploreTarget,
  compactFileTarget,
  compactGenericTarget,
  compactSearchTarget,
  normalizeTargetPath,
} from './compactTarget';

describe('compactTarget helpers', () => {
  it('extracts basenames cleanly from POSIX and Windows paths', () => {
    expect(compactFileTarget('src/webview-v2/chat/ChatApp.tsx')).toEqual({ label: 'ChatApp.tsx' });
    expect(compactFileTarget('C:\\Users\\dev\\repo\\src\\ChatApp.tsx')).toEqual({ label: 'ChatApp.tsx' });
    expect(compactFileTarget('./src/webview-v2/chat/ChatApp.tsx')).toEqual({ label: 'ChatApp.tsx' });
  });

  it('disambiguates only when distinct paths share a basename inside one group', () => {
    const unique = buildGroupDisambiguation([
      'src/webview-v2/chat/ChatApp.tsx',
      'packages/chat-ui/src/chat/ActivityItem.tsx',
    ]);
    expect(unique.size).toBe(0);

    const repeatedSame = buildGroupDisambiguation(['./src/app.ts', 'src/app.ts']);
    expect(repeatedSame.size).toBe(0);

    const colliding = buildGroupDisambiguation([
      'packages/chat-ui/src/index.ts',
      'src/webview-v2/src/index.ts',
      'src/webview-v2/chat/ChatApp.tsx',
    ]);
    expect(compactFileTarget('packages/chat-ui/src/index.ts', colliding)).toEqual({
      label: 'index.ts',
      detail: 'chat-ui/src',
    });
    expect(compactFileTarget('src/webview-v2/src/index.ts', colliding)).toEqual({
      label: 'index.ts',
      detail: 'webview-v2/src',
    });
    expect(compactFileTarget('src/webview-v2/chat/ChatApp.tsx', colliding)).toEqual({
      label: 'ChatApp.tsx',
    });
    expect(normalizeTargetPath('C:\\repo\\src\\index.ts\\')).toBe('C:/repo/src/index.ts');
  });

  it('compacts directory and search targets while preserving plain queries and URLs', () => {
    expect(compactDirPath('.')).toBe('.');
    expect(compactDirPath('C:/repo/src/webview-v2/chat')).toBe('webview-v2/chat');
    expect(compactSearchTarget('interaction.request · C:/repo/src/webview-v2/chat')).toEqual({
      label: 'interaction.request',
      detail: 'webview-v2/chat',
    });
    expect(compactSearchTarget('useEffect · src/webview-v2/chat/ChatApp.tsx')).toEqual({
      label: 'useEffect',
      detail: 'ChatApp.tsx',
    });
    expect(compactSearchTarget('plainQuery')).toEqual({ label: 'plainQuery' });
    expect(compactGenericTarget('https://example.com/a/b/c')).toBe('https://example.com/a/b/c');
    expect(compactGenericTarget('src/webview-v2/chat/ChatApp.tsx')).toBe('ChatApp.tsx');
    expect(compactExploreTarget('App.tsx · store.ts', 'file')).toEqual({ label: 'App.tsx · store.ts' });
  });
});
