import { AssistantRuntimeProvider, useAui } from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { MAX_INLINE_PREVIEW_HTML_LENGTH, MAX_TURN_TEXT_LENGTH, type AskUserAnswer, type ImageMediaType, type ThemePreference, type WebviewToHostMessage } from '../../shared/bridgeMessages';
import { announceBooted, announceHandshakeTimeout, announceReady, announceRendered, getVsCodeApi, persistDraft, postPerfBeacon, readHostMessage, restoreDraft } from '../bridge/vscode';
import { InteractionPanel } from './Interactions';
import { LocalImageContext, OpenPathContext } from './MarkdownText';
import type { PathLink } from './pathLink';
import type { ComposerNavRequest, McpServerAddParams, SessionSettingSelection } from './ComposerControls';
import { resolveBuiltinSlash, type SlashNavTarget } from './slashBuiltins';
import { canSendMessage, DEFAULT_MESSAGE_WINDOW, MESSAGE_WINDOW_STEP, shouldQueueMessage, useDroidExternalStoreRuntime } from './runtimeAdapter';
import { SessionDrawer } from './SessionDrawer';
import { assistantWebviewReducer, initialAssistantWebviewState, isTurnActive, type PendingInteraction, type StoreHostMessage } from './store';
import { DroidThread } from './Thread';
import { GitCommitFlowContext, type GitCommitFlowContextValue } from './GitCommitPanel';
import { CustomModelsContext, useCustomModelsFlow } from './CustomModelsPanel';
import { findLatestChangesContext } from './gitCommitDraft';
import { selectPlanAnchors } from './planAnchor';
import { QueuedMessages } from './QueuedMessages';
import { SideChatSheet } from './SideChatSheet';
import { SubagentActionsContext, SubagentPanelContext, useSubagentPanelFlow } from './subagentPanelFlow';
import { SubagentTranscriptSheet } from './SubagentTranscriptSheet';
import { selectWorkingSubagents } from './subagentWorking';
import { ThemeContext, useThemeController } from './theme';
import { WorkingBadge } from './WorkingBadge';
import { MAX_BTW_TEXT_LENGTH } from '../../shared/btwProtocol';
import {
  isTransientNoticeLifecycleMessage,
  reduceTransientDiagnostic,
  selectVisibleNotice,
  type TransientDiagnostic,
} from './transientNotice';
import './styles.css';

/**
 * How long the webview waits after `webview.ready` for any host
 * message before showing the reload hint. The normal first snapshot
 * arrives within milliseconds; only a dead or version-mismatched host
 * stays silent this long.
 */
const HANDSHAKE_TIMEOUT_MS = 5_000;

