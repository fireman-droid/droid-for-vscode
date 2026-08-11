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
    // Host messages are coalesced into one dispatch batch per animation
    // frame; during streaming the host can emit deltas faster than the
    // transcript re-renders, and per-message renders saturate the main
    // thread on long sessions. The timeout keeps messages flowing when
    // the webview is hidden and frames stop.
    let queue: NonNullable<ReturnType<typeof readHostMessage>>[] = [];
    let frameId: number | null = null;
    let timerId: ReturnType<typeof setTimeout> | null = null;
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
    announceReady(vscode);
    return () => {
      window.removeEventListener('message', handleMessage);
      flush();
    };
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
  const handleCompact = useCallback((): void => {
    if (sessionId === null) {
      return;
    }
    post(vscode, { type: 'session.compact', sessionId });
  }, [sessionId, vscode]);
  const handleForkSession = useCallback(
    (targetSessionId: string): void => {
      post(vscode, {
        type: 'session.fork',
        sessionId: targetSessionId,
      });
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
          onRenameSession={handleRenameSession}
          onForkSession={handleForkSession}
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
          skills={state.skills}
          mcp={state.mcp}
          onRetry={handleRetry}
          onContextRefresh={handleContextRefresh}
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
          attachments={state.attachments}
          fileSearch={state.fileSearch}
          onFileSearch={handleFileSearch}
          onAttachPath={handleAttachPath}
          onAttachFiles={handleAttachFiles}
          onAttachEditor={handleAttachEditor}
          onAttachSelection={handleAttachSelection}
          onAttachProblems={handleAttachProblems}
          onAttachGitChanges={handleAttachGitChanges}
          onAttachmentRemove={handleAttachmentRemove}
          onDraftChange={handleDraftChange}
          onReuseMessage={handleReuseMessage}
          onEditResend={handleEditResend}
          rewindInfo={state.rewindInfo}
          onRequestRewindInfo={handleRequestRewindInfo}
          onRegenerate={
            connectionStatus === 'connected' &&
            !active &&
            !hasInteraction &&
            regenerateAnchor !== null
              ? handleRegenerate
              : null
          }
          onOpenFileDiff={handleOpenFileDiff}
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
}

function Header({
  state,
  sessionActionsDisabled,
  onNewSession,
  onSelectSession,
  onRenameSession,
  onForkSession,
}: {
  readonly state: typeof initialAssistantWebviewState;
  readonly sessionActionsDisabled: boolean;
  readonly onNewSession: () => void;
  readonly onSelectSession: (sessionId: string) => void;
  readonly onRenameSession: (sessionId: string, title: string) => void;
  readonly onForkSession: (sessionId: string) => void;
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
          onRenameSession={onRenameSession}
          onForkSession={onForkSession}
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
