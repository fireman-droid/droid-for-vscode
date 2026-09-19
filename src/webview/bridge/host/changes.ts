import {
  MAX_GIT_BRANCH_LENGTH,
  MAX_GIT_COMMIT_ERROR_LENGTH,
  MAX_GIT_COMMIT_SUBJECT_LENGTH,
  MAX_GIT_STATUS_FILES,
  isGitCommitHashEcho,
  type GitStatusFile,
  type HostToWebviewMessage,
} from '../../../shared/bridgeMessages';
import { type ChangesUpdateState } from '../../../shared/protocol/changesProtocol';
import { MAX_CHANGED_FILES_PER_TURN } from '../../../shared/protocol/bounds';
import { type ChangedFileSummary } from '../../../shared/protocol/transcript';
import {
  hasExactKeys,
  isExactArray,
  isStrictRecord,
  type UnknownRecord,
} from '../../../shared/validation/strictValidation';
import { isSafeWorkspaceRelativePath } from '../../../shared/validation/guards';
import {
  CHANGES_UPDATE_STATE_SET,
  hasTurnIdentity,
  isBoundedString,
  isGitFileStatus,
  isGitUnavailableReason,
  isId,
  isNonEmptyBoundedString,
  isNullableCount,
  isSequence,
} from './guards';

export function parseChangesUpdate(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'changes.update' }> | undefined {
  if (
    !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'turnId', 'state', 'files']) ||
    !hasTurnIdentity(value) ||
    typeof value.state !== 'string' ||
    !CHANGES_UPDATE_STATE_SET.has(value.state)
  ) {
    return undefined;
  }
  const files = parseChangedFiles(value.files, value.state === 'settled' ? 0 : 1);
  if (files === undefined) {
    return undefined;
  }

  return {
    type: 'changes.update',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    state: value.state as ChangesUpdateState,
    files,
  };
}

export function parseChangedFiles(
  value: unknown,
  minimumLength = 1,
): ChangedFileSummary[] | undefined {
  if (!isExactArray(value, minimumLength, MAX_CHANGED_FILES_PER_TURN)) {
    return undefined;
  }
  const files: ChangedFileSummary[] = [];
  const paths = new Set<string>();
  for (const fileValue of value) {
    if (
      !isStrictRecord(fileValue) ||
      !hasExactKeys(fileValue, ['path', 'additions', 'deletions']) ||
      !isSafeWorkspaceRelativePath(fileValue.path) ||
      paths.has(fileValue.path) ||
      !isNullableCount(fileValue.additions) ||
      !isNullableCount(fileValue.deletions)
    ) {
      return undefined;
    }
    paths.add(fileValue.path);
    files.push({
      path: fileValue.path,
      additions: fileValue.additions,
      deletions: fileValue.deletions,
    });
  }
  return files;
}

export function parseGitStatus(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'git.status' }> | undefined {
  if (
    !hasExactKeys(
      value,
      ['type', 'sequence', 'sessionId', 'turnId', 'branch', 'files'],
      ['committedHash', 'unavailableReason'],
    ) ||
    !isSequence(value.sequence) ||
    !isId(value.sessionId) ||
    !isId(value.turnId)
  ) {
    return undefined;
  }
  const branch = value.branch;
  if (branch !== null && !isNonEmptyBoundedString(branch, MAX_GIT_BRANCH_LENGTH)) {
    return undefined;
  }
  const reason = value.unavailableReason;
  if (reason !== undefined && !isGitUnavailableReason(reason)) {
    return undefined;
  }
  const committedHash = value.committedHash;
  if (
    committedHash !== undefined &&
    (!isGitCommitHashEcho(committedHash) || committedHash === '')
  ) {
    return undefined;
  }
  const files = parseGitStatusFiles(value.files);
  // An unavailable report must not smuggle repository data.
  if (
    files === undefined ||
    (reason !== undefined &&
      (files.length > 0 || branch !== null || committedHash !== undefined))
  ) {
    return undefined;
  }

  return {
    type: 'git.status',
    sequence: value.sequence,
    sessionId: value.sessionId,
    turnId: value.turnId,
    branch,
    files,
    ...(committedHash === undefined ? {} : { committedHash }),
    ...(reason === undefined ? {} : { unavailableReason: reason }),
  };
}

export function parseGitStatusFiles(value: unknown): GitStatusFile[] | undefined {
  if (!isExactArray(value, 0, MAX_GIT_STATUS_FILES)) {
    return undefined;
  }
  const files: GitStatusFile[] = [];
  const paths = new Set<string>();
  for (const fileValue of value) {
    if (
      !isStrictRecord(fileValue) ||
      !hasExactKeys(fileValue, ['path', 'status', 'staged', 'inTurn']) ||
      !isSafeWorkspaceRelativePath(fileValue.path) ||
      paths.has(fileValue.path) ||
      !isGitFileStatus(fileValue.status) ||
      typeof fileValue.staged !== 'boolean' ||
      typeof fileValue.inTurn !== 'boolean'
    ) {
      return undefined;
    }
    paths.add(fileValue.path);
    files.push({
      path: fileValue.path,
      status: fileValue.status,
      staged: fileValue.staged,
      inTurn: fileValue.inTurn,
    });
  }
  return files;
}

export function parseGitCommitResult(
  value: UnknownRecord,
): Extract<HostToWebviewMessage, { type: 'git.commitResult' }> | undefined {
  if (value.ok === true) {
    if (
      !hasExactKeys(value, [
        'type',
        'sequence',
        'sessionId',
        'turnId',
        'ok',
        'hash',
        'subject',
      ]) ||
      !isSequence(value.sequence) ||
      !isId(value.sessionId) ||
      !isId(value.turnId) ||
      !isGitCommitHashEcho(value.hash) ||
      !isBoundedString(value.subject, MAX_GIT_COMMIT_SUBJECT_LENGTH)
    ) {
      return undefined;
    }
    return {
      type: 'git.commitResult',
      sequence: value.sequence,
      sessionId: value.sessionId,
      turnId: value.turnId,
      ok: true,
      hash: value.hash,
      subject: value.subject,
    };
  }
  if (value.ok === false) {
    if (
      !hasExactKeys(value, ['type', 'sequence', 'sessionId', 'turnId', 'ok', 'error']) ||
      !isSequence(value.sequence) ||
      !isId(value.sessionId) ||
      !isId(value.turnId) ||
      !isNonEmptyBoundedString(value.error, MAX_GIT_COMMIT_ERROR_LENGTH)
    ) {
      return undefined;
    }
    return {
      type: 'git.commitResult',
      sequence: value.sequence,
      sessionId: value.sessionId,
      turnId: value.turnId,
      ok: false,
      error: value.error,
    };
  }
  return undefined;
}
