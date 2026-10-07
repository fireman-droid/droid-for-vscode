// @vitest-environment jsdom
import './reviewBrowserTestSetup';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReviewFiles } from '../../../packages/chat-ui/src/review/ReviewFiles';

const files = Array.from({ length: 1_000 }, (_, index) => ({
  path: `src/file-${String(index).padStart(4, '0')}.ts`, status: 'unreviewed', additions: 1, deletions: 0,
}));
const isViewport = (element: HTMLElement) => element.classList.contains('review-file-list');
const previousScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
beforeEach(() => {
  // Supply only browser geometry; exercise the real virtualizer and Radix controls.
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isViewport(this) ? 330 : this.hasAttribute('data-virtual-row') ? 33 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(240);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) { return isViewport(this) ? 330 : 0; });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return isViewport(this) ? Number.parseFloat((this.firstElementChild as HTMLElement)?.style.height) || this.querySelectorAll('[data-virtual-row]').length * 33 : 0;
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value(this: HTMLElement, { top }: ScrollToOptions) {
    const previous = this.scrollTop;
    this.scrollTop = Math.max(0, Math.min(top ?? 0, this.scrollHeight - this.clientHeight));
    if (previous !== this.scrollTop) queueMicrotask(() => { if (this.isConnected) this.dispatchEvent(new Event('scroll')); });
  } });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (previousScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', previousScrollTo);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

it('keeps every long-list file reachable by End, arrows, Tab and activation', async () => {
  const user = userEvent.setup(), onSelect = vi.fn();
  render(<ReviewFiles side="right" files={files} selected={files[0]!.path} onSelect={onSelect} />);
  const first = await screen.findByRole('button', { name: /file-0000.ts/ });
  expect(screen.queryByRole('button', { name: /file-0999.ts/ })).toBeNull();
  act(() => first.focus());
  await user.keyboard('{End}');
  await waitFor(() => expect(document.activeElement?.textContent).toContain('file-0999.ts'));
  await user.keyboard('{ArrowUp}{Enter}');
  expect(onSelect).toHaveBeenLastCalledWith('src/file-0998.ts');
  await user.tab();
  expect(document.activeElement?.textContent).toContain('file-0999.ts');
  await user.keyboard('{Home}');
  await waitFor(() => expect(document.activeElement?.textContent).toBe('src'));
  await user.keyboard('{ArrowDown}');
  expect(document.activeElement?.textContent).toContain('file-0000.ts');
  // Move beyond the initial viewport without skipping unmounted files.
  for (let index = 1; index < 14; index++) fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
  for (let index = 14; index <= 18; index++) {
    await user.tab();
    expect(document.activeElement?.textContent).toContain(`file-${String(index).padStart(4, '0')}.ts`);
  }
});

it('reveals externally selected files and recovers the viewport after filtering and collapse', async () => {
  const onSelect = vi.fn();
  const view = render(<ReviewFiles side="right" files={files} selected={files[999]!.path} onSelect={onSelect} />);
  expect((await screen.findByRole('button', { name: /file-0999.ts/ })).getAttribute('aria-current')).toBe('true');
  view.rerender(<ReviewFiles side="right" files={files} selected={files[0]!.path} onSelect={onSelect} />);
  expect((await screen.findByRole('button', { name: /file-0000.ts/ })).getAttribute('aria-current')).toBe('true');
  view.rerender(<ReviewFiles side="right" files={files} selected={files[999]!.path} onSelect={onSelect} />);
  const last = await screen.findByRole('button', { name: /file-0999.ts/ });
  expect(last.getAttribute('aria-current')).toBe('true');
  const viewport = view.container.querySelector<HTMLElement>('.review-file-list')!;
  expect(viewport.scrollTop).toBeGreaterThan(0);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter files' }), { target: { value: 'file-0000' } });
  expect(await screen.findByRole('button', { name: /file-0000.ts/ })).toBeDefined();
  expect(viewport.scrollTop).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Collapse src', exact: true }));
  expect(screen.queryByRole('button', { name: /file-0000.ts/ })).toBeNull();
  view.rerender(<ReviewFiles side="right" files={files} selected={files[0]!.path} onSelect={onSelect} />);
  expect((await screen.findByRole('button', { name: /file-0000.ts/ })).getAttribute('aria-current')).toBe('true');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter files' }), { target: { value: '' } });
  expect(await screen.findByRole('button', { name: /file-0000.ts/ })).toBeDefined();
  expect(viewport.scrollTop).toBe(0);
});
