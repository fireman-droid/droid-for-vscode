// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useReviewFileNavigation } from './useReviewFileNavigation';
import { captureReviewPosition, restoreReviewPosition } from './useReviewReadingPosition';
import type { ReviewScopeState } from '../../shared/protocol/reviewProtocol';
import type { ReviewActions } from './useReviewActions';
afterEach(cleanup);
const scope: ReviewScopeState = { sessionId: 's', reviewScopeId: 'r', scopeKind: 'workspace', baseline: 'head', baselineLabel: 'HEAD',
  lifecycle: 'reviewing', currentIndex: 0, reviewedCount: 0, reviewableCount: 3,
  files: ['a.ts', 'hidden.ts', 'b.ts'].map(path => ({ path, additions: 1, deletions: 1, version: path, status: 'unreviewed', restorable: false })) };
it('moves only among filtered paths and advances after the marked version is confirmed', () => {
  const select = vi.fn();
  const actions = { onMarkReviewed: vi.fn() } as unknown as ReviewActions;
  const view = renderHook(({ state, paths }) => useReviewFileNavigation(state, paths, 'a.ts', select, actions),
    { initialProps: { state: scope, paths: ['a.ts', 'b.ts'] } });
  act(() => view.result.current.navigate('next'));
  expect(select).toHaveBeenLastCalledWith('b.ts'); select.mockClear();
  act(() => view.result.current.markAndNext());
  expect(actions.onMarkReviewed).toHaveBeenCalledWith(false); expect(select).not.toHaveBeenCalled();
  view.rerender({ state: { ...scope, files: scope.files.map(file => ({ ...file, status: file.path === 'a.ts' ? 'reviewed' : file.status })) }, paths: ['b.ts'] });
  expect(select).toHaveBeenLastCalledWith('b.ts');
});
it('does not advance if the file changes before the mark is confirmed', () => {
  const select = vi.fn(); const actions = { onMarkReviewed: vi.fn() } as unknown as ReviewActions;
  const view = renderHook(({ state }) => useReviewFileNavigation(state, ['a.ts', 'b.ts'], 'a.ts', select, actions), { initialProps: { state: scope } });
  act(() => view.result.current.markAndNext());
  view.rerender({ state: { ...scope, files: scope.files.map(file => ({ ...file, version: 'new', status: 'reviewed' })) } });
  expect(select).not.toHaveBeenCalled();
});
it('keeps the visible source line after insertions and preserves horizontal reading position', () => {
  const container = document.createElement('div');
  container.getBoundingClientRect = () => ({ top: 10 } as DOMRect);
  container.scrollTop = 200; container.scrollLeft = 40;
  const row = document.createElement('div'); row.dataset.diffAfter = '10'; row.innerHTML = '<code>const current = 1;</code>';
  row.getBoundingClientRect = () => ({ top: 20, bottom: 42 } as DOMRect); container.append(row);
  const position = captureReviewPosition(container);
  row.dataset.diffAfter = '12'; row.getBoundingClientRect = () => ({ top: 64, bottom: 86 } as DOMRect);
  restoreReviewPosition(container, position);
  expect(container.scrollTop).toBe(244); expect(container.scrollLeft).toBe(40);
  restoreReviewPosition(container, { top: 70, left: 12 });
  expect(container.scrollTop).toBe(70); expect(container.scrollLeft).toBe(12);
});
