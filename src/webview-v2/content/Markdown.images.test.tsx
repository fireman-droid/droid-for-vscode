// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Markdown } from '../../../packages/chat-ui/src/content/Markdown';
import { ContentProvider, type LocalImageEntry } from '../../../packages/chat-ui/src/content/context';

const url = 'https://images.example.test/plot.png?key=a%2Fb';
let visible: IntersectionObserverCallback;
beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { visible = callback; }
    observe() {} disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('requests a visible remote image through the host and previews returned bytes', () => {
  const request = vi.fn();
  const view = (entries: Record<string, LocalImageEntry>) => <ContentProvider value={{
    workspaceRoot: null, theme: 'dark', images: { entries, request },
  }}><Markdown text={`![Chart](${url})`} /></ContentProvider>;
  const { rerender } = render(view({}));
  expect(screen.queryByRole('img')).toBeNull();
  expect(request).not.toHaveBeenCalled();
  act(() => visible([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
  expect(request).toHaveBeenCalledExactlyOnceWith(url);
  rerender(view({ [url]: { status: 'ok', mediaType: 'image/png', data: 'aGk=' } }));
  expect(screen.getByRole('img', { name: 'Chart' }).getAttribute('src')).toBe('data:image/png;base64,aGk=');
  fireEvent.click(screen.getByRole('button', { name: 'Enlarge Chart' }));
  expect(screen.getByRole('dialog', { name: 'Image preview' })).toBeTruthy();
});

it.each(['not-found', 'too-large', 'unsupported'])('keeps an openable image link after %s', status => {
  render(<ContentProvider value={{ workspaceRoot: null, theme: 'dark', images: {
    request: vi.fn(), entries: { [url]: { status, mediaType: null, data: '' } },
  } }}><Markdown text={`![Chart](${url})`} /></ContentProvider>);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('link', { name: 'Chart' }).getAttribute('href')).toBe(url);
  expect(screen.getByText(/Image preview unavailable/)).toBeTruthy();
});

it('shows a source link in a surface without an image resolver', () => {
  render(<Markdown text={`![Chart](${url})`} />);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('link', { name: 'Chart' }).getAttribute('href')).toBe(url);
});

it('does not leave an over-limit image source waiting for a rejected bridge request', () => {
  const request = vi.fn();
  const longUrl = 'https://images.example.test/' + 'x'.repeat(1024);
  render(<ContentProvider value={{ workspaceRoot: null, theme: 'dark', images: { entries: {}, request } }}>
    <Markdown text={`![Chart](${longUrl})`} />
  </ContentProvider>);
  expect(screen.getByRole('link', { name: 'Chart' }).getAttribute('href')).toBe(longUrl);
  expect(request).not.toHaveBeenCalled();
});
