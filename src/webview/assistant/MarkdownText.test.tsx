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

  it('offers Preview next to Copy and sends the fence source', () => {
    const onPreview = vi.fn();
    render(
      <InlineHtmlPreviewContext.Provider value={onPreview}>
        <DroidMarkdownContent text={HTML_FENCE} />
      </InlineHtmlPreviewContext.Provider>,
    );
    const button = screen.getByRole('button', { name: 'Preview HTML' });
    expect(
      button.parentElement?.querySelector('[aria-label="Copy code"]'),
    ).not.toBeNull();
    fireEvent.click(button);
    expect(onPreview).toHaveBeenCalledExactlyOnceWith(
      '<!DOCTYPE html>\n<html><body><p>hi</p></body></html>\n',
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
      screen.queryByRole('button', { name: 'Preview HTML' }),
    ).toBeNull();
    cleanup();
    render(<DroidMarkdownContent text={HTML_FENCE} />);
    expect(
      screen.queryByRole('button', { name: 'Preview HTML' }),
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
      name: 'Preview HTML',
    });
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Too large to preview (limit 512 KB)');
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
      screen.queryByRole('button', { name: 'Preview HTML' }),
    ).toBeNull();
    rerender(
      <InlineHtmlPreviewContext.Provider value={onPreview}>
        <CodeBlock streaming={false}>
          <code>{'<!DOCTYPE html><p>hi</p>'}</code>
        </CodeBlock>
      </InlineHtmlPreviewContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Preview HTML' }));
    expect(onPreview).toHaveBeenCalledExactlyOnceWith(
      '<!DOCTYPE html><p>hi</p>',
    );
  });
});
