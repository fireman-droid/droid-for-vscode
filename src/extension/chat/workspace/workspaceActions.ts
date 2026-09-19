import type { WorkspaceActionsPort } from './workspaceActionsPort';
// Workspace-scoped file, preview, Git, and attachment actions.
import { isAbsolute, relative } from 'node:path';

import { type PreviewInlineHtmlMessage } from '../../../shared/bridgeMessages';
import {
  MAX_GIT_COMMIT_SUBJECT_LENGTH,
  type GitBranchDiffUnavailableReason,
} from '../../../shared/protocol/gitCommitFlow';
import {
  type ImageMediaType,
  type WorkspaceImageStatus,
} from '../../../shared/protocol/attachments';
import {
  MAX_FILE_SEARCH_RESULTS,
  MAX_IMAGE_DATA_LENGTH,
} from '../../../shared/protocol/bounds';
import { type WorkspaceFilesStatus } from '../../../shared/protocol/workspace';
import { FILE_NOT_READY_DIAGNOSTIC_CODE } from '../../../shared/protocol/transientDiagnostics';
import { isSafeWorkspaceRelativePath } from '../../../shared/validation/guards';
import { formatUnknownError, isTurnActive } from '../internals';

/**
 * Names the offending path and the failure mode so repeated clicks on
 * different chips produce distinguishable diagnostics (QA v0.3 P2-3);
 * the webview dedupes on code+message, so a fixed sentence collapsed
 * every failed file into one anonymous card.
 */
export function fileDiffFailedMessage(
  path: string,
  reason: 'missing' | 'open-error',
): string {
  return reason === 'missing'
    ? `Could not open ${path}. It may have been moved or deleted.`
    : `Could not open ${path}. The editor failed to open it.`;
}

export const FILE_NOT_READY_MESSAGE =
  'That file does not exist yet. Droid is still working on it.';

export const PREVIEW_FAILED_MESSAGE =
  'That prototype could not be previewed. It may have been moved, deleted, or is too large.';

export const OPEN_PATH_FAILED_MESSAGE =
  'That path could not be opened. It may have been moved or deleted.';

export function handleFileOpenDiff(
  ctl: WorkspaceActionsPort,
  sessionId: string,
  turnId: string,
  path: string,
): void {
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  const requestedTurnId = ctl.turnState.turn?.turnId ?? null;
  const turnChanges = ctl.effects.readConversationTurnChanges(turnId);
  const latestChanges = ctl.effects.readLatestConversationChanges();
  const committed = ctl.changeStats.readCommittedTurn?.(
    latestChanges?.sessionId ?? sessionId,
  );
  const committedRef =
    latestChanges?.turnId === turnId &&
    committed !== undefined &&
    committed.paths.includes(path.replaceAll('\\', '/'))
      ? committed.hash
      : undefined;
  const diffScope = {
    sessionId: turnChanges?.sessionId ?? sessionId,
    turnId,
  };
  const open =
    committedRef === undefined
      ? ctl.fileDiff.openDiff(path, diffScope)
      : ctl.fileDiff.openDiff(path, diffScope, { committedRef });
  void open.then((outcome) => {
    if (
      ctl.sessionState.disposed ||
      ctl.sessionState.connection.status !== 'connected' ||
      ctl.sessionState.sessionId !== sessionId ||
      (ctl.turnState.turn?.turnId ?? null) !== requestedTurnId
    ) {
      return;
    }
    if (outcome === 'not-found') {
      // Missing during an active turn means Droid has not written
      // the file yet; missing on a settled transcript means it was
      // moved or deleted after the fact.
      if (ctl.turnState.turn?.turnId === turnId && isTurnActive(ctl.turnState.turn)) {
        ctl.emitSessionDiagnostic(
          FILE_NOT_READY_DIAGNOSTIC_CODE,
          FILE_NOT_READY_MESSAGE,
          turnId,
        );
        return;
      }
      ctl.emitSessionDiagnostic(
        'file-diff-failed',
        fileDiffFailedMessage(path, 'missing'),
      );
      return;
    }
    if (outcome === 'failed') {
      ctl.emitSessionDiagnostic(
        'file-diff-failed',
        fileDiffFailedMessage(path, 'open-error'),
      );
    }
  });
}

export function handleFilePreview(
  ctl: WorkspaceActionsPort,
  sessionId: string,
  path: string,
): void {
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  void ctl.prototypePreview.openPreview(path).then((outcome) => {
    if (outcome === 'failed') {
      ctl.emitSessionDiagnostic('preview-failed', PREVIEW_FAILED_MESSAGE);
    }
  });
}

