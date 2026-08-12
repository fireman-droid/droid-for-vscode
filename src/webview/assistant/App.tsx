import {
  AssistantRuntimeProvider,
  useAui,
} from '@assistant-ui/react';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import {
  MAX_TURN_TEXT_LENGTH,
  type AskUserAnswer,
  type ImageMediaType,
  type WebviewToHostMessage,
} from '../../shared/bridgeMessages';
import {
  announceBooted,
  announceReady,
  announceRendered,
  getVsCodeApi,
  persistDraft,
  postPerfBeacon,
  readHostMessage,
  restoreDraft,
} from '../bridge/vscode';
import { InteractionPanel } from './Interactions';
import { LocalImageContext, OpenPathContext } from './MarkdownText';
import type { PathLink } from './pathLink';
import type {
  McpServerAddParams,
  SessionSettingSelection,
} from './ComposerControls';
import {
  canSendMessage,
  DEFAULT_MESSAGE_WINDOW,
  MESSAGE_WINDOW_STEP,
  useDroidExternalStoreRuntime,
} from './runtimeAdapter';
import { SessionDrawer } from './SessionDrawer';
import {
  assistantWebviewReducer,
  initialAssistantWebviewState,
  isTurnActive,
  type PendingInteraction,
} from './store';
import { DroidThread } from './Thread';
import {
  GitCommitFlowContext,
  type GitCommitFlowContextValue,
} from './GitCommitPanel';
import { findLatestChangesContext } from './gitCommitDraft';
import './styles.css';

