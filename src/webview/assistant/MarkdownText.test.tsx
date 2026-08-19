// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MAX_INLINE_PREVIEW_HTML_LENGTH } from '../../shared/bridgeMessages';
import {
  CodeBlock,
  DroidMarkdownContent,
  InlineHtmlPreviewContext,
  isInlineHtmlPreviewCandidate,
  isLocalImagePath,
  isSafeMarkdownUrl,
  LocalImageContext,
  markdownUrlTransform,
  OpenPathContext,
  PathPreviewContext,
  previewablePathOf,
  SafeLink,
  safeMarkdownUrlTransform,
} from './MarkdownText';

afterEach(cleanup);

describe('safe Markdown links', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,bad',
    'file:///etc/passwd',
    'command:workbench.action.openSettings',
    'mailto:user@example.com',
    '/relative/path',
  ])('rejects %s', (href) => {
    expect(isSafeMarkdownUrl(href)).toBe(false);
    expect(safeMarkdownUrlTransform(href)).toBe('');
    render(<SafeLink href={href}>unsafe</SafeLink>);
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('unsafe').tagName).toBe('SPAN');
    cleanup();
  });

  it('opens only http and https links with isolated opener state', () => {
    expect(isSafeMarkdownUrl('http://localhost:3000/docs')).toBe(true);
    render(
      <SafeLink href="https://example.com/docs">documentation</SafeLink>,
    );
    const link = screen.getByRole<HTMLAnchorElement>('link');
    expect(link.target).toBe('_blank');
    expect(link.rel).toBe('noreferrer noopener');
    expect(link.href).toBe('https://example.com/docs');
  });
});

