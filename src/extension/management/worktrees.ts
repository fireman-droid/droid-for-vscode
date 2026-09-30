import path from 'node:path';
import type { DaemonApi } from '../../runtime/daemon/api';
import { changed, choose, confirm, inspectText, ManagementError, type ManagementContext } from './managementUi';

type Worktree = Awaited<ReturnType<DaemonApi['worktrees']['list']>>['worktrees'][number];
type Inspection = Awaited<ReturnType<DaemonApi['worktrees']['inspectDeletion']>>;
type OpenedSession = Awaited<ReturnType<DaemonApi['sessions']['listOpened']>>[number];
interface DeletionReview { readonly worktree: Worktree; readonly inspection: Inspection; readonly occupants: readonly OpenedSession[] }

export async function manageWorktrees(context: ManagementContext): Promise<void> {
  for (;;) {
    context.assertCurrent();
    const result = await context.droid.worktrees.list({ includeSizes: false });
    context.assertCurrent();
    const selected = await choose('Droid managed worktrees', [
      { label: 'Refresh', action: 'refresh' as const, detail: 'Includes all worktrees managed by this local Droid daemon.' },
      ...result.worktrees.map((worktree) => ({
        label: worktree.branch ?? path.basename(worktree.path), action: 'inspect' as const, worktree,
        description: `${worktree.lifecycle} · ${worktree.isClean === undefined ? 'Changes not checked' : worktree.isClean ? 'Clean' : 'Uncommitted changes'} · ${worktree.sessions.length} sessions`,
        detail: worktree.path,
      })),
    ]);
    if (!selected) return;
    if (selected.action === 'refresh') continue;
    const review = await reviewWorktree(context, selected.worktree.path);
    await inspectText('Worktree cleanup review', describeReview(review));
    context.assertCurrent();
    const action = await choose('Managed worktree action', [
      { label: 'Back to worktrees', action: 'back' },
      { label: 'Delete worktree…', action: 'delete', detail: 'Remove this checkout and archive its associated sessions. Keep local and remote branches.' },
    ]);
    if (action?.action !== 'delete') continue;
    assertCanDelete(context, review);
    if (!await confirm(context, `${describeReview(review)}\n\nDelete this worktree and archive its sessions? Uncommitted and untracked files in this checkout will be permanently lost. Local and remote branches will be kept. Droid may run the worktree setup profile’s cleanup script.`)) continue;
    // The confirmation authorizes the displayed state, not a changed target.
    const fresh = await reviewWorktree(context, review.worktree.path);
    context.assertCurrent(true);
    assertCanDelete(context, fresh);
    if (reviewKey(fresh) !== reviewKey(review))
      throw new ManagementError('The worktree, changes or session occupancy changed. Inspect it again before deleting.');
    const cleanup = await context.droid.worktrees.cleanup({
      worktreePath: fresh.worktree.path, deleteLocalBranch: false, deleteRemoteBranch: false, force: true,
    });
    context.assertCurrent();
    const details = [`${cleanup.archivedSessionIds.length} sessions archived.`,
      cleanup.localBranchDeleted ? 'Local branch deleted.' : 'Local branch kept.',
      cleanup.remoteBranchDeleted ? 'Remote branch deleted.' : 'Remote branch kept.', ...cleanup.warnings].join('\n');
    if (!cleanup.worktreeRemoved)
      throw new ManagementError(`Droid did not remove the worktree (${cleanup.preservedReason ?? 'not confirmed'}).\n${details}`);
    await changed(`Removed ${cleanup.worktreePath}.\n${details}`);
  }
}

async function reviewWorktree(context: ManagementContext, worktreePath: string): Promise<DeletionReview> {
  const [listed, inspection, opened] = await Promise.all([
    context.droid.worktrees.list({ includeSizes: false }),
    context.droid.worktrees.inspectDeletion({ worktreePath }),
    context.droid.sessions.listOpened({ filter: { includeBtwForks: true } }),
  ]);
  context.assertCurrent();
  const worktree = listed.worktrees.find((item) => samePath(item.path, worktreePath));
  if (!worktree || !samePath(inspection.worktreePath, worktreePath))
    throw new ManagementError('The managed worktree changed or is no longer available. Refresh the list.');
  const ids = new Set(worktree.sessions.map((session) => session.sessionId));
  const occupants = opened.filter((session) => ids.has(session.id) || session.cwd !== undefined && containsPath(worktree.path, session.cwd));
  return { worktree, inspection, occupants };
}

function assertCanDelete(context: ManagementContext, review: DeletionReview): void {
  const { worktree, occupants } = review;
  if (samePath(worktree.path, worktree.repoRoot) || containsPath(worktree.path, context.cwd) ||
    worktree.sessions.some((session) => session.sessionId === context.sessionId))
    throw new ManagementError('This checkout is the main repository or belongs to the active chat. Switch to another workspace and session before deleting it.');
  if (occupants.some((session) => session.workingState !== 'idle'))
    throw new ManagementError('A session in this worktree is running or awaiting input. Stop or finish its work before deleting the checkout.');
}

function describeReview({ worktree, inspection, occupants }: DeletionReview): string {
  return [
    `Path: ${worktree.path}`, `Repository: ${worktree.repoRoot}`, `Branch: ${inspection.branch ?? worktree.branch ?? 'Detached / unavailable'}`,
    `Lifecycle: ${worktree.lifecycle}`,
    `Changes: ${inspection.changedFiles} files, +${inspection.additions} / -${inspection.deletions}; ${inspection.untrackedFiles} untracked files`,
    `Local-only commits: ${inspection.localOnlyCommits ?? 'Unavailable'}`,
    `Remote branch: ${inspection.hasRemoteBranch ? 'Present' : 'Absent'}${inspection.remoteRefsStale ? ' (remote refs may be stale)' : ''}`,
    `Pull request: ${inspection.pullRequest?.state ?? 'Not reported'}`,
    `Associated sessions: ${worktree.sessions.length}`,
    ...worktree.sessions.map((session) => `  ${session.title || session.sessionId} (${session.sessionId})`),
    `Open session occupancy: ${occupants.length === 0 ? 'None reported by Droid' : occupants.length}`,
    ...occupants.map((session) => `  ${session.title || session.id}: ${session.workingState} (${session.id})`),
  ].join('\n');
}

function reviewKey(review: DeletionReview): string {
  return JSON.stringify({ path: review.worktree.path, repoRoot: review.worktree.repoRoot, lifecycle: review.worktree.lifecycle,
    inspection: review.inspection, sessions: review.worktree.sessions.map((row) => row.sessionId).sort(),
    occupants: review.occupants.map((row) => `${row.id}:${row.workingState}`).sort() });
}

function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function samePath(left: string, right: string): boolean { return path.relative(left, right) === ''; }
