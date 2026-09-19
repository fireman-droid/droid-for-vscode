import {
  MAX_REWIND_EVICTED_REASON_LENGTH,
  MAX_REWIND_INFO_FILES,
  MAX_TOOL_FILE_PATH_LENGTH,
} from '../../shared/protocol/bounds';
import type { RuntimeRewindEvictedFile, RuntimeRewindInfo } from '../DroidRuntime';
import { toWorkspaceRelativePath } from '../tools/toolFilePath';
import type { RewindFileDetail } from '../../shared/protocol/rewindDetails';

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
 * names files by absolute path; outside files expose only a basename
 * and location marker, never an absolute path in the Webview.
 */
export function projectRewindInfo(
  info: SdkRewindInfo,
  workspaceRoot: string | null,
): RuntimeRewindInfo {
  const relativePath = (rawPath: string): string | undefined =>
    workspaceRoot === null ? undefined : toWorkspaceRelativePath(workspaceRoot, rawPath);
  const paths = (files: ReadonlyArray<{ filePath: string }>): string[] => {
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
  const details: RewindFileDetail[] = [];
  const append = (files: ReadonlyArray<{ filePath: string; reason?: string }>, action: RewindFileDetail['action']) => {
    for (const file of files) {
      if (details.length >= MAX_REWIND_INFO_FILES) break;
      const path = relativePath(file.filePath);
      const label = path ?? (file.filePath.split(/[\\/]/u).at(-1) ?? '').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069:]/gu, '').slice(0, MAX_TOOL_FILE_PATH_LENGTH);
      details.push({ label: label || 'File', action,
        location: path ? 'workspace' : workspaceRoot === null ? 'unknown-workspace' : 'outside-workspace',
        ...(file.reason === undefined ? {} : { reason: file.reason.replace(/[\u0000-\u001f\u007f]/gu, '').slice(0, MAX_REWIND_EVICTED_REASON_LENGTH) }),
      });
    }
  };
  append(info.availableFiles, 'restore');
  append(info.createdFiles, 'delete');
  append(info.evictedFiles, 'unavailable');
  return {
    restorableCount: info.availableFiles.length,
    createdCount: info.createdFiles.length,
    restorablePaths: paths(info.availableFiles),
    createdPaths: paths(info.createdFiles),
    evictedFiles,
    details,
    evictedCount: info.evictedFiles.length,
  };
}
