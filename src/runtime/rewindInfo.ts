import {
  MAX_REWIND_EVICTED_REASON_LENGTH,
  MAX_REWIND_INFO_FILES,
} from '../shared/bridgeMessages';
import type {
  RuntimeRewindEvictedFile,
  RuntimeRewindInfo,
} from './DroidRuntime';
import { toWorkspaceRelativePath } from './toolFilePath';

/** The rewind report as the SDK session facade returns it. */
export interface SdkRewindInfo {
  readonly availableFiles: ReadonlyArray<{ filePath: string }>;
  readonly createdFiles: ReadonlyArray<{ filePath: string }>;
  readonly evictedFiles: ReadonlyArray<{
    filePath: string;
    reason: string;
  }>;
}

/**
 * Projects an SDK rewind report onto the runtime contract. The backend
 * names files by absolute path; one outside the workspace has no chip
 * to render, so only the counts keep it.
 */
export function projectRewindInfo(
  info: SdkRewindInfo,
  workspaceRoot: string | null,
): RuntimeRewindInfo {
  const relativePath = (rawPath: string): string | undefined =>
    workspaceRoot === null
      ? undefined
      : toWorkspaceRelativePath(workspaceRoot, rawPath);
  const paths = (
    files: ReadonlyArray<{ filePath: string }>,
  ): string[] => {
    const result: string[] = [];
    for (const file of files) {
      if (result.length >= MAX_REWIND_INFO_FILES) {
        break;
      }
      const path = relativePath(file.filePath);
      if (path !== undefined) {
        result.push(path);
      }
    }
    return result;
  };
  const evictedFiles: RuntimeRewindEvictedFile[] = [];
  for (const file of info.evictedFiles) {
    if (evictedFiles.length >= MAX_REWIND_INFO_FILES) {
      break;
    }
    const path = relativePath(file.filePath);
    if (path !== undefined) {
      evictedFiles.push({
        path,
        reason: file.reason.slice(0, MAX_REWIND_EVICTED_REASON_LENGTH),
      });
    }
  }
  return {
    restorableCount: info.availableFiles.length,
    createdCount: info.createdFiles.length,
    restorablePaths: paths(info.availableFiles),
    createdPaths: paths(info.createdFiles),
    evictedFiles,
  };
}
