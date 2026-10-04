import { useCallback, type Dispatch } from 'react';
import { post, type ChatPort } from '../host/chatIntent';
import type { PathLink } from '@droidvisx/chat-ui/markdown/pathLink';
import { type AssistantWebviewAction } from '../state/types';
import type { GitCommitMode } from '../../shared/protocol/gitCommitFlow';

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
    (commitTurnId: string, paths: readonly string[], message: string, snapshotId?: string, mode?: GitCommitMode): void => {
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
        ...(snapshotId === undefined ? {} : { snapshotId }),
        ...(mode === undefined ? {} : { mode }),
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
  const handleOpenTerminalMirror = useCallback((): void => {
    if (sessionId === null || connectionStatus !== 'connected') {
      return;
    }
    post(vscode, { type: 'terminal.openMirror', sessionId });
  }, [sessionId, connectionStatus, vscode]);
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
    handleOpenTerminalMirror,
    handleOpenPath,
  };
}
