import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { post, type ChatPort } from '../shell/chatIntent';
import { type AssistantWebviewState } from '../state/types';

export function useSessionActions({
  vscode,
  sessionId,
  connectionStatus,
  transcript,
  conversationTransitionBlocking,
  beginConversationSwitch,
}: {
  vscode: ChatPort;
  sessionId: string | null;
  connectionStatus: string;
  transcript: AssistantWebviewState['transcript'];
  conversationTransitionBlocking: boolean;
  beginConversationSwitch: (sessionId: string) => void;
}) {
  // Compaction in-flight latch (10a): set when either entry point
  // fires, cleared when the host answers with a session switch
  // (success adopts the continuation session) or a session-compact*
  // diagnostic (blocked/unsupported/failed), with a timeout backstop.
  const [compactPending, setCompactPending] = useState(false);
  const compactBaselineRef = useRef<{
    readonly sessionId: string | null;
    readonly signal: string | null;
  } | null>(null);
  const compactSignal = useMemo(() => {
    for (let i = transcript.length - 1; i >= 0; i -= 1) {
      const item = transcript[i];
      if (
        item !== undefined &&
        item.kind === 'diagnostic' &&
        item.code.startsWith('session-compact')
      ) {
        return item.id;
      }
    }
    return null;
  }, [transcript]);
  const handleCompact = useCallback((): void => {
    if (
      sessionId === null ||
      connectionStatus !== 'connected' ||
      conversationTransitionBlocking ||
      compactPending
    ) {
      return;
    }
    compactBaselineRef.current = { sessionId, signal: compactSignal };
    setCompactPending(true);
    post(vscode, { type: 'session.compact', sessionId });
  }, [
    compactPending,
    compactSignal,
    connectionStatus,
    conversationTransitionBlocking,
    sessionId,
    vscode,
  ]);
  useEffect(() => {
    if (!compactPending) {
      return undefined;
    }
    const baseline = compactBaselineRef.current;
    if (
      baseline === null ||
      connectionStatus !== 'connected' ||
      sessionId !== baseline.sessionId ||
      compactSignal !== baseline.signal
    ) {
      compactBaselineRef.current = null;
      setCompactPending(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      compactBaselineRef.current = null;
      setCompactPending(false);
    }, 30_000);
    return () => clearTimeout(timer);
  }, [compactPending, compactSignal, connectionStatus, sessionId]);
  const handleRetry = useCallback((): void => {
    post(vscode, {
      type: 'runtime.retry',
      sessionId: sessionId,
    });
  }, [sessionId, vscode]);
  const handleNewSession = useCallback((): void => {
    post(vscode, { type: 'session.new' });
  }, [vscode]);
  const handleCreateWorktreeSession = useCallback((): void => {
    post(vscode, { type: 'worktree.createSession' });
  }, [vscode]);
  const handleSelectSession = useCallback(
    (nextSessionId: string): void => {
      if (nextSessionId !== sessionId) {
        beginConversationSwitch(nextSessionId);
      }
      post(vscode, {
        type: 'session.select',
        sessionId: nextSessionId,
      });
    },
    [beginConversationSwitch, sessionId, vscode],
  );
  const handleRenameSession = useCallback(
    (targetSessionId: string, title: string): void => {
      const trimmed = title.trim();
      if (trimmed.length === 0) {
        return;
      }
      post(vscode, {
        type: 'session.rename',
        sessionId: targetSessionId,
        title: trimmed,
      });
    },
    [vscode],
  );
  const handleForkSession = useCallback(
    (targetSessionId: string): void => {
      post(vscode, {
        type: 'session.fork',
        sessionId: targetSessionId,
      });
    },
    [vscode],
  );
  // "Fork chat" on the last assistant message branches the current
  // session from its present state (the SDK has no per-message fork
  // anchor, so the action lives only on the newest reply).
  const handleForkCurrentSession = useCallback((): void => {
    if (sessionId !== null) {
      handleForkSession(sessionId);
    }
  }, [handleForkSession, sessionId]);
  const handleToggleFavorite = useCallback(
    (targetSessionId: string, favorite: boolean): void => {
      post(vscode, {
        type: 'session.favorite',
        sessionId: targetSessionId,
        favorite,
      });
    },
    [vscode],
  );
  const handleArchiveSession = useCallback(
    (targetSessionId: string): void => {
      post(vscode, {
        type: 'session.archive',
        sessionId: targetSessionId,
      });
    },
    [vscode],
  );
  const handleUnarchiveSession = useCallback(
    (targetSessionId: string): void => {
      post(vscode, {
        type: 'session.unarchive',
        sessionId: targetSessionId,
      });
    },
    [vscode],
  );
  const handleRefreshArchived = useCallback((): void => {
    post(vscode, { type: 'sessions.archivedRefresh' });
  }, [vscode]);
  const handleSearchContent = useCallback(
    (query: string): void => {
      post(vscode, { type: 'session.search', query });
    },
    [vscode],
  );
  return {
    compactPending,
    handleCompact,
    handleRetry,
    handleNewSession,
    handleCreateWorktreeSession,
    handleSelectSession,
    handleRenameSession,
    handleForkSession,
    handleForkCurrentSession,
    handleToggleFavorite,
    handleArchiveSession,
    handleUnarchiveSession,
    handleRefreshArchived,
    handleSearchContent,
  };
}