export function App(): React.JSX.Element {
  const vscodeRef = useRef<ReturnType<typeof getVsCodeApi> | null>(null);
  vscodeRef.current ??= getVsCodeApi();
  const vscode = vscodeRef.current;
  const [state, dispatch] = useReducer(
    assistantWebviewReducer,
    initialAssistantWebviewState,
  );
  const [draft, setDraft] = useState(() => restoreDraft(vscode));
  const [initialDraft] = useState(draft);
  // Pushes the restored draft into the composer once on boot; nothing
  // rewrites the draft programmatically after that.
  const [draftCommand] = useState(() => ({
    id: 0,
    text: initialDraft,
  }));
  const sendPendingRef = useRef(false);
  // Incremented on every committed Composer send; the thread closes
  // any open user-message edit card when it changes (a new message is
  // an explicit signal the user abandoned that edit).
  const [sendSignal, setSendSignal] = useState(0);

  useEffect(() => {
    // Host messages are coalesced into one dispatch batch per animation
    // frame; during streaming the host can emit deltas faster than the
    // transcript re-renders, and per-message renders saturate the main
    // thread on long sessions. The timeout keeps messages flowing when
    // the webview is hidden and frames stop.
    let queue: NonNullable<ReturnType<typeof readHostMessage>>[] = [];
    let frameId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
    // rAF batching accounting (P3), reported once per finished turn.
    let batchStats = { flushes: 0, messages: 0, maxBatch: 0, maxFlushMs: 0 };
    const flush = (): void => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      if (timerId !== null) {
        clearTimeout(timerId);
        timerId = null;
      }
      if (queue.length === 0) {
        return;
      }
      const batch = queue;
      queue = [];
      sendPendingRef.current = false;
      const flushStart = performance.now();
      let turnFinished = false;
      for (const message of batch) {
        if (
          message.type === 'turn.state' &&
          (message.status === 'completed' ||
            message.status === 'interrupted' ||
            message.status === 'failed')
        ) {
          turnFinished = true;
        }
        dispatch({ type: 'host.message', message });
      }
      const flushMs = performance.now() - flushStart;
      batchStats.flushes += 1;
      batchStats.messages += batch.length;
      batchStats.maxBatch = Math.max(batchStats.maxBatch, batch.length);
      batchStats.maxFlushMs = Math.max(batchStats.maxFlushMs, flushMs);
      if (turnFinished && batchStats.messages > 0) {
        postPerfBeacon(
          vscode,
          'perf-batch',
          `flushes ${batchStats.flushes} messages ${batchStats.messages} maxBatch ${batchStats.maxBatch} maxFlushMs ${Math.round(batchStats.maxFlushMs)}`,
        );
        batchStats = { flushes: 0, messages: 0, maxBatch: 0, maxFlushMs: 0 };
      }
    };
    const handleMessage = (event: MessageEvent<unknown>): void => {
      const message = readHostMessage(event.data);
      if (message === undefined) {
        return;
      }
      queue.push(message);
      frameId ??= requestAnimationFrame(flush);
      timerId ??= setTimeout(flush, 50);
    };
    window.addEventListener('message', handleMessage);
    persistDraft(vscode, initialDraft);
    announceBooted(vscode);
    announceReady(vscode);
    return () => {
      window.removeEventListener('message', handleMessage);
      flush();
    };
  }, [initialDraft, vscode]);

  useEffect(() => {
    // Main-thread stall accounting (P2): long tasks are aggregated and
    // reported at most once per 30s window, only when any occurred.
    if (typeof PerformanceObserver !== 'function') {
      return;
    }
    let count = 0;
    let totalMs = 0;
    let maxMs = 0;
    let observer: PerformanceObserver;
    try {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          count += 1;
          totalMs += entry.duration;
          maxMs = Math.max(maxMs, entry.duration);
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // The longtask entry type is unsupported in some environments.
      return;
    }
    const intervalId = setInterval(() => {
      if (count === 0) {
        return;
      }
      postPerfBeacon(
        vscode,
        'perf-longtask',
        `count ${count} maxMs ${Math.round(maxMs)} totalMs ${Math.round(totalMs)} windowMs 30000`,
      );
      count = 0;
      totalMs = 0;
      maxMs = 0;
    }, 30_000);
    return () => {
      clearInterval(intervalId);
      observer.disconnect();
    };
  }, [vscode]);

  // One-shot beacon proving the first non-empty transcript reached the
  // DOM; its absence in the logs isolates a render-phase hang.
  const renderedBeaconRef = useRef(false);
  useEffect(() => {
    if (!renderedBeaconRef.current && state.transcript.length > 0) {
      renderedBeaconRef.current = true;
      announceRendered(vscode, state.transcript.length);
    }
  }, [state.transcript.length, vscode]);

  const active = isTurnActive(state.turn);
  const hasInteraction = state.interactions.length > 0;
  const connectionStatus = state.connection.status;
  const sessionId = state.sessionId;
  const turnId = state.turn?.turnId ?? null;
  const turnStatus = state.turn?.status ?? null;
  const interactionCount = state.interactions.length;
  const sendDisabled = !canSendMessage(
    {
      connectionStatus,
      sessionId,
      turnStatus,
      interactionCount,
    },
    draft,
  );
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
    for (let i = state.transcript.length - 1; i >= 0; i -= 1) {
      const item = state.transcript[i];
      if (
        item !== undefined &&
        item.kind === 'diagnostic' &&
        item.code.startsWith('session-compact')
      ) {
        return item.id;
      }
    }
    return null;
  }, [state.transcript]);
  const handleCompact = useCallback((): void => {
    if (
      sessionId === null ||
      connectionStatus !== 'connected' ||
      compactPending
    ) {
      return;
    }
    compactBaselineRef.current = { sessionId, signal: compactSignal };
    setCompactPending(true);
    post(vscode, { type: 'session.compact', sessionId });
  }, [compactPending, compactSignal, connectionStatus, sessionId, vscode]);
  useEffect(() => {
    if (!compactPending) {
      return undefined;
    }
    const baseline = compactBaselineRef.current;
    if (
      baseline === null ||
      connectionStatus !== 'connected' ||
      state.sessionId !== baseline.sessionId ||
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
  }, [compactPending, compactSignal, connectionStatus, state.sessionId]);

  const handleSend = useCallback(
    async (text: string): Promise<void> => {
      // /compact typed in the composer is otherwise forwarded to the
      // Droid CLI as prompt text, which acknowledges without running
      // our compaction pipeline (no continuation-session adoption, no
      // context refresh). Route it through the same RPC as the
      // Compact button so both paths behave identically (10b).
      if (/^\/compact$/i.test(text.trim())) {
        handleCompact();
        setDraft('');
        persistDraft(vscode, '');
        return;
      }
      // /new is a GUI built-in like /compact: start a fresh session
      // instead of sending the literal text to the CLI.
      if (/^\/new$/i.test(text.trim())) {
        post(vscode, { type: 'session.new' });
        setDraft('');
        persistDraft(vscode, '');
        return;
      }
      const eligibility = {
        connectionStatus,
        sessionId,
        turnStatus,
        interactionCount,
      };
      if (
        !canSendMessage(
          eligibility,
          text,
          sendPendingRef.current,
        )
      ) {
        return;
      }
      sendPendingRef.current = true;
      const nextTurnId = createTurnId();
      dispatch({ type: 'turn.send', turnId: nextTurnId, text });
      post(vscode, {
        type: 'turn.send',
        sessionId: eligibility.sessionId,
        turnId: nextTurnId,
        text,
      });
      setSendSignal((value) => value + 1);
      setDraft('');
      persistDraft(vscode, '');
    },
    [
      connectionStatus,
      handleCompact,
      interactionCount,
      sessionId,
      turnStatus,
      vscode,
    ],
  );
  const handleCancel = useCallback(async (): Promise<void> => {
    if (
      sessionId === null ||
      turnId === null ||
      (turnStatus !== 'submitting' && turnStatus !== 'streaming')
    ) {
      return;
    }
    post(vscode, {
      type: 'turn.stop',
      sessionId,
      turnId,
    });
    dispatch({ type: 'turn.stop' });
  }, [sessionId, turnId, turnStatus, vscode]);
  const callbacks = useMemo(
    () => ({
      isSendDisabled: sendDisabled || sendPendingRef.current,
      onSend: handleSend,
      onCancel: handleCancel,
    }),
    [handleCancel, handleSend, sendDisabled],
  );
  const [messageWindow, setMessageWindow] = useState(
    DEFAULT_MESSAGE_WINDOW,
  );
  const windowSessionRef = useRef(sessionId);
  if (windowSessionRef.current !== sessionId) {
    windowSessionRef.current = sessionId;
    setMessageWindow(DEFAULT_MESSAGE_WINDOW);
  }
  const { runtime, hiddenMessageCount } = useDroidExternalStoreRuntime(
    state,
    callbacks,
    messageWindow,
  );
  const handleShowEarlier = useCallback((): void => {
    setMessageWindow((current) => current + MESSAGE_WINDOW_STEP);
  }, []);

  const handleDraftChange = useCallback(
    (nextDraft: string): void => {
      setDraft(nextDraft);
      persistDraft(vscode, nextDraft);
    },
    [vscode],
  );
  const handleEditResend = useCallback(
    (messageId: string, text: string, restoreFiles = false): void => {
      const trimmed = text.trim();
      if (
        sessionId === null ||
        connectionStatus !== 'connected' ||
        isTurnActive(state.turn) ||
        interactionCount > 0 ||
        trimmed.length === 0 ||
        text.length > MAX_TURN_TEXT_LENGTH
      ) {
        return;
      }
      post(vscode, {
        type: 'turn.editResend',
        sessionId,
        turnId: createTurnId(),
        messageId,
        text,
        ...(restoreFiles ? { restoreFiles: true } : {}),
      });
    },
    [
      connectionStatus,
      interactionCount,
      sessionId,
      state.turn,
      vscode,
    ],
  );
  const handleRequestRewindInfo = useCallback(
    (messageId: string): void => {
      if (sessionId !== null && connectionStatus === 'connected') {
        post(vscode, {
          type: 'rewind.info',
          sessionId,
          messageId,
        });
      }
    },
    [connectionStatus, sessionId, vscode],
  );
  // Anchor for Regenerate: the last user message that can start a
  // rewind. Regenerating resends its unchanged text from that point.
  const regenerateAnchor = useMemo(() => {
    for (let i = state.transcript.length - 1; i >= 0; i -= 1) {
      const item = state.transcript[i];
      if (item !== undefined && item.kind === 'user') {
        return item.messageId === undefined
          ? null
          : { messageId: item.messageId, text: item.text };
      }
    }
    return null;
  }, [state.transcript]);
  const handleRegenerate = useCallback((): void => {
    if (regenerateAnchor !== null) {
      handleEditResend(
        regenerateAnchor.messageId,
        regenerateAnchor.text,
      );
    }
  }, [handleEditResend, regenerateAnchor]);
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
  const handleAttachPath = useCallback(
    (path: string): void => {
      if (sessionId !== null && connectionStatus === 'connected') {
        post(vscode, {
          type: 'attachment.addPath',
          sessionId,
          path,
        });
      }
    },
    [connectionStatus, sessionId, vscode],
  );
  // Markdown image resolution: one in-flight request per path; the
  // reply lands in `state.localImages` and re-renders the reference.
  const requestedImagesRef = useRef<Set<string>>(new Set());
  const requestedImagesSessionRef = useRef(sessionId);
  if (requestedImagesSessionRef.current !== sessionId) {
    requestedImagesSessionRef.current = sessionId;
    requestedImagesRef.current.clear();
  }
  const requestLocalImage = useCallback(
    (path: string): void => {
      if (
        sessionId === null ||
        connectionStatus !== 'connected' ||
        requestedImagesRef.current.has(path)
      ) {
        return;
      }
      requestedImagesRef.current.add(path);
      post(vscode, { type: 'workspace.readImage', sessionId, path });
    },
    [connectionStatus, sessionId, vscode],
  );
  const localImageSource = useMemo(
    () => ({
      entries: state.localImages,
      request: requestLocalImage,
    }),
    [state.localImages, requestLocalImage],
  );
  const handleGitRequestStatus = useCallback((): void => {
    if (sessionId === null || connectionStatus !== 'connected') {
      return;
    }
    dispatch({ type: 'git.statusRequested' });
    post(vscode, { type: 'git.requestStatus', sessionId });
  }, [connectionStatus, sessionId, vscode]);
  const handleGitCommit = useCallback(
    (
      commitTurnId: string,
      paths: readonly string[],
      message: string,
    ): void => {
      if (sessionId === null || connectionStatus !== 'connected') {
        return;
      }
      dispatch({ type: 'git.commitRequested', turnId: commitTurnId });
      post(vscode, { type: 'git.commit', sessionId, paths, message });
    },
    [connectionStatus, sessionId, vscode],
  );
  const changesContext = useMemo(
    () => findLatestChangesContext(state.transcript),
    [state.transcript],
  );
  const gitFlow = useMemo<GitCommitFlowContextValue>(
    () => ({
      state: state.git,
      latestChangesTurnId: changesContext?.turnId ?? null,
      promptText: changesContext?.prompt ?? null,
      onRequestStatus: handleGitRequestStatus,
      onCommit: handleGitCommit,
    }),
    [
      state.git,
      changesContext,
      handleGitRequestStatus,
      handleGitCommit,
    ],
  );
  const handleRetry = useCallback((): void => {
    post(vscode, {
      type: 'runtime.retry',
      sessionId: state.sessionId,
    });
  }, [state.sessionId, vscode]);
  const handleNewSession = useCallback((): void => {
    post(vscode, { type: 'session.new' });
  }, [vscode]);
  const handleCreateWorktreeSession = useCallback((): void => {
    post(vscode, { type: 'worktree.createSession' });
  }, [vscode]);
  const handleSelectSession = useCallback(
    (nextSessionId: string): void => {
      post(vscode, {
        type: 'session.select',
        sessionId: nextSessionId,
      });
    },
    [vscode],
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
  const handleContextRefresh = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, {
      type: 'session.context.refresh',
      sessionId,
    });
  }, [sessionId, vscode]);
  const handleSkillsRefresh = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, { type: 'skills.refresh', sessionId });
  }, [sessionId, vscode]);
  const handleCommandsRefresh = useCallback((): void => {
    if (sessionId === null || connectionStatus !== 'connected') {
      return;
    }
    post(vscode, { type: 'commands.refresh', sessionId });
  }, [connectionStatus, sessionId, vscode]);
  const handleSkillToggle = useCallback(
    (name: string, disabled: boolean): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'skill.toggle',
        sessionId,
        name,
        disabled,
      });
    },
    [sessionId, vscode],
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
  const handleOpenFileDiff = useCallback(
    (path: string): void => {
      if (sessionId === null || connectionStatus !== 'connected') {
        return;
      }
      post(vscode, { type: 'file.openDiff', sessionId, path });
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
  const handleMcpRefresh = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, { type: 'mcp.refresh', sessionId });
  }, [sessionId, vscode]);
  const handleMcpServerToggle = useCallback(
    (name: string, enabled: boolean): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'mcp.server.toggle',
        sessionId,
        name,
        enabled,
      });
    },
    [sessionId, vscode],
  );
  const handleMcpServerAdd = useCallback(
    (params: McpServerAddParams): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'mcp.server.add',
        sessionId,
        ...params,
      });
    },
    [sessionId, vscode],
  );
  const handleMcpServerRemove = useCallback(
    (name: string): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'mcp.server.remove',
        sessionId,
        name,
      });
    },
    [sessionId, vscode],
  );
  const handleMcpServerAuthenticate = useCallback(
    (name: string): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'mcp.server.authenticate',
        sessionId,
        name,
      });
    },
    [sessionId, vscode],
  );
  const handleAttachFiles = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, { type: 'attachment.pick', sessionId });
  }, [sessionId, vscode]);
  const handleAttachEditor = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, { type: 'attachment.addEditor', sessionId });
  }, [sessionId, vscode]);
  const handleAttachSelection = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, { type: 'attachment.addSelection', sessionId });
  }, [sessionId, vscode]);
  const handleAttachProblems = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, { type: 'attachment.addProblems', sessionId });
  }, [sessionId, vscode]);
  const handleAttachGitChanges = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, { type: 'attachment.addGitChanges', sessionId });
  }, [sessionId, vscode]);
  const handleAttachImage = useCallback(
    (
      name: string,
      mediaType: ImageMediaType,
      dataBase64: string,
    ): void => {
      if (sessionId === null || connectionStatus !== 'connected') {
        return;
      }
      post(vscode, {
        type: 'attachment.addImage',
        sessionId,
        name,
        mediaType,
        dataBase64,
      });
    },
    [connectionStatus, sessionId, vscode],
  );
  const handleAttachUris = useCallback(
    (uris: readonly string[]): void => {
      if (
        sessionId === null ||
        connectionStatus !== 'connected' ||
        uris.length === 0
      ) {
        return;
      }
      post(vscode, {
        type: 'attachment.addUris',
        sessionId,
        uris,
      });
    },
    [connectionStatus, sessionId, vscode],
  );
  const handleAttachTextFile = useCallback(
    (name: string, text: string, truncated: boolean): void => {
      if (sessionId === null || connectionStatus !== 'connected') {
        return;
      }
      post(vscode, {
        type: 'attachment.addTextFile',
        sessionId,
        name,
        text,
        truncated,
      });
    },
    [connectionStatus, sessionId, vscode],
  );
  const handleAttachmentRemove = useCallback(
    (attachmentId: string): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'attachment.remove',
        sessionId,
        attachmentId,
      });
    },
    [sessionId, vscode],
  );
  const handleEditStageBegin = useCallback(
    (messageId: string): void => {
      if (sessionId === null || connectionStatus !== 'connected') {
        return;
      }
      post(vscode, { type: 'editStage.begin', sessionId, messageId });
    },
    [connectionStatus, sessionId, vscode],
  );
  const handleEditStageCancel = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, { type: 'editStage.cancel', sessionId });
  }, [sessionId, vscode]);
  const handleEditAttachFiles = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, {
      type: 'attachment.pick',
      sessionId,
      stage: 'edit',
    });
  }, [sessionId, vscode]);
  const handleEditAttachEditor = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, {
      type: 'attachment.addEditor',
      sessionId,
      stage: 'edit',
    });
  }, [sessionId, vscode]);
  const handleEditAttachSelection = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, {
      type: 'attachment.addSelection',
      sessionId,
      stage: 'edit',
    });
  }, [sessionId, vscode]);
  const handleEditAttachProblems = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, {
      type: 'attachment.addProblems',
      sessionId,
      stage: 'edit',
    });
  }, [sessionId, vscode]);
  const handleEditAttachGitChanges = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, {
      type: 'attachment.addGitChanges',
      sessionId,
      stage: 'edit',
    });
  }, [sessionId, vscode]);
  const handleEditAttachmentRemove = useCallback(
    (attachmentId: string): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'attachment.remove',
        sessionId,
        attachmentId,
        stage: 'edit',
      });
    },
    [sessionId, vscode],
  );
  const handleSettingUpdate = useCallback(
    (update: SessionSettingSelection): void => {
      if (sessionId === null) {
        return;
      }
      post(vscode, {
        type: 'session.setting.update',
        sessionId,
        ...update,
      });
    },
    [sessionId, vscode],
  );
  const handlePermissionRespond = useCallback(
    (
      interaction: PendingInteraction,
      selectedOption: string,
      editedSpecContent?: string,
    ): void => {
      post(vscode, {
        type: 'permission.respond',
        sessionId: interaction.sessionId,
        turnId: interaction.turnId,
        requestId: interaction.request.requestId,
        selectedOption,
        ...(editedSpecContent === undefined
          ? {}
          : { editedSpecContent }),
      });
    },
    [vscode],
  );
  const handleAskUserRespond = useCallback(
    (
      interaction: PendingInteraction,
      cancelled: boolean,
      answers: readonly AskUserAnswer[],
    ): void => {
      postAskUserResponse(vscode, interaction, cancelled, answers);
    },
    [vscode],
  );
  const sessionActionsDisabled =
    state.connection.status !== 'connected' || active || hasInteraction;
  const showPending = active && !hasInteraction;
  // A running tool row or streaming thinking block already carries the
  // live shimmer; the pending status row then stays static so each
  // turn keeps exactly one animated indicator.
  const activityLive = useMemo(
    () =>
      state.transcript.some(
        (item) =>
          (item.kind === 'tool' && item.status === 'running') ||
          (item.kind === 'thinking' && item.status === 'active'),
      ),
    [state.transcript],
  );
  const inlineInteraction =
    state.interactions.length > 0 ? (
      <InteractionPanel
        requests={state.interactions}
        onPermissionRespond={handlePermissionRespond}
        onAskUserRespond={handleAskUserRespond}
      />
    ) : null;

  // Rendered once here so transcript markdown (deep inside
  // assistant-ui's message tree) can open clicked file paths without
  // prop drilling.
  const app = (
    <AssistantRuntimeProvider runtime={runtime}>
      <DraftSynchronizer command={draftCommand} />
      {/* Entry animations are opt-in per streaming design item D:
          only a live turn on a connected session animates; recovered
          snapshots, session switches, reconcile replacements and
          Show earlier all mount without the class and stay silent. */}
      <div
        className={`dvx-shell${
          connectionStatus === 'connected' && active
            ? ' dvx-anim-live'
            : ''
        }`}
      >
        <Header
          state={state}
          sessionActionsDisabled={sessionActionsDisabled}
          onNewSession={handleNewSession}
          onCreateWorktreeSession={handleCreateWorktreeSession}
          onSelectSession={handleSelectSession}
          onRenameSession={handleRenameSession}
          onForkSession={handleForkSession}
          onToggleFavorite={handleToggleFavorite}
          onArchiveSession={handleArchiveSession}
          onUnarchiveSession={handleUnarchiveSession}
          onRefreshArchived={handleRefreshArchived}
          onSearchContent={handleSearchContent}
        />
        <DroidThread
          pending={showPending}
          activity={state.turn?.activity}
          activityLive={activityLive}
          historyStatus={state.historyStatus}
          truncated={state.truncated}
          hiddenMessageCount={hiddenMessageCount}
          onShowEarlier={handleShowEarlier}
          statusMessage={getStatusMessage(state, draft)}
          showRetry={
            state.connection.status === 'unavailable' ||
            state.turn?.status === 'failed'
          }
          running={active}
          stopping={state.turn?.status === 'stopping'}
          interactionPending={hasInteraction}
          controlsDisabled={
            state.connection.status !== 'connected' ||
            state.sessionId === null
          }
          settingUpdatesDisabled={hasInteraction}
          settings={state.settings}
          context={state.context}
          tokenUsage={state.tokenUsage}
          modelCatalog={state.modelCatalog}
          skills={state.skills}
          mcp={state.mcp}
          onRetry={handleRetry}
          onContextRefresh={handleContextRefresh}
          compactPending={compactPending}
          onCompact={handleCompact}
          onSettingUpdate={handleSettingUpdate}
          onSkillsRefresh={handleSkillsRefresh}
          onSkillToggle={handleSkillToggle}
          onMcpRefresh={handleMcpRefresh}
          onMcpServerToggle={handleMcpServerToggle}
          onMcpServerAdd={handleMcpServerAdd}
          onMcpServerRemove={handleMcpServerRemove}
          mcpAuth={state.mcpAuth}
          onMcpServerAuthenticate={handleMcpServerAuthenticate}
          onNewSession={handleNewSession}
          onSelectSession={handleSelectSession}
          attachments={state.attachments}
          fileSearch={state.fileSearch}
          onFileSearch={handleFileSearch}
          commands={state.commands}
          onCommandsRefresh={handleCommandsRefresh}
          onAttachPath={handleAttachPath}
          onAttachFiles={handleAttachFiles}
          onAttachEditor={handleAttachEditor}
          onAttachSelection={handleAttachSelection}
          onAttachProblems={handleAttachProblems}
          onAttachGitChanges={handleAttachGitChanges}
          onAttachImage={handleAttachImage}
          onAttachUris={handleAttachUris}
          onAttachTextFile={handleAttachTextFile}
          onAttachmentRemove={handleAttachmentRemove}
          onDraftChange={handleDraftChange}
          onEditResend={handleEditResend}
          rewindInfo={state.rewindInfo}
          onRequestRewindInfo={handleRequestRewindInfo}
          editStage={state.editAttachments}
          editResendRejection={state.editResendRejection}
          sendSignal={sendSignal}
          onEditStageBegin={handleEditStageBegin}
          onEditStageCancel={handleEditStageCancel}
          onEditAttachFiles={handleEditAttachFiles}
          onEditAttachEditor={handleEditAttachEditor}
          onEditAttachSelection={handleEditAttachSelection}
          onEditAttachProblems={handleEditAttachProblems}
          onEditAttachGitChanges={handleEditAttachGitChanges}
          onEditAttachmentRemove={handleEditAttachmentRemove}
          onRegenerate={
            connectionStatus === 'connected' &&
            !active &&
            !hasInteraction &&
            regenerateAnchor !== null
              ? handleRegenerate
              : null
          }
          onOpenFileDiff={handleOpenFileDiff}
          onPreviewFile={handlePreviewFile}
          editResendEnabled={
            connectionStatus === 'connected' &&
            !active &&
            !hasInteraction
          }
          inlineInteraction={inlineInteraction}
        />
      </div>
    </AssistantRuntimeProvider>
  );
  return (
    <OpenPathContext.Provider value={handleOpenPath}>
      <LocalImageContext.Provider value={localImageSource}>
        <GitCommitFlowContext.Provider value={gitFlow}>
          {app}
        </GitCommitFlowContext.Provider>
      </LocalImageContext.Provider>
    </OpenPathContext.Provider>
  );
}

