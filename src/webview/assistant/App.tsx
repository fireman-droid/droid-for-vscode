import { AssistantRuntimeProvider, useAui } from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';

import { MAX_INLINE_PREVIEW_HTML_LENGTH, MAX_TURN_TEXT_LENGTH, type AskUserAnswer, type ThemePreference, type WebviewToHostMessage } from '../../shared/bridgeMessages';
import { parseMissionControlPanelHostMessage } from '../../shared/missionControlPanelProtocol';
import type { MissionControlSetupSnapshotMessage } from '../../shared/missionControlSetupProtocol';
import { normalizeMissionTaskText } from '../../shared/missionProtocol';
import { announceBooted, announceHandshakeTimeout, announceReady, announceRendered, getVsCodeApi, persistDraft, readHostMessage, restoreDraft } from '../bridge/vscode';
import { buildInteractionSlots } from './interactionSlots';
import { LocalImageContext, OpenPathContext } from './MarkdownText';
import type { PathLink } from './pathLink';
import type { ComposerNavRequest, McpServerAddParams, SessionSettingSelection } from './ComposerControls';
import {
  CANVAS_REQUEST_TEMPLATE,
  resolveBuiltinSlash,
  type SlashNavTarget,
} from './slashBuiltins';
import { useMissionControl } from './mission/useMissionControl';
import { canSendMessage, DEFAULT_MESSAGE_WINDOW, MESSAGE_WINDOW_STEP, shouldQueueMessage, useDroidExternalStoreRuntime } from './runtimeAdapter';
import { AppHeader } from './AppHeader';
import { useConversationTransition } from './conversationTransition';
import { assistantWebviewReducer, initialAssistantWebviewState, isTurnActive, type PendingInteraction, type StoreHostMessage } from './store';
import { DroidThread, ToolChangesContext } from './Thread';
import { GitCommitFlowContext, type GitCommitFlowContextValue } from './GitCommitPanel';
import { CustomModelsContext, useCustomModelsFlow } from './customModelsFlow';
import { ModelsPage } from './ModelsPage';
import { selectPlanAnchors } from './planAnchor';
import { QueuedMessages } from './QueuedMessages';
import { ReviewDockSlot } from './reviewDockSlot';
import { SideChatSheet } from './SideChatSheet';
import { useBtwPanel } from './useBtwPanel';
import { MissionWorkspace } from '../missionControl/MissionWorkspace';
import { SubagentActivityStoreContext, SubagentOpenContext, useSubagentPanelFlow } from './subagentPanelFlow';
import { selectWorkingSubagents } from './subagentWorking';
import { ThemeContext, useThemeController } from './theme';
import { useAttachmentActions } from './useAttachmentActions';
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
  const {
    beginSwitch: beginConversationSwitch,
    observeHostMessage: observeTransitionMessage,
    phase: conversationTransitionPhase,
    blocking: conversationTransitionBlocking,
    overlay: conversationTransitionOverlay,
  } = useConversationTransition({
    sequence: state.sequence,
    sessionId: state.sessionId,
    connectionStatus: state.connection.status,
  });
  const missionControl = useMissionControl(vscode, createTurnId);
  const [transientDiagnostic, setTransientDiagnostic] =
    useState<TransientDiagnostic | null>(null);
  const [missionWorkspaceRoute, setMissionWorkspaceRoute] = useState<'new-mission' | 'detail' | null>(null);
  const [missionSetup, setMissionSetup] = useState<MissionControlSetupSnapshotMessage | null>(null);
  const [draft, setDraft] = useState(() => restoreDraft(vscode));
  const draftValueRef = useRef(draft);
  const [initialDraft] = useState(draft);
  const [draftCommand, setDraftCommand] = useState(() => ({
    id: 0,
    text: initialDraft,
  }));
  const replaceComposerDraft = useCallback(
    (text: string): void => {
      draftValueRef.current = text;
      setDraft(text);
      setDraftCommand((command) => ({ id: command.id + 1, text }));
      persistDraft(vscode, text);
    },
    [vscode],
  );
  const sendPendingRef = useRef(false);
  const canvasFeedbackSequenceRef = useRef(-1);
  // A new send closes any abandoned user-message edit card.
  const [sendSignal, setSendSignal] = useState(0);
  useEffect(() => {
    if (
      state.missionControlResult?.action === 'start' &&
      state.missionControlResult.status === 'accepted'
    ) {
      setMissionWorkspaceRoute('detail');
    }
  }, [state.missionControlResult]);
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
  const handleMissionOpen = useCallback((task?: string): void => {
    missionControl({
      type: 'mission.panel.open',
      target: 'setup',
      ...(task === undefined ? {} : { task }),
    });
  }, [missionControl]);
  const handleMissionCatalogOpen = useCallback((): void => {
    missionControl({ type: 'mission.panel.open', target: 'catalog' });
  }, [missionControl]);
  const handleMissionClose = useCallback((): void => {
    missionControl({ type: 'mission.dismissSetup' });
  }, [missionControl]);

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
    for (const message of batch) {
        dispatch({ type: 'host.message', message });
    }
  };
    const handleMessage = (event: MessageEvent<unknown>): void => {
      const missionWorkspaceMessage = parseMissionControlPanelHostMessage(
        event.data,
      );
      if (missionWorkspaceMessage?.type === 'missionControl.route') {
        const catalog = missionWorkspaceMessage.route === 'catalog';
        setMissionWorkspaceRoute(catalog ? null : missionWorkspaceMessage.route);
        if (catalog) setMissionSetup(null);
        return;
      }
      if (missionWorkspaceMessage?.type === 'missionControl.setup.snapshot') {
        setMissionSetup(missionWorkspaceMessage);
        return;
      }
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
      if (message.type === 'canvas.feedbackDraft') {
        if (message.sequence <= canvasFeedbackSequenceRef.current) return;
        canvasFeedbackSequenceRef.current = message.sequence;
        const current = draftValueRef.current.trim();
        replaceComposerDraft(
          current.length === 0
            ? message.text
            : `${draftValueRef.current}\n\n${message.text}`,
        );
        return;
      }
      observeTransitionMessage(message);
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
  }, [
    applyHostTheme,
    initialDraft,
    observeTransitionMessage,
    replaceComposerDraft,
    vscode,
  ]);

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
  const generating = active && state.turn?.status !== 'stopping';
  const hasInteraction = state.interactions.length > 0;
  const connectionStatus = state.connection.status;
  const sessionId = state.sessionId;
  const {
    handleAttachPath,
    handleAttachFiles,
    handleAttachEditor,
    handleAttachSelection,
    handleAttachProblems,
    handleAttachGitChanges,
    handleAttachImage,
    handleAttachPdf,
    handleAttachRemoteImage,
    handleAttachUris,
    handleAttachTextFile,
    handleAttachmentRemove,
    handleEditStageBegin,
    handleEditStageCancel,
    handleEditAttachFiles,
    handleEditAttachEditor,
    handleEditAttachSelection,
    handleEditAttachProblems,
    handleEditAttachGitChanges,
    handleEditAttachImage,
    handleEditAttachPdf,
    handleEditAttachRemoteImage,
    handleEditAttachUris,
    handleEditAttachTextFile,
    handleEditAttachmentRemove,
    handleAttachmentReadImage,
    handleAttachmentReplaceImage,
  } = useAttachmentActions(vscode, sessionId, connectionStatus);
  // Full-page BYOK model manager (spec §6 拍板): a webview-local view
  // switch — the page replaces the chat area while the session keeps
  // streaming in the background store.
  const [modelsPageOpen, setModelsPageOpen] = useState(false);
  const openModelsPage = useCallback((): void => {
    setModelsPageOpen(true);
  }, []);
  const closeModelsPage = useCallback((): void => {
    setModelsPageOpen(false);
  }, []);
  // BYOK custom-models flow: state + callbacks live in the hook
  // (window-listener pull, not store/snapshot state) and reach the
  // pages via context — same no-prop-drilling pattern as gitFlow.
  const customModelsFlow = useCustomModelsFlow(
    vscode,
    sessionId,
    openModelsPage,
  );
  // Observation-only live activity and child transcripts use the same
  // window-listener pull pattern as customModelsFlow.
  const subagentFlow = useSubagentPanelFlow(vscode, sessionId);
  const btwAvailable = state.btwAvailable;
  const btw = useBtwPanel(vscode, btwAvailable ? sessionId : null);
  const {
    open: btwOpen,
    openPanel: handleBtwOpen,
    openWithQuote: handleBtwQuote,
    ask: handleBtwAsk,
    stop: handleBtwStop,
    dismiss: handleBtwDismiss,
  } = btw;
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
  useEffect(() => {
    subagentFlow.onPanelToggle(workingSubagents.length > 0);
    return () => subagentFlow.onPanelToggle(false);
  }, [subagentFlow, workingSubagents.length]);
  const interactionCount = state.interactions.length;
  const queuedCount = state.queue.items.length;
  const queueEditingId = state.queueEditing?.queueId ?? null;
  const sendDisabled = conversationTransitionBlocking || !canSendMessage(
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
      if (conversationTransitionBlocking) {
        return;
      }
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
        draftValueRef.current = '';
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
        } else if (builtin.kind === 'btw') {
          // `/btw` opens the side chat card; a trailing question is
          // asked immediately, a bare `/btw` just opens it.
          handleBtwOpen();
          if (builtin.question.length > 0) {
            handleBtwAsk(builtin.question);
          }
        } else if (builtin.kind === 'canvas') {
          replaceComposerDraft(
            builtin.request.length === 0
              ? CANVAS_REQUEST_TEMPLATE
              : `Create an interactive Canvas artifact for:\n\n${builtin.request}`,
          );
          return;
        }
        draftValueRef.current = '';
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
        // During stopping, send-now makes this next instruction run
        // immediately after interruption instead of parking it.
        const queueId = createTurnId();
        dispatch({ type: 'queue.add', queueId, text });
        post(vscode, { type: 'queue.add', sessionId: eligibility.sessionId, queueId, text });
        if (turnStatus === 'stopping' || state.queue.paused !== null) {
          dispatch({ type: 'queue.promote', queueId });
          post(vscode, { type: 'queue.promote', sessionId: eligibility.sessionId, queueId });
        }
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
      draftValueRef.current = '';
      setDraft('');
      persistDraft(vscode, '');
    },
    [
      btwAvailable,
      connectionStatus,
      conversationTransitionBlocking,
      handleBtwAsk,
      handleCompact,
      handleMissionOpen,
      handleSlashNavigate,
      interactionCount,
      queuedCount,
      queueEditingId,
      replaceComposerDraft,
      sessionId,
      state.queue.paused,
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
      draftValueRef.current = item.text;
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
    draftValueRef.current = '';
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
      draftValueRef.current = nextDraft;
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
        conversationTransitionBlocking ||
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
      conversationTransitionBlocking,
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
  const handleGitRequestStatus = useCallback((requestTurnId: string): void => {
    if (sessionId === null || connectionStatus !== 'connected') {
      return;
    }
    dispatch({ type: 'git.statusRequested', turnId: requestTurnId });
    post(vscode, {
      type: 'git.requestStatus',
      sessionId,
      turnId: requestTurnId,
    });
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
  const latestChanges = useMemo(
    () =>
      state.latestChanges === null
        ? null
        : {
            id: `changes-ledger:${state.latestChanges.turnId}`,
            kind: 'changes' as const,
            turnId: state.latestChanges.turnId,
            files: state.latestChanges.files,
          },
    [state.latestChanges],
  );
  const toolChanges = useMemo(
    () => ({
      turnId: latestChanges?.turnId ?? null,
      filesByPath: new Map(
        (latestChanges?.files ?? []).map((file) => [file.path, file] as const),
      ),
    }),
    [latestChanges],
  );
  // Plan line: pure projection of transcript TodoWrites (no new
  // bridge data). The selector returns only the latest lineage, so a
  // new plan replaces the completed historical card.
  const planAnchors = useMemo(
    () => selectPlanAnchors(state.transcript),
    [state.transcript],
  );
  const gitFlow = useMemo<GitCommitFlowContextValue>(
    () => ({
      state: state.git,
      latestChangesTurnId: state.latestChanges?.turnId ?? null,
      promptText: state.latestChanges?.prompt ?? null,
      onRequestStatus: handleGitRequestStatus,
      onCommit: handleGitCommit,
    }),
    [
      state.git,
      state.latestChanges,
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
    conversationTransitionBlocking ||
    state.connection.status !== 'connected' ||
    (active && !state.backgroundTurnsAvailable) ||
    hasInteraction;
  const showPending = generating && !hasInteraction;
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
  const { inlineInteraction, footerInteraction } = buildInteractionSlots(
    state.interactions, handlePermissionRespond, handleAskUserRespond, vscode,
  );

  // Split-pane /btw: while the side question pane is mounted the
  // shell gains a second grid column so both conversations stay live
  // side by side (Claude Code form factor, user decision 2026-08-12).
  // The models page owns the whole content area, so /btw does not
  // split the shell while it is open.
  const fullPageOpen = modelsPageOpen;
  const missionSplit = !fullPageOpen && missionWorkspaceRoute !== null;
  const btwSplit =
    !fullPageOpen &&
    !missionSplit &&
    btwOpen &&
    btwAvailable &&
    sessionId !== null;

  // Rendered once here so transcript markdown (deep inside
  // assistant-ui's message tree) can open clicked file paths without
  // prop drilling.
  const app = (
    <AssistantRuntimeProvider runtime={runtime}>
      <DraftSynchronizer command={draftCommand} />
      {/* Live turn entry animation remains separate from the localized
          Conversation recovery and switching transition below. */}
      <div
        className={`dvx-shell${
          connectionStatus === 'connected' && generating
            ? ' dvx-anim-live'
            : ''
        }${showHandshakeNotice ? ' dvx-shell-stalled' : ''}${
          btwSplit || missionSplit ? ' dvx-shell-split' : ''
        }`}
        data-theme={resolvedTheme}
        data-dvx-theme-preference={themeContextValue.preference}
      >
        <AppHeader
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
        <div
          className="dvx-conversation-surface"
          data-transition-phase={conversationTransitionPhase}
          aria-busy={
            !showHandshakeNotice &&
            conversationTransitionPhase !== 'idle'
              ? true
              : undefined
          }
        >
        {showHandshakeNotice ? (
          <aside
            className="dvx-history-notice dvx-handshake-notice"
            role="alert"
          >
            DroidVisX was updated behind this window. Run “Developer:
            Reload Window” to reconnect the panel.
          </aside>
        ) : null}
        {/* The model manager page replaces the chat content while
            open (spec §6 拍板); the store keeps streaming behind it. */}
        {modelsPageOpen ? (
          <ModelsPage onClose={closeModelsPage} />
        ) : (
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
          activeTurnId={active ? turnId : null}
          stopping={state.turn?.status === 'stopping'}
          interactionPending={hasInteraction}
          controlsDisabled={
            conversationTransitionBlocking ||
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
          attachmentImages={state.attachmentImages}
          fileSearch={state.fileSearch}
          onFileSearch={handleFileSearch}
          commands={state.commands}
          onCommandsRefresh={handleCommandsRefresh}
          navSignal={composerNav}
          onSlashNavigate={handleSlashNavigate}
          missionActive={missionWorkspaceRoute === 'detail'}
          btwAvailable={btwAvailable}
          onBtwOpen={handleBtwOpen}
          onBtwQuote={handleBtwQuote}
          onAttachPath={handleAttachPath}
          onAttachFiles={handleAttachFiles}
          onAttachEditor={handleAttachEditor}
          onAttachSelection={handleAttachSelection}
          onAttachProblems={handleAttachProblems}
          onAttachGitChanges={handleAttachGitChanges}
          onAttachImage={handleAttachImage}
          onAttachPdf={handleAttachPdf}
          onAttachRemoteImage={handleAttachRemoteImage}
          onAttachUris={handleAttachUris}
          onAttachTextFile={handleAttachTextFile}
          onAttachmentReadImage={handleAttachmentReadImage}
          onAttachmentReplaceImage={handleAttachmentReplaceImage}
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
          onEditAttachImage={handleEditAttachImage}
          onEditAttachPdf={handleEditAttachPdf}
          onEditAttachRemoteImage={handleEditAttachRemoteImage}
          onEditAttachUris={handleEditAttachUris}
          onEditAttachTextFile={handleEditAttachTextFile}
          onEditAttachmentRemove={handleEditAttachmentRemove}
          onRegenerate={
            connectionStatus === 'connected' &&
            !conversationTransitionBlocking &&
            !active &&
            !hasInteraction &&
            regenerateAnchor !== null
              ? handleRegenerate
              : null
          }
          onForkSession={
            connectionStatus === 'connected' &&
            !conversationTransitionBlocking &&
            !active &&
            !hasInteraction &&
            sessionId !== null
              ? handleForkCurrentSession
              : null
          }
          onOpenFileDiff={handleOpenFileDiff}
          onOpenReviewTurn={handleOpenReviewTurn}
          onPreviewFile={handlePreviewFile}
          onPreviewInlineHtml={handlePreviewInlineHtml}
          workspaceRoot={state.workspaceRoot}
          onOpenTerminalMirror={handleOpenTerminalMirror}
          editResendEnabled={
            connectionStatus === 'connected' &&
            !conversationTransitionBlocking &&
            !active &&
            !hasInteraction
          }
          inlineInteraction={inlineInteraction}
          footerInteraction={footerInteraction}
          planAnchors={planAnchors}
          reviewDock={
            <ReviewDockSlot
              changes={latestChanges}
              sessionId={connectionStatus === 'connected' ? sessionId : null}
              vscode={vscode}
              review={state.review.scope}
              restorePreview={state.review.restorePreview}
              operation={state.review.operation}
              agent={state.review.agent}
            />
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
          missionSetup={null}
          onMissionOpen={
            () => handleMissionOpen(normalizeMissionTaskText(draft))
          }
          queuedCount={queuedCount}
          queueEditing={queueEditingId !== null}
          onQueueEditCancel={handleQueueEditCancel}
        />
        )}
        {showHandshakeNotice ? null : conversationTransitionOverlay}
        </div>
        {/* Full-height side question pane living in the shell's
            second grid column beside the main conversation (Claude
            Code split-pane form factor). */}
        {btwSplit ? (
          <SideChatSheet
            state={state.btw}
            draft={btw.draft}
            quote={btw.quote}
            width={btw.width}
            onDraftChange={btw.setDraft}
            onQuoteClear={btw.clearQuote}
            onWidthChange={btw.setWidth}
            onAsk={handleBtwAsk}
            onStop={handleBtwStop}
            onDismiss={handleBtwDismiss}
          />
        ) : missionSplit ? (
          <MissionWorkspace
            route={missionWorkspaceRoute}
            setup={missionSetup}
            mission={state.missionSnapshot}
            result={state.missionControlResult}
            vscode={vscode}
            onCatalog={handleMissionCatalogOpen}
            onClose={handleMissionClose}
          />
        ) : null}
      </div>
    </AssistantRuntimeProvider>
  );
  return (
    <ThemeContext.Provider value={themeContextValue}>
      <OpenPathContext.Provider value={handleOpenPath}>
        <ToolChangesContext.Provider value={toolChanges}>
        <LocalImageContext.Provider value={localImageSource}>
          <GitCommitFlowContext.Provider value={gitFlow}>
            <CustomModelsContext.Provider value={customModelsFlow}>
              <SubagentActivityStoreContext.Provider
                value={subagentFlow.activityStore}
              >
                <SubagentOpenContext.Provider
                  value={subagentFlow.openSubagent}
                >
                  {app}
                </SubagentOpenContext.Provider>
              </SubagentActivityStoreContext.Provider>
            </CustomModelsContext.Provider>
          </GitCommitFlowContext.Provider>
        </LocalImageContext.Provider>
        </ToolChangesContext.Provider>
      </OpenPathContext.Provider>
    </ThemeContext.Provider>
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