/** Renders a bridge-validated transcript HTML code block in the
 * sandboxed preview panel (same surface as file previews). */
export function handleInlineHtmlPreview(
  ctl: WorkspaceActionsPort,
  message: PreviewInlineHtmlMessage,
): void {
  const { sessionId, html } = message;
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  const artifact =
    message.artifactId === undefined
      ? undefined
      : { artifactId: message.artifactId, title: message.title as string };
  void ctl.prototypePreview.openInlineHtml(html, artifact).then((outcome) => {
    if (outcome === 'failed') {
      ctl.emitSessionDiagnostic('preview-failed', PREVIEW_FAILED_MESSAGE);
    }
  });
}

export function handleTerminalOpenMirror(
  ctl: WorkspaceActionsPort,
  sessionId: string,
): void {
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  ctl.terminalMirror?.open();
}

/**
 * Paths of the newest changes card, which drive the commit panel's
 * default selection (`inTurn`); normalized to forward slashes to
 * match `GitStatusFile` paths.
 */
export function latestTurnChangePaths(ctl: WorkspaceActionsPort): ReadonlySet<string> {
  const changes = ctl.effects.readLatestConversationChanges();
  return new Set(changes?.files.map((file) => file.path.replaceAll('\\', '/')) ?? []);
}

export function handleGitRequestStatus(
  ctl: WorkspaceActionsPort,
  sessionId: string,
  turnId: string,
): void {
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  const root = ctl.sessionState.activeRuntimeCwd;
  if (root === null) {
    ctl.emit({
      type: 'git.status',
      sessionId,
      turnId,
      branch: null,
      files: [],
      unavailableReason: 'unsupported-workspace',
    });
    return;
  }
  const latestChanges = ctl.effects.readLatestConversationChanges();
  const inTurn =
    latestChanges?.turnId === turnId ? latestTurnChangePaths(ctl) : new Set<string>();
  void ctl.gitWorkflow.status(root, inTurn).then((status) => {
    if (ctl.sessionState.disposed || ctl.sessionState.sessionId !== sessionId) {
      return;
    }
    if (status.available) {
      const committed = ctl.changeStats.readCommittedTurn?.(
        latestChanges?.sessionId ?? sessionId,
      );
      const committedHash =
        committed !== undefined &&
        inTurn.size > 0 &&
        [...inTurn].every((path) => committed.paths.includes(path)) &&
        !status.files.some((file) => file.inTurn)
          ? committed.hash
          : undefined;
      ctl.emit({
        type: 'git.status',
        sessionId,
        turnId,
        branch: status.branch,
        files: status.files,
        ...(committedHash === undefined ? {} : { committedHash }),
      });
      return;
    }
    ctl.emit({
      type: 'git.status',
      sessionId,
      turnId,
      branch: null,
      files: [],
      unavailableReason: status.reason,
    });
  });
}

export function handleGitRequestBranchDiff(
  ctl: WorkspaceActionsPort,
  sessionId: string,
): void {
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  const runtime = ctl.sessionState.runtime;
  const unavailable = (reason: GitBranchDiffUnavailableReason): void => {
    ctl.emit({
      type: 'git.branchDiff',
      sessionId,
      branch: null,
      baseBranch: null,
      files: [],
      additions: 0,
      deletions: 0,
      commitCount: 0,
      unavailableReason: reason,
    });
  };
  if (runtime === null || typeof runtime.readGitDiff !== 'function') {
    unavailable('unsupported-runtime');
    return;
  }
  void runtime.readGitDiff().then(
    (diff) => {
      if (ctl.sessionState.disposed || ctl.sessionState.sessionId !== sessionId) {
        return;
      }
      ctl.emit({
        type: 'git.branchDiff',
        sessionId,
        branch: diff.branch,
        baseBranch: diff.baseBranch,
        files: diff.files,
        additions: diff.additions,
        deletions: diff.deletions,
        commitCount: diff.commitCount,
      });
    },
    () => {
      if (!ctl.sessionState.disposed && ctl.sessionState.sessionId === sessionId) {
        unavailable('read-failed');
      }
    },
  );
}