function Header({
  state,
  sessionActionsDisabled,
  onNewSession,
  onCreateWorktreeSession,
  onSelectSession,
  onRenameSession,
  onForkSession,
  onToggleFavorite,
  onArchiveSession,
  onUnarchiveSession,
  onRefreshArchived,
  onSearchContent,
}: {
  readonly state: typeof initialAssistantWebviewState;
  readonly sessionActionsDisabled: boolean;
  readonly onNewSession: () => void;
  readonly onCreateWorktreeSession: () => void;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onRenameSession: (sessionId: string, title: string) => void;
  readonly onForkSession: (sessionId: string) => void;
  readonly onToggleFavorite: (
    sessionId: string,
    favorite: boolean,
  ) => void;
  readonly onArchiveSession: (sessionId: string) => void;
  readonly onUnarchiveSession: (sessionId: string) => void;
  readonly onRefreshArchived: () => void;
  readonly onSearchContent: (query: string) => void;
}): React.JSX.Element {
  const connectionLabel = formatConnectionStatus(state.connection.status);
  return (
    <header className="dvx-header">
      <div className="dvx-brand">
        <div>
          <div className="dvx-title">DroidVisX</div>
          <div
            className="dvx-runtime-status"
            role={
              state.connection.status === 'unavailable' ? 'alert' : 'status'
            }
          >
            <span>{connectionLabel}</span>
            {/* Quiet read-only mission identity; same muted style as
                the connection label (UI restraint: no new element). */}
            {state.mission !== null ? (
              <span>{`· ${formatMissionIdentity(state.mission)}`}</span>
            ) : null}
          </div>
        </div>
      </div>
      <div className="dvx-header-actions">
        <button
          className="dvx-icon-button dvx-header-new"
          type="button"
          aria-label="New session"
          disabled={sessionActionsDisabled}
          onClick={onNewSession}
        >
          <NewSessionIcon />
        </button>
        <SessionDrawer
          sessions={state.sessions}
          archived={state.archived}
          sessionSearch={state.sessionSearch}
          actionsDisabled={sessionActionsDisabled}
          worktreeCreateAvailable={state.worktreeCreateAvailable}
          onCreateWorktreeSession={onCreateWorktreeSession}
          onSelectSession={onSelectSession}
          onRenameSession={onRenameSession}
          onForkSession={onForkSession}
          onToggleFavorite={onToggleFavorite}
          onArchiveSession={onArchiveSession}
          onUnarchiveSession={onUnarchiveSession}
          onRefreshArchived={onRefreshArchived}
          onSearchContent={onSearchContent}
        />
      </div>
    </header>
  );
}

