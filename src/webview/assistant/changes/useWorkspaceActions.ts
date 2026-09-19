import { useCallback, type Dispatch } from 'react';
import { post, type ChatPort } from '../shell/chatIntent';
import { MAX_INLINE_PREVIEW_HTML_LENGTH } from '../../../shared/bridgeMessages';
import type { PathLink } from '../markdown/pathLink';
import { type AssistantWebviewAction } from '../state/types';

export function useWorkspaceActions({
  vscode,
  sessionId,
  connectionStatus,
  dispatch,
}: {
  vscode: ChatPort;
  sessionId: string | null;
  connectionStatus: string;
  dispatch: Dispatch<AssistantWebviewAction>;
}) {
  const handleFileSearch = useCallback(
    (requestId: string, query: string): void => {
      if (sessionId !== null && connectionStatus === 'connected') {
        post(vscode, {
          type: 'workspace.searchFiles',
          sessionId,
          requestId,
          query,
        });
      }
    },
    [connectionStatus, sessionId, vscode],
  );
  const handleGitRequestStatus = useCallback(
    (requestTurnId: string): void => {
      if (sessionId === null || connectionStatus !== 'connected') {
        return;
      }
      dispatch({ type: 'git.statusRequested', turnId: requestTurnId });
      post(vscode, {
        type: 'git.requestStatus',
        sessionId,
        turnId: requestTurnId,
      });
    },
    [connectionStatus, sessionId, vscode],
  );
  const handleGitCommit = useCallback(
    (commitTurnId: string, paths: readonly string[], message: string): void => {
      if (sessionId === null || connectionStatus !== 'connected') {
        return;
      }
      dispatch({ type: 'git.commitRequested', turnId: commitTurnId });
      post(vscode, {
        type: 'git.commit',
        sessionId,
        turnId: commitTurnId,
        paths,
        message,
      });
    },
    [connectionStatus, sessionId, vscode],
  );
  const handleOpenFileDiff = useCallback(
    (path: string, turnId: string | null): void => {
      if (sessionId === null || turnId === null || connectionStatus !== 'connected') {
        return;
      }
      post(vscode, { type: 'file.openDiff', sessionId, turnId, path });
    },
    [sessionId, connectionStatus, vscode],
  );
  const handleOpenReviewTurn = useCallback(
    (reviewTurnId: string): void => {
      if (sessionId === null || connectionStatus !== 'connected') {
        return;
      }
      post(vscode, {
        type: 'review.open',
        sessionId,
        scopeKind: 'turn',
        turnId: reviewTurnId,
        openCurrent: true,
      });
    },
    [sessionId, connectionStatus, vscode],
  );
  const handlePreviewFile = useCallback(
    (path: string): void => {
      if (sessionId === null || connectionStatus !== 'connected') {
        return;
      }
      post(vscode, { type: 'file.preview', sessionId, path });
    },
    [sessionId, connectionStatus, vscode],
  );
  const handleOpenTerminalMirror = useCallback((): void => {
    if (sessionId === null || connectionStatus !== 'connected') {
      return;
    }
    post(vscode, { type: 'terminal.openMirror', sessionId });
  }, [sessionId, connectionStatus, vscode]);
  // Webview side of the dual-side limit: the code-block entry is
  // already disabled above MAX_INLINE_PREVIEW_HTML_LENGTH, so this
  // guard only drops payloads a stale DOM could still submit.
  const handlePreviewInlineHtml = useCallback(
    (
      html: string,
      artifact: { readonly artifactId: string; readonly title: string },
    ): void => {
      if (
        sessionId === null ||
        connectionStatus !== 'connected' ||
        html.length === 0 ||
        html.length > MAX_INLINE_PREVIEW_HTML_LENGTH
      ) {
        return;
      }
      post(vscode, {
        type: 'preview.inlineHtml',
        sessionId,
        html,
        artifactId: artifact.artifactId,
        title: artifact.title,
      });
    },
    [sessionId, connectionStatus, vscode],
  );
  const handleOpenPath = useCallback(
    (link: PathLink): void => {
      if (sessionId === null || connectionStatus !== 'connected') {
        return;
      }
      post(vscode, {
        type: 'workspace.openPath',
        sessionId,
        path: link.path,
        ...(link.line === undefined ? {} : { line: link.line }),
        ...(link.column === undefined ? {} : { column: link.column }),
      });
    },
    [sessionId, connectionStatus, vscode],
  );
  return {
    handleFileSearch,
    handleGitRequestStatus,
    handleGitCommit,
    handleOpenFileDiff,
    handleOpenReviewTurn,
    handlePreviewFile,
    handleOpenTerminalMirror,
    handlePreviewInlineHtml,
    handleOpenPath,
  };
}
