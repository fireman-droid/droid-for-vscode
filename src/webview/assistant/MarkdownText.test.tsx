// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DroidMarkdownContent,
  isSafeMarkdownUrl,
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
