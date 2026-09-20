// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { GitCommitFlowContext, type GitCommitFlowContextValue } from './GitCommitPanel';
import { ReviewDock as LegacyReviewDock } from './ReviewDock';
import { ReviewDockSlot as LegacyReviewDockSlot } from './reviewDockSlot';
import { ReviewDockSlot as V2ReviewDockSlot } from '../../../webview-v2/chat/ReviewDock';
import { createChatStore } from '../../../webview-v2/chat/store';
import { initialAssistantWebviewState } from '../state/initialState';
import { initialGitCommitFlowState } from '../state/store';

afterEach(cleanup);

const changes = {
  id: 'changes-latest',
  kind: 'changes' as const,
  turnId: 'turn-latest',
  files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
};

const historicalReview = {
  sessionId: 'session-1',
  reviewScopeId: 'scope-old',
  scopeKind: 'turn' as const,
  turnId: 'turn-old',
  baseline: 'before-old',
  baselineLabel: 'Before turn',
  lifecycle: 'complete' as const,
  files: [
    {
      path: 'src/old.ts',
      additions: 1,
      deletions: 0,
      version: 'v1',
      status: 'current' as const,
      restorable: true,
    },
  ],
  currentIndex: 0,
  reviewedCount: 0,
  reviewableCount: 1,
};

function callbacks() {
  return {
    onOpenScope: vi.fn(),
    onSelectFile: vi.fn(),
    onNavigate: vi.fn(),
    onMarkReviewed: vi.fn(),
    onPreviewRestore: vi.fn(),
    onConfirmRestore: vi.fn(),
    onRunAgentReview: vi.fn(),
  };
}

