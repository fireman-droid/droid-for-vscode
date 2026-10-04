// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  GitCommitFlowContext,
  type GitCommitFlowContextValue,
} from './gitCommitFlow';
import { ChangesCommitEntry as V2ChangesCommitEntry } from '../chat/GitCommitPanel';
import type { GitCommitFlowState } from '../state/store';

afterEach(cleanup);

const file = {
  path: 'src/app.ts',
  status: 'modified' as const,
  staged: false,
  inTurn: true,
};

function flow(state: Partial<GitCommitFlowState> = {}): GitCommitFlowContextValue {
  return {
    state: {
      availability: 'available',
      unavailableReason: null,
      statusPending: false,
      statusTurnId: 'turn-a',
      branch: 'main',
      snapshotId: 'preview-a',
      files: [file],
      committedHash: null,
      commitPending: false,
      commitTurnId: null,
      lastResult: null,
      ...state,
    },
    latestChangesTurnId: 'turn-a',
    promptText: 'Update the app',
    onRequestStatus: vi.fn(),
    onCommit: vi.fn(),
  };
}

describe.each([['V2', V2ChangesCommitEntry]] as const)('%s GitCommitPanel', (_version, ChangesCommitEntry) => {
  it('refreshes failed status and removes files that disappeared', async () => {
    const user = userEvent.setup();
    const initial = flow();
    const view = render(
      <GitCommitFlowContext.Provider value={initial}>
        <ChangesCommitEntry turnId="turn-a" />
      </GitCommitFlowContext.Provider>,
    );
    await user.click(screen.getByRole('button', { name: 'Commit…' }));
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox.getAttribute('aria-checked') === 'true').toBe(true);

    const failed = flow({
      commitTurnId: 'turn-a',
      lastResult: { ok: false, error: 'pathspec did not match' },
    });
    view.rerender(
      <GitCommitFlowContext.Provider value={failed}>
        <ChangesCommitEntry turnId="turn-a" />
      </GitCommitFlowContext.Provider>,
    );
    expect(failed.onRequestStatus).toHaveBeenCalledWith('turn-a');
    const refreshing = flow({
      statusPending: true,
      commitTurnId: 'turn-a',
      lastResult: { ok: false, error: 'pathspec did not match' },
    });
    view.rerender(
      <GitCommitFlowContext.Provider value={refreshing}>
        <ChangesCommitEntry turnId="turn-a" />
      </GitCommitFlowContext.Provider>,
    );
    expect(
      screen.getByRole<HTMLButtonElement>('button', { name: 'Commit' }).disabled,
    ).toBe(true);

    const settled = flow({
      commitTurnId: 'turn-a',
      lastResult: failed.state.lastResult,
    });
    view.rerender(
      <GitCommitFlowContext.Provider value={settled}>
        <ChangesCommitEntry turnId="turn-a" />
      </GitCommitFlowContext.Provider>,
    );
    expect(settled.onRequestStatus).not.toHaveBeenCalled();

    const refreshed = flow({
      files: [],
      commitTurnId: 'turn-a',
      lastResult: failed.state.lastResult,
    });
    view.rerender(
      <GitCommitFlowContext.Provider value={refreshed}>
        <ChangesCommitEntry turnId="turn-a" />
      </GitCommitFlowContext.Provider>,
    );
    expect(screen.getByText('No pending turn changes')).toBeDefined();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(refreshed.onRequestStatus).not.toHaveBeenCalled();
  });
});
