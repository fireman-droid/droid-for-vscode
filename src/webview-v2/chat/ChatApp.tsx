import { MAX_INLINE_PREVIEW_HTML_LENGTH } from '../../shared/protocol/canvasProtocol';
import { renderMermaid } from '../../webview/assistant/markdown/mermaidRenderer';
import { ChatLayout } from '@droidvisx/chat-ui/chat/ChatLayout';
import type { TranscriptHandle } from '@droidvisx/chat-ui/chat/TranscriptView';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { Plus } from 'lucide-react';
import { createTurnId, type ChatPort } from '../../webview/assistant/shell/chatIntent';
import type { ThemePreference } from '../../shared/protocol/shell';
import { useComposerFlow } from '../../webview/assistant/composer/useComposerFlow';
import { useHostMessageFlow } from '../../webview/assistant/shell/useHostMessageFlow';
import { useConversationTransition } from '../../webview/assistant/shell/conversationTransition';
import { Button } from '../ui/button';
import { DroidConnectionDot } from '../ui/droid-motion';
import { useWebviewTheme } from '../shell/theme';
import { createChatStore, selectChatShell } from './store';
import { LiveTranscript } from './Transcript';
import { useMessageActions } from '../../webview/assistant/editing/useMessageActions';
import { InteractionPanel } from './InteractionPanel';
import { QueueBar } from './QueueBar';
import { SessionMenu } from './SessionMenu';
import { useSessionActions } from '../../webview/assistant/sessions/useSessionActions';
import { ComposerControls } from './ComposerControls';
import { useWorkspaceActions } from '../../webview/assistant/changes/useWorkspaceActions';
import { useLocalImageSource } from '../../webview/assistant/images/localImageSource';
import { ContentProvider } from '../content/context';
import { ToolActionsContext } from '../content/toolActions';
import { InlineDiffContext } from '../../webview/assistant/changes/useInlineDiff';
import { SubagentActivityStoreContext, useSubagentPanelFlow } from '../../webview/assistant/subagents/subagentPanelFlow';
import { GitCommitFlowContext } from '../../webview/assistant/changes/gitCommitFlow';
import { ReviewDockSlot } from './ReviewDock';
import { Composer } from './Composer';
import { MAX_TURN_TEXT_LENGTH } from '../../shared/protocol/bounds';
import { appendSelectionQuote } from '../../webview/assistant/btw/selectionQuote';
import { useBtwPanel } from '../../webview/assistant/btw/useBtwPanel';
import { SideChatSheet } from './SideChatSheet';
import { WorkingSubagents } from './WorkingSubagents';
import { getStatusMessage } from '../../webview/assistant/shell/statusMessage';
import { selectVisibleNotice } from '../../webview/assistant/shell/transientDiagnostic';
import { TransientNotice } from './TransientNotice';
import { isFooterInteraction } from '../../webview/assistant/interactions/interactionPlacement';
import { useMissionControl } from '../../webview/assistant/mission/useMissionControl';
import { normalizeMissionTaskText } from '../../shared/protocol/missionProtocol';
import { MissionWorkspace } from '../mission/MissionWorkspace';
import { SelectSessionContext } from '../../webview/assistant/thread/messageContexts';
import { stableTranscriptId } from '../../shared/transcript/hostTranscriptState';
import { IdeStatus } from './IdeStatus';
import { ConversationWait, SessionRecovery } from './ConnectionFeedback';
import { AppInfo } from './AppInfo';

