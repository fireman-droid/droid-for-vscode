import type { DroidRuntime } from '../../runtime/DroidRuntime';
import type { ReviewFile } from '../../shared/protocol/reviewProtocol';
import { reviewGit, type ReviewGitScope } from './reviewGitComparison';
import { splitSdkPatches } from './reviewSdkPatch';

export async function loadReviewSdkScope(
  root: string, kind: 'branch' | 'workspace', runtime: DroidRuntime | null | undefined,
): Promise<ReviewGitScope> {
  if (!runtime?.readGitDiff) throw new Error('The runtime cannot provide SDK Git Diff.');
  const head = (await reviewGit(root, ['rev-parse', '--verify', 'HEAD^{commit}'])).toString().trim();
  const report = await runtime.readGitDiff({ includePatch: true });
  const section = report.comparisons?.[kind];
  if (!section) throw new Error('The runtime did not provide the requested SDK Diff scope.');
  let before = head;
  if (kind === 'branch') {
    const base = (await reviewGit(root, ['rev-parse', '--verify', '--end-of-options', `${report.baseBranch}^{commit}`])).toString().trim();
    before = (await reviewGit(root, ['merge-base', base, head])).toString().trim();
  }
  const currentHead = (await reviewGit(root, ['rev-parse', '--verify', 'HEAD^{commit}'])).toString().trim();
  if (currentHead !== head) throw new Error('HEAD changed while loading the SDK Diff. Refresh Review.');
  const after = kind === 'branch' ? head : 'worktree';
  const patches = splitSdkPatches(section.patch);
  const files = section.files.map((file) => {
    const changeKind: ReviewFile['changeKind'] = file.status === 'added' ? 'added' :
      file.status === 'deleted' ? 'deleted' : 'modified';
    return { path: file.path, additions: file.additions, deletions: file.deletions, changeKind };
  }).sort((left, right) => left.path.localeCompare(right.path)).slice(0, 200);
  return {
    baseline: `${before}:${after}`,
    label: kind === 'branch' ? `${report.baseBranch} merge-base → HEAD` : 'HEAD → working tree',
    comparison: { before, after },
    files,
    sdkPatches: new Map(files.flatMap(({ path }) => {
      const patch = patches.get(path);
      return patch ? [[path, patch] as const] : [];
    })),
    ...(kind === 'branch' ? { commitCount: report.commitCount } : {}),
  };
}