export function App(): React.JSX.Element {
  const vscodeRef = useRef<ReturnType<typeof getVsCodeApi> | null>(null);
  vscodeRef.current ??= getVsCodeApi();
  const vscode = vscodeRef.current;
  const [state, dispatch] = useReducer(
    assistantWebviewReducer,
    initialAssistantWebviewState,
  );
  const [transientDiagnostic, setTransientDiagnostic] =
    useState<TransientDiagnostic | null>(null);
  const [draft, setDraft] = useState(() => restoreDraft(vscode));
  const [initialDraft] = useState(draft);
  // Rewrites the composer draft programmatically: once on boot with
  // the restored draft, then on queued-prompt edit begin/cancel
  // ("Edit Queued" loads the prompt text, cancel clears it).
  const [draftCommand, setDraftCommand] = useState(() => ({
    id: 0,
    text: initialDraft,
  }));
  const sendPendingRef = useRef(false);
  // Incremented on every committed Composer send; the thread closes
  // any open user-message edit card when it changes (a new message is
  // an explicit signal the user abandoned that edit).
  const [sendSignal, setSendSignal] = useState(0);
  // Slash-command navigation (S2): `/model` `/mcp` `/skills`
  // `/context` open composer popovers; `/sessions` opens the history
  // drawer. Monotonic ids let the same target fire repeatedly.
  const [composerNav, setComposerNav] =
    useState<ComposerNavRequest | null>(null);
  const composerNavCounterRef = useRef(0);

  const persistThemePreference = useCallback(
    (preference: ThemePreference): void => {
      post(vscode, { type: 'ui.theme.set', preference });
    },
    [vscode],
  );
  const {
    context: themeContextValue,
    resolved: resolvedTheme,
    applyHostTheme,
  } = useThemeController(persistThemePreference);
  const [sessionsOpenSignal, setSessionsOpenSignal] = useState(0);
  const handleSlashNavigate = useCallback(
    (target: SlashNavTarget): void => {
      if (target === 'sessions') {
        setSessionsOpenSignal((value) => value + 1);
        return;
      }
      composerNavCounterRef.current += 1;
      setComposerNav({ id: composerNavCounterRef.current, target });
    },
    [],
  );

  useEffect(() => {
    // Host messages are coalesced into one dispatch batch per animation
    // frame; during streaming the host can emit deltas faster than the
    // transcript re-renders, and per-message renders saturate the main
    // thread on long sessions. The timeout keeps messages flowing when
    // the webview is hidden and frames stop.
    let queue: StoreHostMessage[] = [];
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
      // Theme pushes bypass the store (sequence-free view-provider
      // messages) and apply immediately — no batching for a switch.
      if (message.type === 'ui.theme') {
        applyHostTheme(message.preference, message.resolved);
        return;
      }
      if (isTransientNoticeLifecycleMessage(message)) {
        setTransientDiagnostic((current) =>
          reduceTransientDiagnostic(current, message),
        );
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
    // applyHostTheme is stable across renders.
  }, [applyHostTheme, initialDraft, vscode]);

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

  // Handshake fallback: after a VSIX overwrite install the stale
  // in-memory host silently drops the newer bundle's `webview.ready`
  // (protocol version mismatch) and never sends a snapshot. When
  // nothing at all arrives within the window, surface a quiet reload
  // hint instead of a forever-idle panel.
  const receivedHostMessage = state.sequence >= 0;
  const [handshakeStalled, setHandshakeStalled] = useState(false);
  useEffect(() => {
    if (receivedHostMessage) {
      setHandshakeStalled(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setHandshakeStalled(true);
      announceHandshakeTimeout(vscode, HANDSHAKE_TIMEOUT_MS);
    }, HANDSHAKE_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [receivedHostMessage, vscode]);
  const showHandshakeNotice = handshakeStalled && !receivedHostMessage;

  const active = isTurnActive(state.turn);
  const hasInteraction = state.interactions.length > 0;
  const connectionStatus = state.connection.status;
  const sessionId = state.sessionId;
  // BYOK custom-models panel flow: state + callbacks live in the
  // hook (window-listener pull, not store/snapshot state) and reach
  // the panel via context — same no-prop-drilling pattern as gitFlow.
  const customModelsFlow = useCustomModelsFlow(vscode, sessionId);
  // Observation-only live activity and child transcripts use the same
  // window-listener pull pattern as customModelsFlow.
  const subagentFlow = useSubagentPanelFlow(vscode, sessionId);
  // `/btw` side chat (S1): the card's open flag is webview-local; the
  // host owns the hidden fork and its projected contents (state.btw).
  // Closing the card or switching sessions discards the fork.
  const btwAvailable = state.btwAvailable;
  const [btwOpen, setBtwOpen] = useState(false);
  const btwSessionRef = useRef(sessionId);
  if (btwSessionRef.current !== sessionId) {
    btwSessionRef.current = sessionId;
    setBtwOpen(false);
  }
  const handleBtwOpen = useCallback((): void => {
    setBtwOpen(true);
  }, []);
  const handleBtwAsk = useCallback(
    (text: string): void => {
      const question = text.trim().slice(0, MAX_BTW_TEXT_LENGTH);
      if (sessionId !== null && question.length > 0) {
        post(vscode, { type: 'btw.ask', sessionId, text: question });
      }
    },
    [sessionId, vscode],
  );
  const handleBtwPrepare = useCallback((): void => {
    if (sessionId !== null) {
      post(vscode, { type: 'btw.prepare', sessionId });
    }
  }, [sessionId, vscode]);
  const handleBtwDismiss = useCallback((): void => {
    setBtwOpen(false);
    if (sessionId !== null) {
      post(vscode, { type: 'btw.dismiss', sessionId });
    }
  }, [sessionId, vscode]);
  const handleBtwStop = useCallback((): void => {
    if (sessionId !== null) {
      post(vscode, { type: 'btw.stop', sessionId });
    }
  }, [sessionId, vscode]);
  const turnId = state.turn?.turnId ?? null;
  const turnStatus = state.turn?.status ?? null;
  // Turn ids this connection has actually seen live on state.turn.
  // The selector needs these only for statusless foreground Tasks;
  // an explicit ledger `running` status remains authoritative after
  // reload. Rows of finished live turns stay in the set until the
  // session changes so background work keeps counting.
  const liveTurnIdsRef = useRef(new Set<string>());
  const liveTurnSessionRef = useRef(state.sessionId);
  if (liveTurnSessionRef.current !== state.sessionId) {
    liveTurnSessionRef.current = state.sessionId;
    liveTurnIdsRef.current = new Set();
  }
  if (turnId !== null) {
    liveTurnIdsRef.current.add(turnId);
  }
  const workingSubagents = useMemo(
    () =>
      selectWorkingSubagents(state.transcript, liveTurnIdsRef.current),
    // turnId covers set growth; the set itself is a stable ref.
    [state.transcript, turnId],
  );
  const interactionCount = state.interactions.length;
  const queuedCount = state.queue.items.length;
  const queueEditingId = state.queueEditing?.queueId ?? null;
  const sendDisabled = !canSendMessage(
    {
      connectionStatus,
      sessionId,
      turnStatus,
      interactionCount,
      queuedCount,
      queueEditing: queueEditingId !== null,
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
      // "Edit Queued" mode: the send replaces the queued prompt in
      // place (same queue position) instead of starting or queueing
      // a turn. Text is treated literally — no slash routing.
      if (queueEditingId !== null) {
        if (
          sessionId !== null &&
          text.trim().length > 0 &&
          text.length <= MAX_TURN_TEXT_LENGTH
        ) {
          dispatch({ type: 'queue.update', queueId: queueEditingId, text });
          post(vscode, {
            type: 'queue.update',
            sessionId,
            queueId: queueEditingId,
            text,
          });
        }
        dispatch({ type: 'queue.editEnd' });
        setDraft('');
        persistDraft(vscode, '');
        return;
      }
      // GUI built-in slash commands typed in the composer would
      // otherwise be forwarded to the Droid CLI as prompt text (the
      // CLI acknowledges without running the real pipeline). Route
      // them — including the CLI's own names/aliases like /compress,
      // /handoff and /clear — onto the existing pipelines, and map
      // navigation commands onto their panels (slash-parity S2).
      const builtin = resolveBuiltinSlash(text, {
        btwEnabled: btwAvailable,
      });
      if (builtin !== null) {
        if (builtin.kind === 'compact') {
          handleCompact();
        } else if (builtin.kind === 'new') {
          post(vscode, { type: 'session.new' });
        } else if (builtin.kind === 'navigate') {
          handleSlashNavigate(builtin.target);
        } else {
          // `/btw` opens the side chat card; a trailing question is
          // asked immediately, a bare `/btw` just opens it.
          setBtwOpen(true);
          if (builtin.question.length > 0) {
            handleBtwAsk(builtin.question);
          }
        }
        setDraft('');
        persistDraft(vscode, '');
        return;
      }
      const eligibility = {
        connectionStatus,
        sessionId,
        turnStatus,
        interactionCount,
        queuedCount,
        queueEditing: false,
      };
      // The re-entrancy latch protects the turn pipeline only. Queue
      // adds are safe to rapid-fire: each press gets a fresh queueId
      // and the optimistic reducer advances queuedCount synchronously.
      const queueRoute = shouldQueueMessage(eligibility);
      if (
        !canSendMessage(
          eligibility,
          text,
          !queueRoute && sendPendingRef.current,
        )
      ) {
        return;
      }
      if (queueRoute) {
        // A turn is running (or a paused queue holds earlier
        // prompts): enqueue on the host instead of starting a turn.
        // The optimistic card shows immediately; the host's
        // `queue.state` echo reconciles.
        const queueId = createTurnId();
        dispatch({ type: 'queue.add', queueId, text });
        post(vscode, {
          type: 'queue.add',
          sessionId: eligibility.sessionId,
          queueId,
          text,
        });
      } else {
        sendPendingRef.current = true;
        const nextTurnId = createTurnId();
        dispatch({ type: 'turn.send', turnId: nextTurnId, text });
        post(vscode, {
          type: 'turn.send',
          sessionId: eligibility.sessionId,
          turnId: nextTurnId,
          text,
        });
      }
      setSendSignal((value) => value + 1);
      setDraft('');
      persistDraft(vscode, '');
    },
    [
      btwAvailable,
      connectionStatus,
      handleBtwAsk,
      handleCompact,
      handleSlashNavigate,
      interactionCount,
      queuedCount,
      queueEditingId,
      sessionId,
      turnStatus,
      vscode,
    ],
  );
  const handleQueuePromote = useCallback(
    (queueId: string): void => {
      if (sessionId === null) {
        return;
      }
      dispatch({ type: 'queue.promote', queueId });
      post(vscode, { type: 'queue.promote', sessionId, queueId });
    },
    [sessionId, vscode],
  );
  const handleQueueEditBegin = useCallback(
    (queueId: string): void => {
      const item = state.queue.items.find(
        (entry) => entry.queueId === queueId,
      );
      if (sessionId === null || item === undefined) {
        return;
      }
      dispatch({ type: 'queue.editBegin', queueId });
      // Loading the prompt into the Composer closes any open
      // edit-resend card (the two edit modes are mutually
      // exclusive) and replaces the draft.
      setSendSignal((value) => value + 1);
      setDraftCommand((command) => ({
        id: command.id + 1,
        text: item.text,
      }));
      setDraft(item.text);
      persistDraft(vscode, item.text);
    },
    [sessionId, state.queue.items, vscode],
  );
  const handleQueueEditCancel = useCallback((): void => {
    if (queueEditingId === null) {
      return;
    }
    dispatch({ type: 'queue.editEnd' });
    setDraftCommand((command) => ({ id: command.id + 1, text: '' }));
    setDraft('');
    persistDraft(vscode, '');
  }, [queueEditingId, vscode]);
  const handleQueueRemove = useCallback(
    (queueId: string): void => {
      if (sessionId === null) {
        return;
      }
      dispatch({ type: 'queue.remove', queueId });
      post(vscode, { type: 'queue.remove', sessionId, queueId });
    },
    [sessionId, vscode],
  );
  const handleQueueResume = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    dispatch({ type: 'queue.resume' });
    post(vscode, { type: 'queue.resume', sessionId });
  }, [sessionId, vscode]);
  const handleQueueClear = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    dispatch({ type: 'queue.clear' });
    post(vscode, { type: 'queue.clear', sessionId });
  }, [sessionId, vscode]);
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
      isSendDisabled:
        sendDisabled ||
        (!shouldQueueMessage({ turnStatus, queuedCount }) &&
          sendPendingRef.current),
      onSend: handleSend,
      onCancel: handleCancel,
    }),
    [handleCancel, handleSend, queuedCount, sendDisabled, turnStatus],
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
  // Plan lines: pure projections of the transcript's todowrites (no
  // new bridge data) — one thin line per plan lineage, keyed by the
  // user message that triggered the lineage's turn and rendered
  // directly under that message, updated in place by later
  // todowrites.
  const planAnchors = useMemo(
    () => selectPlanAnchors(state.transcript),
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
      subagentFlow.actions.onCloseSheet();
      post(vscode, {
        type: 'session.select',
        sessionId: nextSessionId,
      });
    },
    [subagentFlow.actions, vscode],
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
  const handleOpenFileDiff = useCallback(
    (path: string, turnId: string | null): void => {
      if (sessionId === null || turnId === null || connectionStatus !== 'connected') {
        return;
      }
      post(vscode, { type: 'file.openDiff', sessionId, turnId, path });
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
    (html: string): void => {
      if (
        sessionId === null ||
        connectionStatus !== 'connected' ||
        html.length === 0 ||
        html.length > MAX_INLINE_PREVIEW_HTML_LENGTH
      ) {
        return;
      }
      post(vscode, { type: 'preview.inlineHtml', sessionId, html });
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
  const handlePluginsRefresh = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, { type: 'plugins.refresh', sessionId });
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
  // With daemon-backed background turns, switching away from a
  // running turn detaches it instead of killing it, so an active turn
  // no longer blocks session actions. Pending interactions still do:
  // an unanswered permission/plan request must be settled first.
  const sessionActionsDisabled =
    state.connection.status !== 'connected' ||
    (active && !state.backgroundTurnsAvailable) ||
    hasInteraction;
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

  // Split-pane /btw: while the side question pane is mounted the
  // shell gains a second grid column so both conversations stay live
  // side by side (Claude Code form factor, user decision 2026-08-12).
  const btwSplit = btwOpen && btwAvailable && sessionId !== null;
  // The read-only subagent transcript sheet rides the same split
  // column; the /btw pane keeps priority when both want it.
  const subagentSplit = subagentFlow.sheet !== null && !btwSplit;
  // While the sheet's delegation row still counts as working (same
  // rule as the badge), the sheet re-requests the transcript on an
  // interval — the live view of a running subagent.
  const sheetToolUseId = subagentFlow.sheet?.toolUseId ?? null;
  const sheetRowRunning =
    sheetToolUseId !== null &&
    workingSubagents.some((row) => row.toolUseId === sheetToolUseId);

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
        }${showHandshakeNotice ? ' dvx-shell-stalled' : ''}${
          btwSplit || subagentSplit ? ' dvx-shell-split' : ''
        }`}
        data-theme={resolvedTheme}
      >
        <Header
          state={state}
          sessionActionsDisabled={sessionActionsDisabled}
          sessionsOpenSignal={sessionsOpenSignal}
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
        {showHandshakeNotice ? (
          <aside
            className="dvx-history-notice dvx-handshake-notice"
            role="alert"
          >
            DroidVisX was updated behind this window. Run “Developer:
            Reload Window” to reconnect the panel.
          </aside>
        ) : null}
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
          plugins={state.plugins}
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
          onPluginsRefresh={handlePluginsRefresh}
          onNewSession={handleNewSession}
          onSelectSession={handleSelectSession}
          attachments={state.attachments}
          fileSearch={state.fileSearch}
          onFileSearch={handleFileSearch}
          commands={state.commands}
          onCommandsRefresh={handleCommandsRefresh}
          navSignal={composerNav}
          onSlashNavigate={handleSlashNavigate}
          btwAvailable={btwAvailable}
          onBtwOpen={handleBtwOpen}
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
          onForkSession={
            connectionStatus === 'connected' &&
            !active &&
            !hasInteraction &&
            sessionId !== null
              ? handleForkCurrentSession
              : null
          }
          onOpenFileDiff={handleOpenFileDiff}
          onPreviewFile={handlePreviewFile}
          onPreviewInlineHtml={handlePreviewInlineHtml}
          workspaceRoot={state.workspaceRoot}
          onOpenTerminalMirror={handleOpenTerminalMirror}
          editResendEnabled={
            connectionStatus === 'connected' &&
            !active &&
            !hasInteraction
          }
          inlineInteraction={inlineInteraction}
          planAnchors={planAnchors}
          workingBadge={
            workingSubagents.length === 0 ? null : (
              <WorkingBadge rows={workingSubagents} />
            )
          }
          transientDiagnostic={selectVisibleNotice(transientDiagnostic, sessionId, turnId, active)}
          queuedMessages={
            state.queue.items.length === 0 ? null : (
              <QueuedMessages
                queue={state.queue}
                editingId={queueEditingId}
                onEditBegin={handleQueueEditBegin}
                onPromote={handleQueuePromote}
                onRemove={handleQueueRemove}
                onResume={handleQueueResume}
                onClear={handleQueueClear}
              />
            )
          }
          queuedCount={queuedCount}
          queueEditing={queueEditingId !== null}
          onQueueEditCancel={handleQueueEditCancel}
        />
        {/* Full-height side question pane living in the shell's
            second grid column beside the main conversation (Claude
            Code split-pane form factor). */}
        {btwSplit ? (
          <SideChatSheet
            btw={state.btw}
            onPrepare={handleBtwPrepare}
            onAsk={handleBtwAsk}
            onStop={handleBtwStop}
            onDismiss={handleBtwDismiss}
          />
        ) : null}
        {/* Read-only subagent transcript sheet: same split column as
            /btw; the side question pane keeps priority when open. */}
        {subagentFlow.sheet !== null && !btwSplit ? (
          <SubagentTranscriptSheet
            key={subagentFlow.sheet.toolUseId}
            sheet={subagentFlow.sheet}
            running={sheetRowRunning}
            onRefresh={subagentFlow.actions.onRefreshTranscript}
            onDismiss={subagentFlow.actions.onCloseSheet}
          />
        ) : null}
      </div>
    </AssistantRuntimeProvider>
  );
  return (
    <ThemeContext.Provider value={themeContextValue}>
      <OpenPathContext.Provider value={handleOpenPath}>
        <LocalImageContext.Provider value={localImageSource}>
          <GitCommitFlowContext.Provider value={gitFlow}>
            <CustomModelsContext.Provider value={customModelsFlow}>
              <SubagentPanelContext.Provider value={subagentFlow}>
                <SubagentActionsContext.Provider
                  value={subagentFlow.actions}
                >
                  {app}
                </SubagentActionsContext.Provider>
              </SubagentPanelContext.Provider>
            </CustomModelsContext.Provider>
          </GitCommitFlowContext.Provider>
        </LocalImageContext.Provider>
      </OpenPathContext.Provider>
    </ThemeContext.Provider>
  );
}

function Header({
  state,
  sessionActionsDisabled,
  sessionsOpenSignal,
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
  /** `/sessions` navigation counter; a change opens the drawer. */
  readonly sessionsOpenSignal: number;
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
          <div className="dvx-title">Droid</div>
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
          openSignal={sessionsOpenSignal}
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