export function ChatApp({ port }: { readonly port: ChatPort }) {
  const [store] = useState(createChatStore);
  const transcript = useRef<TranscriptHandle>(null);
  const pendingAnswer = useRef<{
    conversationId: string | null; sessionId: string; turnId: string; resultId: string;
  } | null>(null);
  // Stream text has its own subscriber; controls observe arrivals and domain state.
  useStore(store, useShallow(selectChatShell));
  const state = store.getState().state;
  const getSequence = useCallback(() => store.getState().state.sequence, [store]);
  const dispatch = store.getState().dispatch;
  const persistTheme = useCallback((preference: ThemePreference) => {
    port.postMessage({ type: 'ui.theme.set', preference });
  }, [port]);
  const theme = useWebviewTheme(persistTheme);
  const workspace = useWorkspaceActions({ vscode: port, sessionId: state.sessionId, connectionStatus: state.connection.status, dispatch });
  const subagents = useSubagentPanelFlow(port, state.sessionId);
  const images = useLocalImageSource(port, state.sessionId, state.connection.status, state.localImages);
  const content = useMemo(() => ({
    workspaceRoot: state.workspaceRoot,
    theme: theme.resolved,
    renderDiagram: renderMermaid, maxPreviewHtmlLength: MAX_INLINE_PREVIEW_HTML_LENGTH, previewHtmlDescription: 'HTML · sandboxed · no network',
    images,
    actions: { openPath: workspace.handleOpenPath, previewFile: workspace.handlePreviewFile, previewHtml: workspace.handlePreviewInlineHtml },
  }), [state.workspaceRoot, theme.resolved, images, workspace.handleOpenPath, workspace.handlePreviewFile, workspace.handlePreviewInlineHtml]);
  const inlineDiff = useMemo(() => ({
    port, sessionId: state.sessionId, connected: state.connection.status === 'connected',
  }), [port, state.sessionId, state.connection.status]);
  const toolActions = useMemo(() => state.sessionId !== null && state.connection.status === 'connected' ? {
    openPath: workspace.handleOpenPath,
    openFileDiff: workspace.handleOpenFileDiff,
    openReviewTurn: (turnId: string) => port.postMessage({ type: 'review.panel.open', sessionId: state.sessionId!, scopeKind: 'turn', turnId }),
    openTerminalMirror: workspace.handleOpenTerminalMirror,
    openSubagent: subagents.openSubagent,
  } : {}, [state.sessionId, state.connection.status, workspace.handleOpenPath, workspace.handleOpenFileDiff, workspace.handleOpenReviewTurn, workspace.handleOpenTerminalMirror, subagents.openSubagent]);
  const gitFlow = useMemo(() => ({
    state: state.git, latestChangesTurnId: state.latestChanges?.turnId ?? null,
    promptText: state.latestChanges?.prompt ?? null,
    onRequestStatus: workspace.handleGitRequestStatus, onCommit: workspace.handleGitCommit,
  }), [state.git, state.latestChanges, workspace.handleGitRequestStatus, workspace.handleGitCommit]);
  const transition = useConversationTransition({
    sequence: state.sequence,
    getSequence,
    sessionId: state.sessionId,
    connectionStatus: state.connection.status,
  });
  const [navigation, setNavigationState] = useState<{ page: string | null; id: number }>({ page: null, id: 0 });
  const setNavigation = useCallback((page: string | null) => {
    setNavigationState((current) => ({ page, id: current.id + 1 }));
  }, []);
  const ideReconnecting = state.ide.status === 'reconnecting';
  const operationsBlocked = transition.blocking || ideReconnecting;
  const sessions = useSessionActions({
    vscode: port, sessionId: state.sessionId, connectionStatus: state.connection.status,
    transcript: state.transcript, conversationTransitionBlocking: operationsBlocked,
    beginConversationSwitch: transition.beginSwitch,
  });
  const compact = sessions.handleCompact;
  const btw = useBtwPanel(port, state.btwAvailable ? state.sessionId : null);
  const openBtw = btw.openPanel;
  const askBtw = btw.ask;
  const dismissBtw = useCallback(() => {
    btw.dismiss();
    if (state.sessionId !== null) port.postMessage({ type: 'btw.dismiss', sessionId: state.sessionId });
  }, [btw.dismiss, state.sessionId, port]);
  const routes = useMemo(() => ({
    blocked: operationsBlocked,
    compact,
    navigate: setNavigation,
    openBtw,
    askBtw,
  }), [operationsBlocked, compact, openBtw, askBtw, setNavigation]);
  const composer = useComposerFlow(port, state, dispatch, routes);
  const [quoteNotice, setQuoteNotice] = useState<string | null>(null);
  useEffect(() => setQuoteNotice(null), [composer.draft, state.sessionId]);
  const missionControl = useMissionControl(port, createTurnId);
  const [missionChat, setMissionChat] = useState(false);
  const openMission = () => {
    setMissionChat(false);
    const task = normalizeMissionTaskText(composer.draft);
    missionControl({ type: 'mission.panel.open', target: 'setup', ...(task === undefined ? {} : { task }) });
  };
  const quoteIntoChat = (text: string) => {
    const next = appendSelectionQuote(composer.draft, text, MAX_TURN_TEXT_LENGTH);
    if (next === null) { setQuoteNotice('This selection is too long to add in full. Select less text or remove another quote.'); return; }
    setQuoteNotice(null);
    composer.handleDraftChange(next);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-composer-input]')?.focus({ preventScroll: true }));
  };
  const messageActions = useMessageActions({
    vscode: port,
    sessionId: state.sessionId,
    connectionStatus: state.connection.status,
    conversationTransitionBlocking: operationsBlocked,
    interactionCount: state.interactions.length,
    turn: state.turn,
    transcript: state.transcript,
  });
  useLayoutEffect(() => {
    const pending = pendingAnswer.current;
    if (pending === null) return;
    if (pending.conversationId !== state.conversationId || pending.sessionId !== state.sessionId ||
      pending.turnId !== state.turn?.turnId || state.connection.status !== 'connected' || transition.blocking ||
      state.turn.status === 'stopping' || state.turn.status === 'interrupted' || state.turn.status === 'failed') {
      pendingAnswer.current = null;
      return;
    }
    const result = state.transcript.find((item) => item.id === pending.resultId);
    if (result?.kind !== 'ask-user-result') return;
    pendingAnswer.current = null;
    // Wait for the Host-confirmed result and closed card to share a committed layout.
    if (result.status === 'answered') transcript.current?.scrollToBottom();
  }, [state.conversationId, state.sessionId, state.turn, state.connection.status, state.transcript, transition.blocking]);
  const host = useHostMessageFlow(port, state, {
    dispatch,
    observeTransitionMessage: transition.observeHostMessage,
    applyHostTheme: theme.applyHostTheme,
    appendCanvasDraft: composer.appendCanvasDraft,
    settleSend: composer.settleSend,
  });
  useEffect(() => { setMissionChat(false); }, [host.missionWorkspaceRoute, state.conversationId]);
  const running = state.turn?.status === 'submitting' || state.turn?.status === 'streaming';
  const notice = selectVisibleNotice(host.transientDiagnostic, state.sessionId, state.turn?.turnId ?? null, running || state.turn?.status === 'stopping');
  const statusMessage = getStatusMessage(state, composer.draft);
  const sessionActionsDisabled = operationsBlocked || state.connection.status !== 'connected' ||
    ((running || state.turn?.status === 'stopping') && !state.backgroundTurnsAvailable) || state.interactions.length > 0;
  const interaction = <InteractionPanel requests={state.interactions} actions={{
    onPermission: messageActions.handlePermissionRespond,
    onAnswer: (request, cancelled, answers) => {
      pendingAnswer.current = cancelled ? null : {
        conversationId: state.conversationId, sessionId: request.sessionId, turnId: request.turnId,
        resultId: stableTranscriptId('ask-user-result', request.turnId, request.request.requestId),
      };
      messageActions.handleAskUserRespond(request, cancelled, answers);
    },
    onOpenPlan: (request) => port.postMessage({
      type: 'plan.document.open', sessionId: request.sessionId, turnId: request.turnId, requestId: request.request.requestId,
    }),
  }} />;
  const footerInteraction = isFooterInteraction(state.interactions[0]);
  return (
    <ContentProvider value={content}>
    <div className="v2-chat-layout flex h-full min-w-0" data-mission-open={host.missionWorkspaceRoute !== null || undefined} data-mission-chat={missionChat || undefined}>
    <ChatLayout data-transition-phase={transition.phase} aria-busy={transition.blocking}
      header={<>
        <div className="flex min-w-0 items-center gap-1.5"><AppInfo />
          <span role={state.connection.status === 'unavailable' ? 'alert' : 'status'} title={`Local runtime ${state.connection.status}${state.mission ? ` · ${state.mission.role === 'worker' ? 'Mission worker' : 'Mission'}${state.mission.state ? ` · ${state.mission.state}` : ''}` : ''}`} className="grid size-3.5 place-items-center">
            <DroidConnectionDot state={state.connection.status} working={running} />
            <span className="sr-only">{`Local runtime ${state.connection.status}`}</span>
          </span>
        </div>
        <div className="flex items-center gap-1">
          <IdeStatus ide={state.ide} sessionId={state.sessionId} port={port}
            blocked={transition.blocking || state.connection.status !== 'connected' || running ||
              state.turn?.status === 'stopping' || state.interactions.length > 0 || state.mission !== null} />
          {host.missionWorkspaceRoute !== null ? <Button variant="outline" size="sm" className="v2-mission-chat-toggle" onClick={() => setMissionChat(false)}>Mission</Button> : null}
          <WorkingSubagents state={state} flow={subagents} />
          <Button variant="outline" size="icon" className="size-7 rounded-full bg-input-background text-muted-foreground" aria-label="New session" disabled={sessionActionsDisabled} onClick={sessions.handleNewSession}><Plus className="size-4" /></Button>
          <SessionMenu state={state} actions={sessions} disabled={sessionActionsDisabled} open={navigation.page === 'sessions'} openSignal={navigation.id} onOpenChange={(open) => setNavigation(open ? 'sessions' : null)} />
        </div>
      </>}
      footer={<>
        <GitCommitFlowContext.Provider value={gitFlow}>
          <ReviewDockSlot store={store} vscode={port} />
        </GitCommitFlowContext.Provider>
        {footerInteraction ? interaction : null}
        {host.showHandshakeNotice && transition.overlay === null ? <p role="status" className="text-xs text-muted-foreground">Still waiting for the extension. Use the editor’s Reload Window command if it remains unresponsive.</p> : null}
        {notice ? <TransientNotice key={notice.sequence} diagnostic={notice} /> : null}
        {statusMessage && !running && !ideReconnecting ? <p role="status" className="text-xs text-muted-foreground">{statusMessage}</p> : null}
        <SessionRecovery state={state} blocked={transition.blocking} onReconnect={sessions.handleRetry} port={port} />
        <QueueBar queue={state.queue} flow={composer} />
        {composer.queueEditingId === null ? null : <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Editing queued message</span><Button variant="ghost" size="sm" onClick={composer.handleQueueEditCancel}>Cancel edit</Button>
        </div>}
        <Composer key={state.conversationId ?? 'none'} state={state} port={port} flow={composer} blocked={operationsBlocked} quoteNotice={quoteNotice}
          onFileSearch={workspace.handleFileSearch} onNavigate={setNavigation} onBtwOpen={openBtw}
          renderInputRow={(input, action) => <ComposerControls input={input} action={action} state={state} port={port} blocked={operationsBlocked} page={navigation.page} navigationId={navigation.id} onPageChange={setNavigation} onCompact={compact} compactPending={sessions.compactPending} theme={theme.context} onNewSession={sessions.handleNewSession}
            onMissionOpen={openMission} missionActive={host.missionWorkspaceRoute === 'detail'} />} />
      </>}
      overlay={<>
      {transition.overlay !== null ? <ConversationWait phase={transition.phase} hasSnapshot={transition.hasSnapshot}
        handshakeTimedOut={host.showHandshakeNotice} connection={state.connection} port={port} sequence={state.sequence} /> : null}
      </>}>

        <ToolActionsContext.Provider value={toolActions}>
          <InlineDiffContext.Provider value={inlineDiff}>
            <SubagentActivityStoreContext.Provider value={subagents.activityStore}>
              <SelectSessionContext.Provider value={sessions.handleSelectSession}>
              <LiveTranscript ref={transcript} store={store} port={port} blocked={operationsBlocked} sendSignal={composer.sendSignal} onFork={sessions.handleForkCurrentSession}
                onEditBegin={composer.queueEditingId === null ? undefined : composer.handleQueueEditCancel}
                onDraftSuggestion={!operationsBlocked && !composer.draft.trim() && composer.queueEditingId === null && !running && state.interactions.length === 0
                  ? composer.appendCanvasDraft : undefined}
                onQuote={quoteIntoChat}
                onBtwQuote={state.btwAvailable ? btw.openWithQuote : undefined}
                interaction={footerInteraction ? null : interaction}
                renderEditorSettings={(owner) => <ComposerControls editorOwner={owner} state={state} port={port} blocked={operationsBlocked}
                  theme={theme.context} onMissionOpen={openMission} missionActive={host.missionWorkspaceRoute === 'detail'} />} />
              </SelectSessionContext.Provider>
            </SubagentActivityStoreContext.Provider>
          </InlineDiffContext.Provider>
        </ToolActionsContext.Provider>
    </ChatLayout>
    {host.missionWorkspaceRoute !== null ? <MissionWorkspace key={state.conversationId} route={host.missionWorkspaceRoute} setup={host.missionSetup} mission={state.missionSnapshot} result={state.missionControlResult} vscode={port}
      onShowChat={() => setMissionChat(true)} onCatalog={() => missionControl({ type: 'mission.panel.open', target: 'catalog' })} onClose={() => missionControl({ type: 'mission.dismissSetup' })} /> : null}
    {host.missionWorkspaceRoute === null && btw.open && state.btwAvailable && state.sessionId !== null ? <SideChatSheet key={state.sessionId} state={state.btw} draft={btw.draft} quote={btw.quote} quotes={btw.quotes} notice={btw.notice} width={btw.width}
      modelCatalog={state.modelCatalog} defaultModelId={state.settings.value?.interactionMode === 'spec'
        ? state.settings.value.specModeModelId ?? state.settings.value.modelId : state.settings.value?.modelId}
      onDraftChange={btw.setDraft} onQuoteClear={btw.clearQuote} onQuoteRemove={btw.removeQuote} onWidthChange={btw.setWidth} onAsk={btw.ask} onStop={btw.stop} onDismiss={dismissBtw} /> : null}
    </div>
    </ContentProvider>
  );
}
