import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ManagementContext } from './managementUi';
import { manageWorktrees } from './worktrees';
import { forceArchiveSession } from './forceArchive';
import { manageDefaults } from './defaults';

const editor = vi.hoisted(() => ({
  showQuickPick: vi.fn(), showWarningMessage: vi.fn(), showInformationMessage: vi.fn(),
  showInputBox: vi.fn(), showTextDocument: vi.fn(), openTextDocument: vi.fn(),
}));
vi.mock('vscode', () => ({ window: editor, workspace: { openTextDocument: editor.openTextDocument } }));

beforeEach(() => { vi.resetAllMocks(); editor.openTextDocument.mockResolvedValue({}); });

function harness() {
  const worktree = { path: '/repo/trees/one', repoRoot: '/repo/main', branch: 'droid/one', lifecycle: 'ephemeral',
    isClean: false, sessions: [{ sessionId: 'other', title: 'Other work', updatedAt: 1 }] };
  const inspection = { worktreePath: worktree.path, branch: worktree.branch, changedFiles: 2, additions: 3,
    deletions: 1, untrackedFiles: 1, hasRemoteBranch: true, remoteRefsStale: false, localOnlyCommits: 2 };
  const worktrees = {
    list: vi.fn().mockResolvedValue({ worktrees: [worktree] }),
    inspectDeletion: vi.fn().mockResolvedValue(inspection),
    cleanup: vi.fn().mockResolvedValue({ worktreePath: worktree.path, worktreeRemoved: true,
      archivedSessionIds: ['other'], localBranchDeleted: false, remoteBranchDeleted: false, warnings: [] }),
  };
  const sessions = {
    listOpened: vi.fn().mockResolvedValue([]), archive: vi.fn().mockResolvedValue({ success: true }),
    killWorker: vi.fn(),
  };
  const settings = { getDefaults: vi.fn().mockResolvedValue({}), updateDefaults: vi.fn().mockResolvedValue({ success: true }) };
  const context = { droid: { worktrees, sessions, settings }, sessionId: 'current', cwd: '/repo/main',
    signal: new AbortController().signal, assertCurrent: vi.fn() } as unknown as ManagementContext;
  return { context, worktree, inspection, worktrees, sessions, settings };
}

function selectDeletion(): void {
  editor.showQuickPick
    .mockImplementationOnce((items) => items.find((item: { action: string }) => item.action === 'inspect'))
    .mockImplementationOnce((items) => items.find((item: { action: string }) => item.action === 'delete'));
}

describe('native managed worktree cleanup', () => {
  it('leaves the checkout untouched when the confirmation is cancelled', async () => {
    const h = harness(); selectDeletion();
    await manageWorktrees(h.context);
    expect(h.worktrees.cleanup).not.toHaveBeenCalled();
    expect(editor.showWarningMessage).toHaveBeenCalledOnce();
  });

  it('shows the actual dirty checkout and occupancy before confirmed SDK cleanup, preserving both branches', async () => {
    const h = harness(); selectDeletion();
    h.sessions.listOpened.mockResolvedValue([{ id: 'other', title: 'Other work', cwd: h.worktree.path, workingState: 'idle' }]);
    editor.showWarningMessage.mockResolvedValue('Continue');
    await manageWorktrees(h.context);
    const confirmation = editor.showWarningMessage.mock.calls[0]?.[0] as string;
    expect(confirmation).toContain(h.worktree.path);
    expect(confirmation).toContain('Branch: droid/one');
    expect(confirmation).toContain('2 files, +3 / -1; 1 untracked');
    expect(confirmation).toContain('Other work: idle (other)');
    expect(h.worktrees.inspectDeletion).toHaveBeenCalledTimes(2);
    expect(h.worktrees.cleanup).toHaveBeenCalledExactlyOnceWith({ worktreePath: h.worktree.path,
      deleteLocalBranch: false, deleteRemoteBranch: false, force: true });
  });

  it('rejects cleanup when inspection changes after confirmation', async () => {
    const h = harness(); selectDeletion(); editor.showWarningMessage.mockResolvedValue('Continue');
    h.worktrees.inspectDeletion.mockResolvedValueOnce(h.inspection).mockResolvedValue({ ...h.inspection, changedFiles: 3 });
    await expect(manageWorktrees(h.context)).rejects.toThrow('changed');
    expect(h.worktrees.cleanup).not.toHaveBeenCalled();
  });

  it('blocks cleanup of a checkout occupied by a running agent', async () => {
    const h = harness(); selectDeletion();
    h.sessions.listOpened.mockResolvedValue([{ id: 'other', cwd: h.worktree.path, workingState: 'running' }]);
    await expect(manageWorktrees(h.context)).rejects.toThrow('running or awaiting input');
    expect(editor.showWarningMessage).not.toHaveBeenCalled();
    expect(h.worktrees.cleanup).not.toHaveBeenCalled();
  });
});

describe('explicit forced session archive', () => {
  it.each([undefined, 'Continue'])('requires explicit confirmation without stopping the selected agent (%s)', async (answer) => {
    const h = harness();
    h.sessions.listOpened.mockResolvedValue([
      { id: 'current', title: 'Current', cwd: '/repo/main', workingState: 'idle' },
      { id: 'other', title: 'Background', cwd: '/repo/trees/one', workingState: 'running' },
    ]);
    editor.showQuickPick.mockImplementationOnce((items) => {
      expect(items).toHaveLength(1);
      return items[0];
    });
    editor.showWarningMessage.mockResolvedValue(answer);
    await forceArchiveSession(h.context);
    expect(editor.showWarningMessage.mock.calls[0]?.[0]).toContain('does NOT stop its agent');
    if (answer === 'Continue') expect(h.sessions.archive).toHaveBeenCalledExactlyOnceWith('other', { force: true });
    else expect(h.sessions.archive).not.toHaveBeenCalled();
    expect(h.sessions.killWorker).not.toHaveBeenCalled();
  });
});

describe('visible Droid runtime defaults', () => {
  it('sends the selected Anthropic cache setting through the policy-checked defaults update', async () => {
    const h = harness();
    editor.showQuickPick
      .mockImplementationOnce((items) => items.find((item: { value: string }) => item.value === 'enableOneHourAnthropicCaching'))
      .mockImplementationOnce((items) => items.find((item: { value: boolean }) => item.value === true));
    editor.showWarningMessage.mockResolvedValue('Continue');
    await manageDefaults(h.context);
    expect(h.settings.updateDefaults).toHaveBeenCalledExactlyOnceWith({ enableOneHourAnthropicCaching: true });
    expect(editor.showWarningMessage.mock.calls[0]?.[0]).toContain('user-wide');
  });

  it('can reset the ephemeral retention limit and explains its existing-checkout scope', async () => {
    const h = harness();
    editor.showQuickPick.mockImplementationOnce((items) => items.find((item: { value: string }) => item.value === 'worktreeAutoDeleteLimit'));
    editor.showInputBox.mockResolvedValue(''); editor.showWarningMessage.mockResolvedValue('Continue');
    await manageDefaults(h.context);
    expect(h.settings.updateDefaults).toHaveBeenCalledExactlyOnceWith({ worktreeAutoDeleteLimit: null });
    expect(editor.showWarningMessage.mock.calls[0]?.[0]).toContain('including existing ephemeral worktrees');
  });
});
