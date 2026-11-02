// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UiEnvironmentProvider } from '../../src/environment';
import { ReplyView } from '../../src/chat/ReplyView';
import { ContentProvider } from '../../src/content/context';
import { Markdown } from '../../src/content/Markdown';
import { parseMarkdown } from '../../src/markdown/parseMarkdown';
import type { SyntaxRequest, SyntaxResponse } from '../../src/syntax/syntaxProtocol';

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
    expect(screen.queryByRole('button', { name: 'Canvas' })).toBeNull();
  });

  it('keeps HTML as inert code across streaming, settled and thinking states', () => {
    const actions = { openPath: vi.fn(), previewFile: vi.fn(), previewHtml: vi.fn() };
    const value = { actions, workspaceRoot: 'C:\\project', theme: 'dark' as const };
    const html = '<!doctype html><title>Sample</title><p>Hello</p>';
    const text = `\`\`\`html\n${html}\n\`\`\``;
    const { rerender } = render(<ContentProvider value={value}><Markdown text={text} streaming /></ContentProvider>);
    expect(screen.queryByRole('button', { name: 'Open Canvas' })).toBeNull();
    rerender(<ContentProvider value={value}><Markdown text={text} /></ContentProvider>);
    expect(screen.queryByRole('button', { name: 'Open Canvas' })).toBeNull();
    expect(actions.previewHtml).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'html code' }).textContent).toBe(`${html}\n`);
    rerender(<ContentProvider value={value}><Markdown text={text} thinking /></ContentProvider>);
    expect(screen.queryByRole('button', { name: 'Open Canvas' })).toBeNull();
  });

  it('preserves code when no syntax worker is connected', () => {
    const code = 'const settledValue = 42;\n';
    const text = `\`\`\`typescript\n${code}\`\`\``;
    const { rerender } = render(<Markdown text={text} streaming />);
    expect(screen.getByRole('region', { name: 'typescript code' }).textContent).toBe(code);
    expect(screen.queryByText('const', { exact: true })).toBeNull();

    rerender(<Markdown text={text} streaming={false} />);
    expect(screen.queryByText('const', { exact: true })).toBeNull();
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

  it('reuses settled block node references and projects unclosed code fences in place', () => {
    const first = 'Settled intro paragraph.\n\n```typescript\nconst a = 1;\n';
    const second = `${first}const b = 2;\n`;
    const nodes1 = parseMarkdown(first, false, true);
    const nodes2 = parseMarkdown(second, false, true);
    expect(nodes2).toHaveLength(2);
    expect(nodes2[0]).toBe(nodes1[0]);
    expect(JSON.stringify(nodes2[1])).toContain('const a = 1;\\nconst b = 2;\\n');
  });

  it('completes unclosed inline tokens on the live tail block while streaming without touching currency', () => {
    const { container, rerender } = render(
      <Markdown text="Price is $100 and **bold text" streaming />,
    );
    expect(container.querySelector('strong')?.textContent).toBe('bold text');
    expect(container.textContent).toContain('Price is $100 and bold text');

    rerender(<Markdown text="Check `src/index.ts" streaming />);
    expect(container.querySelector('code')?.textContent).toBe('src/index.ts');

    rerender(<Markdown text="Visit [Docs](https://example.com/guide" streaming />);
    expect(screen.getByRole('link', { name: 'Docs' }).getAttribute('href')).toBe('https://example.com/guide');

    rerender(<Markdown text="Math $x^2 + y^2" streaming />);
    expect(container.querySelector('.katex')).not.toBeNull();
  });

  it('preserves earlier highlighted code line DOM nodes and selection while streaming new lines', async () => {
    const streamKeys: (string | undefined)[] = [];
    const createSyntaxWorker = vi.fn(async () => {
      const worker = {
        onmessage: null as ((event: MessageEvent<SyntaxResponse>) => void) | null,
        onerror: null as ((event: ErrorEvent) => void) | null,
        onmessageerror: null as (() => void) | null,
        terminate: vi.fn(),
        postMessage(request: SyntaxRequest) {
          const doc = request.documents[0]!;
          streamKeys.push(doc.streamKey);
          const lines = doc.text.split('\n');
          const html: Record<number, string> = {};
          lines.forEach((line, index) => {
            html[index] = `<span class="hljs-line-${index}">${line}</span>`;
          });
          worker.onmessage?.({ data: { id: request.id, documents: [html] } } as MessageEvent<SyntaxResponse>);
        },
      };
      return worker as unknown as Worker;
    });

    const view = (code: string) => (
      <UiEnvironmentProvider value={{ assistantName: 'Droid', copyText: vi.fn(async () => {}), createSyntaxWorker }}>
        <Markdown text={`\`\`\`typescript\n${code}`} streaming />
      </UiEnvironmentProvider>
    );

    const { container, rerender } = render(view('const first = 1;\n'));
    await waitFor(() => expect(container.querySelector('.hljs-line-0')).not.toBeNull());
    const firstLineSpan = container.querySelector('.hljs-line-0')!;

    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(firstLineSpan);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.toString()).toBe('const first = 1;');

    rerender(view('const first = 1;\nconst second = 2;\n'));
    await waitFor(() => expect(container.querySelector('.hljs-line-1')).not.toBeNull());

    expect(container.querySelector('.hljs-line-0')).toBe(firstLineSpan);
    expect(selection.toString()).toBe('const first = 1;');
    expect(streamKeys.length).toBeGreaterThanOrEqual(2);
    expect(streamKeys[0]).toBeTruthy();
    expect(streamKeys[1]).toBe(streamKeys[0]);
    selection.removeAllRanges();
  });
});
