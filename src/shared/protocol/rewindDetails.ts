import { MAX_REWIND_EVICTED_REASON_LENGTH, MAX_REWIND_INFO_FILES, MAX_TOOL_FILE_PATH_LENGTH } from './bounds';
import { hasExactKeys, isExactArray, isStrictRecord } from '../validation/strictValidation';
import { isSafeWorkspaceRelativePath } from '../validation/guards';

export interface RewindFileDetail {
  /** Workspace-relative path, or basename only when outside the workspace. */
  readonly label: string;
  readonly location: 'workspace' | 'outside-workspace' | 'unknown-workspace';
  readonly action: 'restore' | 'delete' | 'unavailable';
  readonly reason?: string;
}

export interface RewindDetailFields {
  readonly details?: readonly RewindFileDetail[];
  readonly evictedCount?: number;
}

export function isRewindDetails(value: unknown): value is readonly RewindFileDetail[] {
  return isExactArray(value, 0, MAX_REWIND_INFO_FILES) && value.every((file) =>
    isStrictRecord(file) && hasExactKeys(file, ['label', 'location', 'action'], ['reason']) &&
    typeof file.label === 'string' && file.label.length > 0 && file.label.length <= MAX_TOOL_FILE_PATH_LENGTH &&
    !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(file.label) &&
    ['workspace', 'outside-workspace', 'unknown-workspace'].includes(String(file.location)) &&
    (file.location === 'workspace' ? isSafeWorkspaceRelativePath(file.label) : !/[\\/:]/u.test(file.label)) &&
    ['restore', 'delete', 'unavailable'].includes(String(file.action)) &&
    (file.reason === undefined || typeof file.reason === 'string' && file.reason.length <= MAX_REWIND_EVICTED_REASON_LENGTH &&
      !/[\u0000-\u001f\u007f]/u.test(file.reason)));
}

export function rewindDetailSummary(impact: RewindDetailFields & {
  readonly restorableCount: number; readonly createdCount: number;
  readonly restorablePaths: readonly string[]; readonly createdPaths: readonly string[];
  readonly evictedFiles: readonly { path: string; reason: string }[];
}) {
  const details: readonly RewindFileDetail[] = impact.details ?? [
    ...impact.restorablePaths.map((label) => ({ label, location: 'workspace' as const, action: 'restore' as const })),
    ...impact.createdPaths.map((label) => ({ label, location: 'workspace' as const, action: 'delete' as const })),
    ...impact.evictedFiles.map((file) => ({ label: file.path, location: 'workspace' as const, action: 'unavailable' as const, reason: file.reason })),
  ];
  const unavailableCount = impact.evictedCount ?? impact.evictedFiles.length;
  return {
    details, unavailableCount,
    omittedAffected: impact.restorableCount + impact.createdCount - details.filter((file) => file.action !== 'unavailable').length,
    omittedUnavailable: unavailableCount - details.filter((file) => file.action === 'unavailable').length,
  };
}