export function handleGitCommit(
  ctl: WorkspaceActionsPort,
  sessionId: string,
  turnId: string,
  paths: readonly string[],
  message: string,
): void {
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  const root = ctl.sessionState.activeRuntimeCwd;
  if (root === null) {
    ctl.emit({
      type: 'git.commitResult',
      sessionId,
      turnId,
      ok: false,
      error: 'Git is unavailable (unsupported-workspace).',
    });
    return;
  }
  if (ctl.turnState.turn?.turnId === turnId && isTurnActive(ctl.turnState.turn)) {
    ctl.emit({
      type: 'git.commitResult',
      sessionId,
      turnId,
      ok: false,
      error: 'Wait for the Changes turn to finish before committing.',
    });
    return;
  }
  const commitChanges = ctl.effects.readLatestConversationChanges();
  if (commitChanges === undefined || commitChanges.turnId !== turnId) {
    ctl.emit({
      type: 'git.commitResult',
      sessionId,
      turnId,
      ok: false,
      error: 'The Changes turn is no longer current. Reopen Commit.',
    });
    return;
  }
  const commitTurnId = commitChanges.turnId;
  ctl.recordHost({
    level: 'info',
    name: 'host.git.commit.started',
    attributes: { fileCount: paths.length },
  });
  const normalizedPaths = paths.map((path) => path.replaceAll('\\', '/'));
  const selectedPaths = new Set(normalizedPaths);
  const committedStats = commitChanges?.files.filter((file) =>
    selectedPaths.has(file.path.replaceAll('\\', '/')),
  );
  void ctl.gitWorkflow.commit(root, paths, message).then(async (outcome) => {
    ctl.recordHost({
      level: outcome.ok ? 'info' : 'warn',
      name: 'host.git.commit.finished',
      attributes: {
        outcome: outcome.ok ? 'success' : 'failed',
        fileCount: paths.length,
        ...(outcome.ok ? { hash: outcome.hash } : {}),
      },
      ...(outcome.ok ? {} : { detail: outcome.error }),
    });
    if (outcome.ok && outcome.hash !== '' && commitTurnId !== undefined) {
      await ctl.changeStats.rememberCommittedTurn?.(
        {
          sessionId: commitChanges.sessionId,
          turnId: commitTurnId,
        },
        outcome.hash,
        normalizedPaths,
        committedStats,
      );
    }
    if (ctl.sessionState.disposed || ctl.sessionState.sessionId !== sessionId) {
      return;
    }
    ctl.emit(
      outcome.ok
        ? {
            type: 'git.commitResult',
            sessionId,
            turnId,
            ok: true,
            hash: outcome.hash,
            subject: commitSubject(message),
          }
        : {
            type: 'git.commitResult',
            sessionId,
            turnId,
            ok: false,
            error: outcome.error,
          },
    );
    if (outcome.ok) {
      handleGitRequestStatus(ctl, sessionId, turnId);
    }
  });
}

export function handleWorkspaceOpenPath(
  ctl: WorkspaceActionsPort,
  sessionId: string,
  path: string,
  line?: number,
  column?: number,
): void {
  if (
    ctl.sessionState.connection.status !== 'connected' ||
    sessionId !== ctl.sessionState.sessionId
  ) {
    return;
  }
  void ctl.pathOpener.openPath(path, line, column).then((outcome) => {
    if (outcome === 'failed') {
      ctl.emitSessionDiagnostic('open-path-failed', OPEN_PATH_FAILED_MESSAGE);
    }
  });
}

export function handleWorkspaceSearchFiles(
  ctl: WorkspaceActionsPort,
  sessionId: string,
  requestId: string,
  query: string,
): void {
  if (
    sessionId !== ctl.sessionState.sessionId ||
    ctl.sessionState.connection.status !== 'connected'
  ) {
    // Always answer with the original request id: a silently dropped
    // request left the mention popup on "Searching files..." forever.
    const status = ctl.getWorkspaceContext().cwd === null ? 'no-workspace' : 'ok';
    emitWorkspaceFiles(ctl, sessionId, requestId, [], status);
    recordWorkspaceSearch(ctl, query, {
      outcome: 'dropped',
      reason:
        sessionId !== ctl.sessionState.sessionId ? 'session-mismatch' : 'not-connected',
      status,
    });
    return;
  }
  if (query.trim().length === 0) {
    // A bare `@` lists the open editor tabs instead of nothing.
    const openFiles = (
      ctl.attachmentSources.listOpenEditorFiles?.(MAX_FILE_SEARCH_RESULTS) ?? []
    ).filter((file) => isSafeWorkspaceRelativePath(file));
    emitWorkspaceFiles(ctl, sessionId, requestId, openFiles, 'ok');
    return;
  }
  const startedAt = performance.now();
  void ctl.attachmentSources
    .searchWorkspaceFiles(query.trim(), MAX_FILE_SEARCH_RESULTS)
    .then(
      (files) => {
        const safeFiles = files
          .filter((file) => isSafeWorkspaceRelativePath(file))
          .slice(0, MAX_FILE_SEARCH_RESULTS);
        const status =
          safeFiles.length === 0 && ctl.getWorkspaceContext().cwd === null
            ? 'no-workspace'
            : 'ok';
        recordWorkspaceSearch(ctl, query, {
          outcome: 'ok',
          resultCount: safeFiles.length,
          durationMs: Math.round(performance.now() - startedAt),
          status,
        });
        if (sessionId === ctl.sessionState.sessionId) {
          emitWorkspaceFiles(ctl, sessionId, requestId, safeFiles, status);
        }
      },
      (error) => {
        recordWorkspaceSearch(ctl, query, {
          outcome: 'failed',
          durationMs: Math.round(performance.now() - startedAt),
          detail: formatUnknownError(error),
        });
        if (sessionId === ctl.sessionState.sessionId) {
          emitWorkspaceFiles(ctl, sessionId, requestId, [], 'ok');
        }
      },
    );
}

