import { MAX_INLINE_PREVIEW_HTML_LENGTH } from '../../shared/protocol/canvasProtocol';
import { renderMermaid } from '../content/mermaidRenderer';
import { ChatLayout } from '@droidvisx/chat-ui/chat/ChatLayout';
import type { TranscriptHandle } from '@droidvisx/chat-ui/chat/TranscriptView';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { Plus } from 'lucide-react';
import { createTurnId, type ChatPort } from '../host/chatIntent';
import type { ThemePreference } from '../../shared/protocol/shell';
import { useComposerFlow } from './composer/useComposerFlow';
import { useHostMessageFlow } from '../host/useHostMessageFlow';
import { useConversationTransition } from '../shell/conversationTransition';
import { Button } from '../ui/button';
import { useWebviewTheme } from '../shell/theme';
import { createChatStore, selectChatShell } from './store';
import { LiveTranscript } from './Transcript';
import { useMessageActions } from './editing/useMessageActions';
import { InteractionPanel } from './InteractionPanel';
import { QueueBar } from './QueueBar';
import { ComposerChanges } from './ComposerChanges';
import { SessionMenu } from './SessionMenu';
import { useSessionActions } from './sessions/useSessionActions';
import { ComposerControls } from './ComposerControls';
import { useWorkspaceActions } from '../review/useWorkspaceActions';
import { useLocalImageSource } from './images/localImageSource';
import { ContentProvider } from '../content/context';
import { ToolActionsContext } from '../content/toolActions';
import { InlineDiffContext } from '../review/useInlineDiff';
import { SubagentActivityStoreContext, useSubagentPanelFlow } from './subagents/subagentPanelFlow';
import { Composer } from './Composer';
import { MAX_TURN_TEXT_LENGTH } from '../../shared/protocol/bounds';
import { appendSelectionQuote } from '@droidvisx/chat-ui/chat/selectionQuote';
import { useBtwPanel } from './btw/useBtwPanel';
import { SideChatSheet } from './SideChatSheet';
import { WorkingSubagents } from './WorkingSubagents';
import { getStatusMessage } from '../shell/statusMessage';
import { selectVisibleNotice } from '../host/transientDiagnostic';
import { TransientNotice } from './TransientNotice';
import { isFooterInteraction } from './interactions/interactionPlacement';
import { useMissionControl } from '../mission/useMissionControl';
import { normalizeMissionTaskText } from '../../shared/protocol/missionProtocol';
import { MissionWorkspace } from '../mission/MissionWorkspace';
import { SelectSessionContext } from './thread/messageContexts';
import { useAnswerScroll } from './useAnswerScroll';
import { ChatConnectionStatus } from './ChatConnectionStatus';
import { ConversationWait, SessionRecovery } from './ConnectionFeedback';
import { AppInfo } from './AppInfo';