describe('inline code path links', () => {
  const PDF_PATH =
    'D:\\E\\前端好玩的东西\\react+ts\\个人简历\\artifacts\\林泽楷-简历.pdf';

  it('makes an inline-code absolute path clickable', () => {
    const onOpenPath = vi.fn();
    render(
      <OpenPathContext.Provider value={onOpenPath}>
        <DroidMarkdownContent text={`本地路径：\`${PDF_PATH}\``} />
      </OpenPathContext.Provider>,
    );
    const button = screen.getByRole('button', {
      name: PDF_PATH,
    });
    expect(button.className).toBe('dvx-path-link');
    expect(button.closest('code')).not.toBeNull();
    fireEvent.click(button);
    expect(onOpenPath).toHaveBeenCalledExactlyOnceWith({
      path: PDF_PATH,
    });
  });

  it('passes a parsed :line:col suffix along', () => {
    const onOpenPath = vi.fn();
    render(
      <OpenPathContext.Provider value={onOpenPath}>
        <DroidMarkdownContent text={'See `src/webview/assistant/App.tsx:42:7`.'} />
      </OpenPathContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onOpenPath).toHaveBeenCalledExactlyOnceWith({
      path: 'src/webview/assistant/App.tsx',
      line: 42,
      column: 7,
    });
  });

  it('leaves ordinary inline code alone', () => {
    const onOpenPath = vi.fn();
    render(
      <OpenPathContext.Provider value={onOpenPath}>
        <DroidMarkdownContent text={'Run `pnpm run build` and `a/b`.'} />
      </OpenPathContext.Provider>,
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('never links paths inside fenced code blocks', () => {
    const onOpenPath = vi.fn();
    const { container } = render(
      <OpenPathContext.Provider value={onOpenPath}>
        <DroidMarkdownContent
          text={'```\nD:\\E\\artifacts\\report.pdf\n```'}
        />
      </OpenPathContext.Provider>,
    );
    expect(container.querySelector('.dvx-path-link')).toBeNull();
  });

  it('stays inert without a provided handler', () => {
    render(<DroidMarkdownContent text={`\`${PDF_PATH}\``} />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('path-link Preview entry', () => {
  const ROOT = 'd:\\E\\前端好玩的东西\\droidvisx';
  const HTML_PATH = 'D:\\E\\前端好玩的东西\\droidvisx\\artifacts\\烟花.html';

  function renderWithWiring(
    text: string,
    wiring: Parameters<typeof previewablePathOf>[0],
  ): { onOpenPath: ReturnType<typeof vi.fn> } {
    const onOpenPath = vi.fn();
    render(
      <OpenPathContext.Provider value={onOpenPath}>
        <PathPreviewContext.Provider value={wiring}>
          <DroidMarkdownContent text={text} />
        </PathPreviewContext.Provider>
      </OpenPathContext.Provider>,
    );
    return { onOpenPath };
  }

  it('resolves previewable workspace paths and refuses the rest', () => {
    const wiring = { workspaceRoot: ROOT, previewFile: vi.fn() };
    expect(previewablePathOf(wiring, { path: HTML_PATH })).toBe(
      'artifacts/烟花.html',
    );
    expect(previewablePathOf(wiring, { path: 'src/demo/a.htm' })).toBe(
      'src/demo/a.htm',
    );
    // Outside the workspace, wrong extension, no wiring, no root.
    expect(
      previewablePathOf(wiring, { path: 'C:\\Users\\me\\烟花.html' }),
    ).toBeNull();
    expect(previewablePathOf(wiring, { path: `${ROOT}\\a.pdf` })).toBeNull();
    expect(previewablePathOf(null, { path: HTML_PATH })).toBeNull();
    expect(
      previewablePathOf(
        { workspaceRoot: null, previewFile: vi.fn() },
        { path: HTML_PATH },
      ),
    ).toBeNull();
  });

  it('offers Preview next to an inside-root HTML path link', () => {
    const previewFile = vi.fn();
    renderWithWiring(`写好了：\`${HTML_PATH}\``, {
      workspaceRoot: ROOT,
      previewFile,
    });
    const chip = screen.getByRole('button', { name: 'Canvas' });
    expect(chip.className).toBe('dvx-preview-chip dvx-path-preview-chip');
    fireEvent.click(chip);
    expect(previewFile).toHaveBeenCalledExactlyOnceWith(
      'artifacts/烟花.html',
    );
  });

  it('keeps the path link itself opening the editor', () => {
    const { onOpenPath } = renderWithWiring(`\`${HTML_PATH}\``, {
      workspaceRoot: ROOT,
      previewFile: vi.fn(),
    });
    fireEvent.click(screen.getByRole('button', { name: HTML_PATH }));
    expect(onOpenPath).toHaveBeenCalledExactlyOnceWith({
      path: HTML_PATH,
    });
  });

  it('shows no Preview for out-of-workspace or non-HTML paths', () => {
    renderWithWiring(
      '看 `C:\\Users\\me\\烟花.html` 和 `D:\\E\\前端好玩的东西\\droidvisx\\a.pdf`。',
      { workspaceRoot: ROOT, previewFile: vi.fn() },
    );
    expect(
      screen.queryByRole('button', { name: 'Canvas' }),
    ).toBeNull();
    // The links themselves still render.
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('shows no Preview without a workspace root or wiring', () => {
    renderWithWiring(`\`${HTML_PATH}\``, {
      workspaceRoot: null,
      previewFile: vi.fn(),
    });
    expect(
      screen.queryByRole('button', { name: 'Canvas' }),
    ).toBeNull();
    cleanup();
    const onOpenPath = vi.fn();
    render(
      <OpenPathContext.Provider value={onOpenPath}>
        <DroidMarkdownContent text={`\`${HTML_PATH}\``} />
      </OpenPathContext.Provider>,
    );
    expect(
      screen.queryByRole('button', { name: 'Canvas' }),
    ).toBeNull();
  });
});

describe('markdown images', () => {
  // 1x1 transparent PNG.
  const PIXEL =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

  it('classifies local image paths without treating schemes as paths', () => {
    expect(isLocalImagePath('out/plot.png')).toBe(true);
    expect(isLocalImagePath('D:\\reports\\chart.jpeg')).toBe(true);
    expect(isLocalImagePath('https://example.com/x.png')).toBe(false);
    expect(isLocalImagePath('javascript:alert(1)')).toBe(false);
    expect(isLocalImagePath('out/notes.txt')).toBe(false);
    // The transform keeps image srcs and still strips link hrefs.
    expect(markdownUrlTransform('out/plot.png', 'src')).toBe(
      'out/plot.png',
    );
    expect(markdownUrlTransform('out/plot.png', 'href')).toBe('');
  });

  it('renders remote images directly', () => {
    render(
      <DroidMarkdownContent
        text={'![chart](https://example.com/chart.png)'}
      />,
    );
    const image = screen.getByAltText<HTMLImageElement>('chart');
    expect(image.src).toBe('https://example.com/chart.png');
  });

  it('requests local image bytes and renders them once resolved', () => {
    const request = vi.fn();
    const { rerender } = render(
      <LocalImageContext.Provider value={{ entries: {}, request }}>
        <DroidMarkdownContent text={'![plot](out/plot.png)'} />
      </LocalImageContext.Provider>,
    );
    expect(request).toHaveBeenCalledExactlyOnceWith('out/plot.png');
    expect(screen.getByRole('status').textContent).toContain(
      'Loading image…',
    );
    rerender(
      <LocalImageContext.Provider
        value={{
          entries: {
            'out/plot.png': {
              status: 'ok',
              mediaType: 'image/png',
              data: PIXEL,
            },
          },
          request,
        }}
      >
        <DroidMarkdownContent text={'![plot](out/plot.png)'} />
      </LocalImageContext.Provider>,
    );
    const thumb = screen.getByRole('button', { name: /Enlarge image/ });
    expect(thumb.querySelector('img')?.src).toContain(
      'data:image/png;base64,',
    );
  });

  it('degrades a missing local image to a clickable path link', () => {
    const onOpenPath = vi.fn();
    render(
      <OpenPathContext.Provider value={onOpenPath}>
        <LocalImageContext.Provider
          value={{
            entries: {
              'out/plot.png': {
                status: 'not-found',
                mediaType: null,
                data: '',
              },
            },
            request: vi.fn(),
          }}
        >
          <DroidMarkdownContent text={'![plot](out/plot.png)'} />
        </LocalImageContext.Provider>
      </OpenPathContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'out/plot.png' }));
    expect(onOpenPath).toHaveBeenCalledExactlyOnceWith({
      path: 'out/plot.png',
    });
  });

  it('falls back to plain text without any wiring', () => {
    render(<DroidMarkdownContent text={'![plot](out/plot.png)'} />);
    expect(screen.getByText('out/plot.png').tagName).toBe('CODE');
    expect(screen.queryByRole('img')).toBeNull();
  });
});

describe('HTML code block preview', () => {
  const HTML_FENCE =
    '```html\n<!DOCTYPE html>\n<html><body><p>hi</p></body></html>\n```';

  it('classifies HTML documents with the loose heuristic', () => {
    expect(isInlineHtmlPreviewCandidate('html', '<div>x</div>')).toBe(true);
    expect(isInlineHtmlPreviewCandidate('HTML', '<div>x</div>')).toBe(true);
    expect(
      isInlineHtmlPreviewCandidate(null, '  <!doctype html><p>x</p>'),
    ).toBe(true);
    expect(
      isInlineHtmlPreviewCandidate(null, '<html lang="en"></html>'),
    ).toBe(true);
    expect(isInlineHtmlPreviewCandidate(null, '<div>x</div>')).toBe(false);
    expect(isInlineHtmlPreviewCandidate('js', 'const a = 1;')).toBe(false);
    expect(isInlineHtmlPreviewCandidate('html', '   \n')).toBe(false);
  });

  it('renders a stable Canvas artifact card and sends its identity', () => {
    const onPreview = vi.fn();
    render(
      <InlineHtmlPreviewContext.Provider value={onPreview}>
        <DroidMarkdownContent text={HTML_FENCE} />
      </InlineHtmlPreviewContext.Provider>,
    );
    const button = screen.getByRole('button', {
      name: 'Open Interactive HTML artifact in Canvas',
    });
    expect(screen.getByLabelText('Copy code')).not.toBeNull();
    fireEvent.click(button);
    expect(onPreview).toHaveBeenCalledExactlyOnceWith(
      '<!DOCTYPE html>\n<html><body><p>hi</p></body></html>\n',
      expect.objectContaining({
        artifactId: expect.stringMatching(/^inline:/),
        title: 'Interactive HTML artifact',
      }),
    );
  });

  it('skips non-HTML fences and unwired renders', () => {
    const onPreview = vi.fn();
    render(
      <InlineHtmlPreviewContext.Provider value={onPreview}>
        <DroidMarkdownContent text={'```js\nconst a = 1;\n```'} />
      </InlineHtmlPreviewContext.Provider>,
    );
    expect(
      screen.queryByRole('button', {
        name: 'Open Interactive HTML artifact in Canvas',
      }),
    ).toBeNull();
    cleanup();
    render(<DroidMarkdownContent text={HTML_FENCE} />);
    expect(
      screen.queryByRole('button', {
        name: 'Open Interactive HTML artifact in Canvas',
      }),
    ).toBeNull();
  });

  it('disables the entry with an explanation when over the limit', () => {
    const onPreview = vi.fn();
    const big = `<!DOCTYPE html>${'a'.repeat(
      MAX_INLINE_PREVIEW_HTML_LENGTH,
    )}`;
    render(
      <InlineHtmlPreviewContext.Provider value={onPreview}>
        <CodeBlock>
          <code>{big}</code>
        </CodeBlock>
      </InlineHtmlPreviewContext.Provider>,
    );
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Open Interactive HTML artifact in Canvas',
    });
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Too large to open (limit 512 KB)');
    fireEvent.click(button);
    expect(onPreview).not.toHaveBeenCalled();
  });

  it('holds the entry back while the message streams', () => {
    const onPreview = vi.fn();
    const { rerender } = render(
      <InlineHtmlPreviewContext.Provider value={onPreview}>
        <CodeBlock streaming>
          <code>{'<!DOCTYPE html><p>hi</p>'}</code>
        </CodeBlock>
      </InlineHtmlPreviewContext.Provider>,
    );
    expect(
      screen.queryByRole('button', {
        name: 'Open Interactive HTML artifact in Canvas',
      }),
    ).toBeNull();
    rerender(
      <InlineHtmlPreviewContext.Provider value={onPreview}>
        <CodeBlock streaming={false}>
          <code>{'<!DOCTYPE html><p>hi</p>'}</code>
        </CodeBlock>
      </InlineHtmlPreviewContext.Provider>,
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open Interactive HTML artifact in Canvas',
      }),
    );
    expect(onPreview).toHaveBeenCalledExactlyOnceWith(
      '<!DOCTYPE html><p>hi</p>',
      expect.objectContaining({
        artifactId: expect.stringMatching(/^inline:/),
      }),
    );
  });
});