function NewSessionIcon(): React.JSX.Element {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8 3.333v9.334M3.333 8h9.334"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DraftSynchronizer({
  command,
}: {
  readonly command: {
    readonly id: number;
    readonly text: string;
  };
}): React.JSX.Element | null {
  const aui = useAui();
  const appliedCommandRef = useRef(-1);
  useEffect(() => {
    if (appliedCommandRef.current !== command.id) {
      appliedCommandRef.current = command.id;
      aui.thread.composer().setText(command.text);
      if (command.id > 0) {
        document
          .getElementById('dvx-prompt')
          ?.focus({ preventScroll: true });
      }
    }
  }, [aui, command]);
  return null;
}

function getStatusMessage(
  state: typeof initialAssistantWebviewState,
  draft: string,
): string | undefined {
  if (state.turn?.error !== undefined) {
    return state.turn.error;
  }
  if (state.connection.message !== undefined) {
    return state.connection.message;
  }
  if (draft.length > MAX_TURN_TEXT_LENGTH) {
    const excess = draft.length - MAX_TURN_TEXT_LENGTH;
    return `Message is too long. Remove ${excess.toLocaleString()} ${
      excess === 1 ? 'character' : 'characters'
    } to send.`;
  }
  switch (state.turn?.status) {
    case 'submitting':
      return 'Sending…';
    case 'streaming':
      return state.turn.activity === 'working'
        ? 'Droid is working…'
        : 'Droid is responding…';
    case 'stopping':
      return 'Stopping…';
    case 'interrupted':
      return 'Stopped';
    default:
      return undefined;
  }
}

