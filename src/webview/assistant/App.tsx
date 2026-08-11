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
  type WebviewToHostMessage,
} from '../../shared/bridgeMessages';
import {
  announceReady,
  getVsCodeApi,
  persistDraft,
  readHostMessage,
  restoreDraft,
} from '../bridge/vscode';
import { InteractionPanel } from './Interactions';
import type { SessionSettingSelection } from './ComposerControls';
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
  const draftCommandIdRef = useRef(0);
  const [draftCommand, setDraftCommand] = useState(() => ({
    id: draftCommandIdRef.current,
    text: initialDraft,
  }));
  const sendPendingRef = useRef(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>): void => {
      const message = readHostMessage(event.data);
      if (message !== undefined) {
        sendPendingRef.current = false;
        dispatch({ type: 'host.message', message });
      }
    };
    window.addEventListener('message', handleMessage);
    persistDraft(vscode, initialDraft);
    announceReady(vscode);
    return () => window.removeEventListener('message', handleMessage);
  }, [initialDraft, vscode]);

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
  const handleSend = useCallback(
    async (text: string): Promise<void> => {
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
      setDraft('');
      persistDraft(vscode, '');
    },
    [
      connectionStatus,
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
  const handleReuseMessage = useCallback(
    (text: string): void => {
      const nextDraft = text.slice(0, MAX_TURN_TEXT_LENGTH);
      setDraft(nextDraft);
      persistDraft(vscode, nextDraft);
      draftCommandIdRef.current += 1;
      setDraftCommand({
        id: draftCommandIdRef.current,
        text: nextDraft,
      });
    },
    [vscode],
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
  const handleSelectSession = useCallback(
    (nextSessionId: string): void => {
      post(vscode, {
        type: 'session.select',
        sessionId: nextSessionId,
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
  const inlineInteraction =
    state.interactions.length > 0 ? (
      <InteractionPanel
        requests={state.interactions}
        onPermissionRespond={handlePermissionRespond}
        onAskUserRespond={handleAskUserRespond}
      />
    ) : null;

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <DraftSynchronizer command={draftCommand} />
      <div className="dvx-shell">
        <Header
          state={state}
          sessionActionsDisabled={sessionActionsDisabled}
          onNewSession={handleNewSession}
          onSelectSession={handleSelectSession}
        />
        <DroidThread
          pending={showPending}
          activity={state.turn?.activity}
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
          modelCatalog={state.modelCatalog}
          onRetry={handleRetry}
          onContextRefresh={handleContextRefresh}
          onSettingUpdate={handleSettingUpdate}
          onDraftChange={handleDraftChange}
          onReuseMessage={handleReuseMessage}
          inlineInteraction={inlineInteraction}
        />
      </div>
    </AssistantRuntimeProvider>
  );
}

function Header({
  state,
  sessionActionsDisabled,
  onNewSession,
  onSelectSession,
}: {
  readonly state: typeof initialAssistantWebviewState;
  readonly sessionActionsDisabled: boolean;
  readonly onNewSession: () => void;
  readonly onSelectSession: (sessionId: string) => void;
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
          actionsDisabled={sessionActionsDisabled}
          onSelectSession={onSelectSession}
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
