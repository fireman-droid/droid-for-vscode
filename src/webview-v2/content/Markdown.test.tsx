// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContentProvider } from './context';
import { Markdown } from './Markdown';

afterEach(cleanup);

describe('V2 Markdown actions', () => {
  it('keeps safe links and workspace file actions while suppressing unsafe URLs and raw HTML', () => {
    const actions = { openPath: vi.fn(), previewFile: vi.fn(), previewHtml: vi.fn() };
    render(<ContentProvider value={{ actions, workspaceRoot: 'C:\\project', theme: 'dark' }}>
      <Markdown text={'[Reference](https://example.com) [Blocked](javascript:alert%281%29)\n\n`src/demo.html:12`\n\n<img src="https://example.com/unsafe.png" onerror="alert(1)">'} />
    </ContentProvider>);
    expect(screen.getByRole('link', { name: 'Reference' }).getAttribute('rel')).toBe('noreferrer noopener');
    expect(screen.queryByRole('link', { name: 'Blocked' })).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(fireEvent.click(screen.getByRole('link', { name: 'src/demo.html:12' }))).toBe(false);
    expect(actions.openPath).toHaveBeenCalledWith({ path: 'src/demo.html', line: 12 });
    fireEvent.click(screen.getByRole('button', { name: 'Canvas' }));
    expect(actions.previewFile).toHaveBeenCalledWith('src/demo.html');
  });

  it('opens the settled HTML source in Canvas and never offers artifacts from streaming or thinking text', () => {
    const actions = { openPath: vi.fn(), previewFile: vi.fn(), previewHtml: vi.fn() };
    const value = { actions, workspaceRoot: 'C:\\project', theme: 'dark' as const };
    const html = '<!doctype html><title>Sample</title><p>Hello</p>';
    const text = `\`\`\`html\n${html}\n\`\`\``;
    const { rerender } = render(<ContentProvider value={value}><Markdown text={text} streaming /></ContentProvider>);
    expect(screen.queryByRole('button', { name: 'Open Canvas' })).toBeNull();
    rerender(<ContentProvider value={value}><Markdown text={text} /></ContentProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Open Canvas' }));
    expect(actions.previewHtml).toHaveBeenCalledWith(`${html}\n`, { artifactId: expect.stringMatching(/^inline:/), title: 'Sample' });
    rerender(<ContentProvider value={value}><Markdown text={text} thinking /></ContentProvider>);
    expect(screen.queryByRole('button', { name: 'Open Canvas' })).toBeNull();
  });
});