describe.each([
  ['V1', LegacyReviewDock, LegacyReviewDockSlot],
] as const)('%s ReviewDock', (_version, ReviewDock, ReviewDockSlot) => {
  it('keeps the reviewed file version and requires a conflict-free Host preview before restoring', async () => {
    const user = userEvent.setup();
    const postMessage = vi.fn();
    const props = { changes, sessionId: 'session-1', vscode: { postMessage }, review: historicalReview, restorePreview: null, operation: null, agent: null };
    const view = render(<ReviewDockSlot {...props} />);
    await user.click(await screen.findByRole('button', { name: /1 file changed/ }));
    await user.click(screen.getByRole('button', { name: 'Mark & Next' }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'review.markReviewed', sessionId: 'session-1', reviewScopeId: 'scope-old', baseline: 'before-old', path: 'src/old.ts', version: 'v1', advance: true,
    });
    await user.click(screen.getByRole('button', { name: 'More' }));
    await user.click(screen.getByRole('button', { name: 'Restore file' }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'review.restorePreview', sessionId: 'session-1', reviewScopeId: 'scope-old', baseline: 'before-old', target: 'file', path: 'src/old.ts', version: 'v1',
    });
    const preview = { type: 'review.restorePreview' as const, sequence: 1, sessionId: 'session-1', reviewScopeId: 'scope-old', previewId: 'preview-1', target: 'file' as const, restorable: ['src/old.ts'], conflicted: ['src/old.ts'], created: [], deleted: [] };
    view.rerender(<ReviewDockSlot {...props} restorePreview={preview} />);
    await user.click(screen.getByRole('button', { name: 'Confirm restore' }));
    expect(postMessage).toHaveBeenCalledTimes(2);
    view.rerender(<ReviewDockSlot {...props} restorePreview={{ ...preview, conflicted: [] }} />);
    await user.click(screen.getByRole('button', { name: 'Confirm restore' }));
    expect(postMessage).toHaveBeenLastCalledWith({
      type: 'review.restoreFile', sessionId: 'session-1', reviewScopeId: 'scope-old', baseline: 'before-old', previewId: 'preview-1',
    });
  });

  it('does not offer latest-turn Commit while viewing a historical Turn', async () => {
    const user = userEvent.setup();
    const gitFlow: GitCommitFlowContextValue = {
      state: {
        ...initialGitCommitFlowState,
        availability: 'available',
        statusTurnId: 'turn-latest',
        branch: 'main',
        files: [
          {
            path: 'src/app.ts',
            status: 'modified',
            staged: false,
            inTurn: true,
          },
        ],
      },
      latestChangesTurnId: 'turn-latest',
      promptText: 'Update the app',
      onRequestStatus: vi.fn(),
      onCommit: vi.fn(),
    };
    render(
      <GitCommitFlowContext.Provider value={gitFlow}>
        <ReviewDock
          changes={changes}
          review={historicalReview}
          restorePreview={null}
          operation={null}
          agent={null}
          {...callbacks()}
        />
      </GitCommitFlowContext.Provider>,
    );

    await user.click(screen.getByRole('button', { name: /1 file changed/ }));
    await user.click(screen.getByRole('button', { name: 'More' }));

    expect(screen.queryByRole('button', { name: 'Commit…' })).toBeNull();
  });

  it('loads a scope without requesting a native Diff', async () => {
    const user = userEvent.setup();
    const props = callbacks();
    const { rerender } = render(
      <ReviewDock
        changes={changes}
        review={historicalReview}
        restorePreview={null}
        operation={null}
        agent={null}
        {...props}
      />,
    );

    await user.click(screen.getByRole('button', { name: /1 file changed/ }));
    await user.click(screen.getByRole('button', { name: 'Workspace' }));

    expect(props.onOpenScope).toHaveBeenCalledWith('workspace', undefined, undefined);
    expect(
      screen.getByRole('button', { name: 'Workspace' }).getAttribute('aria-pressed'),
    ).toBe('true');
    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Branch' }).disabled).toBe(true);

    rerender(
      <ReviewDock
        changes={changes}
        review={{
          ...historicalReview,
          reviewScopeId: 'scope-workspace',
          scopeKind: 'workspace',
          baseline: 'head',
          baselineLabel: 'HEAD',
        }}
        restorePreview={null}
        operation={null}
        agent={null}
        {...props}
      />,
    );

    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Branch' }).disabled).toBe(false);
    expect(screen.queryByText('Opening diff…')).toBeNull();
  });

  it('keeps the Review button as an explicit open-current action', async () => {
    const user = userEvent.setup();
    const props = callbacks();
    render(
      <ReviewDock
        changes={changes}
        review={historicalReview}
        restorePreview={null}
        operation={null}
        agent={null}
        {...props}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Review' }));

    expect(props.onOpenScope).toHaveBeenCalledWith('turn', 'turn-latest', true);
  });

  it('clears the pending scope lock when opening fails', async () => {
    const user = userEvent.setup();
    const props = callbacks();
    const { rerender } = render(
      <ReviewDock
        changes={changes}
        review={historicalReview}
        restorePreview={null}
        operation={null}
        agent={null}
        {...props}
      />,
    );

    await user.click(screen.getByRole('button', { name: /1 file changed/ }));
    await user.click(screen.getByRole('button', { name: 'Branch' }));

    rerender(
      <ReviewDock
        changes={changes}
        review={historicalReview}
        restorePreview={null}
        operation={{
          type: 'review.operationResult',
          sequence: 1,
          sessionId: 'session-1',
          reviewScopeId: 'scope-branch',
          operation: 'open',
          ok: false,
          message: 'Branch comparison is unavailable.',
        }}
        agent={null}
        {...props}
      />,
    );

    expect(screen.queryByText('Loading…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Workspace' }).disabled).toBe(false);
  });

  it('renders Branch commit count from Review state without requesting Git diff', async () => {
    const user = userEvent.setup();
    const postMessage = vi.fn();
    render(
      <ReviewDockSlot
        changes={changes}
        sessionId="session-1"
        vscode={{ postMessage }}
        review={{
          ...historicalReview,
          reviewScopeId: 'scope-branch',
          scopeKind: 'branch',
          baseline: 'main',
          baselineLabel: 'main',
          branchCommitCount: 2,
        }}
        restorePreview={null}
        operation={null}
        agent={null}
      />,
    );

    await user.click(await screen.findByRole('button', { name: /1 file changed/ }));
    expect(screen.getByText('2 commits · 0 / 1 reviewed')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Branch' }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'review.open',
      sessionId: 'session-1',
      scopeKind: 'branch',
    });
    expect(postMessage).toHaveBeenCalledTimes(1);
  });

  it('posts explicit open-current intent from the Review button', async () => {
    const user = userEvent.setup();
    const postMessage = vi.fn();
    render(
      <ReviewDockSlot
        changes={changes}
        sessionId="session-1"
        vscode={{ postMessage }}
        review={historicalReview}
        restorePreview={null}
        operation={null}
        agent={null}
      />,
    );

    await user.click(await screen.findByRole('button', { name: 'Review' }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'review.open',
      sessionId: 'session-1',
      scopeKind: 'turn',
      turnId: 'turn-latest',
      openCurrent: true,
    });
  });
});

it('V2 counts confirmed AI files and opens their operation review independently of workspace changes', async () => {
  const postMessage = vi.fn();
  const store = createChatStore({ ...initialAssistantWebviewState, sessionId: 'session-1', connection: { status: 'connected' }, transcript: [
    { ...changes, files: [...changes.files, { path: 'manual.txt', additions: 1, deletions: 0 }] },
    { kind: 'tool', id: 'edit-1', toolUseId: 'edit-1', turnId: 'turn-latest', toolName: 'Edit', action: 'Edited',
      status: 'completed', progressCount: 0, latestUpdateKind: null,
      operationDiff: { status: 'ready', source: 'tool-result', callId: 'edit-1', files: [
        { path: 'src/app.ts', kind: 'modified', outcome: 'applied', patch: '@@ -1 +1 @@\n-before\n+after' },
        { path: 'uncertain.txt', kind: 'modified', outcome: 'uncertain', patch: '' },
      ] } },
  ], review: { ...initialAssistantWebviewState.review, scope: historicalReview } });
  render(<V2ReviewDockSlot store={store} vscode={{ postMessage }} />);
  expect(screen.getByText('1 directly confirmed file')).toBeDefined();
  await userEvent.setup().click(screen.getByRole('button', { name: 'Open Review' }));
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({
    type: 'review.panel.open', sessionId: 'session-1', scopeKind: 'operations', turnId: 'turn-latest',
  });
  expect(screen.queryByRole('button', { name: 'Restore file' })).toBeNull();
});
