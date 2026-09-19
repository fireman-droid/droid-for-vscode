import { useCallback, useMemo, useRef, useState, type Dispatch } from 'react';
import { MAX_TURN_TEXT_LENGTH } from '../../../shared/protocol/bounds';
import { persistDraft, restoreDraft } from '../../bridge/vscode';
import { createTurnId, post, type ChatPort } from '../shell/chatIntent';
import { canSendMessage, shouldQueueMessage } from './sendEligibility';
import {
  CANVAS_REQUEST_TEMPLATE,
  resolveBuiltinSlash,
  type SlashNavTarget,
} from './slashBuiltins';
import { type AssistantWebviewAction, type AssistantWebviewState } from '../state/types';

type InputState = Pick<
  AssistantWebviewState,
  | 'sessionId'
  | 'connection'
  | 'turn'
  | 'interactions'
  | 'queue'
  | 'queueEditing'
  | 'btwAvailable'
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
  },
) {
  const [draft, setDraft] = useState(() => restoreDraft(vscode));
  const draftValue = useRef(draft);
  const [draftCommand, setDraftCommand] = useState({ id: 0, text: draft });
  const [sendSignal, setSendSignal] = useState(0);
  const pending = useRef(false);
  const writeDraft = useCallback(
    (text: string, replaceComposer = false): void => {
      draftValue.current = text;
      setDraft(text);
      if (replaceComposer) setDraftCommand((command) => ({ id: command.id + 1, text }));
      persistDraft(vscode, text);
    },
    [vscode],
  );
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
  const { blocked, compact, navigate, openBtw, askBtw } = routes;
  const handleSend = useCallback(
    async (text: string): Promise<void> => {
      if (blocked) return;
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
        writeDraft('');
        return;
      }
      const builtin = resolveBuiltinSlash(text, { btwEnabled: state.btwAvailable });
      if (builtin !== null) {
        if (builtin.kind === 'compact') compact();
        else if (builtin.kind === 'new') post(vscode, { type: 'session.new' });
        else if (builtin.kind === 'navigate') navigate(builtin.target);
        else if (builtin.kind === 'btw') {
          openBtw();
          if (builtin.question.length > 0) askBtw(builtin.question);
        } else if (builtin.kind === 'canvas') {
          writeDraft(
            builtin.request.length === 0
              ? CANVAS_REQUEST_TEMPLATE
              : `Create an interactive Canvas artifact for:\n\n${builtin.request}`,
            true,
          );
          return;
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
        dispatch({ type: 'turn.send', turnId: nextTurnId, text });
        post(vscode, {
          type: 'turn.send',
          sessionId: eligibility.sessionId,
          turnId: nextTurnId,
          text,
        });
      }
      setSendSignal((value) => value + 1);
      writeDraft('');
    },
    [
      blocked,
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
      dispatch({ type: 'queue.editBegin', queueId });
      setSendSignal((value) => value + 1);
      writeDraft(item.text, true);
    },
    [sessionId, state.queue.items, dispatch, writeDraft],
  );
  const handleQueueEditCancel = useCallback((): void => {
    if (queueEditingId === null) return;
    dispatch({ type: 'queue.editEnd' });
    writeDraft('', true);
  }, [queueEditingId, dispatch, writeDraft]);
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
      (turnStatus !== 'submitting' && turnStatus !== 'streaming')
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
