// @vitest-environment jsdom
import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SelectionToolbar } from '../../src/chat/SelectionToolbar';

afterEach(() => { cleanup(); window.getSelection()?.removeAllRanges(); vi.restoreAllMocks(); });

it('leaves drag selection untouched and only offers quote actions after the pointer is released', async () => {
  const root = createRef<HTMLDivElement>();
  const quote = vi.fn();
  render(<div ref={root}><p>Keep this selected text</p><SelectionToolbar viewport={root} onQuote={quote} /></div>);
  vi.spyOn(root.current!, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 480, top: 0, bottom: 400 } as DOMRect);
  const text = screen.getByText('Keep this selected text');
  const range = document.createRange();
  range.selectNodeContents(text);
  range.getBoundingClientRect = () => ({ left: 20, right: 200, top: 100, bottom: 120 }) as DOMRect;
  const selection = window.getSelection()!;
  fireEvent.pointerDown(text);
  act(() => { selection.removeAllRanges(); selection.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
  await act(async () => { await new Promise(requestAnimationFrame); });
  expect(screen.queryByRole('toolbar')).toBeNull();
  expect(selection.toString()).toBe('Keep this selected text');
  fireEvent.pointerUp(text);
  await waitFor(() => expect(screen.getByRole('toolbar')).toBeDefined());
  expect(selection.toString()).toBe('Keep this selected text');
  fireEvent.mouseDown(screen.getByRole('button', { name: 'Add to Chat' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add to Chat' }));
  expect(quote).toHaveBeenCalledExactlyOnceWith('Keep this selected text');
  expect(selection.isCollapsed).toBe(true);
});

it('quotes the selected prose around a status without including its UI text', async () => {
  const root = createRef<HTMLDivElement>();
  const quote = vi.fn();
  render(<div ref={root}><p>First paragraph</p><p role="status">Restored three files</p><p>Last paragraph</p>
    <SelectionToolbar viewport={root} onQuote={quote} /></div>);
  vi.spyOn(root.current!, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 480, top: 0, bottom: 400 } as DOMRect);
  const first = screen.getByText('First paragraph'), last = screen.getByText('Last paragraph');
  const range = document.createRange();
  range.setStart(first.firstChild!, 0); range.setEnd(last.firstChild!, last.textContent!.length);
  range.getBoundingClientRect = () => ({ left: 20, right: 200, top: 100, bottom: 160 }) as DOMRect;
  act(() => { window.getSelection()!.addRange(range); document.dispatchEvent(new Event('selectionchange')); });
  await waitFor(() => expect(screen.getByRole('toolbar')).toBeDefined());
  fireEvent.click(screen.getByRole('button', { name: 'Add to Chat' }));
  expect(quote).toHaveBeenCalledExactlyOnceWith('First paragraph\nLast paragraph');
  expect(screen.getByRole('status').textContent).toBe('Restored three files');
});
