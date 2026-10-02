// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiffView, findDiffChange } from '../../../packages/chat-ui/src/review/DiffView';

const observers: ViewportObserver[] = [];
class ViewportObserver {
  readonly elements = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) { observers.push(this); }
  observe(element: Element) { this.elements.add(element); }
  unobserve(element: Element) { this.elements.delete(element); }
  disconnect() { this.elements.clear(); }
  reveal(elements = [...this.elements]) {
    act(() => this.callback(elements.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry), this as unknown as IntersectionObserver));
  }
  hide(elements = [...this.elements]) {
    act(() => this.callback(elements.map((target) => ({ target, isIntersecting: false }) as IntersectionObserverEntry), this as unknown as IntersectionObserver));
  }
}
beforeEach(() => { observers.length = 0; vi.stubGlobal('IntersectionObserver', ViewportObserver); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.getSelection()?.removeAllRanges(); });
const patch = (prefix: string, count = 300) => `@@ -0,0 +1,${count} @@\n${Array.from({ length: count }, (_, index) => `+${prefix}-${index}`).join('\n')}`;

it('defers long diff content until it approaches the viewport and preserves the final line', () => {
  render(<DiffView patch={patch('complete')} path="large.txt" />);
  expect(screen.queryByText('complete-0')).toBeNull();
  const observer = observers[0]!;
  observer.reveal([[...observer.elements][0]!]);
  expect(screen.getByText('complete-0')).toBeDefined();
  expect(screen.queryByText('complete-299')).toBeNull();
  observer.reveal();
  expect(screen.getByText('complete-299')).toBeDefined();
  expect(document.querySelectorAll('code')).toHaveLength(300);
});

it('keeps every change target available before its content is mounted', () => {
  render(<DiffView patch={`${patch('first')}\n@@ -600 +600 @@\n-last-before\n+last-after`} path="hunks.txt" />);
  const chunks = [...document.querySelectorAll<HTMLElement>('[data-diff-changes]')];
  vi.spyOn(chunks[0]!, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 64 * 22 } as DOMRect);
  vi.spyOn(chunks[1]!, 'getBoundingClientRect').mockReturnValue({ top: 7000, height: 2 * 22 } as DOMRect);
  expect(findDiffChange(document.body, 108, 1)).toBe(7000);
  expect(findDiffChange(document.body, 6992, -1)).toBe(100);
  expect(screen.queryByText('last-after')).toBeNull();
  const observer = observers[0]!;
  observer.reveal([[...observer.elements].at(-1)!]);
  expect(screen.getByText('last-before')).toBeDefined();
  expect(screen.getByText('last-after')).toBeDefined();
});

it('navigates separate edits within the same deferred block by their actual line offsets', () => {
  render(<DiffView patch={'@@ -1,4 +1,4 @@\n first\n-before-one\n+after-one\n between\n-before-two\n+after-two'} path="edits.txt" />);
  const chunk = document.querySelector<HTMLElement>('[data-diff-changes]')!;
  vi.spyOn(chunk, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 6 * 22 } as DOMRect);
  expect(findDiffChange(document.body, 108, 1)).toBe(122);
  expect(findDiffChange(document.body, 130, 1)).toBe(188);
  expect(findDiffChange(document.body, 180, -1)).toBe(122);
  expect(findDiffChange(document.body, 196, 1)).toBeNull();
});

it('replaces revealed content on live patch updates and does not carry it into a different file', () => {
  const view = render(<DiffView patch={patch('original')} path="first.txt" />);
  observers[0]!.reveal();
  view.rerender(<DiffView patch={patch('updated')} path="first.txt" />);
  expect(screen.queryByText('original-299')).toBeNull();
  expect(screen.getByText('updated-299')).toBeDefined();
  view.rerender(<DiffView patch={patch('different')} path="second.txt" />);
  expect(screen.queryByText('updated-299')).toBeNull();
  expect(screen.queryByText('different-299')).toBeNull();
  observers[0]!.reveal();
  expect(screen.getByText('different-299')).toBeDefined();
});

it('keeps short limited chat previews immediate and respects the requested line boundary', () => {
  render(<DiffView patch={patch('preview')} path="preview.txt" limit={3} />);
  expect(screen.getByText('preview-0')).toBeDefined();
  expect(screen.getByText('preview-1')).toBeDefined();
  expect(screen.queryByText('preview-2')).toBeNull();
  expect(observers).toHaveLength(0);
});

it('preserves both sides and tail content when changing to split view', () => {
  const edit = `@@ -1,150 +1,150 @@\n${Array.from({ length: 150 }, (_, index) => `-before-${index}`).join('\n')}\n${Array.from({ length: 150 }, (_, index) => `+after-${index}`).join('\n')}`;
  const view = render(<DiffView patch={edit} path="change.txt" />);
  observers[0]!.reveal();
  view.rerender(<DiffView patch={edit} path="change.txt" split />);
  observers[0]!.reveal();
  expect(screen.getByText('before-0')).toBeDefined();
  expect(screen.getByText('after-0')).toBeDefined();
  expect(screen.getByText('before-149')).toBeDefined();
  expect(screen.getByText('after-149')).toBeDefined();
  expect(document.querySelectorAll('code')).toHaveLength(300);
});

it('renders generated long code lines in full without dropping text', () => {
  const generated = `const generated = "${'x'.repeat(20_000)}";`;
  render(<DiffView patch={`@@ -0,0 +1 @@\n+${generated}`} path="generated.ts" />);
  expect(document.querySelector('code')?.textContent).toBe(generated);
});

it('recycles code while traversing a large full-file diff and can return to its beginning', () => {
  render(<DiffView patch={patch('full-file', 20_000)} path="large.txt" split />);
  const observer = observers[0]!;
  const chunks = [...observer.elements];
  for (const index of [0, 100, chunks.length - 1]) {
    observer.hide();
    observer.reveal([chunks[index]!]);
    expect(document.querySelectorAll('code').length).toBeLessThanOrEqual(64);
  }
  expect(screen.getByText('full-file-19999')).toBeDefined();
  expect(screen.queryByText('full-file-0')).toBeNull();
  observer.hide();
  observer.reveal([chunks[0]!]);
  expect(screen.getByText('full-file-0')).toBeDefined();
  expect(screen.queryByText('full-file-19999')).toBeNull();
});

it('retains a scrolled-away native text selection until the selection is cleared', () => {
  render(<DiffView patch={patch('selectable')} path="large.txt" />);
  const observer = observers[0]!;
  const firstChunk = [...observer.elements][0]!;
  observer.reveal([firstChunk]);
  const range = document.createRange();
  range.selectNodeContents(screen.getByText('selectable-0'));
  document.getSelection()!.addRange(range);
  observer.hide([firstChunk]);
  expect(document.getSelection()!.toString()).toBe('selectable-0');
  expect(screen.getByText('selectable-0')).toBeDefined();
  act(() => { document.getSelection()!.removeAllRanges(); document.dispatchEvent(new Event('selectionchange')); });
  expect(screen.queryByText('selectable-0')).toBeNull();
});

it('uses the enclosing vertical viewport instead of a horizontal-only diff scroller', () => {
  const viewport = document.createElement('div');
  viewport.style.overflowY = 'auto';
  document.body.append(viewport);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) { return this === viewport ? 20_000 : 1_000; });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return this === viewport ? 600 : 1_000; });
  render(<DiffView patch={patch('viewport')} path="large.txt" />, { container: viewport });
  expect(observers[0]!.options?.root).toBe(viewport);
});
