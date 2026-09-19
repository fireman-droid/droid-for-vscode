// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';
import { ReviewApp } from './ReviewApp';
import { ReviewCommit } from './ReviewCommit';
import { ReviewFiles } from './ReviewFiles';
import type { ReviewScopeState } from '../../shared/protocol/reviewProtocol';
afterEach(cleanup);
beforeEach(() => { HTMLElement.prototype.scrollTo = vi.fn(); });
function send(data: unknown) { act(() => window.dispatchEvent(new MessageEvent('message', { data }))); }
const target = { type: 'reviewPanel.context', sessionId: 's1', valid: true, latestTurnId: 't1', operation: null, operationPath: null };
const scope: ReviewScopeState = {
  sessionId: 's1', reviewScopeId: 'scope1', scopeKind: 'workspace', baseline: 'head:worktree',
  baselineLabel: 'HEAD → working tree', lifecycle: 'reviewing', currentIndex: 0, reviewedCount: 0, reviewableCount: 2,
  files: ['a.ts', 'b.ts'].map((path) => ({ path, additions: 1, deletions: 1, status: 'unreviewed', version: path, restorable: false })),
};
it('distinguishes filtered-empty from clean scopes and restores hidden rows when filters are cleared', () => {
  render(<ReviewFiles files={scope.files} selected={null} onSelect={vi.fn()} />);
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter files' }), { target: { value: 'missing' } });
  expect(screen.getByText('0 / 2')).toBeDefined();
  expect(screen.getByText('No matching files.')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
  expect(screen.getByRole('button', { name: /a.ts/ })).toBeDefined();
  expect(screen.getByRole('button', { name: /b.ts/ })).toBeDefined();
});
it('keeps navigation inside Review, rejects stale file responses and supports range switching', async () => {
  const user = userEvent.setup();
  const port = { postMessage: vi.fn() };
  render(<ReviewApp port={port} />);
  send(target);
  send({ type: 'review.state', sequence: 1, state: scope });
  const first = port.postMessage.mock.calls.find(([entry]) => entry.type === 'reviewPanel.readFile')![0];
  fireEvent.click(screen.getByRole('button', { name: /b.ts/ }));
  expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'review.selectFile', path: 'b.ts' }));
  send({ type: 'review.state', sequence: 2, state: { ...scope, currentIndex: 1 } });
  const second = port.postMessage.mock.calls.filter(([entry]) => entry.type === 'reviewPanel.readFile').at(-1)![0];
  send({ type: 'reviewPanel.file', requestId: second.requestId, reviewScopeId: scope.reviewScopeId,
    path: 'b.ts', version: 'b.ts', patch: '@@ -1 +1 @@\n-old\n+selected', truncated: false, error: null });
  send({ type: 'reviewPanel.file', requestId: first.requestId, reviewScopeId: scope.reviewScopeId,
    path: 'a.ts', version: 'a.ts', patch: '@@ -1 +1 @@\n-old\n+obsolete', truncated: false, error: null });
  expect(screen.getByText('selected')).toBeDefined();
  expect(screen.queryByText('obsolete')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mark & next' }));
  expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'review.markReviewed', path: 'b.ts', version: 'b.ts', advance: true }));
  await user.click(screen.getByRole('combobox', { name: 'Comparison scope' }));
  await user.click(screen.getByRole('option', { name: 'Staged', exact: true }));
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'review.open', sessionId: 's1', scopeKind: 'staged' });
  send({ type: 'review.state', sequence: 3, state: scope });
  expect(screen.getByText('Loading comparison…', { selector: '.review-rangebar span' })).toBeDefined();
  send({ type: 'review.state', sequence: 4, state: { ...scope, scopeKind: 'staged', reviewScopeId: 'staged1', baseline: 'head:index' } });
  expect(screen.getByRole('combobox', { name: 'Comparison scope' }).textContent).toBe('Staged');
  const context = screen.getByRole('combobox', { name: 'Context lines' });
  context.focus();
  await user.keyboard('{Enter}');
  await user.keyboard('{ArrowDown}{Enter}');
  expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'reviewPanel.readFile', context: 20 }));
  await user.click(context);
  await user.keyboard('{Escape}');
  expect(document.activeElement).toBe(context);
  const width = screen.getByRole('slider', { name: 'File sidebar width' });
  width.focus();
  await user.keyboard('{ArrowRight}');
  expect(width.getAttribute('aria-valuenow')).toBe('250');
  send({ ...target, valid: false });
  expect(screen.getByText(/no longer active/)).toBeDefined();
});
it('requires explicit staged selection and preserves the commit draft after a failure', () => {
  const port = { postMessage: vi.fn() };
  render(<ReviewCommit port={port} sessionId="s1" onClose={vi.fn()} />);
  send({ type: 'git.status', sequence: 0, sessionId: 's1', turnId: 'review', branch: 'main',
    files: [{ path: 'a.ts', status: 'modified', staged: true, inTurn: false }] });
  fireEvent.change(screen.getByRole('textbox', { name: 'Commit message' }), { target: { value: 'fix: reviewed files' } });
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Commit selected files' }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Commit selected files' }));
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'reviewPanel.commit', paths: ['a.ts'], message: 'fix: reviewed files' });
  send({ type: 'git.commitResult', sequence: 0, sessionId: 's1', turnId: 'review', ok: false, error: 'Hook failed' });
  expect(screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Commit message' }).value).toBe('fix: reviewed files');
  expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('alert').textContent).toBe('Hook failed');
});
it('requires a conflict-free preview before restoring the exact reviewed turn version', () => {
  const port = { postMessage: vi.fn() };
  render(<ReviewApp port={port} />);
  send(target);
  const turn = { ...scope, scopeKind: 'turn', turnId: 't1', files: [
    { ...scope.files[0]!, restorable: true },
  ], reviewableCount: 1 };
  send({ type: 'review.state', sequence: 1, state: turn });
  fireEvent.click(screen.getByRole('button', { name: 'Restore file…' }));
  expect(port.postMessage).toHaveBeenCalledWith({
    type: 'review.restorePreview', sessionId: 's1', reviewScopeId: 'scope1',
    baseline: 'head:worktree', target: 'file', path: 'a.ts', version: 'a.ts',
  });
  const preview = { type: 'review.restorePreview', sequence: 2, sessionId: 's1', reviewScopeId: 'scope1',
    previewId: 'preview1', target: 'file', restorable: [], conflicted: ['a.ts'], created: [], deleted: [] };
  send(preview);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Confirm restore' }).disabled).toBe(true);
  send({ ...preview, sequence: 3, restorable: ['a.ts'], conflicted: [] });
  fireEvent.click(screen.getByRole('button', { name: 'Confirm restore' }));
  expect(port.postMessage).toHaveBeenCalledWith({
    type: 'review.restoreFile', sessionId: 's1', reviewScopeId: 'scope1', baseline: 'head:worktree', previewId: 'preview1',
  });
});
it('shows historical excerpts with working change navigation instead of inapplicable actions', () => {
  const port = { postMessage: vi.fn() };
  render(<ReviewApp port={port} />);
  send(target);
  send({ type: 'review.state', sequence: 1, state: { ...scope, scopeKind: 'turn', turnId: 't1',
    lifecycle: 'unavailable', recordedOnly: true, reviewableCount: 0, baselineLabel: 'Recorded operations · no full turn snapshot',
    files: [{ ...scope.files[0]!, status: 'open-only' }] } });
  const request = port.postMessage.mock.calls.find(([entry]) => entry.type === 'reviewPanel.readFile')![0];
  send({ type: 'reviewPanel.file', requestId: request.requestId, reviewScopeId: scope.reviewScopeId,
    path: 'a.ts', version: 'excerpts', patch: '', truncated: false, error: null,
    recordedOperations: [
      { toolUseId: 'first', patch: '@@ -1 +1 @@\n-before\n+middle' },
      { toolUseId: 'second', patch: '@@ -1 +1 @@\n-middle\n+after' },
    ] });
  expect(screen.getByText('Recorded operation 1 · successful tool input · excerpt')).toBeDefined();
  expect(screen.getByText('Recorded operation 2 · successful tool input · excerpt')).toBeDefined();
  expect(screen.getByText('before')).toBeDefined();
  expect(screen.getByText('after')).toBeDefined();
  for (const name of ['Native Diff', 'Restore file…', 'Restore turn…', 'Mark & next'])
    expect(screen.queryByRole('button', { name })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Context lines' })).toBeNull();
  expect(screen.getByText('Saved operation excerpts · full turn snapshot unavailable')).toBeDefined();
  const hunk = document.querySelector<HTMLElement>('[data-diff-hunk]')!;
  hunk.getBoundingClientRect = () => ({ top: 100 } as DOMRect);
  const scroller = hunk.closest<HTMLElement>('.review-code-scroll')!;
  scroller.scrollBy = vi.fn();
  fireEvent.click(screen.getByRole('button', { name: 'Next change' }));
  expect(scroller.scrollBy).toHaveBeenCalledWith({ top: 100, behavior: 'smooth' });
  fireEvent.click(screen.getByRole('button', { name: 'Open current file' }));
  expect(port.postMessage).toHaveBeenCalledWith({ type: 'reviewPanel.openPath', path: 'a.ts' });
});
