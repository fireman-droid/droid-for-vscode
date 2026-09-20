// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UiEnvironmentProvider } from '@droidvisx/chat-ui/environment';
import { ReplyView } from '@droidvisx/chat-ui/chat/ReplyView';
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

  it('highlights the unchanged code source when streaming finishes', () => {
    const code = 'const settledValue = 42;\n';
    const text = `\`\`\`typescript\n${code}\`\`\``;
    const { rerender } = render(<Markdown text={text} streaming />);
    expect(screen.getByRole('region', { name: 'typescript code' }).textContent).toBe(code);
    expect(screen.queryByText('const', { exact: true })).toBeNull();

    rerender(<Markdown text={text} streaming={false} />);
    expect(screen.getByText('const', { exact: true })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'typescript code' }).textContent).toBe(code);
  });

  it('renders the unchanged Mermaid source locally after streaming finishes', async () => {
    const source = 'graph LR\n  A[Ready] --> B[Done]\n';
    const text = `\`\`\`mermaid\n${source}\`\`\``;
    const renderDiagram = vi.fn(async () => ({
      ok: true as const,
      svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><text x="8" y="20">Local diagram ready</text></svg>',
      css: '',
    }));
    const value = { workspaceRoot: null, theme: 'dark' as const, renderDiagram };
    const { rerender } = render(<ContentProvider value={value}><Markdown text={text} streaming /></ContentProvider>);
    expect(screen.getByRole('region', { name: 'mermaid code' }).textContent).toBe(source);
    expect(renderDiagram).not.toHaveBeenCalled();

    rerender(<ContentProvider value={value}><Markdown text={text} streaming={false} /></ContentProvider>);
    expect(await screen.findByRole('img', { name: 'Mermaid diagram' })).toBeTruthy();
    expect(renderDiagram).toHaveBeenCalledWith(source, 'dark');
    expect(screen.getByText('Local diagram ready')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View source' }));
    expect(screen.getByRole('region', { name: 'mermaid code' }).textContent).toBe(source);
  });

  it('keeps the complete long reply, Markdown structures and copied source after repeated appends', async () => {
    const paragraphs = Array.from({ length: 96 }, (_, index) =>
      `Paragraph ${index + 1}: a local streamed reply retains every sentence, including earlier text and the final punctuation.`);
    const text = [
      '# Local long reply',
      ...paragraphs,
      '[Final reference][docs]',
      '- First list entry\n- Second list entry',
      '| Column | Value |\n| --- | --- |\n| Persisted | all rows |',
      'Formula: \\(x^2 + y^2 = z^2\\).',
      '```text\nfinal code payload\n```',
      '[docs]: https://example.invalid/local-reference',
    ].join('\n\n');
    const copyText = vi.fn(async () => {});
    const environment = { assistantName: 'Local assistant', copyText };
    const view = (source: string, streaming: boolean) => <UiEnvironmentProvider value={environment}>
      <ReplyView replyText={source} running={streaming}><Markdown text={source} streaming={streaming} /></ReplyView>
    </UiEnvironmentProvider>;
    const { rerender } = render(view(text.slice(0, 31), true));
    for (const end of [Math.floor(text.length / 3), Math.floor(text.length * 2 / 3), text.length - 8, text.length]) {
      rerender(view(text.slice(0, end), true));
    }
    rerender(view(text, false));

    expect(screen.getByRole('heading', { name: 'Local long reply' })).toBeTruthy();
    expect(screen.getAllByText(/^Paragraph \d+:/).map((element) => element.textContent)).toEqual(paragraphs);
    expect(screen.getByRole('link', { name: 'Final reference' }).getAttribute('href')).toBe('https://example.invalid/local-reference');
    expect(screen.getAllByRole('listitem').map((element) => element.textContent)).toEqual(['First list entry', 'Second list entry']);
    expect(within(screen.getByRole('table')).getAllByRole('cell').map((element) => element.textContent)).toEqual(['Persisted', 'all rows']);
    expect(screen.getByRole('math', { hidden: true }).querySelector('annotation')?.textContent).toBe('x^2 + y^2 = z^2');
    expect(screen.getByRole('region', { name: 'text code' }).textContent).toBe('final code payload\n');
    fireEvent.click(screen.getByRole('button', { name: 'Copy reply' }));
    await waitFor(() => expect(copyText).toHaveBeenCalledWith(text));
  });
});
