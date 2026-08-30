// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GitCommitFlowContext,
  type GitCommitFlowContextValue,
} from './GitCommitPanel';
import { ReviewDock } from './ReviewDock';
import { ReviewDockSlot } from './reviewDockSlot';
import { initialGitCommitFlowState } from './store';

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

describe('ReviewDock', () => {
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
          branchDiff={null}
          {...callbacks()}
        />
      </GitCommitFlowContext.Provider>,
    );

    await user.click(screen.getByRole('button', { name: /1 file changed/ }));
    await user.click(screen.getByRole('button', { name: 'More' }));

    expect(screen.queryByRole('button', { name: 'Commit…' })).toBeNull();
  });

  it('requests and renders Branch commit count', async () => {
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
        }}
        restorePreview={null}
        operation={null}
        agent={null}
        branchDiff={{
          branch: 'feature/review',
          baseBranch: 'main',
          files: [{ path: 'src/app.ts', additions: 3, deletions: 1 }],
          additions: 3,
          deletions: 1,
          commitCount: 2,
        }}
      />,
    );

    await user.click(
      await screen.findByRole('button', { name: /1 file changed/ }),
    );
    expect(screen.getByText('2 commits · 0 of 1 reviewed')).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Branch' }));

    expect(postMessage).toHaveBeenCalledWith({
      type: 'review.open',
      sessionId: 'session-1',
      scopeKind: 'branch',
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'git.requestBranchDiff',
      sessionId: 'session-1',
    });
  });
});
