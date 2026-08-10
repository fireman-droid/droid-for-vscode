// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  isSafeMarkdownUrl,
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
