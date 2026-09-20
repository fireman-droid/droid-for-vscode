import { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode, type Ref } from 'react';
import { useStore } from 'zustand';
import type { ChatStore } from './store';
import { DroidActivity } from '../ui/droid-motion';
import { useMessageEditor } from '../../webview/assistant/editing/useMessageEditor';
import { useMessageActions } from '../../webview/assistant/editing/useMessageActions';
import { useAttachmentActions } from '../../webview/assistant/attachments/useAttachmentActions';
import type { ChatPort } from '../../webview/assistant/shell/chatIntent';
import type { AssistantWebviewState } from '../../webview/assistant/state/types';
import { QuestionCard } from './QuestionCard';
import { createTranscriptSelector } from '../../webview/assistant/transcript/transcriptGroups';
import { observeCompletion, resolveAssistantStatus, type CompletionClock } from '../../webview/assistant/transcript/transcriptStatus';
import { currentProcessWaiting } from '../../webview/assistant/transcript/activityPresentation';
import { AssistantReply } from './AssistantReply';
import { useEditAttachmentIngress } from './useEditAttachmentIngress';
import { getHistoryNotice } from '../../webview/assistant/shell/statusMessage';
import { isPlanLive, selectPlanAnchors } from '../../webview/assistant/transcript/planAnchor';
import { createOperationSummarySelector } from './operationSummary';
import { ChatStartup } from './ChatStartup';
import { createTranscriptMessagesSelector, createTranscriptStructureSelector } from './transcriptProjection';

import { TranscriptView, type TranscriptHandle } from '@droidvisx/chat-ui/chat/TranscriptView';
export function LiveTranscript({ store, ...props }: { readonly store: ChatStore } & Omit<ComponentProps<typeof Transcript>, 'state'>) {
  const state = useStore(store, (value) => value.state);
  return <Transcript state={state} {...props} />;
}

