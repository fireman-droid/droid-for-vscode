import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ReviewFile, ReviewScopeKind } from '../../shared/protocol/reviewProtocol';
import { isSafeWorkspaceRelativePath } from '../../shared/validation/guards';
import type { CommittedFileStat } from '../changes/changeStats';
import { isText, MAX_INLINE_DIFF_FILE_BYTES, readCurrentFile } from '../changes/inlineDiff';
import type { ReviewSdkPatch } from './reviewSdkPatch';
const execute = promisify(execFile);
export interface ReviewComparison {
  readonly before: string;
  readonly after: string | 'worktree';
}
export interface ReviewGitScope {
  readonly baseline: string;
  readonly label: string;
  readonly comparison: ReviewComparison;
  readonly files: readonly CommittedFileStat[];
  readonly commitCount?: number;
  readonly sdkPatches?: ReadonlyMap<string, ReviewSdkPatch>;
}
export async function reviewGit(root: string, args: readonly string[], maxBuffer = 4 * 1024 * 1024): Promise<Buffer> {
  const { stdout } = await execute('git', [
    '-c', 'core.autocrlf=false', ...args,
  ], { cwd: root, encoding: 'buffer', windowsHide: true, timeout: 10_000, maxBuffer });
  return stdout;
}
async function ref(root: string, value: string): Promise<string> {
  return (await reviewGit(root, ['rev-parse', '--verify', `${value}^{commit}`])).toString().trim();
}
export async function loadReviewGitScope(
  root: string, kind: Exclude<ReviewScopeKind, 'turn'>, baseBranch?: string,
): Promise<ReviewGitScope> {
  const head = await ref(root, 'HEAD');
  let before = head;
  let after = 'worktree';
  let label = 'HEAD → working tree';
  let commitCount: number | undefined;
  if (kind === 'staged' || kind === 'unstaged') {
    // write-tree creates an immutable tree object, without altering the user's index.
    const index = (await reviewGit(root, ['write-tree'])).toString().trim();
    if (kind === 'staged') { after = index; label = 'HEAD → Index'; }
    else { before = index; label = 'Index → working tree'; }
  } else if (kind === 'branch') {
    if (!baseBranch) throw new Error('The runtime did not provide a base branch.');
    const base = await ref(root, baseBranch);
    before = (await reviewGit(root, ['merge-base', base, head])).toString().trim();
    after = head;
    label = `${baseBranch} merge-base → HEAD`;
    commitCount = Number((await reviewGit(root, ['rev-list', '--count', `${before}..${head}`])).toString().trim());
  }
  const args = ['diff', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', before];
  if (after !== 'worktree') args.push(after);
  args.push('--');
  const records = (await reviewGit(root, args)).toString('utf8').split('\0').filter(Boolean);
  const statusArgs = args.map((arg) => arg === '--numstat' ? '--name-status' : arg);
  const statuses = (await reviewGit(root, statusArgs)).toString().split('\0');
  const kinds = new Map<string, ReviewFile['changeKind']>();
  for (let index = 0; index + 1 < statuses.length; index += 2)
    kinds.set(statuses[index + 1]!, statuses[index] === 'A' ? 'added' : statuses[index] === 'D' ? 'deleted' : 'modified');
  const files: (CommittedFileStat & Pick<ReviewFile, 'changeKind'>)[] = [];
  for (const record of records) {
    const match = /^([0-9]+|-)\t([0-9]+|-)\t([\s\S]+)$/.exec(record);
    if (match && isSafeWorkspaceRelativePath(match[3])) files.push({
      path: match[3], additions: match[1] === '-' ? null : Number(match[1]),
      deletions: match[2] === '-' ? null : Number(match[2]),
      ...(kinds.get(match[3]) ? { changeKind: kinds.get(match[3]) } : {}),
    });
  }
  if (after === 'worktree') {
    const untracked = (await reviewGit(root, ['ls-files', '--others', '--exclude-standard', '-z'])).toString().split('\0');
    const known = new Set(files.map((file) => file.path));
    for (const path of untracked) {
      if (!isSafeWorkspaceRelativePath(path) || known.has(path)) continue;
      files.push({ path, additions: null, deletions: 0, changeKind: 'untracked' });
    }
  }
  return {
    baseline: `${before}:${after}`, label, comparison: { before, after },
    files: files.sort((a, b) => a.path.localeCompare(b.path)).slice(0, 200),
    ...(commitCount === undefined ? {} : { commitCount }),
  };
}
export async function readReviewVersion(root: string, version: string, path: string, maxBytes = MAX_INLINE_DIFF_FILE_BYTES): Promise<Buffer | null> {
  if (!isSafeWorkspaceRelativePath(path)) throw new Error('Invalid review path.');
  if (version === 'worktree') {
    const value = await readCurrentFile(root, path, maxBytes);
    if (value === undefined) throw new Error('File is unavailable or outside the workspace.');
    if (value === 'too-large') throw new Error('File exceeds the text preview limit. Open the native Diff.');
    return value;
  }
  const entry = (await reviewGit(root, ['ls-tree', '-z', version, '--', path])).toString();
  if (!entry) return null;
  const match = /^100[0-7]{3} blob ([0-9a-f]+)\t/.exec(entry);
  if (!match) throw new Error('This file type cannot be compared as text.');
  const size = Number((await reviewGit(root, ['cat-file', '-s', match[1]!])).toString());
  if (size > maxBytes) throw new Error('File exceeds the text preview limit.');
  return reviewGit(root, ['cat-file', 'blob', match[1]!], maxBytes);
}
export function textContents(before: Buffer | null, after: Buffer | null) {
  if (!isText(before) || !isText(after)) throw new Error('Binary files cannot be shown as a text Diff.');
  return { before: before ?? Buffer.alloc(0), after: after ?? Buffer.alloc(0) };
}
