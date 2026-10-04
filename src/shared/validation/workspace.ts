import {
  type GitCommitRequestMessage,
  type GitRequestStatusMessage,
  type PreviewInlineHtmlMessage,
  type WebviewToHostMessage,
} from '../bridgeMessages';
import { parseCanvasInlinePreviewMessage } from '../protocol/canvasProtocol';
import {
  MAX_GIT_COMMIT_MESSAGE_LENGTH,
  MAX_GIT_COMMIT_PATHS,
} from '../protocol/gitCommitFlow';
import { type WorkspaceReadImageMessage } from '../protocol/attachments';
import { MAX_FILE_SEARCH_QUERY_LENGTH, MAX_IMAGE_PATH_LENGTH } from '../protocol/bounds';
import {
  type FileOpenDiffMessage,
  type FilePreviewMessage,
  type TerminalOpenMirrorMessage,
  type WorkspaceOpenPathMessage,
  type WorkspaceSearchFilesMessage,
} from '../protocol/workspace';
import { hasExactKeys, isExactArray, type UnknownRecord } from './strictValidation';
import {
  isId,
  isPathPosition,
  isPreviewableFilePath,
  isSafeOpenPath,
  isSafeWorkspaceRelativePath,
} from './guards';

export function parseFileOpenDiff(value: UnknownRecord): FileOpenDiffMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'turnId', 'path']) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isSafeWorkspaceRelativePath(value.path)
  ) {
    return undefined;
  }

  return {
    type: 'file.openDiff',
    sessionId: value.sessionId,
    turnId: value.turnId,
    path: value.path,
  };
}

export function parseWorkspaceOpenPath(
  value: UnknownRecord,
): WorkspaceOpenPathMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'path'], ['line', 'column']) ||
    !isId(value.sessionId) ||
    !isSafeOpenPath(value.path) ||
    (value.line !== undefined && !isPathPosition(value.line)) ||
    (value.column !== undefined &&
      (value.line === undefined || !isPathPosition(value.column)))
  ) {
    return undefined;
  }

  return {
    type: 'workspace.openPath',
    sessionId: value.sessionId,
    path: value.path,
    ...(value.line === undefined ? {} : { line: value.line }),
    ...(value.column === undefined ? {} : { column: value.column }),
  };
}

export function parseFilePreview(value: UnknownRecord): FilePreviewMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'path']) ||
    !isId(value.sessionId) ||
    !isSafeWorkspaceRelativePath(value.path) ||
    !isPreviewableFilePath(value.path)
  ) {
    return undefined;
  }

  return {
    type: 'file.preview',
    sessionId: value.sessionId,
    path: value.path,
  };
}

export function parsePreviewInlineHtml(
  value: UnknownRecord,
): PreviewInlineHtmlMessage | undefined {
  return parseCanvasInlinePreviewMessage(value, isId);
}

export function parseGitRequestStatus(
  value: UnknownRecord,
): GitRequestStatusMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'turnId']) ||
    !isId(value.sessionId) ||
    !isId(value.turnId)
  ) {
    return undefined;
  }

  return { type: 'git.requestStatus', sessionId: value.sessionId, turnId: value.turnId };
}

export function parseTerminalOpenMirror(
  value: UnknownRecord,
): TerminalOpenMirrorMessage | undefined {
  if (!hasExactKeys(value, ['type', 'sessionId']) || !isId(value.sessionId)) {
    return undefined;
  }

  return { type: 'terminal.openMirror', sessionId: value.sessionId };
}

export function parseGitCommitRequest(
  value: UnknownRecord,
): GitCommitRequestMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'turnId', 'paths', 'message'], ['snapshotId', 'mode']) ||
    !isId(value.sessionId) ||
    !isId(value.turnId) ||
    !isExactArray(value.paths, 1, MAX_GIT_COMMIT_PATHS) ||
    typeof value.message !== 'string' ||
    value.message.trim().length === 0 ||
    value.message.length > MAX_GIT_COMMIT_MESSAGE_LENGTH ||
    (value.snapshotId !== undefined && !isId(value.snapshotId)) ||
    (value.mode !== undefined && value.mode !== 'files' && value.mode !== 'staged')
  ) {
    return undefined;
  }
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const pathValue of value.paths) {
    if (!isSafeWorkspaceRelativePath(pathValue) || seen.has(pathValue)) {
      return undefined;
    }
    seen.add(pathValue);
    paths.push(pathValue);
  }

  return {
    type: 'git.commit',
    sessionId: value.sessionId,
    turnId: value.turnId,
    paths,
    message: value.message,
    ...(value.snapshotId === undefined ? {} : { snapshotId: value.snapshotId as string }),
    ...(value.mode === undefined ? {} : { mode: value.mode as 'files' | 'staged' }),
  };
}

export function parseGitRequestBranchDiff(
  value: UnknownRecord,
): Extract<WebviewToHostMessage, { type: 'git.requestBranchDiff' }> | undefined {
  return hasExactKeys(value, ['type', 'sessionId']) && isId(value.sessionId)
    ? { type: 'git.requestBranchDiff', sessionId: value.sessionId }
    : undefined;
}

export function parseWorkspaceSearchFiles(
  value: UnknownRecord,
): WorkspaceSearchFilesMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'requestId', 'query']) ||
    !isId(value.sessionId) ||
    !isId(value.requestId) ||
    typeof value.query !== 'string' ||
    value.query.length > MAX_FILE_SEARCH_QUERY_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value.query)
  ) {
    return undefined;
  }

  return {
    type: 'workspace.searchFiles',
    sessionId: value.sessionId,
    requestId: value.requestId,
    query: value.query,
  };
}

export function parseWorkspaceReadImage(
  value: UnknownRecord,
): WorkspaceReadImageMessage | undefined {
  if (
    !hasExactKeys(value, ['type', 'sessionId', 'path']) ||
    !isId(value.sessionId) ||
    typeof value.path !== 'string' ||
    value.path.length === 0 ||
    value.path.length > MAX_IMAGE_PATH_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value.path)
  ) {
    return undefined;
  }

  return {
    type: 'workspace.readImage',
    sessionId: value.sessionId,
    path: value.path,
  };
}