export function Transcript({
  state,
  port,
  blocked,
  sendSignal,
  onFork,
  renderEditorSettings,
  onQuote,
  onBtwQuote,
  interaction,
  onEditBegin,
  onDraftSuggestion,
  ref,
}: {
  readonly state: AssistantWebviewState;
  readonly port: ChatPort;
  readonly blocked: boolean;
  readonly sendSignal: number;
  readonly onFork: (() => void) | undefined;
  readonly renderEditorSettings?: (owner: string) => ReactNode;
  readonly onQuote?: (text: string) => void;
  readonly onBtwQuote?: (text: string) => void;
  readonly interaction?: ReactNode;
  readonly onEditBegin?: () => void;
  readonly onDraftSuggestion?: (prompt: string) => void;
  readonly ref?: Ref<TranscriptHandle>;
}) {
  const items = state.transcript;
  const historyNotice = getHistoryNotice(state.historyStatus, state.truncated);
  const running = state.turn?.status === 'submitting' || state.turn?.status === 'streaming';
  const view = useRef<TranscriptHandle>(null);
  const stopFollowing = useCallback(() => view.current?.stopFollowing(), []);
  useImperativeHandle(ref, () => ({
    stopFollowing,
    scrollToBottom: () => view.current?.scrollToBottom(),
  }), [stopFollowing]);
  const pausedTurn = state.turn?.status === 'stopping' || state.turn?.status === 'interrupted'
    ? state.turn.turnId : null;
  useLayoutEffect(() => {
    if (pausedTurn !== null) stopFollowing();
  }, [pausedTurn, stopFollowing]);
  const reportLayout = useCallback((detail: string) => port.postMessage({ type: 'webview.diagnostic', kind: 'perf-batch', detail }), [port]);
  const attachments = useAttachmentActions(port, state.sessionId, state.connection.status);
  const actions = useMessageActions({
    vscode: port,
    sessionId: state.sessionId,
    connectionStatus: state.connection.status,
    conversationTransitionBlocking: blocked,
    interactionCount: state.interactions.length,
    turn: state.turn,
    transcript: items,
  });
  const editor = useMessageEditor({
    conversationId: state.conversationId,
    sendSignal,
    rejection: state.editResendRejection,
    onBegin: () => { stopFollowing(); onEditBegin?.(); },
    onStageBegin: attachments.handleEditStageBegin,
    onStageCancel: attachments.handleEditStageCancel,
    onRequestRewindInfo: actions.handleRequestRewindInfo,
    onResend: actions.handleEditResend,
  });
  const canResend =
    !blocked && !running && state.turn?.status !== 'stopping' &&
    state.connection.status === 'connected' && state.sessionId !== null &&
    state.interactions.length === 0 && state.settings.status !== 'updating';
  const currentStage = state.editAttachments?.messageId === editor.draft?.messageId ? state.editAttachments : null;
  const attachmentsDisabled = blocked || state.connection.status !== 'connected' || state.sessionId === null;
  const ingress = useEditAttachmentIngress({
    editor, conversationId: state.conversationId, actions: attachments,
    count: currentStage?.attachments.length ?? 0,
    disabled: attachmentsDisabled || currentStage === null,
  });
  const edit = {
    stage: currentStage, images: state.attachmentImages, actions: attachments,
    disabled: attachmentsDisabled, impact: state.rewindInfo, rejection: state.editResendRejection,
    settings: editor.draft?.phase === 'editing' ? renderEditorSettings?.(editor.draft.messageId) : null,
    ...ingress,
  };
  const selectors = useMemo(() => ({ transcript: createTranscriptSelector(), operations: createOperationSummarySelector(),
    structure: createTranscriptStructureSelector(), messages: createTranscriptMessagesSelector() }), [state.conversationId]);
  const { descriptors, replyTails } = useMemo(() => selectors.transcript(items), [items, selectors]);
  const plans = useMemo(() => selectPlanAnchors(items), [items]);
  const [planChoice, setPlanChoice] = useState<{ conversationId: string | null; id: string; expanded: boolean } | null>(null);
  const currentPlanChoice = planChoice?.conversationId === state.conversationId ? planChoice : null;
  const togglePlan = useCallback((id: string, expanded: boolean) => {
    stopFollowing();
    setPlanChoice({ conversationId: state.conversationId, id, expanded });
  }, [state.conversationId, stopFollowing]);
  const operationSummaries = useMemo(() => selectors.operations(items), [items, selectors]);
  const { ids, turns, lastTurnRows } = useMemo(() => selectors.structure(descriptors), [descriptors, selectors]);
  const byId = useMemo(() => new Map(descriptors.map((item) => [item.kind === 'user' ? item.item.id : item.id, item])), [descriptors]);
  const pendingReplyRow = useMemo(() => running || state.turn?.status === 'stopping'
    ? (turns.find((row) => row.messageIds.some((id) => {
      const descriptor = byId.get(id)!;
      return descriptor.kind === 'assistant' && descriptor.turnId === state.turn?.turnId;
    })) ?? turns.at(-1))?.id : undefined, [running, state.turn?.status, state.turn?.turnId, turns, byId]);
  const completionClock = useRef<CompletionClock>(new Map());
  useEffect(() => {
    const live = new Set(ids);
    for (const id of completionClock.current.keys()) if (!live.has(id)) completionClock.current.delete(id);
  }, [ids]);
  const waiting = useMemo(() => currentProcessWaiting(state.sessionId, state.turn, state.interactions), [state.sessionId, state.turn, state.interactions]);
  const lastReplyId = [...replyTails.keys()].at(-1);
  const toolWorking = useMemo(() => items.some((item) =>
    item.kind === 'tool' && item.status === 'running' && item.turnId === state.turn?.turnId), [items, state.turn?.turnId]);
  const pendingIds = useMemo(() => new Set(turns.find((row) => row.id === pendingReplyRow)?.messageIds ?? []), [turns, pendingReplyRow]);
  const messages = useMemo(() => selectors.messages(descriptors, replyTails, pendingIds), [descriptors, replyTails, pendingIds, selectors]);
  return <TranscriptView ref={view} messages={messages} conversationId={state.conversationId} sessionKey={state.sessionId}
    sendSignal={sendSignal} reportLayout={reportLayout} onQuote={onQuote} onBtwQuote={onBtwQuote}
    leadingContent={<>
      {historyNotice ? <p role="note" className="mb-2 text-xs text-muted-foreground">{historyNotice}</p> : null}
      {items.length === 0 ? <ChatStartup state={state} blocked={blocked} onDraftSuggestion={onDraftSuggestion} /> : null}
    </>}
    trailingContent={<>{interaction}{running && state.interactions.length === 0 ? <div role="status" aria-live="polite" className="flex select-none items-center gap-2 py-1 text-xs text-muted-foreground">
      <DroidActivity phase={state.turn?.compacting ? 'loading' : toolWorking ? 'working' : 'thinking'} />
      <span>{state.turn?.compacting ? 'Compacting conversation…' : `Droid is ${state.turn?.activity === 'working' ? 'working' : 'responding'}`}</span>
    </div> : null}</>}
    renderMessage={(id, presentation) => {
      const message = byId.get(id)!;
      if (message.kind === 'user') {
        const plan = plans.get(message.item.id);
        return <QuestionCard item={message.item} images={message.images} editor={editor} edit={edit}
          placeholder={presentation.placeholder} placeholderHeight={presentation.placeholderHeight} canResend={canResend}
          plan={plan} planRunning={plan !== undefined && isPlanLive(plan, running, state.turn?.turnId ?? null)} planChoice={currentPlanChoice} onPlanToggle={togglePlan} />;
      }
      const replyPending = pendingIds.has(id);
      const status = resolveAssistantStatus(message.items, message.turnId, state.turn);
      const summary = lastTurnRows.get(message.turnId) === message.id ? operationSummaries.get(message.turnId) : undefined;
      const operationsLive = state.turn?.turnId === message.turnId
        ? running || state.turn.status === 'stopping' : status.type === 'running';
      return <AssistantReply descriptor={message} status={status} waiting={waiting} replyText={replyPending ? undefined : replyTails.get(message.id)}
        operationSummary={summary} operationsLive={operationsLive} onInteract={stopFollowing}
        completedAt={observeCompletion(completionClock.current, message.id, replyPending || status.type === 'running')}
        regenerate={message.id === lastReplyId && canResend && actions.regenerateAnchor !== null ? actions.handleRegenerate : undefined}
        fork={message.id === lastReplyId && canResend ? onFork : undefined} />;
    }} />;
}
