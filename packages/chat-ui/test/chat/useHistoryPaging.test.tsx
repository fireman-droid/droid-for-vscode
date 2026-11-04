// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import type { Virtualizer } from '@tanstack/react-virtual';
import { afterEach, expect, it, vi } from 'vitest';
import { useHistoryPaging, type TranscriptPaging } from '../../src/chat/useHistoryPaging';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function setup(navigating = false) {
  const element = document.createElement('div');
  const node = document.createElement('div');
  node.dataset.historyId = 'anchor';
  element.append(node);
  Object.defineProperties(element, { clientHeight: { value: 400 }, scrollHeight: { value: 4000 } });
  element.scrollTop = 200;
  let messageTop = 200;
  const rect = (top: number) => ({ top, bottom: top + 100, height: 100, left: 0, right: 500, width: 500, x: 0, y: top, toJSON() {} });
  vi.spyOn(element, 'getBoundingClientRect').mockImplementation(() => rect(0));
  vi.spyOn(node, 'getBoundingClientRect').mockImplementation(() => rect(messageTop - element.scrollTop));
  const writeTop = vi.fn((top: number) => { element.scrollTop = top; });
  const navigation = { current: navigating ? () => 0 : null };
  const scrolling = { navigation, follow: { current: { following: false } },
    stopFollowing: vi.fn(), scrollToBottom: vi.fn(), writeTop };
  const virtualizer = { getTotalSize: () => 4000, measurementsCache: [{ start: 1700 }] } as unknown as Virtualizer<HTMLDivElement, Element>;
  const rows = [{ messageIds: ['anchor'] }];
  const viewport = { current: element };
  const page: TranscriptPaging = { version: 'history', revision: 1, hasOlder: true, hasNewer: false,
    loading: null, error: null, onRequest: vi.fn() };
  const hook = renderHook(({ paging }) => useHistoryPaging(paging, viewport, rows, virtualizer, scrolling),
    { initialProps: { paging: page } });
  return { element, navigation, writeTop, page, hook, setMessageTop: (top: number) => { messageTop = top; } };
}

it('restores a mounted anchor directly without an intermediate estimated jump', () => {
  const view = setup();
  expect(view.page.onRequest).toHaveBeenCalledOnce();
  view.setMessageTop(1200);
  view.hook.rerender({ paging: { ...view.page, revision: 2 } });
  expect(view.element.scrollTop).toBe(1200);
  expect(view.writeTop.mock.calls.map(([top]) => top)).toEqual([1200]);
});

it('does not interrupt question navigation and accepts an upward gesture at the top', () => {
  const view = setup(true);
  expect(view.page.onRequest).not.toHaveBeenCalled();
  expect(view.writeTop).not.toHaveBeenCalled();
  act(() => { view.navigation.current = null; view.element.scrollTop = 0; });
  fireEvent.wheel(view.element, { deltaY: -80 });
  expect(view.page.onRequest).toHaveBeenCalledExactlyOnceWith('older');
});