export function ChatApp({ port }: { readonly port: ChatPort }) {
  const [store] = useState(createChatStore);
  const transcript = useRef<TranscriptHandle>(null);
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
  const transition = useConversationTransition({
    sequence: state.sequence,
    getSequence,
    historyAvailable: state.historyStatus !== 'unavailable' && state.transcript.length > 0,
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
  const btw = useBtwPanel(port, state.sessionId, { state: state.btw, available: state.btwAvailable,
    defaultModelId: state.settings.value?.interactionMode === 'spec'
      ? state.settings.value.specModeModelId ?? state.settings.value.modelId : state.settings.value?.modelId });
  const openBtw = btw.openPanel;
  const askBtw = btw.ask;
  const routes = useMemo(() => ({
    blocked: operationsBlocked,
    compact,
    navigate: setNavigation,
    openBtw,
    askBtw,
  }), [operationsBlocked, compact, openBtw, askBtw, setNavigation]);
  const composer = useComposerFlow(port, state, dispatch, routes);
  const currentComposer = useRef(composer);
  currentComposer.current = composer;
  const [quoteNotice, setQuoteNotice] = useState<string | null>(null);
  useEffect(() => setQuoteNotice(null), [composer.draft, state.sessionId]);
  const missionControl = useMissionControl(port, createTurnId);
  const [missionChat, setMissionChat] = useState(false);
  const openMission = useCallback(() => {
    setMissionChat(false);
    const task = normalizeMissionTaskText(currentComposer.current.draft);
    missionControl({ type: 'mission.panel.open', target: 'setup', ...(task === undefined ? {} : { task }) });
  }, [missionControl]);
  const quoteIntoChat = useCallback((text: string) => {
    const current = currentComposer.current;
    const next = appendSelectionQuote(current.draft, text, MAX_TURN_TEXT_LENGTH);
    if (next === null) { setQuoteNotice('This selection is too long to add in full. Select less text or remove another quote.'); return; }
    setQuoteNotice(null);
    current.handleDraftChange(next);
    requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('[data-composer-input]')?.focus({ preventScroll: true }));
  }, []);
  const messageActions = useMessageActions({
    vscode: port,
    sessionId: state.sessionId,
    connectionStatus: state.connection.status,
    conversationTransitionBlocking: operationsBlocked,
    interactionCount: state.interactions.length,
    turn: state.turn,
    transcript: state.transcript,
  });
  const answer = useAnswerScroll({ state, blocked: transition.blocking, transcript,
    onRespond: messageActions.handleAskUserRespond });
  const host = useHostMessageFlow(port, state, {
    dispatch,
    getSequence,
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
  const interaction = useMemo(() => <InteractionPanel requests={state.interactions} actions={{
    onPermission: messageActions.handlePermissionRespond,
    onAnswer: answer,
    onOpenPlan: (request) => port.postMessage({
      type: 'plan.document.open', sessionId: request.sessionId, turnId: request.turnId, requestId: request.request.requestId,
    }),
  }} />, [state.interactions, messageActions.handlePermissionRespond, answer, port]);
  const footerInteraction = isFooterInteraction(state.interactions[0]);
  const renderEditorSettings = useCallback((owner: string) => <ComposerControls editorOwner={owner} state={state} port={port} blocked={operationsBlocked}
    theme={theme.context} onMissionOpen={openMission} missionActive={host.missionWorkspaceRoute === 'detail'} />,
  [state, port, operationsBlocked, theme.context, openMission, host.missionWorkspaceRoute]);
  return (
    <ContentProvider value={content}>
    <div className="v2-chat-layout flex h-full min-w-0" data-mission-open={host.missionWorkspaceRoute !== null || undefined} data-mission-chat={missionChat || undefined}>
    <ChatLayout data-transition-phase={transition.phase} aria-busy={transition.blocking}
      header={<>
        <div className="flex min-w-0 items-center gap-1.5"><AppInfo />
          <ChatConnectionStatus connection={state.connection} ide={state.ide} sessionId={state.sessionId} port={port} working={running}
            missionLabel={state.mission ? `${state.mission.role === 'worker' ? 'Mission worker' : 'Mission'}${state.mission.state ? ` · ${state.mission.state}` : ''}` : undefined}
            blocked={transition.blocking || state.connection.status !== 'connected' || running ||
              state.turn?.status === 'stopping' || state.interactions.length > 0 || state.mission !== null} />
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {host.missionWorkspaceRoute !== null ? <Button variant="outline" size="sm" className="v2-mission-chat-toggle" onClick={() => setMissionChat(false)}>Mission</Button> : null}
          <WorkingSubagents state={state} flow={subagents} />
          <Button variant="outline" size="icon" className="size-7 rounded-full bg-input-background text-muted-foreground" aria-label="New session" disabled={sessionActionsDisabled} onClick={sessions.handleNewSession}><Plus className="size-4" /></Button>
          <SessionMenu state={state} actions={sessions} disabled={sessionActionsDisabled} open={navigation.page === 'sessions'} openSignal={navigation.id} onOpenChange={(open) => setNavigation(open ? 'sessions' : null)} />
        </div>
      </>}
      footer={<>
        {footerInteraction ? interaction : null}
        {host.showHandshakeNotice && transition.overlay === null ? <p role="status" className="text-xs text-muted-foreground">Waiting for the extension. Session state refreshes automatically.</p> : null}
        {notice ? <TransientNotice key={notice.sequence} diagnostic={notice} /> : null}
        {statusMessage && !running && !ideReconnecting ? <p role="status" className="text-xs text-muted-foreground">{statusMessage}</p> : null}
        <SessionRecovery state={state} blocked={transition.blocking && transition.overlay !== null} onReconnect={sessions.handleRetry} port={port} />
        <div className="v2-composer-dock">
        <QueueBar key={state.conversationId ?? 'none'} queue={state.queue} flow={composer} />
        <ComposerChanges store={store} port={port} blocked={operationsBlocked} onStop={() => void composer.callbacks.onCancel()} />
        {composer.queueEditingId === null ? null : <div className="v2-composer-queue-edit flex items-center justify-between text-xs text-muted-foreground">
          <span>Editing queued message</span><Button variant="ghost" size="sm" onClick={composer.handleQueueEditCancel}>Cancel edit</Button>
        </div>}
        <Composer key={state.conversationId ?? 'none'} state={state} port={port} flow={composer} blocked={operationsBlocked} quoteNotice={quoteNotice}
          onFileSearch={workspace.handleFileSearch} onNavigate={setNavigation} onBtwOpen={openBtw}
          renderInputRow={(input, action) => <ComposerControls input={input} action={action} state={state} port={port} blocked={operationsBlocked} page={navigation.page} navigationId={navigation.id} onPageChange={setNavigation} onCompact={compact} compactPending={sessions.compactPending} theme={theme.context} onNewSession={sessions.handleNewSession}
            onMissionOpen={openMission} missionActive={host.missionWorkspaceRoute === 'detail'} />} />
        </div>
      </>}
      overlay={<>
      {transition.overlay !== null ? <ConversationWait phase={transition.phase} hasSnapshot={transition.hasSnapshot}
        handshakeTimedOut={host.showHandshakeNotice} connection={state.connection} port={port} sequence={state.sequence}
        conversationId={state.conversationId} sessionId={state.sessionId} /> : null}
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
                renderEditorSettings={renderEditorSettings} />
              </SelectSessionContext.Provider>
            </SubagentActivityStoreContext.Provider>
          </InlineDiffContext.Provider>
        </ToolActionsContext.Provider>
    </ChatLayout>
    {host.missionWorkspaceRoute !== null ? <MissionWorkspace key={state.conversationId} route={host.missionWorkspaceRoute} setup={host.missionSetup} mission={state.missionSnapshot} result={state.missionControlResult} vscode={port}
      onShowChat={() => setMissionChat(true)} onCatalog={() => missionControl({ type: 'mission.panel.open', target: 'catalog' })} onClose={() => missionControl({ type: 'mission.dismissSetup' })} /> : null}
    {host.missionWorkspaceRoute === null && btw.open && state.btwAvailable && state.sessionId !== null ? <SideChatSheet key={state.sessionId} state={state.btw} draft={btw.draft} quote={btw.quote} quotes={btw.quotes} notice={btw.notice} width={btw.width}
      modelCatalog={state.modelCatalog} images={btw.images} selectedModel={btw.selectedModel}
      onModelChange={btw.setChosenModel} sending={btw.sending}
      onDraftChange={btw.setDraft} onQuoteClear={btw.clearQuote} onQuoteRemove={btw.removeQuote} onWidthChange={btw.setWidth} onAsk={btw.sendDraft} onStop={btw.stop} onDismiss={btw.dismiss} /> : null}
    </div>
    </ContentProvider>
  );
}
