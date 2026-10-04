import { MAX_GIT_STATUS_FILES, type GitStatusFile, type GitStatusMessage } from './gitCommitFlow';

/** Pages keep transport messages bounded without hiding already-staged files. */
export function gitStatusPages(report: { readonly files: readonly GitStatusFile[]; readonly snapshotId?: string }) {
  const totalFiles = report.files.length;
  const pages: { files: readonly GitStatusFile[]; snapshotId?: string; offset: number; totalFiles: number }[] = [];
  for (let offset = 0; offset < Math.max(1, totalFiles); offset += MAX_GIT_STATUS_FILES)
    pages.push({ files: report.files.slice(offset, offset + MAX_GIT_STATUS_FILES), offset, totalFiles,
      ...(report.snapshotId === undefined ? {} : { snapshotId: report.snapshotId }) });
  return pages;
}

export function mergeGitStatusPage(
  previous: { readonly files: readonly GitStatusFile[]; readonly snapshotId?: string | null } | null,
  page: GitStatusMessage,
): { files: readonly GitStatusFile[]; snapshotId: string | null; complete: boolean } | undefined {
  const offset = page.offset ?? 0;
  if (offset > 0 && (!previous || previous.snapshotId !== page.snapshotId || previous.files.length !== offset)) return undefined;
  const files = offset === 0 ? page.files : [...previous!.files, ...page.files];
  if (new Set(files.map(file => file.path)).size !== files.length) return undefined;
  return { files, snapshotId: page.snapshotId ?? null, complete: files.length === (page.totalFiles ?? files.length) };
}
