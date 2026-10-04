// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useReviewWorkbench } from './useReviewWorkbench';
import type { ReviewScopeState } from '../../shared/protocol/reviewProtocol';
afterEach(() => { cleanup(); vi.useRealTimers(); });
const scope: ReviewScopeState = { sessionId: 's1', reviewScopeId: 'original', scopeKind: 'workspace',
  baseline: 'head', baselineLabel: 'HEAD → working tree', lifecycle: 'reviewing', currentIndex: 0,
  reviewedCount: 0, reviewableCount: 1,
  files: [{ path: 'a.ts', version: 'v1', additions: 1, deletions: 1, status: 'current', restorable: false }] };
function send(data: unknown) { act(() => window.dispatchEvent(new MessageEvent('message', { data }))); }
function setup() {
  const port = { postMessage: vi.fn() };
  const view = renderHook(() => useReviewWorkbench(port));
  send({ type: 'reviewPanel.context', sessionId: 's1', valid: true, latestTurnId: 't1', operation: null, operationPath: null });
  send({ type: 'review.state', sequence: 1, state: scope });
  const request = port.postMessage.mock.calls.at(-1)![0];
  send({ type: 'reviewPanel.file', requestId: request.requestId, reviewScopeId: 'original', path: 'a.ts', version: 'v1',
    patch: '@@ -1 +1 @@\n-old\n+saved', truncated: false, error: null });
  return { port, view, latest: () => port.postMessage.mock.calls.at(-1)![0] };
}
it('keeps readable content while switching and ignores stale errors, state and unrelated native errors', () => {
  const { view, latest } = setup();
  act(() => view.result.current.openScope('staged'));
  const first = latest();
  expect(first.requestId).toBeTruthy();
  expect(view.result.current.file?.patch).toContain('saved');
  send({ type: 'review.operationResult', sequence: 2, sessionId: 's1', reviewScopeId: 'review', operation: 'open',
    requestId: first.requestId, ok: false, message: 'Index unavailable' });
  expect(view.result.current.scopePending).toBe(false);
  act(() => view.result.current.openScope('unstaged'));
  const second = latest();
  send({ type: 'reviewPanel.error', requestId: 'native-old', sessionId: 's1', message: 'Native error' });
  send({ type: 'reviewPanel.error', requestId: first.requestId, sessionId: 's1', message: 'Old error' });
  send({ type: 'review.state', sequence: 3, requestId: first.requestId, state: { ...scope, scopeKind: 'staged' } });
  expect(view.result.current.scopePending).toBe(true);
  expect(view.result.current.error).toBeNull();
  send({ type: 'review.state', sequence: 4, requestId: second.requestId,
    state: { ...scope, scopeKind: 'unstaged', reviewScopeId: 'unstaged' } });
  expect(view.result.current.scopePending).toBe(false);
  expect(view.result.current.review?.scopeKind).toBe('unstaged');
  send({ type: 'review.state', sequence: 5, state: scope });
  expect(view.result.current.review?.scopeKind).toBe('unstaged');
});
it('times out only the current scope request and resets it when the target becomes invalid', () => {
  vi.useFakeTimers();
  const { view, latest } = setup();
  act(() => view.result.current.openScope('staged'));
  const request = latest();
  act(() => vi.advanceTimersByTime(35_000));
  expect(view.result.current.scopePending).toBe(false);
  expect(view.result.current.error).toContain('did not finish');
  expect(view.result.current.file?.patch).toContain('saved');
  send({ type: 'review.state', sequence: 2, requestId: request.requestId, state: { ...scope, scopeKind: 'staged' } });
  expect(view.result.current.review?.scopeKind).toBe('workspace');
  act(() => view.result.current.openScope('staged'));
  send({ type: 'reviewPanel.context', sessionId: 's1', valid: false, latestTurnId: null, operation: null, operationPath: null });
  expect(view.result.current.scopePending).toBe(false);
  expect(view.result.current.review).toBeNull();
  act(() => vi.advanceTimersByTime(35_000));
  expect(view.result.current.error).toBeNull();
});
it('requests local branch refs and waits for selection when no unambiguous default exists', () => {
  const { view, latest } = setup();
  act(() => view.result.current.openScope('branch'));
  const request = latest();
  expect(request.type).toBe('review.listBranches');
  send({ type: 'review.branches', sequence: 2, sessionId: 's1', requestId: request.requestId, refs: ['refs/heads/develop'] });
  expect(view.result.current.scopePending).toBe(false);
  expect(view.result.current.review?.scopeKind).toBe('workspace');
  act(() => view.result.current.openScope('branch', 'refs/heads/develop'));
  expect(latest()).toMatchObject({ type: 'review.open', scopeKind: 'branch', baseBranch: 'refs/heads/develop' });
});
it('lists candidates for a restored branch without replacing its chosen base with the default', () => {
  const { view, latest } = setup();
  send({ type: 'reviewPanel.context', sessionId: 's1', valid: true, resetReview: true,
    latestTurnId: 't1', operation: null, operationPath: null });
  send({ type: 'review.state', sequence: 2, state: { ...scope, scopeKind: 'branch', baseBranch: 'refs/heads/release' } });
  const request = latest();
  expect(request.type).toBe('review.listBranches');
  send({ type: 'review.branches', sequence: 3, sessionId: 's1', requestId: request.requestId,
    refs: ['refs/heads/release', 'refs/remotes/origin/main'], defaultBranch: 'refs/remotes/origin/main' });
  expect(view.result.current.review?.baseBranch).toBe('refs/heads/release');
  expect(view.result.current.branches?.refs).toHaveLength(2);
  expect(latest().type).toBe('review.listBranches');
});