function postAskUserResponse(
  vscode: ReturnType<typeof getVsCodeApi>,
  interaction: PendingInteraction,
  cancelled: boolean,
  answers: readonly AskUserAnswer[],
): void {
  post(vscode, {
    type: 'ask-user.respond',
    sessionId: interaction.sessionId,
    turnId: interaction.turnId,
    requestId: interaction.request.requestId,
    cancelled,
    answers,
  });
}

function post(
  vscode: ReturnType<typeof getVsCodeApi>,
  message: WebviewToHostMessage,
): void {
  vscode.postMessage(message);
}

function createTurnId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function formatConnectionStatus(
  status: typeof initialAssistantWebviewState.connection.status,
): string {
  switch (status) {
    case 'connected':
      return 'Local runtime connected';
    case 'connecting':
      return 'Connecting to local runtime';
    case 'unavailable':
      return 'Local runtime unavailable';
    case 'idle':
      return 'Local runtime idle';
  }
}

/** "Mission · running" / "Mission worker" read-only identity text. */
function formatMissionIdentity(
  mission: NonNullable<typeof initialAssistantWebviewState.mission>,
): string {
  const label =
    mission.role === 'worker' ? 'Mission worker' : 'Mission';
  return mission.state === null
    ? label
    : `${label} · ${formatMissionState(mission.state)}`;
}

function formatMissionState(
  state: NonNullable<
    NonNullable<typeof initialAssistantWebviewState.mission>['state']
  >,
): string {
  switch (state) {
    case 'awaiting_input':
      return 'awaiting input';
    case 'orchestrator_turn':
      return 'orchestrating';
    default:
      return state;
  }
}
