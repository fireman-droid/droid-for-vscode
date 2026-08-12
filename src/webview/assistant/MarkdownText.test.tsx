// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DroidMarkdownContent,
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
