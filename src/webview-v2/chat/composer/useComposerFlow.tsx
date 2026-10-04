import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch } from 'react';
import { MAX_TURN_TEXT_LENGTH } from '../../../shared/protocol/bounds';
import { TURN_SEND_REJECTED_CODE } from '../../../shared/protocol/turns';
import { persistDraft, restoreDraft } from '../../bridge/vscode';
import { createTurnId, post, type ChatPort } from '../../host/chatIntent';
import { subscribeHostMessages } from '../../host/hostMessageSource';
import { canSendMessage, shouldQueueMessage } from './sendEligibility';
import {
  resolveBuiltinSlash,
  type SlashNavTarget,
} from './slashBuiltins';
import { type AssistantWebviewAction, type AssistantWebviewState } from '../../state/types';
import { getChatSurfaceCapabilities, type ChatSurfaceCapabilities } from '../../../shared/chatSurfacePolicy';

type InputState = Pick<
  AssistantWebviewState,
  | 'sessionId'
  | 'connection'
  | 'turn'
  | 'interactions'
  | 'queue'
  | 'queueEditing'
  | 'btwAvailable'
  | 'settings'
>;

export function useComposerFlow(
  vscode: ChatPort,
  state: InputState,
  dispatch: Dispatch<AssistantWebviewAction>,
  routes: {
    readonly blocked: boolean;
    readonly compact: () => void;
    readonly navigate: (target: SlashNavTarget) => void;
    readonly openBtw: () => void;
    readonly askBtw: (question: string) => void;
    readonly capabilities?: ChatSurfaceCapabilities;
  },
) {
  const [draft, setDraft] = useState(() => restoreDraft(vscode));
  const [commandNotice, setCommandNotice] = useState<string | null>(null);
  const draftValue = useRef(draft);
  const [draftCommand, setDraftCommand] = useState({ id: 0, text: draft });
  const [sendSignal, setSendSignal] = useState(0);
  const pending = useRef(false);
  const draftRevision = useRef(0);
  const pendingSend = useRef<{ sessionId: string; turnId: string; text: string; revision: number } | null>(null);
  const previousDraft = useRef<string | null>(null);
  const currentSession = useRef(state.sessionId);
  if (currentSession.current !== state.sessionId) {
    currentSession.current = state.sessionId;
    pendingSend.current = null;
  }
  const writeDraft = useCallback(
    (text: string, replaceComposer = false): void => {
      draftRevision.current += 1;
      draftValue.current = text;
      setDraft(text);
      setCommandNotice(null);
      if (replaceComposer) setDraftCommand((command) => ({ id: command.id + 1, text }));
      // Queue edits are temporary; reloading must still restore the ordinary draft.
      persistDraft(vscode, previousDraft.current ?? text);
    },
    [vscode],
  );
  useEffect(() => subscribeHostMessages((message) => {
    const sent = pendingSend.current;
    if (sent === null) return;
    if ((message.type === 'host.snapshot' || message.type === 'host.connection') && message.sessionId !== sent.sessionId) {
      pendingSend.current = null;
      return;
    }
    if ((message.type !== 'turn.error' && message.type !== 'turn.state') ||
      message.sessionId !== sent.sessionId || message.turnId !== sent.turnId) return;
    pendingSend.current = null;
    pending.current = false;
    if (message.type === 'turn.error' && message.code === TURN_SEND_REJECTED_CODE &&
      currentSession.current === sent.sessionId && draftRevision.current === sent.revision) {
      writeDraft(sent.text, true);
    }
  }), [writeDraft]);
  const finishQueueEdit = useCallback(() => {
    dispatch({ type: 'queue.editEnd' });
    if (previousDraft.current === null) return;
    const original = previousDraft.current;
    previousDraft.current = null;
    writeDraft(original, true);
  }, [dispatch, writeDraft]);
  useEffect(() => {
    if (state.queueEditing === null && previousDraft.current !== null) finishQueueEdit();
  }, [state.queueEditing, finishQueueEdit]);
  const handleDraftChange = useCallback((text: string) => writeDraft(text), [writeDraft]);
  const appendCanvasDraft = useCallback(
    (text: string): void => {
      writeDraft(
        draftValue.current.trim().length === 0
          ? text
          : `${draftValue.current}\n\n${text}`,
        true,
      );
    },
    [writeDraft],
  );
  const settleSend = useCallback(() => {
    pending.current = false;
  }, []);
  const sessionId = state.sessionId;
  const turnId = state.turn?.turnId ?? null;
  const turnStatus = state.turn?.status ?? null;
  const queueEditingId = state.queueEditing?.queueId ?? null;
  const queuedCount = state.queue.items.length;
  const connectionStatus = state.connection.status;
  const interactionCount = state.interactions.length;
  const settingsUpdating = state.settings.status === 'updating';
  const { blocked, compact, navigate, openBtw, askBtw, capabilities = getChatSurfaceCapabilities('main') } = routes;
  const handleSend = useCallback(
    async (text: string): Promise<void> => {
      if (blocked || settingsUpdating) return;
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
        finishQueueEdit();
        return;
      }
      const builtin = resolveBuiltinSlash(text, { btwEnabled: state.btwAvailable });
      if (builtin !== null) {
        if (!capabilities.navigateSessions && (builtin.kind === 'new' || builtin.kind === 'navigate' && builtin.target === 'sessions') ||
          !capabilities.compactSession && builtin.kind === 'compact') {
          setCommandNotice('Return to the main chat to switch sessions, start a new task, or compact the conversation.');
          return;
        }
        if (builtin.kind === 'compact') compact();
        else if (builtin.kind === 'new') post(vscode, { type: 'session.new' });
        else if (builtin.kind === 'navigate') navigate(builtin.target);
        else if (builtin.kind === 'btw') {
          openBtw();
          if (builtin.question.length > 0) askBtw(builtin.question);
        }
        writeDraft('');
        return;
      }
      const eligibility = {
        sessionId,
        connectionStatus,
        turnStatus,
        interactionCount,
        queuedCount,
        queueEditing: false,
      };
      const queueRoute = shouldQueueMessage(eligibility);
      if (!canSendMessage(eligibility, text, !queueRoute && pending.current)) return;
      setSendSignal((value) => value + 1);
      writeDraft('');
      if (queueRoute) {
        const queueId = createTurnId();
        dispatch({ type: 'queue.add', queueId, text });
        post(vscode, {
          type: 'queue.add',
          sessionId: eligibility.sessionId,
          queueId,
          text,
        });
        if (turnStatus === 'stopping' || state.queue.paused !== null) {
          dispatch({ type: 'queue.promote', queueId });
          post(vscode, {
            type: 'queue.promote',
            sessionId: eligibility.sessionId,
            queueId,
          });
        }
      } else {
        pending.current = true;
        const nextTurnId = createTurnId();
        pendingSend.current = { sessionId: eligibility.sessionId, turnId: nextTurnId, text, revision: draftRevision.current };
        dispatch({ type: 'turn.send', turnId: nextTurnId, text });
        post(vscode, {
          type: 'turn.send',
          sessionId: eligibility.sessionId,
          turnId: nextTurnId,
          text,
        });
      }
    },
    [
      blocked,
      capabilities,
      settingsUpdating,
      finishQueueEdit,
      queueEditingId,
      sessionId,
      connectionStatus,
      turnStatus,
      interactionCount,
      queuedCount,
      state.btwAvailable,
      state.queue.paused,
      compact,
      navigate,
      openBtw,
      askBtw,
      vscode,
      dispatch,
      writeDraft,
    ],
  );
  const handleQueuePromote = useCallback(
    (queueId: string): void => {
      if (sessionId === null) return;
      dispatch({ type: 'queue.promote', queueId });
      post(vscode, { type: 'queue.promote', sessionId, queueId });
    },
    [sessionId, dispatch, vscode],
  );
  const handleQueueEditBegin = useCallback(
    (queueId: string): void => {
      const item = state.queue.items.find((entry) => entry.queueId === queueId);
      if (sessionId === null || item === undefined) return;
      if (previousDraft.current === null) previousDraft.current = draftValue.current;
      dispatch({ type: 'queue.editBegin', queueId });
      setSendSignal((value) => value + 1);
      writeDraft(item.text, true);
    },
    [sessionId, state.queue.items, dispatch, writeDraft],
  );
  const handleQueueEditCancel = useCallback((): void => {
    if (queueEditingId === null) return;
    finishQueueEdit();
  }, [queueEditingId, finishQueueEdit]);
  const handleQueueRemove = useCallback(
    (queueId: string): void => {
      if (sessionId === null) return;
      dispatch({ type: 'queue.remove', queueId });
      post(vscode, { type: 'queue.remove', sessionId, queueId });
    },
    [sessionId, dispatch, vscode],
  );
  const handleQueueResume = useCallback((): void => {
    if (sessionId === null) return;
    dispatch({ type: 'queue.resume' });
    post(vscode, { type: 'queue.resume', sessionId });
  }, [sessionId, dispatch, vscode]);
  const handleQueueClear = useCallback((): void => {
    if (sessionId === null) return;
    dispatch({ type: 'queue.clear' });
    post(vscode, { type: 'queue.clear', sessionId });
  }, [sessionId, dispatch, vscode]);
  const handleCancel = useCallback(async (): Promise<void> => {
    if (
      sessionId === null ||
      turnId === null ||
      (turnStatus !== 'submitting' && turnStatus !== 'streaming' && turnStatus !== 'stopping')
    )
      return;
    post(vscode, { type: 'turn.stop', sessionId, turnId });
    dispatch({ type: 'turn.stop' });
  }, [sessionId, turnId, turnStatus, vscode, dispatch]);
  const sendDisabled =
    blocked ||
    !canSendMessage(
      {
        connectionStatus,
        sessionId,
        turnStatus,
        interactionCount,
        queuedCount,
        queueEditing: queueEditingId !== null,
        settingsUpdating,
      },
      draft,
    );
  const callbacks = useMemo(
    () => ({
      isSendDisabled:
        sendDisabled ||
        (!shouldQueueMessage({ turnStatus, queuedCount }) && pending.current),
      onSend: handleSend,
      onCancel: handleCancel,
    }),
    [sendDisabled, turnStatus, queuedCount, handleSend, handleCancel],
  );
  return {
    draft,
    commandNotice,
    draftCommand,
    sendSignal,
    appendCanvasDraft,
    settleSend,
    handleDraftChange,
    callbacks,
    queueEditingId,
    queuedCount,
    handleQueuePromote,
    handleQueueEditBegin,
    handleQueueEditCancel,
    handleQueueRemove,
    handleQueueResume,
    handleQueueClear,
  };
}
