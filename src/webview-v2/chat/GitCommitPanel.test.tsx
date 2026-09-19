// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { GitCommitFlowContext, type GitCommitFlowContextValue } from '../../webview/assistant/changes/gitCommitFlow';
import { initialGitCommitFlowState } from '../../webview/assistant/changes/gitCommitStore';
import { ReviewDock } from './ReviewDock';

afterEach(cleanup);
const flow: GitCommitFlowContextValue = {
  state: { ...initialGitCommitFlowState, availability: 'available', statusTurnId: 'turn-1', branch: 'main', files: [
    { path: 'src/app.ts', status: 'modified', staged: false, inTurn: true },
    { path: 'unrelated.txt', status: 'untracked', staged: false, inTurn: false },
  ] },
  latestChangesTurnId: 'turn-1', promptText: 'Update the app', onRequestStatus: vi.fn(), onCommit: vi.fn(),
};

it('keeps the inline commit form inside Review, preserves edited input on failure, and restores More focus on Escape', async () => {
  const user = userEvent.setup();
  const review = { sessionId: 'session-1', reviewScopeId: 'scope-1', scopeKind: 'turn' as const, turnId: 'turn-1', baseline: 'before-1', baselineLabel: 'Before turn', lifecycle: 'complete' as const,
    files: [{ path: 'src/app.ts', additions: 1, deletions: 1, version: 'v1', status: 'current' as const, restorable: true }], currentIndex: 0, reviewedCount: 0, reviewableCount: 1 };
  const props = {
    changes: { kind: 'changes' as const, id: 'changes-1', turnId: 'turn-1', files: [{ path: 'src/app.ts', additions: 1, deletions: 1 }] },
    review, restorePreview: null, operation: null, agent: null,
    onOpenScope: vi.fn(), onSelectFile: vi.fn(), onNavigate: vi.fn(), onMarkReviewed: vi.fn(), onPreviewRestore: vi.fn(), onConfirmRestore: vi.fn(), onRunAgentReview: vi.fn(),
  };
  const view = render(<GitCommitFlowContext.Provider value={flow}><ReviewDock {...props} /></GitCommitFlowContext.Provider>);
  await user.click(screen.getByRole('button', { name: /1 file changed/ }));
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(screen.getByRole('button', { name: 'Commit…' }));
  await screen.findByRole('group', { name: 'Commit changes' });
  expect(screen.getByRole('checkbox', { name: /src\/app.ts/ }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('checkbox', { name: /unrelated.txt/ }).getAttribute('aria-checked')).toBe('false');
  await user.clear(screen.getByRole('textbox', { name: 'Commit message' }));
  await user.type(screen.getByRole('textbox', { name: 'Commit message' }), 'fix: preserve my message');
  await user.click(screen.getByRole('button', { name: 'Commit', exact: true }));
  expect(flow.onCommit).toHaveBeenCalledExactlyOnceWith('turn-1', ['src/app.ts'], 'fix: preserve my message');
  const failed = { ...flow, state: { ...flow.state, commitTurnId: 'turn-1', lastResult: { ok: false as const, error: 'Commit was rejected' } } };
  view.rerender(<GitCommitFlowContext.Provider value={failed}><ReviewDock {...props} /></GitCommitFlowContext.Provider>);
  expect(screen.getByRole('alert').textContent).toBe('Commit was rejected');
  expect((screen.getByRole('textbox', { name: 'Commit message' }) as HTMLTextAreaElement).value).toBe('fix: preserve my message');
  await user.keyboard('{Escape}');
  await waitFor(() => {
    expect(screen.queryByRole('group', { name: 'Commit changes' })).toBeNull();
    expect(document.activeElement?.textContent).toBe('More');
  });
});
