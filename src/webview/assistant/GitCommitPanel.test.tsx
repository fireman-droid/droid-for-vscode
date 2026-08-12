// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GitStatusFile } from '../../shared/gitCommitFlow';
import {
  ChangesCommitEntry,
  GitCommitFlowContext,
  type GitCommitFlowContextValue,
} from './GitCommitPanel';
import {
  initialGitCommitFlowState,
  type GitCommitFlowState,
} from './store';

afterEach(cleanup);

const FILES: readonly GitStatusFile[] = [
  {
    path: 'src/app.ts',
    status: 'modified',
    staged: false,
    inTurn: true,
  },
  {
    path: 'src/util.ts',
    status: 'added',
    staged: true,
    inTurn: true,
  },
  {
    path: 'notes.md',
    status: 'untracked',
    staged: false,
    inTurn: false,
  },
];

function renderEntry(
  stateOverrides: Partial<GitCommitFlowState> = {},
  valueOverrides: Partial<GitCommitFlowContextValue> = {},
  turnId: string | null = 'turn-1',
) {
  const onRequestStatus = vi.fn();
  const onCommit = vi.fn();
  const value: GitCommitFlowContextValue = {
    state: { ...initialGitCommitFlowState, ...stateOverrides },
    latestChangesTurnId: 'turn-1',
    promptText: 'Refactor the parser for speed',
    onRequestStatus,
    onCommit,
    ...valueOverrides,
  };
  const view = render(
    <GitCommitFlowContext.Provider value={value}>
      <ChangesCommitEntry turnId={turnId} />
    </GitCommitFlowContext.Provider>,
  );
  return { onRequestStatus, onCommit, view, value };
}

function readyState(
  overrides: Partial<GitCommitFlowState> = {},
): Partial<GitCommitFlowState> {
  return {
    availability: 'available',
    branch: 'main',
    files: FILES,
    ...overrides,
  };
}

async function expandPanel(
  stateOverrides: Partial<GitCommitFlowState> = {},
) {
  const rendered = renderEntry(readyState(stateOverrides));
  await userEvent
    .setup()
    .click(
      screen.getByRole('button', { name: 'Commit these changes…' }),
    );
  return rendered;
}

describe('ChangesCommitEntry', () => {
  it('probes availability once on mount while unknown', () => {
    const { onRequestStatus } = renderEntry();
    expect(onRequestStatus).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('renders nothing when git is unavailable', () => {
    const { onRequestStatus } = renderEntry({
      availability: 'unavailable',
      unavailableReason: 'no-git-extension',
    });
    expect(onRequestStatus).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe('');
  });

  it('renders nothing on a non-latest changes card', () => {
    const { onRequestStatus } = renderEntry(
      readyState(),
      {},
      'turn-0',
    );
    expect(onRequestStatus).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe('');
  });

  it('expands into the panel and re-requests fresh status', async () => {
    const { onRequestStatus } = await expandPanel();
    expect(onRequestStatus).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole('group', { name: 'Commit changes' }),
    ).toBeDefined();
    expect(screen.getByText('on main')).toBeDefined();
  });

  it('checks in-turn files by default and prefills the draft', async () => {
    await expandPanel();
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(3);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
    expect((boxes[1] as HTMLInputElement).checked).toBe(true);
    expect((boxes[2] as HTMLInputElement).checked).toBe(false);
    const message = screen.getByRole('textbox', {
      name: 'Commit message',
    }) as HTMLTextAreaElement;
    expect(message.value).toBe(
      'Refactor the parser for speed\n\nvia DroidVisX, 2 files',
    );
  });

  it('disables commit when the message is cleared or nothing is selected', async () => {
    await expandPanel();
    const user = userEvent.setup();
    const commit = screen.getByRole('button', { name: 'Commit' });
    expect((commit as HTMLButtonElement).disabled).toBe(false);
    await user.clear(
      screen.getByRole('textbox', { name: 'Commit message' }),
    );
    expect((commit as HTMLButtonElement).disabled).toBe(true);
    await user.type(
      screen.getByRole('textbox', { name: 'Commit message' }),
      'msg',
    );
    expect((commit as HTMLButtonElement).disabled).toBe(false);
    const boxes = screen.getAllByRole('checkbox');
    await user.click(boxes[0] as HTMLElement);
    await user.click(boxes[1] as HTMLElement);
    expect((commit as HTMLButtonElement).disabled).toBe(true);
  });

  it('submits the checked paths and the edited message', async () => {
    const { onCommit } = await expandPanel();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole('checkbox')[2] as HTMLElement);
    const message = screen.getByRole('textbox', {
      name: 'Commit message',
    });
    await user.clear(message);
    await user.type(message, 'feat: everything');
    await user.click(screen.getByRole('button', { name: 'Commit' }));
    expect(onCommit).toHaveBeenCalledTimes(1);
    const [turnId, paths, text] = onCommit.mock.calls[0] as [
      string,
      readonly string[],
      string,
    ];
    expect(turnId).toBe('turn-1');
    expect([...paths].sort()).toEqual([
      'notes.md',
      'src/app.ts',
      'src/util.ts',
    ]);
    expect(text).toBe('feat: everything');
  });

  it('shows the committing state while a commit is pending', async () => {
    await expandPanel({ commitPending: true, commitTurnId: 'turn-1' });
    const button = screen.getByRole('button', {
      name: 'Committing…',
    }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it('surfaces the raw git error and stays open on failure', async () => {
    await expandPanel({
      commitTurnId: 'turn-1',
      lastResult: {
        ok: false,
        error: 'pre-commit hook exited with code 1',
      },
    });
    expect(screen.getByRole('alert').textContent).toBe(
      'pre-commit hook exited with code 1',
    );
    expect(
      screen.getByRole('textbox', { name: 'Commit message' }),
    ).toBeDefined();
  });

  it('collapses to a quiet result line after a successful commit', () => {
    renderEntry(
      readyState({
        commitTurnId: 'turn-1',
        lastResult: {
          ok: true,
          hash: 'abc1234',
          subject: 'feat: add commit panel',
        },
      }),
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Committed abc1234 · feat: add commit panel',
    );
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('omits the hash from the result line when it was unreadable', () => {
    renderEntry(
      readyState({
        commitTurnId: 'turn-1',
        lastResult: { ok: true, hash: '', subject: 'fix: thing' },
      }),
    );
    expect(screen.getByRole('status').textContent).toBe(
      'Committed · fix: thing',
    );
  });

  it('shows an empty-state hint when there is nothing to commit', async () => {
    await expandPanel({ files: [] });
    expect(
      screen.getByText('No uncommitted changes.'),
    ).toBeDefined();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