/** Structured record for one `@` mention file search (P0 gap: the
 * search round-trip previously produced zero log events). */
export function recordWorkspaceSearch(
  ctl: WorkspaceActionsPort,
  query: string,
  attributes: {
    outcome: 'ok' | 'failed' | 'dropped';
    resultCount?: number;
    durationMs?: number;
    reason?: string;
    status?: string;
    detail?: string;
  },
): void {
  const { detail, ...rest } = attributes;
  ctl.recordHost({
    level: attributes.outcome === 'ok' ? 'info' : 'warn',
    name: 'host.workspace.search',
    attributes: { queryLength: query.length, ...rest },
    ...(detail === undefined ? {} : { detail }),
  });
}

/**
 * Reads a workspace-local image referenced by transcript markdown.
 * Reuses the attachment reader, which enforces workspace
 * containment and per-kind size caps; anything that is not a
 * displayable image degrades to a non-ok status so the webview can
 * fall back to a clickable path link.
 */
export function handleWorkspaceReadImage(
  ctl: WorkspaceActionsPort,
  sessionId: string,
  path: string,
): void {
  if (sessionId !== ctl.sessionState.sessionId) {
    return;
  }
  const respond = (
    status: WorkspaceImageStatus,
    mediaType: ImageMediaType | null = null,
    data = '',
  ): void => {
    if (sessionId !== ctl.sessionState.sessionId) {
      return;
    }
    ctl.emit({
      type: 'workspace.imageData',
      sessionId,
      path,
      status,
      mediaType,
      data,
    });
  };
  const cwd = ctl.getWorkspaceContext().cwd;
  if (cwd === null) {
    respond('not-found');
    return;
  }
  // Markdown may reference the file absolutely; the reader only
  // accepts workspace-relative paths, so rebase inside-root
  // absolutes and refuse everything else.
  const relativePath = isAbsolute(path) ? relative(cwd, path) : path;
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath)
  ) {
    respond('not-found');
    return;
  }
  void ctl.attachmentSources.readWorkspaceFile(relativePath.replaceAll('\\', '/')).then(
    (outcome) => {
      switch (outcome.status) {
        case 'picked': {
          const item = outcome.items[0];
          if (item === undefined || item.kind !== 'image') {
            respond('unsupported');
          } else if (item.data.length > MAX_IMAGE_DATA_LENGTH) {
            respond('too-large');
          } else {
            respond('ok', item.mediaType, item.data);
          }
          return;
        }
        case 'rejected':
          respond(outcome.reason === 'too-large' ? 'too-large' : 'unsupported');
          return;
        default:
          respond('not-found');
      }
    },
    () => respond('not-found'),
  );
}

export function emitWorkspaceFiles(
  ctl: WorkspaceActionsPort,
  sessionId: string,
  requestId: string,
  files: readonly string[],
  status: WorkspaceFilesStatus,
): void {
  ctl.emit({
    type: 'workspace.files',
    sessionId,
    requestId,
    status,
    files,
  });
}

export /** Display subject of a commit: first line, trimmed and capped. */
function commitSubject(message: string): string {
  const firstLine = message.split('\n', 1)[0] ?? '';
  return firstLine.trim().slice(0, MAX_GIT_COMMIT_SUBJECT_LENGTH);
}
