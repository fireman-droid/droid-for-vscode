import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useWorkspaceActions } from './changes/useWorkspaceActions';
import { InlineDiffContext } from './changes/useInlineDiff';
import { useCapabilityActions } from './composer/useCapabilityActions';
import { useComposerFlow } from './composer/useComposerFlow';
import { DraftSynchronizer } from './composer/DraftSynchronizer';
import { useMessageActions } from './editing/useMessageActions';
import { useSessionActions } from './sessions/useSessionActions';
import { createTurnId, post } from './shell/chatIntent';
import { useHostMessageFlow } from './shell/useHostMessageFlow';

import { getStatusMessage } from './shell/statusMessage';
import { normalizeMissionTaskText } from '../../shared/protocol/missionProtocol';
import { type ThemePreference } from '../../shared/protocol/shell';
import { getVsCodeApi } from '../bridge/vscode';
import { MissionWorkspace } from '../missionControl/MissionWorkspace';
import { useAttachmentActions } from './attachments/useAttachmentActions';
import { SideChatSheet } from './btw/SideChatSheet';
import { useBtwPanel } from './btw/useBtwPanel';
import {
  GitCommitFlowContext,
  type GitCommitFlowContextValue,
} from './changes/GitCommitPanel';
import { ReviewDockSlot } from './changes/reviewDockSlot';
import type { ComposerNavRequest } from './composer/ComposerControls';
import { type SlashNavTarget } from './composer/slashBuiltins';
import { useLocalImageSource } from './images/localImageSource';
import { buildInteractionSlots } from './interactions/interactionSlots';
import { LocalImageContext, OpenPathContext } from './markdown/MarkdownText';
import { useMissionControl } from './mission/useMissionControl';
import { CustomModelsContext, useCustomModelsFlow } from './models/customModelsFlow';
import { QueuedMessages } from './queue/QueuedMessages';
import { AppHeader } from './shell/AppHeader';
import { useConversationTransition } from './shell/conversationTransition';
import { ThemeContext, useThemeController } from './shell/theme';
import { selectVisibleNotice } from './shell/transientNotice';
import { initialAssistantWebviewState } from './state/initialState';
import { assistantWebviewReducer } from './state/store';
import { isTurnActive } from './state/turnIdentity';
import './styles.css';
import {
  SubagentActivityStoreContext,
  SubagentOpenContext,
  useSubagentPanelFlow,
} from './subagents/subagentPanelFlow';
import { selectWorkingSubagents } from './subagents/subagentWorking';
import { DroidThread } from './thread/Thread';
import { ToolChangesContext } from './thread/messageContexts';
import { selectPlanAnchors } from './transcript/planAnchor';
import { ProcessInteractionProvider } from './transcript/processPresentation';
import {
  DEFAULT_MESSAGE_WINDOW,
  MESSAGE_WINDOW_STEP,
  useDroidExternalStoreRuntime,
} from './transcript/runtimeAdapter';

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
  // Slash-command navigation (S2): `/model` `/mcp` `/skills`
  // `/context` open composer popovers; `/sessions` opens the history
  // drawer. Monotonic ids let the same target fire repeatedly.
  const [composerNav, setComposerNav] = useState<ComposerNavRequest | null>(null);
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
  const handleSlashNavigate = useCallback((target: SlashNavTarget): void => {
    if (target === 'sessions') {
      setSessionsOpenSignal((value) => value + 1);
      return;
    }
    composerNavCounterRef.current += 1;
    setComposerNav({ id: composerNavCounterRef.current, target });
  }, []);
  const handleMissionOpen = useCallback(
    (task?: string): void => {
      missionControl({
        type: 'mission.panel.open',
        target: 'setup',
        ...(task === undefined ? {} : { task }),
      });
    },
    [missionControl],
  );
  const handleMissionCatalogOpen = useCallback((): void => {
    missionControl({ type: 'mission.panel.open', target: 'catalog' });
  }, [missionControl]);
  const handleMissionClose = useCallback((): void => {
    missionControl({ type: 'mission.dismissSetup' });
  }, [missionControl]);
  const active = isTurnActive(state.turn);
  const generating = active && state.turn?.status !== 'stopping';
  const hasInteraction = state.interactions.length > 0;
  const connectionStatus = state.connection.status;
  const sessionId = state.sessionId;
  const inlineDiffContext = useMemo(
    () => ({ port: vscode, sessionId, connected: connectionStatus === 'connected' }),
    [vscode, sessionId, connectionStatus],
  );
  const attachments = useAttachmentActions(vscode, sessionId, connectionStatus);
  const openModelsPage = useCallback((): void => {
    post(vscode, { type: 'models.open' });
  }, [vscode]);
  // BYOK custom-models flow: state + callbacks live in the hook
  // (window-listener pull, not store/snapshot state) and reach the
  // pages via context — same no-prop-drilling pattern as gitFlow.
  const customModelsFlow = useCustomModelsFlow(vscode, sessionId, openModelsPage);
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
    () => selectWorkingSubagents(state.transcript, liveTurnIdsRef.current),
    // turnId covers set growth; the set itself is a stable ref.
    [state.transcript, turnId],
  );
  useEffect(() => {
    subagentFlow.onPanelToggle(workingSubagents.length > 0);
    return () => subagentFlow.onPanelToggle(false);
  }, [subagentFlow, workingSubagents.length]);
  const interactionCount = state.interactions.length;
  const sessions = useSessionActions({
    vscode,
    sessionId,
    connectionStatus,
    transcript: state.transcript,
    conversationTransitionBlocking,
    beginConversationSwitch,
  });
  const workspace = useWorkspaceActions({
    vscode,
    sessionId,
    connectionStatus,
    dispatch,
  });
  const capabilities = useCapabilityActions({ vscode, sessionId, connectionStatus });
  const messages = useMessageActions({
    vscode,
    sessionId,
    connectionStatus,
    conversationTransitionBlocking,
    interactionCount,
    turn: state.turn,
    transcript: state.transcript,
  });
  const composer = useComposerFlow(vscode, state, dispatch, {
    blocked: conversationTransitionBlocking,
    compact: sessions.handleCompact,
    navigate: handleSlashNavigate,
    openBtw: handleBtwOpen,
    askBtw: handleBtwAsk,
  });
  const host = useHostMessageFlow(vscode, state, {
    dispatch,
    observeTransitionMessage,
    applyHostTheme,
    appendCanvasDraft: composer.appendCanvasDraft,
    settleSend: composer.settleSend,
  });

  const [messageWindow, setMessageWindow] = useState(DEFAULT_MESSAGE_WINDOW);
  const windowSessionRef = useRef(sessionId);
  if (windowSessionRef.current !== sessionId) {
    windowSessionRef.current = sessionId;
    setMessageWindow(DEFAULT_MESSAGE_WINDOW);
  }
  const { runtime, hiddenMessageCount } = useDroidExternalStoreRuntime(
    state,
    composer.callbacks,
    messageWindow,
  );
  const handleShowEarlier = useCallback((): void => {
    setMessageWindow((current) => current + MESSAGE_WINDOW_STEP);
  }, []);
  const localImageSource = useLocalImageSource(
    vscode,
    sessionId,
    connectionStatus,
    state.localImages,
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
      onRequestStatus: workspace.handleGitRequestStatus,
      onCommit: workspace.handleGitCommit,
    }),
    [
      state.git,
      state.latestChanges,
      workspace.handleGitRequestStatus,
      workspace.handleGitCommit,
    ],
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
    state.interactions,
    messages.handlePermissionRespond,
    messages.handleAskUserRespond,
    vscode,
  );

  // Split-pane /btw: while the side question pane is mounted the
  // shell gains a second grid column so both conversations stay live
  // side by side (Claude Code form factor, user decision 2026-08-12).
  const missionWorkspaceRoute = host.missionWorkspaceRoute;
  const missionSplit = missionWorkspaceRoute !== null;
  const btwSplit = !missionSplit && btwOpen && btwAvailable && sessionId !== null;

  // Rendered once here so transcript markdown (deep inside
  // assistant-ui's message tree) can open clicked file paths without
  // prop drilling.
  const app = (
    <AssistantRuntimeProvider runtime={runtime}>
      <ProcessInteractionProvider
        conversationId={state.conversationId}
        sessionId={state.sessionId}
        turn={state.turn}
        interactions={state.interactions}
      >
        <DraftSynchronizer command={composer.draftCommand} />
        {/* Live turn entry animation remains separate from the localized
          Conversation recovery and switching transition below. */}
        <div
          className={`dvx-shell${
            connectionStatus === 'connected' && generating ? ' dvx-anim-live' : ''
          }${host.showHandshakeNotice ? ' dvx-shell-stalled' : ''}${
            btwSplit || missionSplit ? ' dvx-shell-split' : ''
          }`}
          data-theme={resolvedTheme}
          data-dvx-theme-preference={themeContextValue.preference}
        >
          <AppHeader
            state={state}
            sessionActionsDisabled={sessionActionsDisabled}
            sessionsOpenSignal={sessionsOpenSignal}
            onNewSession={sessions.handleNewSession}
            onCreateWorktreeSession={sessions.handleCreateWorktreeSession}
            onSelectSession={sessions.handleSelectSession}
            onRenameSession={sessions.handleRenameSession}
            onForkSession={sessions.handleForkSession}
            onToggleFavorite={sessions.handleToggleFavorite}
            onArchiveSession={sessions.handleArchiveSession}
            onUnarchiveSession={sessions.handleUnarchiveSession}
            onRefreshArchived={sessions.handleRefreshArchived}
            onSearchContent={sessions.handleSearchContent}
          />
          <div
            className="dvx-conversation-surface"
            data-transition-phase={conversationTransitionPhase}
            aria-busy={
              !host.showHandshakeNotice && conversationTransitionPhase !== 'idle'
                ? true
                : undefined
            }
          >
            {host.showHandshakeNotice ? (
              <aside className="dvx-history-notice dvx-handshake-notice" role="alert">
                DroidVisX was updated behind this window. Run “Developer: Reload Window”
                to reconnect the panel.
              </aside>
            ) : null}
            <DroidThread
              transcript={{
                pending: showPending,
                activity: state.turn?.activity,
                activityLive: activityLive,
                historyStatus: state.historyStatus,
                truncated: state.truncated,
                hiddenMessageCount: hiddenMessageCount,
                onShowEarlier: handleShowEarlier,
                statusMessage: getStatusMessage(state, composer.draft),
                showRetry:
                  state.connection.status === 'unavailable' ||
                  state.turn?.status === 'failed',
                running: active,
                activeTurnId: active ? turnId : null,
                stopping: state.turn?.status === 'stopping',
                interactionPending: hasInteraction,
                onRetry: sessions.handleRetry,
                planAnchors: planAnchors,
              }}
              composer={{
                controlsDisabled:
                  conversationTransitionBlocking ||
                  state.connection.status !== 'connected' ||
                  state.sessionId === null,
                settingUpdatesDisabled: hasInteraction,
                settings: state.settings,
                context: state.context,
                tokenUsage: state.tokenUsage,
                modelCatalog: state.modelCatalog,
                skills: state.skills,
                mcp: state.mcp,
                plugins: state.plugins,
                onContextRefresh: capabilities.handleContextRefresh,
                compactPending: sessions.compactPending,
                onCompact: sessions.handleCompact,
                onSettingUpdate: capabilities.handleSettingUpdate,
                onSkillsRefresh: capabilities.handleSkillsRefresh,
                onSkillToggle: capabilities.handleSkillToggle,
                onMcpRefresh: capabilities.handleMcpRefresh,
                onMcpServerToggle: capabilities.handleMcpServerToggle,
                onMcpServerAdd: capabilities.handleMcpServerAdd,
                onMcpServerRemove: capabilities.handleMcpServerRemove,
                mcpAuth: state.mcpAuth,
                onMcpServerAuthenticate: capabilities.handleMcpServerAuthenticate,
                onPluginsRefresh: capabilities.handlePluginsRefresh,
                onNewSession: sessions.handleNewSession,
                attachments: state.attachments,
                attachmentImages: state.attachmentImages,
                fileSearch: state.fileSearch,
                onFileSearch: workspace.handleFileSearch,
                commands: state.commands,
                onCommandsRefresh: capabilities.handleCommandsRefresh,
                navSignal: composerNav,
                onSlashNavigate: handleSlashNavigate,
                missionActive: host.missionWorkspaceRoute === 'detail',
                btwAvailable: btwAvailable,
                onBtwOpen: handleBtwOpen,
                onAttachPath: attachments.handleAttachPath,
                onAttachFiles: attachments.handleAttachFiles,
                onAttachEditor: attachments.handleAttachEditor,
                onAttachSelection: attachments.handleAttachSelection,
                onAttachProblems: attachments.handleAttachProblems,
                onAttachGitChanges: attachments.handleAttachGitChanges,
                onAttachImage: attachments.handleAttachImage,
                onAttachPdf: attachments.handleAttachPdf,
                onAttachRemoteImage: attachments.handleAttachRemoteImage,
                onAttachUris: attachments.handleAttachUris,
                onAttachTextFile: attachments.handleAttachTextFile,
                onAttachmentReadImage: attachments.handleAttachmentReadImage,
                onAttachmentReplaceImage: attachments.handleAttachmentReplaceImage,
                onAttachmentRemove: attachments.handleAttachmentRemove,
                onDraftChange: composer.handleDraftChange,
                onMissionOpen: () =>
                  handleMissionOpen(normalizeMissionTaskText(composer.draft)),
                queuedCount: composer.queuedCount,
                queueEditing: composer.queueEditingId !== null,
                onQueueEditCancel: composer.handleQueueEditCancel,
              }}
              messageActions={{
                onSelectSession: sessions.handleSelectSession,
                onBtwQuote: handleBtwQuote,
                onEditResend: messages.handleEditResend,
                rewindInfo: state.rewindInfo,
                onRequestRewindInfo: messages.handleRequestRewindInfo,
                editStage: state.editAttachments,
                editResendRejection: state.editResendRejection,
                sendSignal: composer.sendSignal,
                onEditStageBegin: attachments.handleEditStageBegin,
                onEditStageCancel: attachments.handleEditStageCancel,
                onEditAttachFiles: attachments.handleEditAttachFiles,
                onEditAttachEditor: attachments.handleEditAttachEditor,
                onEditAttachSelection: attachments.handleEditAttachSelection,
                onEditAttachProblems: attachments.handleEditAttachProblems,
                onEditAttachGitChanges: attachments.handleEditAttachGitChanges,
                onEditAttachImage: attachments.handleEditAttachImage,
                onEditAttachPdf: attachments.handleEditAttachPdf,
                onEditAttachRemoteImage: attachments.handleEditAttachRemoteImage,
                onEditAttachUris: attachments.handleEditAttachUris,
                onEditAttachTextFile: attachments.handleEditAttachTextFile,
                onEditAttachmentRemove: attachments.handleEditAttachmentRemove,
                onRegenerate:
                  connectionStatus === 'connected' &&
                  !conversationTransitionBlocking &&
                  !active &&
                  !hasInteraction &&
                  messages.regenerateAnchor !== null
                    ? messages.handleRegenerate
                    : null,
                onForkSession:
                  connectionStatus === 'connected' &&
                  !conversationTransitionBlocking &&
                  !active &&
                  !hasInteraction &&
                  sessionId !== null
                    ? sessions.handleForkCurrentSession
                    : null,
                onOpenFileDiff: workspace.handleOpenFileDiff,
                onOpenReviewTurn: workspace.handleOpenReviewTurn,
                onPreviewFile: workspace.handlePreviewFile,
                onPreviewInlineHtml: workspace.handlePreviewInlineHtml,
                workspaceRoot: state.workspaceRoot,
                onOpenTerminalMirror: workspace.handleOpenTerminalMirror,
                editResendEnabled:
                  connectionStatus === 'connected' &&
                  !conversationTransitionBlocking &&
                  !active &&
                  !hasInteraction,
              }}
              slots={{
                inlineInteraction: inlineInteraction,
                footerInteraction: footerInteraction,
                reviewDock: (
                  <ReviewDockSlot
                    changes={latestChanges}
                    sessionId={connectionStatus === 'connected' ? sessionId : null}
                    vscode={vscode}
                    review={state.review.scope}
                    restorePreview={state.review.restorePreview}
                    operation={state.review.operation}
                    agent={state.review.agent}
                  />
                ),
                transientDiagnostic: selectVisibleNotice(
                  host.transientDiagnostic,
                  sessionId,
                  turnId,
                  active,
                ),
                queuedMessages:
                  state.queue.items.length === 0 ? null : (
                    <QueuedMessages
                      queue={state.queue}
                      editingId={composer.queueEditingId}
                      onEditBegin={composer.handleQueueEditBegin}
                      onPromote={composer.handleQueuePromote}
                      onRemove={composer.handleQueueRemove}
                      onResume={composer.handleQueueResume}
                      onClear={composer.handleQueueClear}
                    />
                  ),
                missionSetup: null,
              }}
            />
            {host.showHandshakeNotice ? null : conversationTransitionOverlay}
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
              setup={host.missionSetup}
              mission={state.missionSnapshot}
              result={state.missionControlResult}
              vscode={vscode}
              onCatalog={handleMissionCatalogOpen}
              onClose={handleMissionClose}
            />
          ) : null}
        </div>
      </ProcessInteractionProvider>
    </AssistantRuntimeProvider>
  );
  return (
    <ThemeContext.Provider value={themeContextValue}>
      <OpenPathContext.Provider value={workspace.handleOpenPath}>
        <ToolChangesContext.Provider value={toolChanges}>
          <LocalImageContext.Provider value={localImageSource}>
            <GitCommitFlowContext.Provider value={gitFlow}>
              <CustomModelsContext.Provider value={customModelsFlow}>
                <SubagentActivityStoreContext.Provider value={subagentFlow.activityStore}>
                  <SubagentOpenContext.Provider value={subagentFlow.openSubagent}>
                    <InlineDiffContext.Provider value={inlineDiffContext}>
                      {app}
                    </InlineDiffContext.Provider>
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

