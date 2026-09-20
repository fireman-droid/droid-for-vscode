// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiffView } from '../../../packages/chat-ui/src/review/DiffView';

const observers: ViewportObserver[] = [];
class ViewportObserver {
  readonly elements = new Set<Element>();
  constructor(private readonly callback: IntersectionObserverCallback) { observers.push(this); }
  observe(element: Element) { this.elements.add(element); }
  unobserve(element: Element) { this.elements.delete(element); }
  disconnect() { this.elements.clear(); }
  reveal(elements = [...this.elements]) {
    act(() => this.callback(elements.map((target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry), this as unknown as IntersectionObserver));
  }
}
beforeEach(() => { observers.length = 0; vi.stubGlobal('IntersectionObserver', ViewportObserver); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
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
  const hunks = [...document.querySelectorAll('[data-diff-hunk]')];
  expect(hunks.map((hunk) => hunk.textContent)).toEqual(['@@ -0,0 +1,300 @@', '@@ -600 +600 @@']);
  expect(screen.queryByText('last-after')).toBeNull();
  const observer = observers[0]!;
  observer.reveal([[...observer.elements].at(-1)!]);
  expect(screen.getByText('last-before')).toBeDefined();
  expect(screen.getByText('last-after')).toBeDefined();
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
